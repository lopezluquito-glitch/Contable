/*
 * Motor de revelado automático.
 *
 * 1. analyze(): estudia el histograma, la saturación, la nitidez y el punto de
 *    interés de una copia reducida de la foto y propone ajustes "de diseñador":
 *    niveles por canal (balance de blancos + rango dinámico), gamma para una
 *    exposición correcta, recuperación de luces/sombras, contraste e intensidad.
 * 2. process(): aplica esos ajustes (más los manuales y el estilo elegido) a
 *    cualquier resolución, de modo que la vista previa y la impresión coinciden.
 */
const Enhance = (() => {
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const STYLES = {
    natural:  { label: 'Natural' },
    vivid:    { label: 'Vívido', contrast: 0.12, vibrance: 0.25, saturation: 0.04, clarity: 0.15 },
    fresh:    { label: 'Luminoso', exposure: 0.15, contrast: -0.05, warmth: -0.08, vibrance: 0.15, shadows: 0.15 },
    warm:     { label: 'Cálido dorado', warmth: 0.35, vibrance: 0.1, fade: 0.02,
                split: { shadow: [0.45, 0.35, 0.3], high: [1, 0.75, 0.45], amount: 0.08 } },
    portrait: { label: 'Retrato suave', clarity: -0.25, contrast: -0.06, warmth: 0.1, sharpen: -0.2, vibrance: -0.05, shadows: 0.1 },
    cinema:   { label: 'Cine', contrast: 0.1, saturation: -0.1, fade: 0.04, vignette: 0.3,
                split: { shadow: [0.05, 0.4, 0.5], high: [1, 0.65, 0.35], amount: 0.2 } },
    film:     { label: 'Película', contrast: -0.06, saturation: -0.14, warmth: 0.12, fade: 0.07, vignette: 0.15,
                split: { shadow: [0.2, 0.35, 0.45], high: [1, 0.9, 0.7], amount: 0.1 } },
    bw:       { label: 'B/N clásico', bw: true, contrast: 0.2, clarity: 0.2, vignette: 0.15 },
    bwsoft:   { label: 'B/N suave', bw: true, contrast: -0.05, fade: 0.05, clarity: 0.05 },
  };

  const DEFAULT_ADJUST = {
    intensity: 1, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    warmth: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, sharpen: 0,
    vignette: 0, style: 'natural',
  };

  function percentile(hist, total, p) {
    const target = p * total;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  }

  function analyze(imageData) {
    const { data, width, height } = imageData;
    const n = width * height;
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), hl = new Uint32Array(256);
    const gray = new Float32Array(n);
    let satSum = 0;

    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = data[j], g = data[j + 1], b = data[j + 2];
      hr[r]++; hg[g]++; hb[b]++;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      hl[l | 0]++;
      gray[i] = l;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      satSum += mx > 0 ? (mx - mn) / mx : 0;
    }

    // Niveles: mezcla del estiramiento por canal (corrige dominantes de color)
    // con el de luminancia (evita "sobrecorregir" atardeceres o luz de vela).
    const WB = 0.75;
    const lowL = percentile(hl, n, 0.004), highL = percentile(hl, n, 0.996);
    const levels = [hr, hg, hb].map((h) => {
      let lo = lowL + (percentile(h, n, 0.004) - lowL) * WB;
      let hi = highL + (percentile(h, n, 0.996) - highL) * WB;
      lo = Math.min(lo, 80);   // quita velo sin forzar imágenes muy claras
      hi = Math.max(hi, 150);  // aclara subexposiciones sin forzar nocturnas
      if (hi - lo < 120) {     // no amplificar ruido en imágenes planas
        const mid = (hi + lo) / 2;
        lo = mid - 60; hi = mid + 60;
      }
      return { lo, hi };
    });

    // Exposición: llevar la mediana de luminancia (ya estirada) hacia ~0.46.
    const loAvg = (levels[0].lo + levels[1].lo + levels[2].lo) / 3;
    const hiAvg = (levels[0].hi + levels[1].hi + levels[2].hi) / 3;
    const stretch = (v) => clamp01((v - loAvg) / (hiAvg - loAvg));
    const median = clamp(stretch(percentile(hl, n, 0.5)), 0.05, 0.95);
    let gamma = Math.log(0.46) / Math.log(median);
    // Aclarar es frecuente (subexposición); oscurecer se hace con más prudencia
    // para no apagar cielos, nieve o escenas claras intencionadas.
    gamma = clamp(gamma, 0.55, 1.6);
    gamma = gamma < 1 ? Math.max(0.6, 1 + (gamma - 1) * 0.8) : Math.min(1.2, 1 + (gamma - 1) * 0.45);

    let dark = 0, bright = 0, mean = 0, sq = 0;
    for (let i = 0; i < 256; i++) {
      const v = Math.pow(stretch(i), gamma);
      if (v < 0.12) dark += hl[i];
      if (v > 0.93) bright += hl[i];
      mean += v * hl[i];
      sq += v * v * hl[i];
    }
    dark /= n; bright /= n; mean /= n;
    const std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    const meanSat = satSum / n;

    // Nitidez (varianza del laplaciano) y punto de interés (centro de energía de bordes).
    let lapSum = 0, lapSq = 0, cnt = 0, ex = 0, ey = 0, et = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
        lapSum += lap; lapSq += lap * lap; cnt++;
        const e = Math.abs(lap);
        if (e > 12) {
          const wgt = e * e;
          ex += x * wgt; ey += y * wgt; et += wgt;
        }
      }
    }
    const lapMean = lapSum / Math.max(1, cnt);
    const sharpness = lapSq / Math.max(1, cnt) - lapMean * lapMean;
    const focus = et > 0
      ? { x: clamp(0.5 + ((ex / et) / width - 0.5) * 0.6, 0.2, 0.8), y: clamp(0.5 + ((ey / et) / height - 0.5) * 0.6, 0.2, 0.8) }
      : { x: 0.5, y: 0.5 };

    return {
      levels,
      gamma,
      shadows: clamp(dark * 2.2, 0, 0.55),
      highlights: clamp(bright * 3, 0, 0.6),
      contrast: std < 0.17 ? 0.28 : std < 0.22 ? 0.18 : 0.08,
      vibrance: meanSat < 0.18 ? 0.35 : meanSat < 0.3 ? 0.25 : meanSat < 0.45 ? 0.15 : 0.05,
      clarity: 0.22,
      sharpen: 0.35,
      sharpness,
      focus,
    };
  }

  /** Combina los ajustes automáticos, el estilo y los ajustes manuales. */
  function resolve(auto, adj) {
    const a = { ...DEFAULT_ADJUST, ...adj };
    const s = STYLES[a.style] || STYLES.natural;
    const k = a.intensity;
    const neutral = { lo: 0, hi: 255 };
    return {
      levels: auto.levels.map((l) => ({ lo: neutral.lo + (l.lo - neutral.lo) * k, hi: neutral.hi + (l.hi - neutral.hi) * k })),
      gamma: 1 + (auto.gamma - 1) * k,
      exposure: a.exposure + (s.exposure || 0),
      contrast: clamp(auto.contrast * k + a.contrast * 0.5 + (s.contrast || 0), -0.7, 0.85),
      highlights: clamp(auto.highlights * k + a.highlights * 0.8, -0.5, 1.2),
      shadows: clamp(auto.shadows * k + a.shadows * 0.8 + (s.shadows || 0), -0.5, 1.2),
      warmth: a.warmth + (s.warmth || 0),
      tint: a.tint,
      vibrance: auto.vibrance * k + a.vibrance * 0.8 + (s.vibrance || 0),
      saturation: a.saturation * 0.8 + (s.saturation || 0),
      clarity: auto.clarity * k + a.clarity * 0.9 + (s.clarity || 0),
      sharpen: Math.max(0, auto.sharpen * k + a.sharpen * 0.8 + (s.sharpen || 0)),
      vignette: clamp(a.vignette + (s.vignette || 0), -1, 1),
      fade: s.fade || 0,
      split: s.split || null,
      bw: !!s.bw,
    };
  }

  function buildLuts(P) {
    const gains = [1 + 0.1 * P.warmth, 1 - 0.07 * P.tint, 1 - 0.1 * P.warmth];
    const expK = Math.pow(2, P.exposure);
    const c = P.contrast;
    return P.levels.map((lv, ch) => {
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) {
        let x = clamp01(((v - lv.lo) / (lv.hi - lv.lo)) * gains[ch]);
        x = Math.pow(x, P.gamma);
        x *= expK;
        if (x > 0.8) x = 0.8 + 0.2 * (1 - Math.exp(-(x - 0.8) / 0.2)); // hombro suave
        x = x - (c * Math.sin(2 * Math.PI * x)) / (2 * Math.PI);          // curva en S
        x = P.fade + clamp01(x) * (1 - P.fade);
        lut[v] = Math.round(x * 255);
      }
      return lut;
    });
  }

  /** Desenfoque aproximadamente gaussiano (3 pasadas de caja) sobre un Float32Array. */
  function blur(src, w, h, r) {
    r = Math.max(1, Math.round(r));
    let a = Float32Array.from(src);
    let b = new Float32Array(src.length);
    for (let pass = 0; pass < 3; pass++) {
      boxH(a, b, w, h, r);
      boxV(b, a, w, h, r);
    }
    return a;
  }

  function boxH(src, dst, w, h, r) {
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = src[row] * (r + 1);
      for (let x = 1; x <= r; x++) acc += src[row + Math.min(x, w - 1)];
      for (let x = 0; x < w; x++) {
        dst[row + x] = acc * inv;
        acc += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
      }
    }
  }

  function boxV(src, dst, w, h, r) {
    const inv = 1 / (2 * r + 1);
    for (let x = 0; x < w; x++) {
      let acc = src[x] * (r + 1);
      for (let y = 1; y <= r; y++) acc += src[Math.min(y, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc * inv;
        acc += src[Math.min(y + r + 1, h - 1) * w + x] - src[Math.max(y - r, 0) * w + x];
      }
    }
  }

  /** Aplica el revelado sobre imageData (in situ). */
  function process(imageData, auto, adj) {
    const P = resolve(auto, adj);
    const { data, width: w, height: h } = imageData;
    const n = w * h;
    const [lr, lg, lb] = buildLuts(P);
    const L = new Float32Array(n);

    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = (data[j] = lr[data[j]]);
      const g = (data[j + 1] = lg[data[j + 1]]);
      const b = (data[j + 2] = lb[data[j + 2]]);
      L[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }

    const minDim = Math.min(w, h);
    const needLocal = Math.abs(P.shadows) + Math.abs(P.highlights) + Math.abs(P.clarity) > 0.001;
    const M = needLocal ? blur(L, w, h, minDim / 45) : null;
    const S = P.sharpen > 0.001 ? blur(L, w, h, Math.max(1, minDim / 1400)) : null;

    const vig = P.vignette;
    const cx = w / 2, cy = h / 2, maxD = Math.hypot(cx, cy);
    const split = P.split;

    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const j = i * 4;
        let r = data[j] / 255, g = data[j + 1] / 255, b = data[j + 2] / 255;
        const l = L[i];
        let nl = l;
        if (M) {
          const m = M[i];
          const wmid = 4 * l * (1 - l);
          nl += P.shadows * 0.5 * (1 - m) * (1 - m) * wmid;
          nl -= P.highlights * 0.45 * m * m * wmid;
          nl += P.clarity * 0.9 * (l - m) * wmid;
        }
        if (S) nl += P.sharpen * 1.5 * (l - S[i]);

        const d = nl - l;
        if (d !== 0) {
          if (d > 0 && l > 0.02) {
            const k = Math.min(nl / l, 3);
            r = 0.5 * r * k + 0.5 * (r + d);
            g = 0.5 * g * k + 0.5 * (g + d);
            b = 0.5 * b * k + 0.5 * (b + d);
          } else {
            r += d; g += d; b += d;
          }
        }

        // Intensidad (vibrance) con protección de tonos de piel + saturación.
        const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx - mn;
        let vib = P.vibrance * (1 - clamp01(sat));
        if (r >= g && g >= b && sat > 0.04) {
          const hue = (g - b) / sat; // 0 = rojo, 1 = amarillo
          if (hue > 0.2 && hue < 0.8) vib *= 0.45;
        }
        const amt = 1 + vib + P.saturation;
        r = Y + (r - Y) * amt;
        g = Y + (g - Y) * amt;
        b = Y + (b - Y) * amt;

        if (P.bw) {
          const bwv = 0.32 * r + 0.56 * g + 0.12 * b;
          r = g = b = bwv;
        }

        if (split) {
          const t = clamp01(Y);
          const ws = (1 - t) * (1 - t) * split.amount, wh = t * t * split.amount;
          r += ws * (split.shadow[0] - 0.5) + wh * (split.high[0] - 0.5);
          g += ws * (split.shadow[1] - 0.5) + wh * (split.high[1] - 0.5);
          b += ws * (split.shadow[2] - 0.5) + wh * (split.high[2] - 0.5);
        }

        if (vig !== 0) {
          const dist = Math.hypot(x - cx, y - cy) / maxD;
          const t = clamp01((dist - 0.35) / 0.65);
          const f = 1 - vig * t * t * (3 - 2 * t) * 0.55;
          r *= f; g *= f; b *= f;
        }

        data[j] = r * 255;
        data[j + 1] = g * 255;
        data[j + 2] = b * 255;
      }
    }
    return imageData;
  }

  /** Revela un origen dibujable (bitmap/canvas) a un canvas nuevo del tamaño indicado. */
  function renderToCanvas(source, auto, adj, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    if (auto) {
      const img = ctx.getImageData(0, 0, width, height);
      process(img, auto, adj);
      ctx.putImageData(img, 0, 0);
    }
    return canvas;
  }

  return { STYLES, DEFAULT_ADJUST, analyze, process, resolve, renderToCanvas };
})();

if (typeof module !== 'undefined') module.exports = Enhance;
