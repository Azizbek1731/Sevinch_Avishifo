import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  ErrorCode,
  aiBillExtractResultSchema,
  type AiBillExtractResult,
  type AuthUser,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { AppConfigService } from '../../core/config/app-config.service';
import { AuditService } from '../../core/audit/audit.service';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const MAX_BYTES = 12 * 1024 * 1024;

const SYSTEM_PROMPT = `Siz klinika statsionar hisob-blankasini (СЧЁТ-СОГЛАШЕНИЕ / счёт-соглашение) o‘qiyotgan yordamchisiz.
Vazifa: rasmdagi HAR BIR alohida pullik qatorni JSON qilib chiqarish.

Muhim:
- Bu qo‘lda yozilgan blanka. Chapda nom, o‘ngda summa. Qavs/chiziq bilan birlashtirilgan GURUH JAMI (masalan 804000, 367000, 850000, 2021000) — alohida qator EMAS.
- Katta summalarni o‘tkazib yubormang (masalan «Аренда за опер.» ~ millions).
- «O‘rin kuni / Урин куни / койка» alohida qator — kun soni × narx.
- Bir qatorda bir nechta nom vergul bilan yozilgan bo‘lsa (EKG, Kardiolog) — bitta qator qilib, bitta summani yozing; ixtiyoriy bo‘lishsa ajrating.
- Subtotal / Итого / umumiy yig‘indini qator qilmang.
- Miqdor ko‘rsatilmasa quantity=1.
- unitPrice — faqat raqam, nuqta bilan ("3700000.00"); bo‘shliq/minglik ajratuvchisiz.
- title — blankadagi matnga yaqin (o‘zbek/rus); o‘ylab yangi xizmat invent qilmang.
- Nom noaniq, lekin summa aniq bo‘lsa: title ga eng yaqin o‘qilgan matn, note ga "aniqlashtirish kerak".
- patientName / doctorName blankadan (bo‘lmasa null).

Javob FAQAT JSON:
{
  "patientName": string|null,
  "doctorName": string|null,
  "notes": string|null,
  "lines": [{ "title": string, "quantity": number, "unitPrice": string, "note": string|null }]
}`;

@Injectable()
export class BillScanService {
  private readonly logger = new Logger(BillScanService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    const key = this.config.env.OPENAI_API_KEY;
    return Boolean(key && key.trim());
  }

  get model(): string {
    return this.config.env.OPENAI_BILL_MODEL || 'gpt-5.6-terra';
  }

  async extractFromImage(
    file: Express.Multer.File,
    user: AuthUser,
  ): Promise<AiBillExtractResult & { model: string }> {
    if (!this.enabled) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Hisob rasmini AI o‘qish hozircha yoqilmagan. OPENAI_API_KEY ni .env ga qo‘ying.',
        503,
      );
    }
    if (!file?.buffer?.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Rasm fayli kerak', 400);
    }
    if (file.size > MAX_BYTES) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Rasm 12 MB dan katta bo‘lmasin', 400);
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Faqat JPEG, PNG, WEBP yoki HEIC rasm yuklang',
        400,
      );
    }

    const model = this.config.env.OPENAI_BILL_MODEL || 'gpt-5.6-terra';
    const b64 = file.buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    let rawText: string;
    try {
      rawText = await this.callOpenAi(model, dataUrl);
    } catch (error) {
      this.logger.error(`OpenAI bill scan failed: ${(error as Error).message}`);
      throw error instanceof AppException
        ? error
        : new AppException(ErrorCode.VALIDATION_ERROR, 'AI rasmni o‘qiy olmadi. Qayta urinib ko‘ring.', 502);
    }

    const parsed = this.parsePayload(rawText);
    await this.audit.log({
      action: AuditAction.EXPORT,
      entity: 'BillScan',
      entityId: user.id,
      after: {
        model,
        lineCount: parsed.lines.length,
        bytes: file.size,
        mime,
      },
    });
    return { ...parsed, model };
  }

  private async callOpenAi(model: string, dataUrl: string): Promise<string> {
    const key = this.config.env.OPENAI_API_KEY!.trim();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Shu hisob-blankadagi pullik qatorlarni JSON qilib chiqaring. Subtotallarni qator qilmang.',
              },
              {
                type: 'image_url',
                // high keeps cost down; original is better for dense handwriting when supported
                image_url: { url: dataUrl, detail: 'high' },
              },
            ],
          },
        ],
      }),
    });

    const body = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    if (!res.ok) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        body.error?.message || `OpenAI xatosi (${res.status})`,
        502,
      );
    }
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'AI bo‘sh javob qaytardi', 502);
    }
    return text;
  }

  private parsePayload(raw: string): AiBillExtractResult {
    let json: unknown;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      json = JSON.parse(cleaned);
    } catch {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'AI javobini o‘qib bo‘lmadi', 502);
    }

    const root = json as { lines?: unknown[]; patientName?: unknown; doctorName?: unknown; notes?: unknown };
    const lines = Array.isArray(root.lines) ? root.lines : [];
    const normalized = {
      patientName: typeof root.patientName === 'string' ? root.patientName : null,
      doctorName: typeof root.doctorName === 'string' ? root.doctorName : null,
      notes: typeof root.notes === 'string' ? root.notes : null,
      lines: lines
        .map((row) => this.normalizeLine(row))
        .filter((row): row is NonNullable<typeof row> => row !== null),
    };

    const parsed = aiBillExtractResultSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'AI chiqargan qatorlar formati noto‘g‘ri',
        502,
      );
    }
    return parsed.data;
  }

  private normalizeLine(row: unknown): { title: string; quantity: number; unitPrice: string; note?: string } | null {
    if (!row || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;
    const title = String(r.title ?? r.name ?? '').trim();
    if (!title) return null;
    const quantityRaw = Number(r.quantity ?? r.qty ?? 1);
    const quantity = Number.isFinite(quantityRaw) ? Math.min(999, Math.max(1, Math.round(quantityRaw))) : 1;
    const priceRaw = String(r.unitPrice ?? r.price ?? r.amount ?? '')
      .replace(/\s/g, '')
      .replace(/,/g, '')
      .replace(/[^\d.]/g, '');
    if (!priceRaw || !/^\d+(\.\d{1,2})?$/.test(priceRaw)) return null;
    // Skip obvious zero-noise and absurdly tiny placeholders unless explicit 0 for free line
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 300) : undefined;
    return {
      title: title.slice(0, 200),
      quantity,
      unitPrice: priceRaw.includes('.') ? Number(priceRaw).toFixed(2) : `${priceRaw}.00`,
      ...(note ? { note } : {}),
    };
  }
}
