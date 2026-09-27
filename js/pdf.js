/*
 * Generador de PDF mínimo (sin dependencias) para imprenta: una imagen JPEG
 * por página, con MediaBox que incluye el sangrado y TrimBox con el corte final.
 */
const PdfWriter = (() => {
  const MM_TO_PT = 72 / 25.4;
  const num = (v) => (Math.round(v * 1000) / 1000).toString();

  /**
   * @param pages [{ jpeg: Blob, pxW, pxH, wMm, hMm, bleedMm }]
   * @returns Blob application/pdf
   */
  function build(pages, meta = {}) {
    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let offset = 0;
    const push = (x) => {
      if (typeof x === 'string') x = enc.encode(x);
      parts.push(x);
      offset += x.size !== undefined ? x.size : x.length;
    };
    const begin = (n) => { offsets[n] = offset; push(`${n} 0 obj\n`); };
    const end = () => push('\nendobj\n');

    push('%PDF-1.4\n');
    push(new Uint8Array([37, 226, 227, 207, 211, 10]));

    const pageIds = pages.map((_, i) => 4 + i * 3);
    begin(1); push('<< /Type /Catalog /Pages 2 0 R >>'); end();
    begin(2); push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`); end();
    // Texto UTF-16BE en hexadecimal para conservar tildes y eñes.
    const utf16 = (s) => 'FEFF' + [...s].map((ch) => {
      const c = ch.codePointAt(0);
      if (c <= 0xffff) return c.toString(16).padStart(4, '0');
      const v = c - 0x10000;
      return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16));
    }).join('').toUpperCase();
    begin(3); push(`<< /Title <${utf16(meta.title || 'Álbum')}> /Producer (Estudio Album) >>`); end();

    pages.forEach((p, i) => {
      const pid = pageIds[i], cid = pid + 1, iid = pid + 2;
      const bl = p.bleedMm || 0;
      const W = (p.wMm + 2 * bl) * MM_TO_PT, H = (p.hMm + 2 * bl) * MM_TO_PT;
      const b = bl * MM_TO_PT;
      begin(pid);
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] ` +
        `/BleedBox [0 0 ${num(W)} ${num(H)}] /TrimBox [${num(b)} ${num(b)} ${num(W - b)} ${num(H - b)}] ` +
        `/Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
      end();
      const content = `q\n${num(W)} 0 0 ${num(H)} 0 0 cm\n/Im0 Do\nQ\n`;
      begin(cid); push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`); end();
      begin(iid);
      push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.size} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
      end();
    });

    const count = 3 + pages.length * 3;
    const xrefAt = offset;
    let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= count; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  return { build };
})();

if (typeof module !== 'undefined') module.exports = PdfWriter;
