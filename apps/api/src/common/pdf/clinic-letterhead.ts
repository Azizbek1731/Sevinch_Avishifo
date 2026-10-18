import sharp from 'sharp';

export interface PdfClinicProfile {
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  logoUrl?: string | null;
}

export const CLINIC_PDF_COLORS = {
  blue: '#164c91',
  red: '#cf323b',
  ink: '#172b46',
  muted: '#62748a',
  rule: '#d8e3ee',
  pale: '#f2f6fb',
};

export function formalClinicName(clinic: PdfClinicProfile): string {
  return clinic.legalName?.trim() || clinic.name.trim();
}

/**
 * A persisted logo is data, never a URL for the PDF server to fetch. Decode only
 * small inline PNG/JPEG images, check their real format and cap decoded pixels.
 * Unsupported, corrupt or oversized logos fall back to the clinic text.
 */
export async function preparePdfClinicLogo(value: string | null | undefined): Promise<Buffer | null> {
  if (!value || value.length > 800_000) return null;
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2]!, 'base64');
  if (!bytes.length || bytes.length > 600_000) return null;
  try {
    const options = { limitInputPixels: 16_000_000, failOn: 'warning' as const };
    const image = sharp(bytes, options);
    const metadata = await image.metadata();
    const expectedFormat = match[1]!.toLowerCase() === 'png' ? 'png' : 'jpeg';
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height ||
        (metadata.pages ?? 1) !== 1) return null;
    const flattened = await image
      .rotate()
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
    const trimmed = await sharp(flattened, options)
      .trim({ background: '#ffffff', threshold: 12 })
      .png()
      .toBuffer();
    // Sharp can reorder flatten/resize around trim in one pipeline. Separate
    // bounded passes also trim transparent white padding in uploaded PNGs.
    return await sharp(trimmed, options)
      .resize({ width: 900, height: 360, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** Full first-page letterhead. Text and logo occupy distinct bounded columns. */
export function drawClinicLetterhead(
  doc: PDFKit.PDFDocument,
  clinic: PdfClinicProfile,
  logo: Buffer | null,
  margin: number,
): void {
  const width = doc.page.width - margin * 2;
  const top = margin;
  const logoWidth = 136;
  const logoHeight = 54;
  const textX = logo ? margin + logoWidth + 22 : margin;
  const textWidth = width - (textX - margin);
  if (logo) doc.image(logo, margin, top, { fit: [logoWidth, logoHeight], valign: 'center' });
  doc.font('bold').fontSize(14).fillColor(CLINIC_PDF_COLORS.blue)
    .text(formalClinicName(clinic), textX, top, { width: textWidth, lineGap: 2 });
  let textBottom = doc.y;
  const phone = clinic.phone?.replace(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/, '+998 $1 $2 $3 $4');
  for (const line of [clinic.address, phone]) {
    if (!line?.trim()) continue;
    doc.font('body').fontSize(8.5).fillColor(CLINIC_PDF_COLORS.muted)
      .text(line.trim(), textX, textBottom + 5, { width: textWidth, lineGap: 1 });
    textBottom = doc.y;
  }
  const bottom = Math.max(textBottom, top + (logo ? logoHeight : 38)) + 12;
  doc.moveTo(margin, bottom).lineTo(margin + width, bottom)
    .lineWidth(1.3).strokeColor(CLINIC_PDF_COLORS.blue).stroke();
  doc.moveTo(margin + width - 62, bottom).lineTo(margin + width, bottom)
    .lineWidth(2.4).strokeColor(CLINIC_PDF_COLORS.red).stroke();
  doc.x = margin;
  doc.y = bottom + 15;
}

/** Buffered-page decoration; continuation text starts below the reserved band. */
export function drawClinicPageFurniture(
  doc: PDFKit.PDFDocument,
  clinic: PdfClinicProfile,
  options: { margin: number; documentLabel: string; documentId: string; pageLabel?: string },
): void {
  const pages = doc.bufferedPageRange();
  const { margin, documentLabel, documentId, pageLabel = 'Sahifa' } = options;
  const name = formalClinicName(clinic);
  for (let page = pages.start; page < pages.start + pages.count; page += 1) {
    doc.switchToPage(page);
    const width = doc.page.width - margin * 2;
    // Footer is deliberately outside the content area; disable automatic
    // pagination only during this final, bounded decoration pass.
    doc.page.margins.bottom = 0;
    if (page > pages.start) {
      doc.font('bold').fontSize(8).fillColor(CLINIC_PDF_COLORS.blue)
        .text(name, margin, 32, { width: width * 0.54, height: 13, ellipsis: true, lineBreak: false });
      doc.font('body').fontSize(7.5).fillColor(CLINIC_PDF_COLORS.muted)
        .text(documentLabel, margin + width * 0.56, 32,
          { width: width * 0.44, height: 13, ellipsis: true, align: 'right', lineBreak: false });
      doc.moveTo(margin, 54).lineTo(margin + width, 54)
        .lineWidth(0.6).strokeColor(CLINIC_PDF_COLORS.rule).stroke();
    }
    const footerY = doc.page.height - 40;
    doc.moveTo(margin, footerY - 8).lineTo(margin + width, footerY - 8)
      .lineWidth(0.6).strokeColor(CLINIC_PDF_COLORS.rule).stroke();
    doc.font('body').fontSize(7).fillColor(CLINIC_PDF_COLORS.muted)
      .text(`${documentId} · AviShifo`, margin, footerY,
        { width: width - 90, height: 13, ellipsis: true, lineBreak: false });
    doc.text(`${pageLabel} ${page - pages.start + 1} / ${pages.count}`,
      margin + width - 90, footerY,
      { width: 90, align: 'right', lineBreak: false });
  }
}
