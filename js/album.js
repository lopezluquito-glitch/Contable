/*
 * Maquetación del álbum: tamaños de página, plantillas, diseño automático y
 * dibujo de cada página sobre un canvas a cualquier resolución (px por mm).
 */
const Album = (() => {
  const SIZES = {
    '20x20': { label: '20 × 20 cm (cuadrado)', w: 200, h: 200 },
    '30x30': { label: '30 × 30 cm (cuadrado grande)', w: 300, h: 300 },
    '30x20': { label: '30 × 20 cm (apaisado)', w: 300, h: 200 },
    'A4h':   { label: 'A4 apaisado (29,7 × 21 cm)', w: 297, h: 210 },
    'A4v':   { label: 'A4 vertical (21 × 29,7 cm)', w: 210, h: 297 },
    '20x30': { label: '20 × 30 cm (vertical)', w: 200, h: 300 },
  };

  const THEMES = {
    gallery: { label: 'Galería blanca', bg: '#ffffff', text: '#1f1f1f', muted: '#8a8a8a' },
    ivory:   { label: 'Marfil',         bg: '#f5efe4', text: '#3b3128', muted: '#9a8b78' },
    sage:    { label: 'Salvia',         bg: '#e7ebe2', text: '#2f3a2c', muted: '#7d8977' },
    charcoal:{ label: 'Carbón',         bg: '#1e1e20', text: '#f1f1f1', muted: '#9a9a9a' },
    black:   { label: 'Negro',          bg: '#000000', text: '#eeeeee', muted: '#8f8f8f' },
  };

  // Rectángulos en fracciones del área de contenido [x, y, w, h].
  const TEMPLATES = {
    full:      { label: 'Foto a sangre', bleed: true, slots: [[0, 0, 1, 1]] },
    single:    { label: '1 foto con marco', slots: [[0, 0, 1, 1]] },
    'two-v':   { label: '2 fotos lado a lado', slots: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
    'two-h':   { label: '2 fotos apiladas', slots: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
    'two-big': { label: '2 fotos (grande + pequeña)', slots: [[0, 0, 0.62, 1], [0.62, 0.3, 0.38, 0.4]] },
    'three-l': { label: '3 fotos (grande izquierda)', slots: [[0, 0, 0.62, 1], [0.62, 0, 0.38, 0.5], [0.62, 0.5, 0.38, 0.5]] },
    'three-t': { label: '3 fotos (grande arriba)', slots: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
    'three-c': { label: '3 fotos en columnas', slots: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
    four:      { label: '4 fotos en cuadrícula', slots: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
    'four-l':  { label: '4 fotos (grande + 3)', slots: [[0, 0, 0.66, 1], [0.66, 0, 0.34, 1 / 3], [0.66, 1 / 3, 0.34, 1 / 3], [0.66, 2 / 3, 0.34, 1 / 3]] },
    six:       { label: '6 fotos', slots: [[0, 0, 1 / 3, 0.5], [1 / 3, 0, 1 / 3, 0.5], [2 / 3, 0, 1 / 3, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]] },
  };

  const DEFAULT_SETTINGS = {
    size: '20x20',
    theme: 'gallery',
    margin: 14,       // mm
    gutter: 4,        // mm
    bleed: 3,         // mm (solo en la exportación para imprenta)
    title: 'Nuestro álbum',
    subtitle: '',
    coverStyle: 'overlay', // overlay | classic
  };

  const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';
  const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

  function pageSize(settings) {
    return SIZES[settings.size] || SIZES['20x20'];
  }

  /** Rectángulos de los huecos en mm (sin sangrado), para una página. */
  function slotRects(page, settings) {
    const { w, h } = pageSize(settings);
    if (page.type === 'cover') {
      if (settings.coverStyle === 'classic') {
        const m = settings.margin * 1.3;
        return [{ x: m, y: m, w: w - 2 * m, h: (h - 2 * m) * 0.72 }];
      }
      return [{ x: 0, y: 0, w, h, bleed: true }];
    }
    const t = TEMPLATES[page.template] || TEMPLATES.single;
    if (t.bleed) return [{ x: 0, y: 0, w, h, bleed: true }];
    const m = settings.margin;
    const captionSpace = page.caption ? Math.max(8, h * 0.06) : 0;
    const cw = w - 2 * m, ch = h - 2 * m - captionSpace;
    const g = settings.gutter / 2;
    return t.slots.map(([sx, sy, sw, sh]) => {
      const l = sx > 0.001 ? g : 0, r = sx + sw < 0.999 ? g : 0;
      const tp = sy > 0.001 ? g : 0, b = sy + sh < 0.999 ? g : 0;
      return { x: m + sx * cw + l, y: m + sy * ch + tp, w: sw * cw - l - r, h: sh * ch - tp - b };
    });
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    arr.forEach((v, i) => {
      permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).forEach((p) => out.push([v, ...p]));
    });
    return out;
  }

  /** Mejor asignación foto→hueco según proporciones (minimiza el recorte). */
  function fitTemplate(template, photos, settings) {
    const rects = slotRects({ type: 'page', template }, settings);
    if (rects.length !== photos.length) return null;
    let best = null;
    for (const perm of permutations(photos.map((_, i) => i))) {
      let cost = 0;
      perm.forEach((pi, si) => {
        const ar = photos[pi].w / photos[pi].h;
        const sar = rects[si].w / rects[si].h;
        cost += Math.abs(Math.log(ar / sar));
      });
      if (!best || cost < best.cost) best = { cost, order: perm.map((pi) => photos[pi].id) };
    }
    return best;
  }

  /**
   * Diseño automático: portada con la mejor foto, fotos destacadas a página
   * completa y el resto en composiciones variadas que respetan la orientación.
   */
  function autoLayout(photos, settings) {
    if (!photos.length) return [];
    const scores = photos.map((p) => p.score || 0).sort((a, b) => b - a);
    const heroCut = scores[Math.max(0, Math.floor(photos.length * 0.12) - 1)] ?? Infinity;
    const coverPhoto = photos.reduce((a, b) => ((b.score || 0) > (a.score || 0) ? b : a));
    const pages = [{ type: 'cover', photos: [coverPhoto.id] }];
    const rest = photos.filter((p) => p !== coverPhoto);
    const rhythm = [2, 3, 1, 4, 2, 3, 2, 1];
    let step = 0, prev = null, i = 0;

    while (i < rest.length) {
      let count = rhythm[step++ % rhythm.length];
      if ((rest[i].score || 0) >= heroCut && prev !== 'full' && prev !== 'single') count = 1;
      count = Math.min(count, rest.length - i);
      const group = rest.slice(i, i + count);
      let best = null;
      for (const [key, t] of Object.entries(TEMPLATES)) {
        if (t.slots.length !== count) continue;
        const fit = fitTemplate(key, group, settings);
        if (!fit) continue;
        let cost = fit.cost + (key === prev ? 0.6 : 0);
        if (key === 'full') cost += group[0].w >= group[0].h ? -0.05 : 0.4;
        if (!best || cost < best.cost) best = { ...fit, cost, key };
      }
      pages.push({ type: 'page', template: best.key, photos: best.order, caption: '' });
      prev = best.key;
      i += count;
    }
    return pages;
  }

  /** Dibuja la imagen cubriendo el rectángulo, centrada en el punto de interés. */
  function drawCover(ctx, img, x, y, w, h, focus) {
    const iw = img.width, ih = img.height;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale, sh = h / scale;
    const fx = focus ? focus.x : 0.5, fy = focus ? focus.y : 0.5;
    const sx = Math.min(Math.max(fx * iw - sw / 2, 0), iw - sw);
    const sy = Math.min(Math.max(fy * ih - sh / 2, 0), ih - sh);
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function fitText(ctx, text, maxW, size, family, weight) {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (ctx.measureText(text).width > maxW && s > 6) {
      s *= 0.92;
      ctx.font = `${weight} ${s}px ${family}`;
    }
    return s;
  }

  /**
   * Dibuja una página.
   * @param ctx      contexto 2D del canvas destino
   * @param opts     { pxPerMm, bleed (mm), getImage(id) -> {img, focus} | null, placeholders }
   */
  function renderPage(ctx, page, settings, opts) {
    const { w, h } = pageSize(settings);
    const k = opts.pxPerMm;
    const bl = opts.bleed || 0;
    const theme = THEMES[settings.theme] || THEMES.gallery;
    const W = (w + 2 * bl) * k, H = (h + 2 * bl) * k;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    const rects = slotRects(page, settings);
    rects.forEach((r, idx) => {
      // Los huecos que tocan el borde se extienden al sangrado.
      let x = (r.x + bl) * k, y = (r.y + bl) * k, rw = r.w * k, rh = r.h * k;
      if (r.bleed) { x = 0; y = 0; rw = W; rh = H; }
      const id = page.photos[idx];
      const entry = id != null ? opts.getImage(id) : null;
      if (entry && entry.img) {
        drawCover(ctx, entry.img, x, y, rw, rh, entry.focus);
      } else if (opts.placeholders) {
        ctx.fillStyle = theme.bg === '#ffffff' ? '#eeeeee' : 'rgba(128,128,128,0.18)';
        ctx.fillRect(x, y, rw, rh);
        ctx.fillStyle = theme.muted;
        ctx.font = `${Math.max(9, 5 * k)}px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Arrastra una foto', x + rw / 2, y + rh / 2);
      }
    });

    if (page.type === 'cover') drawCoverText(ctx, settings, theme, k, bl, w, h);
    else if (page.caption) {
      const fs = Math.max(3.5, h * 0.026) * k;
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cy = (h - settings.margin - Math.max(8, h * 0.06) / 2 + bl) * k;
      fitText(ctx, page.caption, (w - 2 * settings.margin) * k, fs, SERIF, 'italic 400');
      ctx.fillText(page.caption, (w / 2 + bl) * k, cy);
    }
    ctx.restore();
  }

  function drawCoverText(ctx, settings, theme, k, bl, w, h) {
    const title = settings.title || '';
    const sub = settings.subtitle || '';
    const cx = (w / 2 + bl) * k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (settings.coverStyle === 'classic') {
      const m = settings.margin * 1.3;
      const top = m + (h - 2 * m) * 0.72;
      const area = h - m - top;
      ctx.fillStyle = theme.text;
      const ts = fitText(ctx, title, (w - 2 * m) * k, area * 0.36 * k, SERIF, '500');
      ctx.fillText(title, cx, (top + bl) * k + area * 0.5 * k + ts * 0.2);
      if (sub) {
        ctx.fillStyle = theme.muted;
        fitText(ctx, sub.toUpperCase(), (w - 2 * m) * k, area * 0.12 * k, SANS, '500');
        ctx.fillText(sub.toUpperCase(), cx, (top + bl) * k + area * 0.8 * k);
      }
      return;
    }
    const H = (h + 2 * bl) * k, W = (w + 2 * bl) * k;
    const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 2 * k;
    const ts = fitText(ctx, title, (w - 2 * settings.margin) * k, h * 0.085 * k, SERIF, '500');
    const baseY = (h - settings.margin * 1.6 + bl) * k - (sub ? h * 0.05 * k : 0);
    ctx.fillText(title, cx, baseY);
    if (sub) {
      ctx.globalAlpha = 0.9;
      fitText(ctx, sub.toUpperCase(), (w - 2 * settings.margin) * k, Math.min(h * 0.026 * k, ts * 0.35), SANS, '500');
      ctx.fillText(sub.toUpperCase(), cx, baseY + h * 0.05 * k);
    }
  }

  return { SIZES, THEMES, TEMPLATES, DEFAULT_SETTINGS, pageSize, slotRects, autoLayout, renderPage, drawCover };
})();

if (typeof module !== 'undefined') module.exports = Album;
