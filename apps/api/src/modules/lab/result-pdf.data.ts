import type { Prisma } from '@prisma/client';
import { ageInDays, matchReferenceRange, type PatientContext } from '@avishifo/shared';
import { parseReferenceRanges } from './reference-ranges';
import type { ResultPdfData } from './result-pdf.service';

/** The exact include the PDF needs — share it so every caller fetches the same shape. */
export const RESULT_PDF_INCLUDE = {
  patient: true,
  items: {
    include: {
      labTest: { include: { parameters: true } },
      result: { include: { values: true, reportDocument: true } },
    },
  },
} satisfies Prisma.LabOrderInclude;

type OrderForPdf = Prisma.LabOrderGetPayload<{ include: typeof RESULT_PDF_INCLUDE }>;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * Assemble the renderer's input from raw rows.
 *
 * Exists because the portal and the Telegram bot run before any tenant context
 * and cannot call the staff-side LabService — but the PDF a patient downloads
 * must match the one the clinic prints to the letter, so both paths meet here:
 * the same reference-interval matching, the same patient context, one shape.
 */
export function buildResultPdfData(
  order: OrderForPdf,
  clinic: { name: string; legalName: string | null; address: string | null; phone: string | null },
  approvedBy: { fullName: string } | null,
): ResultPdfData {
  const ctx: PatientContext = {
    gender: order.patient.gender,
    ageDays: ageInDays(order.patient.dob, order.collectedAt ?? order.createdAt),
    state: order.physiologicalState,
  };

  return {
    clinic,
    approvedBy,
    order: {
      orderNumber: order.orderNumber,
      createdAt: iso(order.createdAt),
      collectedAt: iso(order.collectedAt),
      physiologicalState: order.physiologicalState,
      patient: {
        mrn: order.patient.mrn,
        fullName: order.patient.fullName,
        dob: order.patient.dob ? order.patient.dob.toISOString().slice(0, 10) : null,
        gender: order.patient.gender,
      },
      items: order.items.map((it) => ({
        labTest: {
          code: it.labTest.code,
          name: (it.labTest.name ?? {}) as Record<string, string>,
          parameters: [...it.labTest.parameters]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((p) => {
              const ranges = parseReferenceRanges(p.referenceRanges);
              return {
                id: p.id,
                name: p.name,
                unit: p.unit,
                referenceRanges: ranges,
                matchedRange: matchReferenceRange(ranges, ctx),
              };
            }),
        },
        result: it.result
          ? {
              note: it.result.note,
              approvedAt: iso(it.result.approvedAt),
              reportDocument: it.result.reportDocument
                ? {
                    id: it.result.reportDocument.id,
                    title: it.result.reportDocument.title,
                    fileName: it.result.reportDocument.fileName,
                  }
                : null,
              values: it.result.values.map((v) => ({
                parameterId: v.parameterId,
                value: v.value,
                flag: v.flag,
              })),
            }
          : null,
      })),
    },
  };
}
