/**
 * Minimal single-page PDF writer: embeds one JPEG (DCTDecode) at 1:1 scale.
 * Enough for "export this page as PDF" without pulling a PDF library into the app.
 */
export function jpegToPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const objects: Buffer[] = [];
  const push = (value: string | Buffer) => objects.push(typeof value === "string" ? Buffer.from(value, "latin1") : value);

  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;

  push("%PDF-1.4\n");
  const offsets: number[] = [];
  let cursor = objects[0]!.length;

  const addObject = (body: string | Buffer[]) => {
    offsets.push(cursor);
    const parts = Array.isArray(body) ? body : [Buffer.from(body, "latin1")];
    for (const part of parts) {
      push(part);
      cursor += part.length;
    }
  };

  addObject(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  addObject(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
  addObject(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n`
  );
  addObject([
    Buffer.from(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      "latin1"
    ),
    jpeg,
    Buffer.from(`\nendstream\nendobj\n`, "latin1")
  ]);
  addObject(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefOffset = cursor;
  const xref = [
    "xref",
    `0 ${offsets.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${offsets.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF"
  ].join("\n");
  push(xref);

  return Buffer.concat(objects);
}
