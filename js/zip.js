/*
 * Lector de .zip mínimo (sin dependencias) para abrir directamente las
 * descargas de Google Fotos. Lee solo el índice del archivo y extrae cada
 * foto bajo demanda, así un .zip grande no se carga entero en memoria.
 * Admite ZIP64 (descargas de más de 4 GB) y compresión «deflate».
 */
const ZipReader = (() => {
  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    avif: 'image/avif', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  };
  const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif|heic|heif)$/i;

  const isZip = (f) => /\.zip$/i.test(f.name) || /zip/.test(f.type);

  async function bytes(file, start, len) {
    return new DataView(await file.slice(start, start + len).arrayBuffer());
  }

  function dosDate(time, date) {
    const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
    return isNaN(d) ? Date.now() : d.getTime();
  }

  /** Lista las fotos que contiene el .zip (sin extraerlas). */
  async function imageEntries(file) {
    const tailLen = Math.min(file.size, 65557 + 20);
    const tail = await bytes(file, file.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('el archivo está dañado o no se descargó completo');
    let count = tail.getUint16(eocd + 10, true);
    let cdSize = tail.getUint32(eocd + 12, true);
    let cdOff = tail.getUint32(eocd + 16, true);
    if (eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
      const z = await bytes(file, Number(tail.getBigUint64(eocd - 12, true)), 56);
      if (z.getUint32(0, true) === 0x06064b50) {
        count = Number(z.getBigUint64(32, true));
        cdSize = Number(z.getBigUint64(40, true));
        cdOff = Number(z.getBigUint64(48, true));
      }
    }

    const cd = await bytes(file, cdOff, cdSize);
    const dec = new TextDecoder();
    const out = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const flags = cd.getUint16(p + 8, true);
      const method = cd.getUint16(p + 10, true);
      const modified = dosDate(cd.getUint16(p + 12, true), cd.getUint16(p + 14, true));
      let csize = cd.getUint32(p + 20, true);
      let usize = cd.getUint32(p + 24, true);
      const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
      let local = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      let x = p + 46 + nlen;
      const xend = x + xlen;
      while (x + 4 <= xend) {
        const id = cd.getUint16(x, true), size = cd.getUint16(x + 2, true);
        if (id === 0x0001) { // campos ZIP64
          let q = x + 4;
          if (usize === 0xffffffff) { usize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (local === 0xffffffff) local = Number(cd.getBigUint64(q, true));
        }
        x += 4 + size;
      }
      p = xend + clen;

      const base = name.split('/').pop();
      if (!IMAGE_RE.test(base) || base.startsWith('.') || name.includes('__MACOSX/') || flags & 1) continue;
      out.push({ name, base, method, csize, usize, local, modified });
    }
    return out;
  }

  /** Extrae una foto del .zip como File. */
  async function extract(file, e) {
    const h = await bytes(file, e.local, 30);
    if (h.getUint32(0, true) !== 0x04034b50) throw new Error('entrada dañada');
    const start = e.local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const raw = file.slice(start, start + e.csize);
    const type = MIME[e.base.split('.').pop().toLowerCase()] || '';
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('actualiza el navegador para abrir archivos .zip');
      data = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    } else throw new Error('compresión no admitida');
    return new File([data], e.base, { type, lastModified: e.modified });
  }

  return { isZip, imageEntries, extract };
})();

if (typeof module !== 'undefined') module.exports = ZipReader;
