import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  /** Money values arrive as decimal strings → rendered as numbers with '#,##0'. */
  money?: boolean;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Array<Record<string, unknown>>;
}

export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Generic XLSX builder shared by every report export (spec §M12). */
@Injectable()
export class XlsxService {
  async buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();

    for (const spec of sheets) {
      const ws = wb.addWorksheet(spec.name);
      ws.columns = spec.columns.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width ?? 18,
      }));
      ws.getRow(1).font = { bold: true };

      for (const row of spec.rows) {
        const values: Record<string, unknown> = {};
        for (const c of spec.columns) {
          const v = row[c.key];
          values[c.key] =
            c.money && typeof v === 'string' && v !== '' ? Number(v) : (v ?? null);
        }
        ws.addRow(values);
      }

      for (const c of spec.columns) {
        if (c.money) {
          const col = ws.getColumn(c.key);
          col.numFmt = '#,##0';
        }
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }
}
