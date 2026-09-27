/* Estudio Álbum — interfaz y flujo de trabajo. */
(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, props = {}, ...children) => {
    const n = Object.assign(document.createElement(tag), props);
    children.forEach((c) => n.append(c));
    return n;
  };

  const SOURCE_MAX = 1600;   // copia de trabajo para el editor
  const DISPLAY_MAX = 1100;  // versión revelada para la maqueta y la cuadrícula
  const THUMB_MAX = 480;

  const state = {
    photos: [],
    settings: { ...Album.DEFAULT_SETTINGS },
    pages: [],
    current: null,
    view: 'photos',
  };
  let nextId = 1;
  const byId = (id) => state.photos.find((p) => p.id === id);

  /* ---------- utilidades ---------- */
  function fitSize(w, h, max) {
    const s = Math.min(1, max / Math.max(w, h));
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  }
  function scaleToCanvas(src, max) {
    const [w, h] = fitSize(src.width, src.height, max);
    const c = el('canvas', { width: w, height: h });
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return c;
  }
  const toBlob = (canvas, type = 'image/jpeg', q = 0.92) =>
    new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, q));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // Publicada en claude.ai, la página guarda archivos con la capacidad «downloads»
  // (el visitante confirma cada archivo); abierta en local, descarga normal.
  const savePromise = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  async function download(blob, name) {
    const saver = await savePromise;
    if (saver) {
      try {
        await saver.save({ filename: name, data: blob });
        return true;
      } catch (e) {
        if (e && e.code === 'declined') { toast(`Descarga de ${name} cancelada`); return false; }
        if (e && !['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e.code)) {
          toast(`No se pudo guardar ${name}: ${e.message || e.code}`, 6000);
          return false;
        }
      }
    }
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return true;
  }
  const slug = (s) => (s || 'album').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'album';
  const baseName = (n) => n.replace(/\.[^.]+$/, '');

  let toastTimer;
  function toast(msg, ms = 3200) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  function busy(msg, frac) {
    $('#busy').classList.remove('hidden');
    if (msg) $('#busyMsg').textContent = msg;
    $('#busyBar').style.width = `${Math.round((frac || 0) * 100)}%`;
  }
  const done = () => $('#busy').classList.add('hidden');

  /** Fecha de captura EXIF (DateTimeOriginal) de un JPEG, si existe. */
  async function readExifDate(file) {
    try {
      const v = new DataView(await file.slice(0, 131072).arrayBuffer());
      if (v.getUint16(0) !== 0xffd8) return null;
      let off = 2;
      while (off + 10 < v.byteLength) {
        const marker = v.getUint16(off), len = v.getUint16(off + 2);
        if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
          const t = off + 10, le = v.getUint16(t) === 0x4949;
          const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
          const find = (ifd, tag) => {
            const n = u16(ifd);
            for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
            return -1;
          };
          const exifPtr = find(u32(4), 0x8769);
          let entry = exifPtr >= 0 ? find(u32(exifPtr + 8), 0x9003) : -1;
          if (entry < 0) entry = find(u32(4), 0x0132);
          if (entry < 0) return null;
          const p = u32(entry + 8);
          let s = '';
          for (let i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(t + p + i));
          const m = s.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
        }
        if ((marker & 0xff00) !== 0xff00) break;
        off += 2 + len;
      }
    } catch (e) { /* sin EXIF */ }
    return null;
  }

  /* ---------- importación y revelado ---------- */
  async function importFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif)$/i.test(f.name));
    if (!files.length) return;
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      busy(`Revelando ${i + 1} de ${files.length}: ${files[i].name}`, i / files.length);
      await tick();
      try {
        state.photos.push(await createPhoto(files[i]));
      } catch (e) {
        console.error(e);
        failed.push(files[i].name);
      }
    }
    done();
    updateScores();
    sortPhotos($('#sortSelect').value);
    renderLibrary();
    if (failed.length) toast(`No se pudieron abrir: ${failed.join(', ')} (usa JPG, PNG o WebP)`, 6000);
    else toast(`${files.length} foto${files.length > 1 ? 's' : ''} mejorada${files.length > 1 ? 's' : ''} automáticamente ✓`);
  }

  async function createPhoto(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const src = scaleToCanvas(bmp, SOURCE_MAX);
    const w = bmp.width, h = bmp.height;
    bmp.close();
    const small = scaleToCanvas(src, 512);
    const auto = Enhance.analyze(small.getContext('2d').getImageData(0, 0, small.width, small.height));
    const photo = {
      id: nextId++,
      file,
      name: file.name,
      w, h,
      date: (await readExifDate(file)) || file.lastModified,
      srcBlob: await toBlob(src, 'image/jpeg', 0.95),
      auto,
      adj: { ...Enhance.DEFAULT_ADJUST, style: $('#globalStyle').value || 'natural' },
      focus: { ...auto.focus },
    };
    photo.origUrl = URL.createObjectURL(await toBlob(scaleToCanvas(src, THUMB_MAX), 'image/jpeg', 0.85));
    await renderDisplay(photo, src);
    return photo;
  }

  async function loadSource(photo) {
    return createImageBitmap(photo.srcBlob);
  }

  async function renderDisplay(photo, src) {
    const own = !src;
    if (own) src = await loadSource(photo);
    const [w, h] = fitSize(src.width, src.height, DISPLAY_MAX);
    photo.display = Enhance.renderToCanvas(src, photo.auto, photo.adj, w, h);
    if (own && src.close) src.close();
    const url = URL.createObjectURL(await toBlob(scaleToCanvas(photo.display, THUMB_MAX), 'image/jpeg', 0.85));
    if (photo.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
    photo.thumbUrl = url;
  }

  /** Versión revelada a la resolución necesaria para imprimir (hasta la nativa). */
  async function renderFull(photo, maxSide) {
    const bmp = await createImageBitmap(photo.file, { imageOrientation: 'from-image' });
    const [w, h] = fitSize(bmp.width, bmp.height, Math.min(maxSide, 7000));
    const c = Enhance.renderToCanvas(bmp, photo.auto, photo.adj, w, h);
    bmp.close();
    return c;
  }

  function updateScores() {
    const sh = state.photos.map((p) => p.auto.sharpness).sort((a, b) => a - b);
    const median = sh[Math.floor(sh.length / 2)] || 1;
    state.photos.forEach((p) => {
      const megapixels = (p.w * p.h) / 1e6;
      p.blurry = state.photos.length > 2 && p.auto.sharpness < median * 0.3;
      p.score = Math.log(1 + p.auto.sharpness) + Math.min(megapixels, 12) * 0.05;
    });
    const top = [...state.photos].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.round(state.photos.length * 0.15)));
    state.photos.forEach((p) => (p.top = state.photos.length > 3 && top.includes(p)));
  }

  function sortPhotos(mode) {
    const cmp = {
      date: (a, b) => a.date - b.date || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      score: (a, b) => b.score - a.score,
    }[mode];
    if (cmp) state.photos.sort(cmp);
  }

  function removePhoto(id) {
    const p = byId(id);
    if (!p) return;
    [p.thumbUrl, p.origUrl].forEach((u) => u && URL.revokeObjectURL(u));
    state.photos = state.photos.filter((x) => x !== p);
    state.pages.forEach((pg) => { pg.photos = pg.photos.map((x) => (x === id ? null : x)); });
    if (state.current === id) state.current = state.photos[0]?.id ?? null;
    updateScores();
    renderLibrary();
  }

  /* ---------- vista 1: biblioteca ---------- */
  function renderLibrary() {
    const has = state.photos.length > 0;
    $('#dropzone').classList.toggle('hidden', has);
    $('#library').classList.toggle('hidden', !has);
    $('#photoCount').textContent = `${state.photos.length} foto${state.photos.length === 1 ? '' : 's'}`;
    const showOrig = $('#showOriginal').checked;
    const grid = $('#photoGrid');
    grid.replaceChildren(...state.photos.map((p) => {
      const del = el('button', { className: 'del', title: 'Quitar', textContent: '✕' });
      del.onclick = (e) => { e.stopPropagation(); removePhoto(p.id); };
      const badges = [];
      if (p.top) badges.push(el('span', { className: 'badge good', textContent: '★ Destacada' }));
      if (p.blurry) badges.push(el('span', { className: 'badge warn', textContent: 'Poco nítida' }));
      if (p.adj.style !== 'natural') badges.push(el('span', { className: 'badge', textContent: Enhance.STYLES[p.adj.style].label }));
      const card = el('div', { className: 'card' },
        el('img', { src: showOrig ? p.origUrl : p.thumbUrl, alt: p.name, loading: 'lazy' }),
        el('div', { className: 'meta' }, el('span', { textContent: p.name }), ...badges),
        del);
      card.onclick = () => openEditor(p.id);
      return card;
    }));
  }

  /* ---------- vista 2: editor ---------- */
  const SLIDERS = [
    { group: 'Luz' },
    { key: 'intensity', label: 'Revelado automático', min: 0, max: 150, scale: 100, unit: '%' },
    { key: 'exposure', label: 'Exposición', min: -100, max: 100, scale: 100 },
    { key: 'contrast', label: 'Contraste', min: -100, max: 100, scale: 100 },
    { key: 'highlights', label: 'Luces (recuperar)', min: -100, max: 100, scale: 100 },
    { key: 'shadows', label: 'Sombras (aclarar)', min: -100, max: 100, scale: 100 },
    { group: 'Color' },
    { key: 'warmth', label: 'Temperatura', min: -100, max: 100, scale: 100 },
    { key: 'tint', label: 'Matiz', min: -100, max: 100, scale: 100 },
    { key: 'vibrance', label: 'Intensidad', min: -100, max: 100, scale: 100 },
    { key: 'saturation', label: 'Saturación', min: -100, max: 100, scale: 100 },
    { group: 'Detalle' },
    { key: 'clarity', label: 'Claridad', min: -100, max: 100, scale: 100 },
    { key: 'sharpen', label: 'Nitidez', min: -100, max: 100, scale: 100 },
    { key: 'vignette', label: 'Viñeta', min: -100, max: 100, scale: 100 },
  ];
  const sliderInputs = {};
  const editor = { src: null, fast: null, id: null, pending: false, split: 50, focusMode: false };

  function buildEditorControls() {
    const chips = $('#styleChips');
    Object.entries(Enhance.STYLES).forEach(([key, s]) => {
      const b = el('button', { className: 'chip', textContent: s.label });
      b.dataset.style = key;
      b.onclick = () => {
        const p = byId(state.current);
        if (!p) return;
        p.adj.style = key;
        syncEditorControls();
        scheduleEditorRender(false);
        markDirty(p);
      };
      chips.append(b);
    });
    const box = $('#sliders');
    SLIDERS.forEach((s) => {
      if (s.group) { box.append(el('h3', { textContent: s.group })); return; }
      const val = el('b');
      const input = el('input', { type: 'range', min: s.min, max: s.max, step: 1 });
      const setLabel = () => { val.textContent = `${input.value > 0 && s.unit !== '%' ? '+' : ''}${input.value}${s.unit || ''}`; };
      input.oninput = () => {
        const p = byId(state.current);
        if (!p) return;
        p.adj[s.key] = input.value / s.scale;
        setLabel();
        scheduleEditorRender(true);
      };
      input.onchange = () => { const p = byId(state.current); scheduleEditorRender(false); if (p) markDirty(p); };
      input.ondblclick = () => {
        input.value = Enhance.DEFAULT_ADJUST[s.key] * s.scale;
        input.oninput();
        input.onchange();
      };
      input.title = 'Doble clic para restablecer';
      sliderInputs[s.key] = { input, setLabel, s };
      box.append(el('div', { className: 'slider' }, el('div', { className: 'row' }, el('span', { textContent: s.label }), val), input));
    });
  }

  function syncEditorControls() {
    const p = byId(state.current);
    if (!p) return;
    Object.values(sliderInputs).forEach(({ input, setLabel, s }) => {
      input.value = Math.round((p.adj[s.key] ?? Enhance.DEFAULT_ADJUST[s.key]) * s.scale);
      setLabel();
    });
    document.querySelectorAll('#styleChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.style === p.adj.style));
  }

  async function openEditor(id) {
    if (id != null) state.current = id;
    if (state.current == null && state.photos.length) state.current = state.photos[0].id;
    switchView('edit');
    const p = byId(state.current);
    $('#compare').classList.toggle('hidden', !p);
    $('#editEmpty').classList.toggle('hidden', !!p);
    renderFilmstrip();
    if (!p) return;
    $('#editName').textContent = p.name;
    syncEditorControls();
    if (editor.id !== p.id) {
      const bmp = await loadSource(p);
      if (state.current !== p.id) { bmp.close(); return; }
      editor.src = scaleToCanvas(bmp, SOURCE_MAX);
      editor.fast = scaleToCanvas(bmp, 800);
      bmp.close();
      editor.id = p.id;
      for (const c of [$('#afterCanvas'), $('#beforeCanvas')]) {
        c.width = editor.src.width;
        c.height = editor.src.height;
      }
      $('#beforeCanvas').getContext('2d').drawImage(editor.src, 0, 0);
    }
    placeFocusMarker();
    scheduleEditorRender(false);
  }

  function scheduleEditorRender(fast) {
    editor.wantFast = fast;
    if (editor.pending) return;
    editor.pending = true;
    requestAnimationFrame(() => {
      editor.pending = false;
      const p = byId(editor.id);
      if (!p || !editor.src) return;
      const src = editor.wantFast ? editor.fast : editor.src;
      const out = Enhance.renderToCanvas(src, p.auto, p.adj, src.width, src.height);
      const ctx = $('#afterCanvas').getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(out, 0, 0, editor.src.width, editor.src.height);
    });
  }

  const dirty = new Set();
  let dirtyTimer;
  function markDirty(p) {
    dirty.add(p.id);
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(async () => {
      const ids = [...dirty];
      dirty.clear();
      for (const id of ids) {
        const ph = byId(id);
        if (ph) await renderDisplay(ph);
      }
      renderFilmstrip();
    }, 400);
  }

  function renderFilmstrip() {
    const strip = $('#filmstrip');
    strip.replaceChildren(...state.photos.map((p) => {
      const img = el('img', { src: p.thumbUrl, alt: p.name, title: p.name, className: p.id === state.current ? 'active' : '' });
      img.onclick = () => openEditor(p.id);
      return img;
    }));
    strip.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function stepPhoto(delta) {
    const i = state.photos.findIndex((p) => p.id === state.current);
    if (i < 0) return;
    const next = state.photos[(i + delta + state.photos.length) % state.photos.length];
    openEditor(next.id);
  }

  function setSplit(pct) {
    editor.split = Math.min(100, Math.max(0, pct));
    $('#beforeCanvas').style.clipPath = `inset(0 ${100 - editor.split}% 0 0)`;
    $('#divider').style.left = `${editor.split}%`;
  }

  function placeFocusMarker() {
    const p = byId(state.current);
    if (!p) return;
    const m = $('#focusMarker');
    m.style.left = `${p.focus.x * 100}%`;
    m.style.top = `${p.focus.y * 100}%`;
  }

  function bindEditor() {
    buildEditorControls();
    setSplit(50);
    const cmp = $('#compare');
    let dragging = false;
    const pos = (e) => {
      const r = cmp.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    cmp.addEventListener('pointerdown', (e) => {
      const p = byId(state.current);
      if (!p) return;
      if (editor.focusMode) {
        const { x, y } = pos(e);
        p.focus = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
        placeFocusMarker();
        toast('Punto de interés guardado: el álbum encuadrará alrededor de él');
        return;
      }
      if (cmp.classList.contains('no-compare')) return;
      dragging = true;
      cmp.setPointerCapture(e.pointerId);
      setSplit(pos(e).x * 100);
    });
    cmp.addEventListener('pointermove', (e) => { if (dragging) setSplit(pos(e).x * 100); });
    cmp.addEventListener('pointerup', () => { dragging = false; });
    $('#compareToggle').onchange = (e) => cmp.classList.toggle('no-compare', !e.target.checked);
    $('#focusToggle').onclick = () => {
      editor.focusMode = !editor.focusMode;
      $('#focusToggle').classList.toggle('active', editor.focusMode);
      cmp.classList.toggle('focus-mode', editor.focusMode);
    };
    $('#prevPhoto').onclick = () => stepPhoto(-1);
    $('#nextPhoto').onclick = () => stepPhoto(1);
    document.addEventListener('keydown', (e) => {
      if (state.view !== 'edit' || e.target.matches('input[type=text], select')) return;
      if (e.key === 'ArrowLeft') stepPhoto(-1);
      if (e.key === 'ArrowRight') stepPhoto(1);
    });
    $('#resetAdj').onclick = () => {
      const p = byId(state.current);
      if (!p) return;
      p.adj = { ...Enhance.DEFAULT_ADJUST };
      p.focus = { ...p.auto.focus };
      syncEditorControls();
      placeFocusMarker();
      scheduleEditorRender(false);
      markDirty(p);
    };
    $('#copyAdj').onclick = async () => {
      const p = byId(state.current);
      if (!p) return;
      await applyToAll((q) => { q.adj = { ...p.adj }; }, 'Copiando ajustes');
      toast('Ajustes aplicados a todas las fotos');
    };
    $('#downloadPhoto').onclick = async () => {
      const p = byId(state.current);
      if (!p) return;
      busy('Revelando a resolución completa…', 0.3);
      await tick();
      try {
        const c = await renderFull(p, 7000);
        busy(null, 0.8);
        const blob = await toBlob(c, 'image/jpeg', 0.95);
        c.width = c.height = 0;
        done();
        await download(blob, `${baseName(p.name)}-mejorada.jpg`);
      } finally { done(); }
    };
  }

  async function applyToAll(mutate, label) {
    for (let i = 0; i < state.photos.length; i++) {
      busy(`${label} ${i + 1} de ${state.photos.length}…`, i / state.photos.length);
      await tick();
      mutate(state.photos[i]);
      await renderDisplay(state.photos[i]);
    }
    done();
    renderLibrary();
    if (state.view === 'edit') { syncEditorControls(); scheduleEditorRender(false); renderFilmstrip(); }
  }

  /* ---------- vista 3: álbum ---------- */
  function bindAlbumSettings() {
    const s = state.settings;
    const size = $('#setSize');
    Object.entries(Album.SIZES).forEach(([k, v]) => size.append(el('option', { value: k, textContent: v.label })));
    const sw = $('#themeSwatches');
    Object.entries(Album.THEMES).forEach(([k, t]) => {
      const b = el('button', { className: 'swatch', title: t.label });
      b.style.background = t.bg;
      b.dataset.theme = k;
      b.onclick = () => { s.theme = k; syncAlbumSettings(); renderPages(); };
      sw.append(b);
    });
    const bind = (sel, key, parse = (v) => v) => {
      $(sel).addEventListener('input', (e) => { s[key] = parse(e.target.value); syncAlbumSettings(); renderPagesSoon(); });
    };
    bind('#setTitle', 'title');
    bind('#setSubtitle', 'subtitle');
    bind('#setCoverStyle', 'coverStyle');
    bind('#setSize', 'size');
    bind('#setMargin', 'margin', Number);
    bind('#setGutter', 'gutter', Number);
    $('#autoLayout').onclick = () => {
      if (!state.photos.length) return toast('Primero añade fotos');
      state.pages = Album.autoLayout(state.photos, s);
      renderPages();
      toast(`Álbum diseñado: ${state.pages.length} páginas`);
    };
    $('#addPage').onclick = () => {
      state.pages.push({ type: 'page', template: 'single', photos: [], caption: '' });
      renderPages();
      $('#pages').lastElementChild?.scrollIntoView({ behavior: 'smooth' });
    };
    syncAlbumSettings();
  }

  function syncAlbumSettings() {
    const s = state.settings;
    $('#setTitle').value = s.title;
    $('#setSubtitle').value = s.subtitle;
    $('#setCoverStyle').value = s.coverStyle;
    $('#setSize').value = s.size;
    $('#setMargin').value = s.margin;
    $('#setGutter').value = s.gutter;
    $('#marginVal').textContent = `${s.margin} mm`;
    $('#gutterVal').textContent = `${s.gutter} mm`;
    document.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.theme === s.theme));
  }

  let renderTimer;
  const renderPagesSoon = () => { clearTimeout(renderTimer); renderTimer = setTimeout(renderPages, 60); };

  function displayImage(id) {
    const p = byId(id);
    return p ? { img: p.display, focus: p.focus } : null;
  }

  function renderPages() {
    const s = state.settings;
    const { w, h } = Album.pageSize(s);
    const boxW = Math.round(w >= h ? 380 : 380 * (w / h));
    const boxH = Math.round(boxW * (h / w));
    const dpr = window.devicePixelRatio || 1;
    const container = $('#pages');
    const frag = document.createDocumentFragment();

    state.pages.forEach((page, pi) => {
      const canvas = el('canvas', { width: Math.round(boxW * dpr), height: Math.round(boxH * dpr) });
      Album.renderPage(canvas.getContext('2d'), page, s, { pxPerMm: (boxW * dpr) / w, getImage: displayImage, placeholders: true });
      const box = el('div', { className: 'page-box' }, canvas);
      box.style.width = `${boxW}px`;
      box.style.height = `${boxH}px`;

      Album.slotRects(page, s).forEach((r, si) => {
        const slot = el('div', { className: 'slot' });
        Object.assign(slot.style, r.bleed
          ? { left: 0, top: 0, width: '100%', height: '100%' }
          : { left: `${(r.x / w) * 100}%`, top: `${(r.y / h) * 100}%`, width: `${(r.w / w) * 100}%`, height: `${(r.h / h) * 100}%` });
        const pid = page.photos[si];
        const photo = pid != null ? byId(pid) : null;
        if (photo) {
          slot.draggable = true;
          slot.ondragstart = (e) => e.dataTransfer.setData('text/plain', `slot:${pi}:${si}`);
          slot.ondblclick = () => openEditor(photo.id);
          const edit = el('button', { title: 'Editar foto', textContent: '✎' });
          edit.onclick = () => openEditor(photo.id);
          const rm = el('button', { title: 'Quitar del hueco', textContent: '✕' });
          rm.onclick = () => { page.photos[si] = null; renderPages(); };
          slot.append(el('div', { className: 'slot-actions' }, edit, rm));
          // Aviso de resolución insuficiente para imprimir (< 150 ppp efectivos).
          const slotW = r.bleed ? w : r.w, slotH = r.bleed ? h : r.h;
          const scale = Math.max(slotW / photo.w, slotH / photo.h); // mm por píxel de la foto
          const ppi = 25.4 / scale;
          if (ppi < 150) slot.append(el('span', { className: 'lowres', textContent: `⚠ ${Math.round(ppi)} ppp` }));
        }
        slot.ondragover = (e) => { e.preventDefault(); slot.classList.add('over'); };
        slot.ondragleave = () => slot.classList.remove('over');
        slot.ondrop = (e) => {
          e.preventDefault();
          slot.classList.remove('over');
          dropOnSlot(e.dataTransfer.getData('text/plain'), pi, si);
        };
        box.append(slot);
      });

      const head = el('div', { className: 'page-head' },
        el('span', { className: 'title', textContent: page.type === 'cover' ? 'Portada' : `Página ${pi}` }));
      if (page.type !== 'cover') {
        const btn = (txt, title, fn) => { const b = el('button', { textContent: txt, title }); b.onclick = fn; head.append(b); };
        btn('←', 'Mover antes', () => movePage(pi, -1));
        btn('→', 'Mover después', () => movePage(pi, 1));
        btn('⤨', 'Barajar fotos de la página', () => {
          const ph = page.photos.filter((x) => x != null);
          for (let i = ph.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ph[i], ph[j]] = [ph[j], ph[i]]; }
          page.photos = ph;
          renderPages();
        });
        btn('🗑', 'Eliminar página', () => { state.pages.splice(pi, 1); renderPages(); });
      }

      const card = el('div', { className: 'page-card' }, head, box);
      if (page.type !== 'cover') {
        const sel = el('select', { title: 'Plantilla' });
        Object.entries(Album.TEMPLATES).forEach(([k, t]) => sel.append(el('option', { value: k, textContent: t.label })));
        sel.value = page.template;
        sel.onchange = () => {
          page.template = sel.value;
          const n = Album.TEMPLATES[sel.value].slots.length;
          page.photos = page.photos.filter((x) => x != null).slice(0, n);
          renderPages();
        };
        const cap = el('input', { type: 'text', placeholder: 'Pie de foto (opcional)', value: page.caption || '' });
        cap.onchange = () => { page.caption = cap.value.trim(); renderPages(); };
        const tools = el('div', { className: 'page-tools' }, sel, cap);
        tools.style.width = `${boxW}px`;
        card.append(tools);
      }
      frag.append(card);
    });

    container.replaceChildren(frag);
    if (!state.pages.length) {
      container.append(el('p', { className: 'muted', textContent: state.photos.length
        ? 'Pulsa «Diseñar automáticamente» para crear el álbum.'
        : 'Añade fotos en el paso 1 para crear el álbum.' }));
    }
    renderTray();
  }

  function dropOnSlot(data, pi, si) {
    const page = state.pages[pi];
    if (!data || !page) return;
    if (data.startsWith('photo:')) {
      page.photos[si] = Number(data.slice(6));
    } else if (data.startsWith('slot:')) {
      const [, fpi, fsi] = data.split(':').map(Number);
      const from = state.pages[fpi];
      if (!from) return;
      const tmp = page.photos[si] ?? null;
      page.photos[si] = from.photos[fsi];
      from.photos[fsi] = tmp;
    }
    for (let i = 0; i < page.photos.length; i++) if (page.photos[i] === undefined) page.photos[i] = null;
    renderPages();
  }

  function movePage(pi, d) {
    const to = pi + d;
    if (to < 1 || to >= state.pages.length) return; // la portada queda fija
    [state.pages[pi], state.pages[to]] = [state.pages[to], state.pages[pi]];
    renderPages();
  }

  function renderTray() {
    const uses = new Map();
    state.pages.forEach((pg) => pg.photos.forEach((id) => id != null && uses.set(id, (uses.get(id) || 0) + 1)));
    const unused = state.photos.filter((p) => !uses.has(p.id)).length;
    $('#unusedInfo').textContent = unused ? `· ${unused} sin usar` : '· todas colocadas';
    $('#tray').replaceChildren(...state.photos.map((p) => {
      const n = uses.get(p.id) || 0;
      const img = el('img', { src: p.thumbUrl, alt: p.name, title: `${p.name} — arrastra a un hueco`, draggable: true });
      img.ondragstart = (e) => e.dataTransfer.setData('text/plain', `photo:${p.id}`);
      img.ondblclick = () => openEditor(p.id);
      const item = el('div', { className: `tray-item${n ? ' used' : ''}` }, img);
      if (n) item.append(el('span', { className: 'count', textContent: `×${n}` }));
      return item;
    }));
  }

  /* ---------- exportación ---------- */
  function exportInfo() {
    const s = state.settings;
    const { w, h } = Album.pageSize(s);
    const dpi = Number($('#expDpi').value);
    const bl = $('#expBleed').checked ? s.bleed : 0;
    const px = (mm) => Math.round((mm / 25.4) * dpi);
    $('#expInfo').textContent = `${state.pages.length} páginas de ${w / 10} × ${h / 10} cm` +
      (bl ? ` (+${bl} mm de sangrado por lado)` : '') + ` · ${px(w + 2 * bl)} × ${px(h + 2 * bl)} px por página.`;
  }

  async function exportAlbum() {
    const s = state.settings;
    const format = $('#expFormat').value;
    const dpi = Number($('#expDpi').value);
    const bleed = $('#expBleed').checked ? s.bleed : 0;
    const { w, h } = Album.pageSize(s);
    const k = dpi / 25.4;
    const W = Math.round((w + 2 * bleed) * k), H = Math.round((h + 2 * bleed) * k);
    const pdfPages = [];
    const lowRes = new Set();
    const cache = new Map(); // id -> {img, focus, size}

    try {
      for (let pi = 0; pi < state.pages.length; pi++) {
        const page = state.pages[pi];
        busy(`Preparando página ${pi + 1} de ${state.pages.length} a ${dpi} ppp…`, pi / state.pages.length);
        await tick();
        const rects = Album.slotRects(page, s);
        const images = new Map();
        for (let si = 0; si < rects.length; si++) {
          const p = page.photos[si] != null ? byId(page.photos[si]) : null;
          if (!p) continue;
          const r = rects[si];
          const rw = (r.bleed ? w + 2 * bleed : r.w) * k, rh = (r.bleed ? h + 2 * bleed : r.h) * k;
          const cover = Math.max(rw / p.w, rh / p.h);
          if (dpi / cover < 150) lowRes.add(p.name); // resolución efectiva impresa < 150 ppp
          const needed = Math.ceil(Math.max(p.w, p.h) * Math.min(1, cover * 1.02));
          let entry = cache.get(p.id);
          if (!entry || entry.size < needed) {
            entry = { img: await renderFull(p, needed), focus: p.focus, size: needed };
            cache.set(p.id, entry);
          }
          images.set(p.id, entry);
        }
        const canvas = el('canvas', { width: W, height: H });
        Album.renderPage(canvas.getContext('2d'), page, s, { pxPerMm: k, bleed, getImage: (id) => images.get(id) });
        const jpeg = await toBlob(canvas, 'image/jpeg', 0.95);
        canvas.width = canvas.height = 0;
        if (format === 'pdf') pdfPages.push({ jpeg, pxW: W, pxH: H, wMm: w, hMm: h, bleedMm: bleed });
        else {
          await download(jpeg, `${slug(s.title)}-${String(pi).padStart(2, '0')}${pi === 0 ? '-portada' : ''}.jpg`);
          await new Promise((r) => setTimeout(r, 350));
        }
        // Libera memoria de las fotos que ya no aparecen en páginas siguientes.
        const later = new Set(state.pages.slice(pi + 1).flatMap((pg) => pg.photos));
        for (const [id, e] of cache) if (!later.has(id)) { e.img.width = e.img.height = 0; cache.delete(id); }
      }
      if (format === 'pdf') {
        busy('Generando PDF…', 1);
        await tick();
        const pdf = PdfWriter.build(pdfPages, { title: s.title });
        done();
        await download(pdf, `${slug(s.title)}.pdf`);
      }
      done();
      toast(lowRes.size
        ? `Exportado ✓ Atención: poca resolución para imprimir en: ${[...lowRes].join(', ')}`
        : 'Álbum exportado ✓ Listo para enviar a imprenta', lowRes.size ? 8000 : 4000);
    } catch (e) {
      console.error(e);
      done();
      toast('Error al exportar: ' + e.message, 6000);
    }
  }

  /* ---------- navegación y arranque ---------- */
  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    document.querySelectorAll('#steps button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'album') {
      if (!state.pages.length && state.photos.length) state.pages = Album.autoLayout(state.photos, state.settings);
      renderPages();
    }
    if (view === 'photos') renderLibrary();
  }

  function init() {
    const gs = $('#globalStyle');
    Object.entries(Enhance.STYLES).forEach(([k, s]) => gs.append(el('option', { value: k, textContent: s.label })));

    document.querySelectorAll('#steps button').forEach((b) => {
      b.onclick = () => (b.dataset.view === 'edit' ? openEditor() : switchView(b.dataset.view));
    });
    ['#fileInput', '#fileInput2'].forEach((sel) => {
      $(sel).onchange = async (e) => { await importFiles(e.target.files); e.target.value = ''; };
    });

    // Arrastrar archivos desde el escritorio a cualquier parte de la vista de fotos.
    const dz = $('#dropzone');
    document.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      dz.classList.add('drag');
    });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dz.classList.remove('drag'); });
    document.addEventListener('drop', (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      dz.classList.remove('drag');
      if (state.view !== 'photos') switchView('photos');
      importFiles(e.dataTransfer.files);
    });

    $('#showOriginal').onchange = renderLibrary;
    $('#sortSelect').onchange = (e) => { sortPhotos(e.target.value); renderLibrary(); };
    $('#applyStyleAll').onclick = async () => {
      const style = gs.value;
      await applyToAll((p) => { p.adj.style = style; }, 'Aplicando estilo');
      toast(`Estilo «${Enhance.STYLES[style].label}» aplicado a todas`);
    };
    $('#toAlbum').onclick = () => switchView('album');

    bindEditor();
    bindAlbumSettings();

    const dlg = $('#exportDialog');
    $('#exportBtn').onclick = () => {
      if (!state.pages.length) {
        if (!state.photos.length) return toast('Primero añade fotos y crea el álbum');
        state.pages = Album.autoLayout(state.photos, state.settings);
      }
      exportInfo();
      dlg.showModal();
    };
    ['#expDpi', '#expBleed', '#expFormat'].forEach((sel) => $(sel).addEventListener('change', exportInfo));
    dlg.addEventListener('close', () => { if (dlg.returnValue === 'ok') exportAlbum(); });

    window.addEventListener('beforeunload', (e) => { if (state.photos.length) { e.preventDefault(); e.returnValue = ''; } });
    document.fonts?.ready.then(() => { if (state.view === 'album') renderPages(); });

    // Acceso para pruebas automatizadas.
    window.__app = { state, importFiles, exportAlbum, switchView, openEditor };
  }

  init();
})();
