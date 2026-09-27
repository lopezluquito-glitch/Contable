/* Control de Vehículos PNP — interfaz. Las reglas viven en flota.js. */
(() => {
  const F = window.Flota;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const KEY = 'pnp-control-vehiculos-v1';
  const KEY_OPERADOR = 'pnp-control-vehiculos-operador';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = (n) => String(n).padStart(2, '0');
  const ahoraLocal = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const hoy = () => ahoraLocal().slice(0, 10);
  const soles = (n) => (n == null ? '—' : 'S/ ' + F.fmtNum(n, 2));
  const opts = (obj) => Object.entries(obj);
  const NIVELES = ['', 'Lleno', '3/4', '1/2', '1/4', 'Reserva'].map((x) => [x, x || '—']);

  /* ---------- persistencia ---------- */
  let storageOk = true;
  let st = (() => {
    try { return F.cargar(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch { storageOk = false; return F.estadoVacio(); }
  })();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); }
    catch { storageOk = false; }
    $('#storageWarn').classList.toggle('hidden', storageOk);
  }
  const usuario = () => $('#operador').value.trim();
  try { $('#operador').value = localStorage.getItem(KEY_OPERADOR) || ''; } catch { /* sin almacenamiento */ }
  $('#operador').addEventListener('change', () => { try { localStorage.setItem(KEY_OPERADOR, usuario()); } catch { /* idem */ } });

  function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function descargar(texto, nombre, tipo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
    a.download = nombre;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- navegación ---------- */
  let vista = 'panel';
  function mostrar(v) {
    vista = v;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    render();
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) mostrar(b.dataset.view); });

  /* ---------- formato de celdas ---------- */
  const ESTADO_CLASE = { operativo: 'ok', mantenimiento: 'warn', inoperativo: 'bad', baja: 'off' };
  function badgeEstado(v) {
    if (v.estado === 'operativo' && F.salidaAbiertaDe(st, v.id)) return '<span class="badge info">En servicio</span>';
    return `<span class="badge ${ESTADO_CLASE[v.estado]}">${F.ESTADOS[v.estado]}</span>`;
  }
  function venceHtml(fecha) {
    if (!fecha) return '<span class="due-bad">Sin registrar</span>';
    const d = F.diasHasta(fecha, new Date());
    const cls = d < 0 ? 'due-bad' : d <= st.config.diasAviso ? 'due-warn' : '';
    const nota = d < 0 ? 'vencido' : d <= st.config.diasAviso ? `${d} d` : '';
    return `<span class="${cls}">${F.fmtFecha(fecha)}</span>${nota ? `<span class="sub ${cls}">${nota}</span>` : ''}`;
  }
  function proxMantHtml(v) {
    const falta = (v.ultimoMantKm || 0) + st.config.intervaloMantKm - v.km;
    const cls = falta <= 0 ? 'due-bad' : falta <= st.config.intervaloMantKm * 0.1 ? 'due-warn' : '';
    return `<span class="${cls}">${falta <= 0 ? `Pasado ${F.fmtNum(-falta)} km` : `en ${F.fmtNum(falta)} km`}</span>`;
  }
  const placaDe = (id) => { const v = F.vehiculo(st, id); return v ? v.placa : '—'; };
  const filaVacia = (cols, texto) => `<tbody><tr><td class="empty-row" colspan="${cols}">${texto}</td></tr></tbody>`;
  const coincide = (q, ...campos) => !q || campos.join(' ').toLowerCase().includes(q.toLowerCase());
  function duracion(desde, hasta) {
    const min = Math.max(0, Math.round((F.parseFecha(hasta) - F.parseFecha(desde)) / 60000));
    return min >= 60 ? `${Math.floor(min / 60)} h ${p2(min % 60)} min` : `${min} min`;
  }

  /* ---------- render ---------- */
  function render() {
    const al = F.alertas(st);
    const tabPanel = $('#tabs [data-view=panel]');
    const criticas = al.filter((a) => a.nivel === 'critico').length;
    tabPanel.innerHTML = 'Panel' + (criticas ? `<span class="count">${criticas}</span>` : '');
    ({ panel: () => renderPanel(al), vehiculos: renderVehiculos, conductores: renderConductores, salidas: renderSalidas,
      combustible: renderCombustible, mantenimiento: renderMantenimiento, reportes: renderReportes })[vista]();
  }

  function renderPanel(al) {
    const r = F.resumen(st);
    $('#empty').classList.toggle('hidden', st.vehiculos.length > 0);
    $('#kpis').innerHTML = st.vehiculos.length ? [
      ['', r.total - r.baja, 'Vehículos en flota'],
      ['ok', r.disponibles, 'Disponibles'],
      ['info', r.enServicio, 'En servicio'],
      ['warn', r.mantenimiento, 'En mantenimiento'],
      ['bad', r.inoperativo, 'Inoperativos'],
      [r.operatividad >= 0.8 ? 'ok' : r.operatividad >= 0.6 ? 'warn' : 'bad', Math.round(r.operatividad * 100) + ' %', 'Operatividad'],
    ].map(([c, n, t]) => `<div class="kpi ${c}"><b>${n}</b><span>${t}</span></div>`).join('') : '';

    const abiertas = st.movimientos.filter((m) => !m.fechaRetorno);
    $('#enServicio').innerHTML = abiertas.length ? `<div class="table-wrap"><table>
      <thead><tr><th>N.°</th><th>Vehículo</th><th>Conductor</th><th>Salida</th><th>Misión / destino</th><th></th></tr></thead>
      <tbody>${abiertas.map((m) => `<tr>
        <td class="num">${m.numero}</td>
        <td><span class="placa">${esc(placaDe(m.vehiculoId))}</span></td>
        <td>${esc(F.nombreConductor(F.conductor(st, m.conductorId)))}</td>
        <td class="nowrap">${F.fmtFecha(m.fechaSalida)}<span class="sub">hace ${duracion(m.fechaSalida, ahoraLocal())}</span></td>
        <td>${esc(m.mision)}<span class="sub">${esc(m.destino)}</span></td>
        <td class="actions"><button class="btn small primary" data-act="retorno" data-id="${m.id}">Retorno</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Ningún vehículo fuera en este momento.</p>';

    $('#alertCount').textContent = al.length ? `${al.length}` : '';
    $('#alertas').innerHTML = al.length
      ? al.map((a, i) => `<li class="${a.nivel}" data-alerta="${i}"><span class="tag">${a.nivel === 'critico' ? 'Crítico' : 'Aviso'}</span><span>${esc(a.texto)}</span></li>`).join('')
      : '<li class="none">Sin alertas: documentos, licencias y mantenimientos al día.</li>';
    $('#alertas').onclick = (e) => {
      const li = e.target.closest('[data-alerta]');
      if (!li) return;
      const { ref } = al[li.dataset.alerta];
      if (ref.tipo === 'vehiculo') fichaVehiculo(ref.id);
      else if (ref.tipo === 'conductor') formConductor(ref.id);
      else if (ref.tipo === 'movimiento') formRetorno(ref.id);
    };
  }

  function renderVehiculos() {
    const q = $('#qVeh').value.trim();
    const fe = $('#fEstado').value;
    const lista = st.vehiculos
      .filter((v) => (!fe || (fe === 'servicio' ? !!F.salidaAbiertaDe(st, v.id) : v.estado === fe)) &&
        coincide(q, v.placa, v.marca, v.modelo, v.unidad, v.serie, F.TIPOS[v.tipo]))
      .sort((a, b) => a.placa.localeCompare(b.placa));
    $('#tVeh').innerHTML = `<thead><tr><th>Placa</th><th>Vehículo</th><th>Unidad</th><th>Estado</th>
      <th class="num">Kilometraje</th><th>SOAT</th><th>Rev. técnica</th><th>Próx. mantenimiento</th><th></th></tr></thead>` +
      (lista.length ? `<tbody>${lista.map((v) => `<tr>
        <td><span class="placa">${esc(v.placa)}</span></td>
        <td>${esc(v.marca)} ${esc(v.modelo)} ${v.anio}<span class="sub">${esc(F.TIPOS[v.tipo])}${v.color ? ' · ' + esc(v.color) : ''}</span></td>
        <td>${esc(v.unidad)}</td>
        <td>${badgeEstado(v)}</td>
        <td class="num">${F.fmtNum(v.km)} km</td>
        <td class="nowrap">${venceHtml(v.soatVence)}</td>
        <td class="nowrap">${v.revisionVence ? venceHtml(v.revisionVence) : '<span class="muted">—</span>'}</td>
        <td class="nowrap">${v.estado === 'baja' ? '—' : proxMantHtml(v)}</td>
        <td class="actions">
          <button class="btn small" data-act="ficha" data-id="${v.id}">Ficha</button>
          <button class="btn small" data-act="editar-vehiculo" data-id="${v.id}">Editar</button>
        </td></tr>`).join('')}</tbody>`
        : filaVacia(9, st.vehiculos.length ? 'Ningún vehículo coincide con la búsqueda.' : 'Aún no hay vehículos registrados.'));
  }

  function renderConductores() {
    const q = $('#qCond').value.trim();
    const inactivos = $('#fInactivos').checked;
    const lista = st.conductores
      .filter((c) => (inactivos || c.activo) && coincide(q, c.cip, c.apellidos, c.nombres, c.unidad, c.grado, c.dni, c.licenciaNumero))
      .sort((a, b) => a.apellidos.localeCompare(b.apellidos));
    $('#tCond').innerHTML = `<thead><tr><th>CIP</th><th>Grado y nombre</th><th>Unidad</th><th>Licencia</th>
      <th>Vence</th><th>Situación</th><th></th></tr></thead>` +
      (lista.length ? `<tbody>${lista.map((c) => {
        const mov = F.salidaAbiertaConductor(st, c.id);
        return `<tr>
        <td class="placa">${esc(c.cip)}</td>
        <td>${esc(c.grado)}<span class="sub">${esc(c.apellidos)}, ${esc(c.nombres)}</span></td>
        <td>${esc(c.unidad)}</td>
        <td>${esc(c.licenciaCategoria)}<span class="sub">${esc(c.licenciaNumero)}</span></td>
        <td class="nowrap">${venceHtml(c.licenciaVence)}</td>
        <td>${!c.activo ? '<span class="badge off">Inactivo</span>' : mov ? `<span class="badge info">Conduce ${esc(placaDe(mov.vehiculoId))}</span>` : '<span class="badge ok">Disponible</span>'}</td>
        <td class="actions"><button class="btn small" data-act="editar-conductor" data-id="${c.id}">Editar</button></td>
      </tr>`; }).join('')}</tbody>`
        : filaVacia(7, st.conductores.length ? 'Ningún efectivo coincide con la búsqueda.' : 'Aún no hay efectivos registrados.'));
  }

  function renderSalidas() {
    const q = $('#qMov').value.trim();
    const f = $('#fMov').value;
    const lista = st.movimientos.filter((m) => {
      if (f === 'abiertas' && m.fechaRetorno) return false;
      if (f === 'cerradas' && !m.fechaRetorno) return false;
      return coincide(q, m.numero, placaDe(m.vehiculoId), F.nombreConductor(F.conductor(st, m.conductorId)), m.mision, m.destino, m.novedades, m.autorizadoPor);
    });
    $('#tMov').innerHTML = `<thead><tr><th class="num">N.°</th><th>Vehículo</th><th>Conductor</th><th>Salida</th><th>Retorno</th>
      <th class="num">Recorrido</th><th>Misión / destino</th><th>Novedades</th><th></th></tr></thead>` +
      (lista.length ? `<tbody>${lista.map((m) => `<tr>
        <td class="num">${m.numero}</td>
        <td><span class="placa">${esc(placaDe(m.vehiculoId))}</span></td>
        <td>${esc(F.nombreConductor(F.conductor(st, m.conductorId)))}${m.acompanantes ? `<span class="sub">Con: ${esc(m.acompanantes)}</span>` : ''}</td>
        <td class="nowrap">${F.fmtFecha(m.fechaSalida)}<span class="sub">${F.fmtNum(m.kmSalida)} km</span></td>
        <td class="nowrap">${m.fechaRetorno ? `${F.fmtFecha(m.fechaRetorno)}<span class="sub">${duracion(m.fechaSalida, m.fechaRetorno)}</span>` : '<span class="badge info">En servicio</span>'}</td>
        <td class="num">${m.fechaRetorno ? F.fmtNum(m.kmRetorno - m.kmSalida) + ' km' : '—'}</td>
        <td>${esc(m.mision)}<span class="sub">${esc(m.destino)}</span></td>
        <td>${esc(m.novedades) || '<span class="muted">—</span>'}</td>
        <td class="actions">
          ${m.fechaRetorno ? '' : `<button class="btn small primary" data-act="retorno" data-id="${m.id}">Retorno</button>`}
          <button class="btn small" data-act="papeleta" data-id="${m.id}">Papeleta</button>
        </td></tr>`).join('')}</tbody>`
        : filaVacia(9, st.movimientos.length ? 'Ninguna salida coincide.' : 'Aún no se registran salidas.'));
  }

  function renderCombustible() {
    const q = $('#qComb').value.trim();
    const rend = new Map();
    for (const v of st.vehiculos) for (const [k, val] of F.rendimientos(st, v.id)) rend.set(k, val);
    const lista = st.combustible
      .filter((c) => coincide(q, placaDe(c.vehiculoId), c.vale, c.grifo))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    $('#tComb').innerHTML = `<thead><tr><th>Fecha</th><th>Vehículo</th><th>Vale</th><th>Grifo</th><th class="num">Km</th>
      <th class="num">Galones</th><th class="num">Monto</th><th class="num">Rendimiento</th></tr></thead>` +
      (lista.length ? `<tbody>${lista.map((c) => `<tr>
        <td class="nowrap">${F.fmtFecha(c.fecha)}</td>
        <td><span class="placa">${esc(placaDe(c.vehiculoId))}</span>${c.conductorId ? `<span class="sub">${esc(F.nombreConductor(F.conductor(st, c.conductorId)))}</span>` : ''}</td>
        <td>${esc(c.vale) || '—'}</td><td>${esc(c.grifo) || '—'}</td>
        <td class="num">${F.fmtNum(c.km)}</td>
        <td class="num">${F.fmtNum(c.galones, 2)}</td>
        <td class="num">${soles(c.monto)}</td>
        <td class="num">${rend.has(c.id) ? F.fmtNum(rend.get(c.id), 1) + ' km/gal' : '—'}</td>
      </tr>`).join('')}</tbody>`
        : filaVacia(8, 'Aún no se registran abastecimientos.'));
  }

  function renderMantenimiento() {
    const q = $('#qMant').value.trim();
    const lista = st.mantenimientos
      .filter((m) => coincide(q, placaDe(m.vehiculoId), m.taller, m.descripcion, m.orden, m.tipo))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    $('#tMant').innerHTML = `<thead><tr><th>Fecha</th><th>Vehículo</th><th>Tipo</th><th>Trabajo realizado</th><th>Taller / orden</th>
      <th class="num">Km</th><th class="num">Costo</th></tr></thead>` +
      (lista.length ? `<tbody>${lista.map((m) => `<tr>
        <td class="nowrap">${F.fmtFecha(m.fecha)}</td>
        <td><span class="placa">${esc(placaDe(m.vehiculoId))}</span></td>
        <td><span class="badge ${m.tipo === 'preventivo' ? 'ok' : 'warn'}">${m.tipo === 'preventivo' ? 'Preventivo' : 'Correctivo'}</span></td>
        <td>${esc(m.descripcion)}</td>
        <td>${esc(m.taller) || '—'}${m.orden ? `<span class="sub">Orden ${esc(m.orden)}</span>` : ''}</td>
        <td class="num">${F.fmtNum(m.km)}</td>
        <td class="num">${soles(m.costo)}</td>
      </tr>`).join('')}</tbody>`
        : filaVacia(7, 'Aún no se registran mantenimientos.'));
  }

  function filasReporte() {
    return F.reportePeriodo(st, $('#rDesde').value, $('#rHasta').value)
      .filter((r) => r.vehiculo.estado !== 'baja' || r.salidas || r.galones || r.mantenimientos)
      .sort((a, b) => b.km - a.km);
  }
  function tablaReporte(filas) {
    const t = filas.reduce((s, r) => ({
      salidas: s.salidas + r.salidas, km: s.km + r.km, horas: s.horas + r.horas, galones: s.galones + r.galones,
      gc: s.gc + r.gastoCombustible, mant: s.mant + r.mantenimientos, gm: s.gm + r.gastoMantenimiento,
    }), { salidas: 0, km: 0, horas: 0, galones: 0, gc: 0, mant: 0, gm: 0 });
    return `<thead><tr><th>Placa</th><th>Unidad</th><th class="num">Salidas</th><th class="num">Km</th><th class="num">Horas</th>
      <th class="num">Galones</th><th class="num">Km/gal</th><th class="num">Combustible</th><th class="num">Mant.</th><th class="num">Costo mant.</th></tr></thead>` +
      (filas.length ? `<tbody>${filas.map((r) => `<tr>
        <td><span class="placa">${esc(r.vehiculo.placa)}</span></td><td>${esc(r.vehiculo.unidad)}</td>
        <td class="num">${r.salidas}</td><td class="num">${F.fmtNum(r.km)}</td><td class="num">${F.fmtNum(r.horas, 1)}</td>
        <td class="num">${F.fmtNum(r.galones, 2)}</td><td class="num">${F.fmtNum(r.kmPorGalon, 1)}</td>
        <td class="num">${soles(r.gastoCombustible)}</td><td class="num">${r.mantenimientos}</td><td class="num">${soles(r.gastoMantenimiento)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num">${t.salidas}</td><td class="num">${F.fmtNum(t.km)}</td><td class="num">${F.fmtNum(t.horas, 1)}</td>
        <td class="num">${F.fmtNum(t.galones, 2)}</td><td class="num">${F.fmtNum(t.galones ? t.km / t.galones : null, 1)}</td>
        <td class="num">${soles(t.gc)}</td><td class="num">${t.mant}</td><td class="num">${soles(t.gm)}</td></tr></tfoot>`
        : filaVacia(10, 'No hay vehículos registrados.'));
  }

  function renderReportes() {
    if (!$('#rDesde').value) $('#rDesde').value = hoy().slice(0, 8) + '01';
    if (!$('#rHasta').value) $('#rHasta').value = hoy();
    $('#tRep').innerHTML = tablaReporte(filasReporte());
    const cfg = $('#cfgForm');
    for (const k of Object.keys(F.CONFIG_DEFECTO)) if (document.activeElement !== cfg[k]) cfg[k].value = st.config[k];
    $('#tLog').innerHTML = `<thead><tr><th>Fecha</th><th>Operador</th><th>Acción</th></tr></thead>` +
      (st.bitacora.length ? `<tbody>${st.bitacora.slice(0, 300).map((b) => `<tr>
        <td class="nowrap">${new Date(b.fecha).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td>${esc(b.usuario) || '<span class="muted">—</span>'}</td><td>${esc(b.accion)}</td></tr>`).join('')}</tbody>`
        : filaVacia(3, 'Sin actividad.'));
  }

  /* ---------- diálogo genérico ---------- */
  const dlg = $('#dlg');
  let dlgSubmit = null;
  function abrirDialogo({ titulo, campos = [], valores = {}, ok = 'Guardar', alGuardar, alCambiar, soloLectura = false, html = '' }) {
    $('#dlgTitle').textContent = titulo;
    $('#dlgError').classList.add('hidden');
    $('#dlgOk').textContent = ok;
    $('#dlgOk').classList.toggle('hidden', soloLectura);
    $('#dlgCancel').textContent = soloLectura ? 'Cerrar' : 'Cancelar';
    $('#dlgExtra').innerHTML = '';
    const body = $('#dlgBody');
    body.innerHTML = html + campos.map((c) => campoHtml(c, valores[c.name])).join('');
    dlgSubmit = alGuardar;
    body.oninput = body.onchange = alCambiar ? () => alCambiar(datosDialogo(), body) : null;
    if (alCambiar) alCambiar(datosDialogo(), body);
    dlg.showModal();
    const primero = body.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
    if (primero && !soloLectura) primero.focus();
  }
  function campoHtml(c, valor) {
    if (c.heading) return `<h3>${esc(c.heading)}</h3>`;
    if (c.html) return c.html;
    const v = valor ?? c.value ?? '';
    const attrs = `name="${c.name}" ${c.required ? 'required' : ''} ${c.attrs || ''}`;
    let input;
    if (c.type === 'select') {
      input = `<select ${attrs}>${c.options.map(([k, t, dis]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''} ${dis ? 'disabled' : ''}>${esc(t)}</option>`).join('')}</select>`;
    } else if (c.type === 'textarea') {
      input = `<textarea ${attrs}>${esc(v)}</textarea>`;
    } else if (c.type === 'checkbox') {
      return `<label class="check ${c.full ? 'full' : ''}"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}> ${esc(c.label)}</label>`;
    } else {
      input = `<input type="${c.type || 'text'}" value="${esc(v)}" ${attrs}>`;
    }
    return `<label class="${c.full ? 'full' : ''}"><span class="${c.required ? 'req' : ''}">${esc(c.label)}</span>${input}${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}</label>`;
  }
  function datosDialogo() {
    const out = {};
    for (const elx of $('#dlgForm').elements) {
      if (!elx.name) continue;
      out[elx.name] = elx.type === 'checkbox' ? elx.checked : elx.value;
    }
    return out;
  }
  $('#dlgForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!dlgSubmit) return dlg.close();
    try {
      const msg = dlgSubmit(datosDialogo());
      save();
      dlg.close();
      render();
      if (msg) toast(msg);
    } catch (err) {
      const box = $('#dlgError');
      box.textContent = err.message;
      box.classList.remove('hidden');
      box.scrollIntoView({ block: 'nearest' });
    }
  });
  $('#dlgCancel').onclick = $('#dlgClose').onclick = () => dlg.close();

  /* ---------- formularios ---------- */
  function formVehiculo(id) {
    const v = id ? F.vehiculo(st, id) : null;
    abrirDialogo({
      titulo: v ? `Editar vehículo ${v.placa}` : 'Nuevo vehículo',
      valores: v || { estado: 'operativo', combustible: 'gasolina', tipo: 'patrullero' },
      campos: [
        { heading: 'Identificación' },
        { name: 'placa', label: 'Placa', required: true, attrs: 'autocomplete="off" style="text-transform:uppercase"' },
        { name: 'tipo', label: 'Tipo', type: 'select', required: true, options: opts(F.TIPOS) },
        { name: 'marca', label: 'Marca', required: true },
        { name: 'modelo', label: 'Modelo', required: true },
        { name: 'anio', label: 'Año', type: 'number', required: true, attrs: 'min="1950" max="2100"' },
        { name: 'color', label: 'Color' },
        { name: 'serie', label: 'N.° de serie / VIN' },
        { name: 'motor', label: 'N.° de motor' },
        { name: 'combustible', label: 'Combustible', type: 'select', options: opts(F.COMBUSTIBLES) },
        { name: 'unidad', label: 'Unidad / dependencia asignada', required: true, attrs: 'list="dlUnidades"' },
        { heading: 'Situación' },
        { name: 'estado', label: 'Estado', type: 'select', options: opts(F.ESTADOS) },
        { name: 'km', label: 'Kilometraje actual', type: 'number', required: true, attrs: 'min="0"' },
        { name: 'ultimoMantKm', label: 'Km del último mantenimiento preventivo', type: 'number', attrs: 'min="0"', hint: 'Si lo dejas vacío se toma el kilometraje actual.' },
        { name: 'soatVence', label: 'SOAT vence', type: 'date', hint: 'Sin SOAT vigente el vehículo no puede salir.' },
        { name: 'revisionVence', label: 'Revisión técnica vence', type: 'date' },
        { name: 'observaciones', label: 'Observaciones', type: 'textarea', full: true },
      ],
      html: datalistUnidades(),
      alGuardar: (d) => {
        const r = F.guardarVehiculo(st, { ...d, id: v?.id }, usuario());
        return `Vehículo ${r.placa} ${v ? 'actualizado' : 'registrado'}`;
      },
    });
    if (v) {
      $('#dlgExtra').innerHTML = '<button type="button" class="btn danger" id="delVeh">Eliminar</button>';
      $('#delVeh').onclick = () => {
        if (!confirm(`¿Eliminar el vehículo ${v.placa}?`)) return;
        try { F.eliminarVehiculo(st, v.id, usuario()); save(); dlg.close(); render(); toast(`Vehículo ${v.placa} eliminado`); }
        catch (err) { $('#dlgError').textContent = err.message; $('#dlgError').classList.remove('hidden'); }
      };
    }
  }

  function datalistUnidades() {
    const u = new Set([...st.vehiculos.map((v) => v.unidad), ...st.conductores.map((c) => c.unidad)].filter(Boolean));
    return `<datalist id="dlUnidades">${[...u].sort().map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
  }

  function formConductor(id) {
    const c = id ? F.conductor(st, id) : null;
    abrirDialogo({
      titulo: c ? `Editar efectivo CIP ${c.cip}` : 'Nuevo efectivo conductor',
      valores: c || { activo: true, grado: 'Suboficial de Tercera', licenciaCategoria: 'A-IIa' },
      campos: [
        { name: 'cip', label: 'CIP', required: true, attrs: 'inputmode="numeric" autocomplete="off"' },
        { name: 'grado', label: 'Grado', type: 'select', required: true, options: F.GRADOS.map((g) => [g, g]) },
        { name: 'apellidos', label: 'Apellidos', required: true },
        { name: 'nombres', label: 'Nombres', required: true },
        { name: 'dni', label: 'DNI', attrs: 'inputmode="numeric" maxlength="8"' },
        { name: 'telefono', label: 'Teléfono', type: 'tel' },
        { name: 'unidad', label: 'Unidad', required: true, attrs: 'list="dlUnidades"', full: true },
        { heading: 'Licencia de conducir' },
        { name: 'licenciaNumero', label: 'N.° de licencia', required: true },
        { name: 'licenciaCategoria', label: 'Categoría', type: 'select', required: true, options: F.LICENCIAS.map((l) => [l, l]) },
        { name: 'licenciaVence', label: 'Vence', type: 'date', required: true },
        { name: 'activo', label: 'Activo (habilitado para conducir)', type: 'checkbox' },
      ],
      html: datalistUnidades(),
      alGuardar: (d) => {
        const r = F.guardarConductor(st, { ...d, id: c?.id }, usuario());
        return `${F.nombreConductor(r)} ${c ? 'actualizado' : 'registrado'}`;
      },
    });
    if (c) {
      $('#dlgExtra').innerHTML = '<button type="button" class="btn danger" id="delCond">Eliminar</button>';
      $('#delCond').onclick = () => {
        if (!confirm(`¿Eliminar a ${F.nombreConductor(c)}?`)) return;
        try { F.eliminarConductor(st, c.id, usuario()); save(); dlg.close(); render(); toast('Efectivo eliminado'); }
        catch (err) { $('#dlgError').textContent = err.message; $('#dlgError').classList.remove('hidden'); }
      };
    }
  }

  function opcionesVehiculos({ soloDisponibles = false, vacio = 'Elige…' } = {}) {
    const lista = st.vehiculos.filter((v) => v.estado !== 'baja').sort((a, b) => a.placa.localeCompare(b.placa));
    return [['', vacio], ...lista.map((v) => {
      const fuera = F.salidaAbiertaDe(st, v.id);
      const nota = v.estado !== 'operativo' ? ` — ${F.ESTADOS[v.estado]}` : fuera ? ' — en servicio' : '';
      return [v.id, `${v.placa} · ${v.marca} ${v.modelo}${nota}`, soloDisponibles && !!nota];
    })];
  }
  function opcionesConductores({ soloDisponibles = false, vacio = 'Elige…' } = {}) {
    const lista = st.conductores.filter((c) => c.activo).sort((a, b) => a.apellidos.localeCompare(b.apellidos));
    return [['', vacio], ...lista.map((c) => {
      const ocupado = soloDisponibles && F.salidaAbiertaConductor(st, c.id);
      return [c.id, `${F.nombreConductor(c)} · CIP ${c.cip}${ocupado ? ' — conduciendo' : ''}`, !!ocupado];
    })];
  }

  function formSalida(vehiculoId) {
    if (!st.vehiculos.length || !st.conductores.length) {
      toast('Primero registra al menos un vehículo y un conductor.');
      return;
    }
    let ultimoVeh = null;
    abrirDialogo({
      titulo: 'Registrar salida de vehículo',
      ok: 'Registrar salida',
      valores: { vehiculoId: vehiculoId || '', fechaSalida: ahoraLocal(), autorizadoPor: usuario() },
      campos: [
        { name: 'vehiculoId', label: 'Vehículo', type: 'select', required: true, options: opcionesVehiculos({ soloDisponibles: true }) },
        { name: 'conductorId', label: 'Conductor', type: 'select', required: true, options: opcionesConductores({ soloDisponibles: true }) },
        { html: '<ul id="chk" class="checklist hidden"></ul>' },
        { name: 'fechaSalida', label: 'Fecha y hora de salida', type: 'datetime-local', required: true },
        { name: 'kmSalida', label: 'Kilometraje de salida', type: 'number', required: true, attrs: 'min="0"' },
        { name: 'combustibleSalida', label: 'Nivel de combustible', type: 'select', options: NIVELES },
        { name: 'acompanantes', label: 'Acompañantes', hint: 'Grado y apellidos de la tripulación' },
        { name: 'mision', label: 'Misión / motivo', required: true, full: true, attrs: 'list="dlMisiones"' },
        { name: 'destino', label: 'Destino / sector / ruta', required: true },
        { name: 'autorizadoPor', label: 'Autorizado por', required: true },
        { html: `<datalist id="dlMisiones">${['Patrullaje preventivo', 'Patrullaje motorizado', 'Atención de ocurrencia', 'Intervención policial', 'Traslado de detenidos', 'Diligencia fiscal / judicial', 'Operativo policial', 'Apoyo a otra unidad', 'Traslado de personal', 'Comisión de servicio', 'Traslado a taller'].map((m) => `<option value="${m}">`).join('')}</datalist>` },
      ],
      alCambiar: (d, body) => {
        if (d.vehiculoId !== ultimoVeh) {
          ultimoVeh = d.vehiculoId;
          const v = F.vehiculo(st, d.vehiculoId);
          if (v) body.querySelector('[name=kmSalida]').value = v.km;
        }
        const chk = body.querySelector('#chk');
        if (!d.vehiculoId || !d.conductorId) { chk.classList.add('hidden'); return; }
        const err = F.impedimentosSalida(st, d.vehiculoId, d.conductorId, d.fechaSalida);
        chk.classList.remove('hidden');
        chk.classList.toggle('ok', !err.length);
        chk.innerHTML = err.length ? err.map((e) => `<li>${esc(e)}</li>`).join('') : '<li>✓ Vehículo y conductor habilitados: documentos vigentes y licencia de la categoría correcta.</li>';
      },
      alGuardar: (d) => {
        const m = F.registrarSalida(st, d, usuario());
        setTimeout(() => {
          if (confirm(`Salida N.° ${m.numero} registrada. ¿Imprimir la papeleta de salida?`)) papeleta(m.id);
        }, 50);
        return `Salida N.° ${m.numero} registrada`;
      },
    });
  }

  function formRetorno(id) {
    const m = st.movimientos.find((x) => x.id === id);
    if (!m || m.fechaRetorno) return;
    const v = F.vehiculo(st, m.vehiculoId);
    abrirDialogo({
      titulo: `Retorno de ${v ? v.placa : 'vehículo'} · salida N.° ${m.numero}`,
      ok: 'Registrar retorno',
      valores: { fechaRetorno: ahoraLocal(), nuevoEstado: 'operativo' },
      html: `<div class="ficha">
        <div><span>Conductor</span>${esc(F.nombreConductor(F.conductor(st, m.conductorId)))}</div>
        <div><span>Salida</span>${F.fmtFecha(m.fechaSalida)}</div>
        <div><span>Km de salida</span>${F.fmtNum(m.kmSalida)}</div>
        <div><span>Misión</span>${esc(m.mision)} — ${esc(m.destino)}</div></div>`,
      campos: [
        { name: 'fechaRetorno', label: 'Fecha y hora de retorno', type: 'datetime-local', required: true },
        { name: 'kmRetorno', label: 'Kilometraje de retorno', type: 'number', required: true, attrs: `min="${m.kmSalida}"` },
        { name: 'combustibleRetorno', label: 'Nivel de combustible', type: 'select', options: NIVELES },
        { name: 'nuevoEstado', label: 'El vehículo queda', type: 'select', options: [['operativo', 'Operativo'], ['mantenimiento', 'En mantenimiento'], ['inoperativo', 'Inoperativo']] },
        { name: 'novedades', label: 'Novedades (daños, incidencias, ocurrencias)', type: 'textarea', full: true },
        { html: '<p id="recorrido" class="hint full"></p>' },
      ],
      alCambiar: (d, body) => {
        const km = Number(d.kmRetorno) - m.kmSalida;
        body.querySelector('#recorrido').textContent = d.kmRetorno !== '' && km >= 0
          ? `Recorrido: ${F.fmtNum(km)} km en ${duracion(m.fechaSalida, d.fechaRetorno || ahoraLocal())}` : '';
      },
      alGuardar: (d) => {
        F.registrarRetorno(st, m.id, d, usuario());
        return `Retorno de ${v ? v.placa : 'vehículo'} registrado`;
      },
    });
  }

  function formCombustible() {
    if (!st.vehiculos.length) return toast('Primero registra un vehículo.');
    let ultimoVeh = null;
    abrirDialogo({
      titulo: 'Registrar abastecimiento de combustible',
      valores: { fecha: hoy() },
      campos: [
        { name: 'vehiculoId', label: 'Vehículo', type: 'select', required: true, options: opcionesVehiculos() },
        { name: 'conductorId', label: 'Conductor', type: 'select', options: opcionesConductores({ vacio: '—' }) },
        { name: 'fecha', label: 'Fecha', type: 'date', required: true },
        { name: 'km', label: 'Kilometraje', type: 'number', required: true, attrs: 'min="0"' },
        { name: 'galones', label: 'Galones', type: 'number', required: true, attrs: 'min="0.01" step="0.01"' },
        { name: 'monto', label: 'Monto (S/)', type: 'number', attrs: 'min="0" step="0.01"' },
        { name: 'vale', label: 'N.° de vale', hint: 'No se admiten vales repetidos.' },
        { name: 'grifo', label: 'Grifo / estación' },
      ],
      alCambiar: (d, body) => {
        if (d.vehiculoId === ultimoVeh) return;
        ultimoVeh = d.vehiculoId;
        const v = F.vehiculo(st, d.vehiculoId);
        if (v) body.querySelector('[name=km]').value = v.km;
      },
      alGuardar: (d) => {
        const r = F.registrarCombustible(st, d, usuario());
        return `Abastecimiento de ${F.fmtNum(r.galones, 2)} gal registrado`;
      },
    });
  }

  function formMantenimiento(vehiculoId) {
    if (!st.vehiculos.length) return toast('Primero registra un vehículo.');
    let ultimoVeh = null;
    abrirDialogo({
      titulo: 'Registrar mantenimiento',
      valores: { fecha: hoy(), tipo: 'preventivo', vehiculoId: vehiculoId || '', nuevoEstado: 'operativo' },
      campos: [
        { name: 'vehiculoId', label: 'Vehículo', type: 'select', required: true, options: opcionesVehiculos() },
        { name: 'tipo', label: 'Tipo', type: 'select', options: [['preventivo', 'Preventivo'], ['correctivo', 'Correctivo']] },
        { name: 'fecha', label: 'Fecha', type: 'date', required: true },
        { name: 'km', label: 'Kilometraje', type: 'number', required: true, attrs: 'min="0"' },
        { name: 'descripcion', label: 'Trabajo realizado', type: 'textarea', required: true, full: true },
        { name: 'taller', label: 'Taller' },
        { name: 'orden', label: 'N.° de orden de trabajo' },
        { name: 'costo', label: 'Costo (S/)', type: 'number', attrs: 'min="0" step="0.01"' },
        { name: 'nuevoEstado', label: 'Después del trabajo el vehículo queda', type: 'select', options: [['', 'Sin cambiar su estado'], ['operativo', 'Operativo'], ['mantenimiento', 'En mantenimiento'], ['inoperativo', 'Inoperativo']] },
        { html: '<p class="hint full">Un mantenimiento preventivo reinicia el contador de kilómetros para el siguiente.</p>' },
      ],
      alCambiar: (d, body) => {
        if (d.vehiculoId === ultimoVeh) return;
        ultimoVeh = d.vehiculoId;
        const v = F.vehiculo(st, d.vehiculoId);
        if (v) body.querySelector('[name=km]').value = v.km;
      },
      alGuardar: (d) => {
        F.registrarMantenimiento(st, d, usuario());
        return 'Mantenimiento registrado';
      },
    });
  }

  function fichaVehiculo(id) {
    const v = F.vehiculo(st, id);
    if (!v) return;
    const movs = st.movimientos.filter((m) => m.vehiculoId === id).slice(0, 15);
    const mant = st.mantenimientos.filter((m) => m.vehiculoId === id).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 10);
    const dato = (t, val) => `<div><span>${t}</span>${val}</div>`;
    abrirDialogo({
      titulo: `Ficha del vehículo ${v.placa}`,
      soloLectura: true,
      html: `<div class="ficha">
        ${dato('Estado', badgeEstado(v))}
        ${dato('Tipo', esc(F.TIPOS[v.tipo]))}
        ${dato('Marca / modelo', `${esc(v.marca)} ${esc(v.modelo)} (${v.anio})`)}
        ${dato('Color', esc(v.color) || '—')}
        ${dato('Unidad', esc(v.unidad))}
        ${dato('Combustible', esc(F.COMBUSTIBLES[v.combustible]))}
        ${dato('N.° de serie', esc(v.serie) || '—')}
        ${dato('N.° de motor', esc(v.motor) || '—')}
        ${dato('Kilometraje', F.fmtNum(v.km) + ' km')}
        ${dato('Próximo mantenimiento', proxMantHtml(v))}
        ${dato('SOAT', venceHtml(v.soatVence))}
        ${dato('Revisión técnica', v.revisionVence ? venceHtml(v.revisionVence) : '—')}
        ${v.observaciones ? `<div class="full" style="grid-column:1/-1"><span>Observaciones</span>${esc(v.observaciones)}</div>` : ''}
      </div>
      <div class="ficha-hist"><h3>Últimas salidas</h3>${movs.length ? `<div class="table-wrap"><table><tbody>${movs.map((m) => `<tr>
        <td class="num">${m.numero}</td><td class="nowrap">${F.fmtFecha(m.fechaSalida)}</td>
        <td>${esc(F.nombreConductor(F.conductor(st, m.conductorId)))}</td><td>${esc(m.mision)}</td>
        <td class="num">${m.fechaRetorno ? F.fmtNum(m.kmRetorno - m.kmSalida) + ' km' : 'En servicio'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin salidas.</p>'}</div>
      <div class="ficha-hist"><h3>Mantenimientos</h3>${mant.length ? `<div class="table-wrap"><table><tbody>${mant.map((m) => `<tr>
        <td class="nowrap">${F.fmtFecha(m.fecha)}</td><td>${m.tipo === 'preventivo' ? 'Preventivo' : 'Correctivo'}</td>
        <td>${esc(m.descripcion)}</td><td class="num">${F.fmtNum(m.km)} km</td><td class="num">${soles(m.costo)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin mantenimientos.</p>'}</div>`,
    });
    $('#dlgExtra').innerHTML = `<button type="button" class="btn" id="fEdit">Editar</button>
      <button type="button" class="btn" id="fMant">Registrar mantenimiento</button>
      ${v.estado === 'operativo' && !F.salidaAbiertaDe(st, v.id) ? '<button type="button" class="btn" id="fSal">Registrar salida</button>' : ''}`;
    $('#fEdit').onclick = () => { dlg.close(); formVehiculo(v.id); };
    $('#fMant').onclick = () => { dlg.close(); formMantenimiento(v.id); };
    if ($('#fSal')) $('#fSal').onclick = () => { dlg.close(); formSalida(v.id); };
  }

  /* ---------- impresión ---------- */
  function imprimir(html) {
    $('#printArea').innerHTML = html;
    window.print();
  }

  function papeleta(id) {
    const m = st.movimientos.find((x) => x.id === id);
    if (!m) return;
    const v = F.vehiculo(st, m.vehiculoId) || {};
    const c = F.conductor(st, m.conductorId);
    const fila = (t, val) => `<tr><th>${t}</th><td>${val}</td></tr>`;
    imprimir(`<h1>POLICÍA NACIONAL DEL PERÚ</h1>
      <p class="sub">${esc(v.unidad || '')}<br><b>PAPELETA DE SALIDA DE VEHÍCULO N.° ${String(m.numero).padStart(6, '0')}</b></p>
      <table>
        ${fila('Placa', `<b>${esc(v.placa)}</b>`)}
        ${fila('Vehículo', `${esc(F.TIPOS[v.tipo] || '')} ${esc(v.marca)} ${esc(v.modelo)} ${v.anio || ''} ${esc(v.color || '')}`)}
        ${fila('Conductor', `${esc(F.nombreConductor(c))} — CIP ${esc(c?.cip)}`)}
        ${fila('Licencia', `${esc(c?.licenciaNumero)} (${esc(c?.licenciaCategoria)}), vence ${F.fmtFecha(c?.licenciaVence)}`)}
        ${fila('Acompañantes', esc(m.acompanantes) || '—')}
        ${fila('Misión / motivo', esc(m.mision))}
        ${fila('Destino / sector', esc(m.destino))}
        ${fila('Salida', `${F.fmtFecha(m.fechaSalida)} — ${F.fmtNum(m.kmSalida)} km — combustible: ${esc(m.combustibleSalida) || '—'}`)}
        ${fila('Retorno', m.fechaRetorno ? `${F.fmtFecha(m.fechaRetorno)} — ${F.fmtNum(m.kmRetorno)} km — combustible: ${esc(m.combustibleRetorno) || '—'}` : '&nbsp;')}
        ${fila('Recorrido', m.fechaRetorno ? `${F.fmtNum(m.kmRetorno - m.kmSalida)} km` : '&nbsp;')}
        ${fila('Novedades', esc(m.novedades) || '&nbsp;<br>&nbsp;')}
        ${fila('Autorizado por', esc(m.autorizadoPor))}
      </table>
      <div class="firmas"><div>Conductor</div><div>Oficial de guardia</div><div>Jefe de unidad</div></div>`);
  }

  /* ---------- exportación ---------- */
  const COLUMNAS = {
    vehiculos: [
      ['Placa', (v) => v.placa], ['Tipo', (v) => F.TIPOS[v.tipo]], ['Marca', (v) => v.marca], ['Modelo', (v) => v.modelo],
      ['Año', (v) => v.anio], ['Color', (v) => v.color], ['Serie/VIN', (v) => v.serie], ['Motor', (v) => v.motor],
      ['Combustible', (v) => F.COMBUSTIBLES[v.combustible]], ['Unidad', (v) => v.unidad], ['Estado', (v) => F.ESTADOS[v.estado]],
      ['En servicio', (v) => (F.salidaAbiertaDe(st, v.id) ? 'Sí' : 'No')], ['Km', (v) => v.km], ['Km último mant.', (v) => v.ultimoMantKm],
      ['SOAT vence', (v) => F.fmtFecha(v.soatVence)], ['Rev. técnica vence', (v) => F.fmtFecha(v.revisionVence)], ['Observaciones', (v) => v.observaciones],
    ],
    conductores: [
      ['CIP', (c) => c.cip], ['Grado', (c) => c.grado], ['Apellidos', (c) => c.apellidos], ['Nombres', (c) => c.nombres], ['DNI', (c) => c.dni],
      ['Unidad', (c) => c.unidad], ['Licencia', (c) => c.licenciaNumero], ['Categoría', (c) => c.licenciaCategoria],
      ['Licencia vence', (c) => F.fmtFecha(c.licenciaVence)], ['Teléfono', (c) => c.telefono], ['Activo', (c) => (c.activo ? 'Sí' : 'No')],
    ],
    movimientos: [
      ['N.°', (m) => m.numero], ['Placa', (m) => placaDe(m.vehiculoId)], ['Conductor', (m) => F.nombreConductor(F.conductor(st, m.conductorId))],
      ['CIP', (m) => F.conductor(st, m.conductorId)?.cip], ['Acompañantes', (m) => m.acompanantes], ['Misión', (m) => m.mision], ['Destino', (m) => m.destino],
      ['Autorizado por', (m) => m.autorizadoPor], ['Salida', (m) => F.fmtFecha(m.fechaSalida)], ['Km salida', (m) => m.kmSalida],
      ['Combustible salida', (m) => m.combustibleSalida], ['Retorno', (m) => (m.fechaRetorno ? F.fmtFecha(m.fechaRetorno) : 'En servicio')],
      ['Km retorno', (m) => m.kmRetorno], ['Recorrido km', (m) => (m.fechaRetorno ? m.kmRetorno - m.kmSalida : '')],
      ['Combustible retorno', (m) => m.combustibleRetorno], ['Novedades', (m) => m.novedades],
    ],
    combustible: [
      ['Fecha', (c) => F.fmtFecha(c.fecha)], ['Placa', (c) => placaDe(c.vehiculoId)], ['Vale', (c) => c.vale], ['Grifo', (c) => c.grifo],
      ['Km', (c) => c.km], ['Galones', (c) => c.galones], ['Monto S/', (c) => c.monto],
      ['Conductor', (c) => (c.conductorId ? F.nombreConductor(F.conductor(st, c.conductorId)) : '')],
    ],
    mantenimientos: [
      ['Fecha', (m) => F.fmtFecha(m.fecha)], ['Placa', (m) => placaDe(m.vehiculoId)], ['Tipo', (m) => m.tipo], ['Trabajo', (m) => m.descripcion],
      ['Taller', (m) => m.taller], ['Orden', (m) => m.orden], ['Km', (m) => m.km], ['Costo S/', (m) => m.costo],
    ],
    bitacora: [
      ['Fecha', (b) => new Date(b.fecha).toLocaleString('es-PE')], ['Operador', (b) => b.usuario], ['Acción', (b) => b.accion],
    ],
  };
  function exportar(tipo) {
    const cols = COLUMNAS[tipo].map(([titulo, valor]) => ({ titulo, valor }));
    descargar(F.csv(st[tipo], cols), `pnp-${tipo}-${hoy()}.csv`, 'text/csv;charset=utf-8');
  }

  $('#rCsv').onclick = () => {
    const cols = [
      ['Placa', (r) => r.vehiculo.placa], ['Unidad', (r) => r.vehiculo.unidad], ['Salidas', (r) => r.salidas], ['Km', (r) => r.km],
      ['Horas', (r) => r.horas.toFixed(1)], ['Galones', (r) => r.galones.toFixed(2)], ['Km/gal', (r) => (r.kmPorGalon ? r.kmPorGalon.toFixed(1) : '')],
      ['Combustible S/', (r) => r.gastoCombustible.toFixed(2)], ['Mantenimientos', (r) => r.mantenimientos], ['Costo mant. S/', (r) => r.gastoMantenimiento.toFixed(2)],
    ].map(([titulo, valor]) => ({ titulo, valor }));
    descargar(F.csv(filasReporte(), cols), `pnp-reporte-${$('#rDesde').value}-a-${$('#rHasta').value}.csv`, 'text/csv;charset=utf-8');
  };
  $('#rPrint').onclick = () => imprimir(`<h1>POLICÍA NACIONAL DEL PERÚ</h1>
    <p class="sub"><b>REPORTE DE USO DE LA FLOTA VEHICULAR</b><br>Del ${F.fmtFecha($('#rDesde').value)} al ${F.fmtFecha($('#rHasta').value)}</p>
    <table>${tablaReporte(filasReporte())}</table>`);
  ['#rDesde', '#rHasta'].forEach((s) => $(s).addEventListener('change', render));

  $('#cfgForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const cfg = {};
    for (const k of Object.keys(F.CONFIG_DEFECTO)) {
      const n = Number(f[k].value);
      if (!(n > 0)) return toast('Revisa los parámetros: deben ser números mayores que cero.');
      cfg[k] = n;
    }
    st.config = cfg;
    F.registrar(st, 'Cambió los parámetros de alertas', usuario());
    save(); render(); toast('Parámetros guardados');
  });

  $('#backupBtn').onclick = () => descargar(JSON.stringify(st, null, 1), `pnp-control-vehiculos-${hoy()}.json`, 'application/json');
  $('#restoreInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.vehiculos) || !Array.isArray(data.movimientos)) throw new Error('formato');
      if (!confirm(`La copia contiene ${data.vehiculos.length} vehículos y ${data.movimientos.length} salidas. ¿Reemplazar los datos actuales?`)) return;
      st = F.cargar(data);
      F.registrar(st, `Restauró la copia de seguridad «${file.name}»`, usuario());
      save(); render(); toast('Copia restaurada');
    } catch {
      toast('El archivo no es una copia de seguridad válida de esta aplicación.', 5000);
    }
  });

  /* ---------- acciones ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (a) {
      ({ 'nuevo-vehiculo': () => formVehiculo(), 'nuevo-conductor': () => formConductor(), 'nueva-salida': () => formSalida(),
        'nuevo-combustible': formCombustible, 'nuevo-mantenimiento': () => formMantenimiento() })[a.dataset.action]();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (b) {
      const id = b.dataset.id;
      ({ ficha: fichaVehiculo, 'editar-vehiculo': formVehiculo, 'editar-conductor': formConductor, retorno: formRetorno, papeleta })[b.dataset.act](id);
      return;
    }
    const x = e.target.closest('[data-export]');
    if (x) exportar(x.dataset.export);
  });

  for (const s of ['#qVeh', '#qCond', '#qMov', '#qComb', '#qMant']) $(s).addEventListener('input', render);
  for (const s of ['#fEstado', '#fInactivos', '#fMov']) $(s).addEventListener('change', render);
  $('#fEstado').innerHTML += `<option value="servicio">En servicio</option>` + opts(F.ESTADOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('');

  /* ---------- datos de ejemplo ---------- */
  $('#demoBtn').onclick = () => {
    try { cargarEjemplo(); } catch (err) { st = F.estadoVacio(); save(); render(); toast('No se pudieron cargar los ejemplos: ' + err.message, 6000); }
  };
  function cargarEjemplo() {
    const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
    const u = 'Ejemplo';
    const unidad = 'Comisaría de ejemplo';
    const V = [
      ['EJ-1001', 'patrullero', 'Toyota', 'Corolla', 2021, 'Blanco/verde', 42150, 38000, 200, 150],
      ['EJ-1002', 'camioneta', 'Nissan', 'Frontier', 2019, 'Blanco/verde', 96400, 92000, 12, 90],
      ['EJ-1003', 'motocicleta', 'Honda', 'XR 250', 2022, 'Blanco', 18300, 13100, 300, 250],
      ['EJ-1004', 'camioneta', 'Toyota', 'Hilux', 2018, 'Blanco/verde', 131800, 130000, 120, -5],
      ['EJ-1005', 'minivan', 'Hyundai', 'H-1', 2017, 'Blanco', 150200, 149000, 60, 60],
    ].map(([placa, tipo, marca, modelo, anio, color, km, ultimoMantKm, soat, rt]) =>
      F.guardarVehiculo(st, { placa, tipo, marca, modelo, anio, color, km, ultimoMantKm, unidad, combustible: tipo === 'camioneta' ? 'diesel' : 'gasolina', soatVence: dia(soat), revisionVence: dia(rt) }, u));
    const C = [
      ['10000001', 'Suboficial de Primera', 'PÉREZ GARCÍA', 'Luis Alberto', 'A-IIb', 400],
      ['10000002', 'Suboficial de Tercera', 'RAMOS HUAMÁN', 'Rosa María', 'A-IIa', 20],
      ['10000003', 'Suboficial Técnico de Tercera', 'TORRES QUISPE', 'Miguel', 'B-IIb', 600],
      ['10000004', 'Teniente', 'FLORES CHÁVEZ', 'Ana Lucía', 'A-I', 800],
    ].map(([cip, grado, apellidos, nombres, licenciaCategoria, vence]) =>
      F.guardarConductor(st, { cip, grado, apellidos, nombres, unidad, licenciaNumero: 'X' + cip, licenciaCategoria, licenciaVence: dia(vence) }, u));
    const hora = (n, h) => `${dia(n)}T${p2(h)}:00`;
    const viaje = (v, c, n, h1, h2, km, mision, destino) => {
      const m = F.registrarSalida(st, { vehiculoId: v.id, conductorId: c.id, fechaSalida: hora(n, h1), kmSalida: v.km, mision, destino, autorizadoPor: 'Mayor de guardia', combustibleSalida: '3/4' }, u);
      F.registrarRetorno(st, m.id, { fechaRetorno: hora(n, h2), kmRetorno: v.km + km, combustibleRetorno: '1/2', nuevoEstado: 'operativo' }, u);
    };
    viaje(V[0], C[0], -3, 7, 15, 86, 'Patrullaje preventivo', 'Sector 1');
    viaje(V[1], C[1], -3, 8, 18, 124, 'Operativo policial', 'Sector 4');
    viaje(V[2], C[2], -2, 7, 13, 64, 'Patrullaje motorizado', 'Sector 2');
    viaje(V[0], C[3], -1, 19, 23, 41, 'Atención de ocurrencia', 'Av. principal');
    viaje(V[1], C[0], -1, 8, 12, 58, 'Diligencia fiscal / judicial', 'Fiscalía provincial');
    F.registrarCombustible(st, { vehiculoId: V[0].id, fecha: dia(-4), km: 42150, galones: 10, monto: 172, vale: 'E-0001', grifo: 'Grifo de ejemplo' }, u);
    F.registrarCombustible(st, { vehiculoId: V[0].id, fecha: dia(-1), km: V[0].km, galones: 4.5, monto: 77.4, vale: 'E-0002', grifo: 'Grifo de ejemplo' }, u);
    F.registrarCombustible(st, { vehiculoId: V[1].id, fecha: dia(-1), km: V[1].km, galones: 12, monto: 190.8, vale: 'E-0003', grifo: 'Grifo de ejemplo' }, u);
    F.registrarMantenimiento(st, { vehiculoId: V[4].id, fecha: dia(-2), km: V[4].km, tipo: 'correctivo', descripcion: 'Cambio de pastillas y discos de freno', taller: 'Taller de ejemplo', costo: 680, nuevoEstado: 'mantenimiento' }, u);
    const d = new Date(Date.now() - 3 * 3600000);
    const hace3h = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
    F.registrarSalida(st, { vehiculoId: V[2].id, conductorId: C[2].id, fechaSalida: hace3h, kmSalida: V[2].km, mision: 'Patrullaje motorizado', destino: 'Sector 3', autorizadoPor: 'Mayor de guardia', combustibleSalida: 'Lleno' }, u);
    save(); render(); toast('Datos de ejemplo cargados. Bórralos desde «Reportes → Borrar todos los datos».', 6000);
  }

  $('#wipeBtn').onclick = () => {
    if (!confirm('¿Borrar TODOS los vehículos, conductores, salidas, abastecimientos, mantenimientos y la bitácora de este navegador? Descarga antes una copia si la necesitas.')) return;
    if (prompt('Escribe BORRAR para confirmar') !== 'BORRAR') return;
    st = F.estadoVacio();
    save(); render(); toast('Datos borrados');
  };

  save();
  render();
  setInterval(() => { if (!dlg.open) render(); }, 60000);
})();
