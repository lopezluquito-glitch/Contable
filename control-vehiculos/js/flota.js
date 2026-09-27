/* Control de Vehículos PNP — datos y reglas de negocio (sin DOM, probado con node --test). */
(function (root) {
  'use strict';

  const TIPOS = {
    patrullero: 'Patrullero (automóvil)',
    camioneta: 'Camioneta',
    motocicleta: 'Motocicleta',
    minivan: 'Minivan / furgoneta',
    bus: 'Ómnibus / microbús',
    camion: 'Camión',
    otro: 'Otro',
  };

  const ESTADOS = {
    operativo: 'Operativo',
    mantenimiento: 'En mantenimiento',
    inoperativo: 'Inoperativo',
    baja: 'De baja',
  };

  const COMBUSTIBLES = { gasolina: 'Gasolina', diesel: 'Diésel', glp: 'GLP', gnv: 'GNV', electrico: 'Eléctrico' };

  const GRADOS = [
    'General', 'Coronel', 'Comandante', 'Mayor', 'Capitán', 'Teniente', 'Alférez',
    'Suboficial Superior', 'Suboficial Brigadier', 'Suboficial Técnico de Primera',
    'Suboficial Técnico de Segunda', 'Suboficial Técnico de Tercera',
    'Suboficial de Primera', 'Suboficial de Segunda', 'Suboficial de Tercera',
  ];

  const LICENCIAS = ['A-I', 'A-IIa', 'A-IIb', 'A-IIIa', 'A-IIIb', 'A-IIIc', 'B-IIa', 'B-IIb', 'B-IIc'];

  // Categorías de licencia que habilitan cada tipo de vehículo.
  const LICENCIA_POR_TIPO = {
    patrullero: ['A-I', 'A-IIa', 'A-IIb', 'A-IIIa', 'A-IIIb', 'A-IIIc'],
    camioneta: ['A-I', 'A-IIa', 'A-IIb', 'A-IIIa', 'A-IIIb', 'A-IIIc'],
    minivan: ['A-IIa', 'A-IIb', 'A-IIIa', 'A-IIIb', 'A-IIIc'],
    bus: ['A-IIb', 'A-IIIa', 'A-IIIc'],
    camion: ['A-IIb', 'A-IIIb', 'A-IIIc'],
    motocicleta: ['B-IIb', 'B-IIc'],
    otro: LICENCIAS,
  };

  const CONFIG_DEFECTO = {
    intervaloMantKm: 5000,  // mantenimiento preventivo cada N km
    diasAviso: 30,          // aviso de vencimiento de SOAT, revisión técnica y licencia
    horasSalidaMax: 12,     // salida abierta más tiempo que esto genera alerta
  };

  const DIA = 86400000;

  /* ---------- utilidades ---------- */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:MM' siempre en hora local.
  function parseFecha(s) {
    if (!s) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00' : s);
    return isNaN(d) ? null : d;
  }

  function diasHasta(fecha, ahora) {
    const d = parseFecha(fecha);
    if (!d) return null;
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    return Math.round((d - hoy) / DIA);
  }

  function normPlaca(p) {
    return String(p || '').toUpperCase().replace(/\s+/g, '').trim();
  }

  function num(v, campo, { min = 0, entero = false, opcional = false } = {}) {
    if (v === '' || v == null) {
      if (opcional) return null;
      throw new Error(`Falta ${campo}.`);
    }
    const n = Number(v);
    if (!isFinite(n) || n < min) throw new Error(`${campo} no es válido.`);
    if (entero && !Number.isInteger(n)) throw new Error(`${campo} debe ser un número entero.`);
    return n;
  }

  function req(v, campo) {
    const s = String(v ?? '').trim();
    if (!s) throw new Error(`Falta ${campo}.`);
    return s;
  }

  function fechaReq(v, campo) {
    if (!parseFecha(v)) throw new Error(`Falta ${campo} o no es una fecha válida.`);
    return v;
  }

  /* ---------- estado ---------- */
  function estadoVacio() {
    return {
      version: 1,
      config: { ...CONFIG_DEFECTO },
      vehiculos: [],
      conductores: [],
      movimientos: [],
      combustible: [],
      mantenimientos: [],
      bitacora: [],
    };
  }

  function cargar(data) {
    const base = estadoVacio();
    if (!data || typeof data !== 'object') return base;
    for (const k of ['vehiculos', 'conductores', 'movimientos', 'combustible', 'mantenimientos', 'bitacora']) {
      if (Array.isArray(data[k])) base[k] = data[k];
    }
    base.config = { ...CONFIG_DEFECTO, ...(data.config || {}) };
    return base;
  }

  function registrar(st, accion, usuario) {
    st.bitacora.unshift({ id: uid(), fecha: new Date().toISOString(), usuario: usuario || '', accion });
    if (st.bitacora.length > 2000) st.bitacora.length = 2000;
  }

  const vehiculo = (st, id) => st.vehiculos.find((v) => v.id === id);
  const conductor = (st, id) => st.conductores.find((c) => c.id === id);
  const salidaAbiertaDe = (st, vehiculoId) =>
    st.movimientos.find((m) => m.vehiculoId === vehiculoId && !m.fechaRetorno);
  const salidaAbiertaConductor = (st, conductorId) =>
    st.movimientos.find((m) => m.conductorId === conductorId && !m.fechaRetorno);

  function nombreConductor(c) {
    return c ? `${c.grado} ${c.apellidos}, ${c.nombres}` : '—';
  }

  /* ---------- vehículos ---------- */
  function guardarVehiculo(st, data, usuario) {
    const placa = normPlaca(data.placa);
    if (!/^[A-Z0-9-]{5,10}$/.test(placa)) throw new Error('La placa debe tener entre 5 y 10 letras, números o guiones.');
    const clave = placa.replace(/-/g, '');
    if (st.vehiculos.some((v) => v.placa.replace(/-/g, '') === clave && v.id !== data.id)) throw new Error(`Ya existe un vehículo con placa ${placa}.`);
    if (!TIPOS[data.tipo]) throw new Error('Elige el tipo de vehículo.');
    const estado = data.estado || 'operativo';
    if (!ESTADOS[estado]) throw new Error('Estado no válido.');
    const anio = num(data.anio, 'el año', { min: 1950, entero: true });
    if (anio > new Date().getFullYear() + 1) throw new Error('El año no es válido.');

    const previo = data.id ? vehiculo(st, data.id) : null;
    if (data.id && !previo) throw new Error('El vehículo no existe.');
    if (previo && estado !== 'operativo' && salidaAbiertaDe(st, previo.id)) {
      throw new Error('El vehículo está en servicio; registra su retorno antes de cambiar su estado.');
    }
    const km = num(data.km, 'el kilometraje', { min: 0 });
    if (previo && km < previo.km) throw new Error(`El kilometraje no puede bajar (actual: ${previo.km} km).`);

    const v = {
      id: previo ? previo.id : uid(),
      placa,
      tipo: data.tipo,
      marca: req(data.marca, 'la marca'),
      modelo: req(data.modelo, 'el modelo'),
      anio,
      color: String(data.color || '').trim(),
      serie: String(data.serie || '').trim().toUpperCase(),
      motor: String(data.motor || '').trim().toUpperCase(),
      combustible: COMBUSTIBLES[data.combustible] ? data.combustible : 'gasolina',
      unidad: req(data.unidad, 'la unidad o dependencia asignada'),
      estado,
      km,
      ultimoMantKm: data.ultimoMantKm === '' || data.ultimoMantKm == null ? (previo ? previo.ultimoMantKm : km) : num(data.ultimoMantKm, 'el km del último mantenimiento'),
      soatVence: data.soatVence || '',
      revisionVence: data.revisionVence || '',
      observaciones: String(data.observaciones || '').trim(),
    };
    if (v.ultimoMantKm > v.km) throw new Error('El km del último mantenimiento no puede ser mayor que el kilometraje actual.');

    if (previo) {
      Object.assign(previo, v);
      registrar(st, `Actualizó el vehículo ${placa}`, usuario);
      return previo;
    }
    st.vehiculos.push(v);
    registrar(st, `Registró el vehículo ${placa}`, usuario);
    return v;
  }

  function eliminarVehiculo(st, id, usuario) {
    const v = vehiculo(st, id);
    if (!v) return;
    const usado = st.movimientos.some((m) => m.vehiculoId === id) ||
      st.combustible.some((c) => c.vehiculoId === id) ||
      st.mantenimientos.some((m) => m.vehiculoId === id);
    if (usado) throw new Error(`${v.placa} tiene historial; en lugar de eliminarlo, cambia su estado a «De baja».`);
    st.vehiculos.splice(st.vehiculos.indexOf(v), 1);
    registrar(st, `Eliminó el vehículo ${v.placa}`, usuario);
  }

  /* ---------- conductores ---------- */
  function guardarConductor(st, data, usuario) {
    const cip = String(data.cip || '').replace(/\D/g, '');
    if (cip.length < 5 || cip.length > 9) throw new Error('El CIP debe tener entre 5 y 9 dígitos.');
    if (st.conductores.some((c) => c.cip === cip && c.id !== data.id)) throw new Error(`Ya existe un efectivo con CIP ${cip}.`);
    if (!GRADOS.includes(data.grado)) throw new Error('Elige el grado.');
    if (!LICENCIAS.includes(data.licenciaCategoria)) throw new Error('Elige la categoría de la licencia.');
    const previo = data.id ? conductor(st, data.id) : null;
    if (data.id && !previo) throw new Error('El efectivo no existe.');
    const activo = data.activo !== false;
    if (previo && !activo && salidaAbiertaConductor(st, previo.id)) {
      throw new Error('El efectivo tiene un vehículo en servicio; registra el retorno antes de desactivarlo.');
    }
    const c = {
      id: previo ? previo.id : uid(),
      cip,
      grado: data.grado,
      apellidos: req(data.apellidos, 'los apellidos').toUpperCase(),
      nombres: req(data.nombres, 'los nombres'),
      dni: String(data.dni || '').replace(/\D/g, ''),
      unidad: req(data.unidad, 'la unidad'),
      licenciaNumero: req(data.licenciaNumero, 'el número de licencia').toUpperCase(),
      licenciaCategoria: data.licenciaCategoria,
      licenciaVence: fechaReq(data.licenciaVence, 'el vencimiento de la licencia'),
      telefono: String(data.telefono || '').trim(),
      activo,
    };
    if (c.dni && c.dni.length !== 8) throw new Error('El DNI debe tener 8 dígitos.');
    if (previo) {
      Object.assign(previo, c);
      registrar(st, `Actualizó al efectivo CIP ${cip}`, usuario);
      return previo;
    }
    st.conductores.push(c);
    registrar(st, `Registró al efectivo CIP ${cip}`, usuario);
    return c;
  }

  function eliminarConductor(st, id, usuario) {
    const c = conductor(st, id);
    if (!c) return;
    if (st.movimientos.some((m) => m.conductorId === id)) {
      throw new Error('El efectivo tiene salidas registradas; en lugar de eliminarlo, márcalo como inactivo.');
    }
    st.conductores.splice(st.conductores.indexOf(c), 1);
    registrar(st, `Eliminó al efectivo CIP ${c.cip}`, usuario);
  }

  /* ---------- salidas y retornos ---------- */
  // Comprueba si un vehículo y un conductor pueden salir; devuelve la lista de impedimentos.
  function impedimentosSalida(st, vehiculoId, conductorId, fechaSalida) {
    const errores = [];
    const v = vehiculo(st, vehiculoId);
    const c = conductor(st, conductorId);
    const ref = parseFecha(fechaSalida) || new Date();
    if (!v) errores.push('Elige un vehículo.');
    if (!c) errores.push('Elige un conductor.');
    if (v) {
      if (v.estado !== 'operativo') errores.push(`${v.placa} está «${ESTADOS[v.estado]}».`);
      if (salidaAbiertaDe(st, v.id)) errores.push(`${v.placa} ya está en servicio (salida sin retorno).`);
      if (!v.soatVence) errores.push(`${v.placa} no tiene registrado el SOAT.`);
      else if (diasHasta(v.soatVence, ref) < 0) errores.push(`El SOAT de ${v.placa} venció el ${fmtFecha(v.soatVence)}.`);
      if (v.revisionVence && diasHasta(v.revisionVence, ref) < 0) {
        errores.push(`La revisión técnica de ${v.placa} venció el ${fmtFecha(v.revisionVence)}.`);
      }
    }
    if (c) {
      if (!c.activo) errores.push(`${nombreConductor(c)} está inactivo.`);
      if (salidaAbiertaConductor(st, c.id)) errores.push(`${nombreConductor(c)} ya tiene un vehículo en servicio.`);
      if (diasHasta(c.licenciaVence, ref) < 0) errores.push(`La licencia de ${nombreConductor(c)} venció el ${fmtFecha(c.licenciaVence)}.`);
      if (v && !LICENCIA_POR_TIPO[v.tipo].includes(c.licenciaCategoria)) {
        errores.push(`La licencia ${c.licenciaCategoria} no habilita a conducir ${TIPOS[v.tipo].toLowerCase()} (requiere ${LICENCIA_POR_TIPO[v.tipo].join(', ')}).`);
      }
    }
    return errores;
  }

  function registrarSalida(st, data, usuario) {
    const fechaSalida = fechaReq(data.fechaSalida, 'la fecha y hora de salida');
    const errores = impedimentosSalida(st, data.vehiculoId, data.conductorId, fechaSalida);
    if (errores.length) throw new Error(errores.join('\n'));
    const v = vehiculo(st, data.vehiculoId);
    const kmSalida = num(data.kmSalida, 'el kilometraje de salida');
    if (kmSalida < v.km) throw new Error(`El kilometraje de salida no puede ser menor que el último registrado (${v.km} km).`);
    const m = {
      id: uid(),
      numero: siguienteNumero(st),
      vehiculoId: v.id,
      conductorId: data.conductorId,
      acompanantes: String(data.acompanantes || '').trim(),
      fechaSalida,
      kmSalida,
      combustibleSalida: String(data.combustibleSalida || ''),
      mision: req(data.mision, 'la misión o motivo'),
      destino: req(data.destino, 'el destino o sector'),
      autorizadoPor: req(data.autorizadoPor, 'quién autoriza la salida'),
      fechaRetorno: '',
      kmRetorno: null,
      combustibleRetorno: '',
      novedades: '',
    };
    v.km = kmSalida;
    st.movimientos.unshift(m);
    registrar(st, `Salida N.° ${m.numero}: ${v.placa} con ${nombreConductor(conductor(st, m.conductorId))}`, usuario);
    return m;
  }

  function siguienteNumero(st) {
    return st.movimientos.reduce((max, m) => Math.max(max, m.numero || 0), 0) + 1;
  }

  function registrarRetorno(st, movimientoId, data, usuario) {
    const m = st.movimientos.find((x) => x.id === movimientoId);
    if (!m) throw new Error('La salida no existe.');
    if (m.fechaRetorno) throw new Error('Esta salida ya tiene retorno registrado.');
    const fechaRetorno = fechaReq(data.fechaRetorno, 'la fecha y hora de retorno');
    if (parseFecha(fechaRetorno) < parseFecha(m.fechaSalida)) throw new Error('El retorno no puede ser anterior a la salida.');
    const kmRetorno = num(data.kmRetorno, 'el kilometraje de retorno');
    if (kmRetorno < m.kmSalida) throw new Error(`El kilometraje de retorno no puede ser menor que el de salida (${m.kmSalida} km).`);
    const v = vehiculo(st, m.vehiculoId);
    Object.assign(m, {
      fechaRetorno,
      kmRetorno,
      combustibleRetorno: String(data.combustibleRetorno || ''),
      novedades: String(data.novedades || '').trim(),
    });
    if (v) {
      v.km = Math.max(v.km, kmRetorno);
      if (data.nuevoEstado && ESTADOS[data.nuevoEstado]) v.estado = data.nuevoEstado;
    }
    registrar(st, `Retorno N.° ${m.numero}: ${v ? v.placa : ''} (${kmRetorno - m.kmSalida} km)`, usuario);
    return m;
  }

  /* ---------- combustible ---------- */
  function registrarCombustible(st, data, usuario) {
    const v = vehiculo(st, data.vehiculoId);
    if (!v) throw new Error('Elige un vehículo.');
    const r = {
      id: uid(),
      vehiculoId: v.id,
      fecha: fechaReq(data.fecha, 'la fecha'),
      km: num(data.km, 'el kilometraje'),
      galones: num(data.galones, 'la cantidad de galones', { min: 0.01 }),
      monto: num(data.monto, 'el monto', { opcional: true }),
      vale: String(data.vale || '').trim(),
      grifo: String(data.grifo || '').trim(),
      conductorId: data.conductorId || '',
    };
    if (r.vale && st.combustible.some((c) => c.vale && c.vale === r.vale)) throw new Error(`El vale N.° ${r.vale} ya fue registrado.`);
    v.km = Math.max(v.km, r.km);
    st.combustible.unshift(r);
    registrar(st, `Abasteció ${r.galones} gal a ${v.placa}${r.vale ? ` (vale ${r.vale})` : ''}`, usuario);
    return r;
  }

  // Rendimiento (km/galón) de cada carga respecto a la anterior del mismo vehículo.
  function rendimientos(st, vehiculoId) {
    const cargas = st.combustible.filter((c) => c.vehiculoId === vehiculoId).sort((a, b) => a.km - b.km);
    const res = new Map();
    for (let i = 1; i < cargas.length; i++) {
      const km = cargas[i].km - cargas[i - 1].km;
      if (km > 0) res.set(cargas[i].id, km / cargas[i].galones);
    }
    return res;
  }

  /* ---------- mantenimiento ---------- */
  function registrarMantenimiento(st, data, usuario) {
    const v = vehiculo(st, data.vehiculoId);
    if (!v) throw new Error('Elige un vehículo.');
    if (!['preventivo', 'correctivo'].includes(data.tipo)) throw new Error('Elige el tipo de mantenimiento.');
    const r = {
      id: uid(),
      vehiculoId: v.id,
      fecha: fechaReq(data.fecha, 'la fecha'),
      km: num(data.km, 'el kilometraje'),
      tipo: data.tipo,
      descripcion: req(data.descripcion, 'la descripción del trabajo'),
      taller: String(data.taller || '').trim(),
      orden: String(data.orden || '').trim(),
      costo: num(data.costo, 'el costo', { opcional: true }),
    };
    if (data.nuevoEstado && ESTADOS[data.nuevoEstado]) {
      if (data.nuevoEstado !== 'operativo' && salidaAbiertaDe(st, v.id)) {
        throw new Error('El vehículo está en servicio; registra su retorno antes de cambiar su estado.');
      }
      v.estado = data.nuevoEstado;
    }
    v.km = Math.max(v.km, r.km);
    if (r.tipo === 'preventivo') v.ultimoMantKm = Math.max(v.ultimoMantKm || 0, r.km);
    st.mantenimientos.unshift(r);
    registrar(st, `Mantenimiento ${r.tipo} de ${v.placa}: ${r.descripcion}`, usuario);
    return r;
  }

  /* ---------- alertas y resúmenes ---------- */
  function alertas(st, ahora = new Date()) {
    const cfg = st.config;
    const out = [];
    const vence = (fecha, que, sujeto, ref, fem = false) => {
      const d = diasHasta(fecha, ahora);
      if (d == null) return;
      if (d < 0) out.push({ nivel: 'critico', ref, texto: `${que} de ${sujeto} ${fem ? 'vencida' : 'vencido'} hace ${-d} día${d === -1 ? '' : 's'} (${fmtFecha(fecha)})` });
      else if (d <= cfg.diasAviso) out.push({ nivel: 'aviso', ref, texto: `${que} de ${sujeto} vence ${d === 0 ? 'hoy' : `en ${d} día${d === 1 ? '' : 's'}`} (${fmtFecha(fecha)})` });
    };
    for (const v of st.vehiculos) {
      if (v.estado === 'baja') continue;
      const ref = { tipo: 'vehiculo', id: v.id };
      if (!v.soatVence) out.push({ nivel: 'critico', ref, texto: `${v.placa} no tiene SOAT registrado` });
      vence(v.soatVence, 'SOAT', v.placa, ref);
      vence(v.revisionVence, 'Revisión técnica', v.placa, ref, true);
      const recorrido = v.km - (v.ultimoMantKm || 0);
      if (recorrido >= cfg.intervaloMantKm) {
        out.push({ nivel: 'critico', ref, texto: `${v.placa} superó su mantenimiento preventivo (${fmtNum(recorrido)} km desde el último)` });
      } else if (recorrido >= cfg.intervaloMantKm * 0.9) {
        out.push({ nivel: 'aviso', ref, texto: `${v.placa} necesita mantenimiento preventivo en ${fmtNum(cfg.intervaloMantKm - recorrido)} km` });
      }
    }
    for (const c of st.conductores) {
      if (!c.activo) continue;
      vence(c.licenciaVence, 'Licencia', nombreConductor(c), { tipo: 'conductor', id: c.id }, true);
    }
    for (const m of st.movimientos) {
      if (m.fechaRetorno) continue;
      const horas = (ahora - parseFecha(m.fechaSalida)) / 3600000;
      if (horas > cfg.horasSalidaMax) {
        const v = vehiculo(st, m.vehiculoId);
        out.push({ nivel: 'aviso', ref: { tipo: 'movimiento', id: m.id }, texto: `${v ? v.placa : 'Vehículo'} lleva ${Math.floor(horas)} h fuera sin registrar retorno (salida N.° ${m.numero})` });
      }
    }
    const peso = { critico: 0, aviso: 1 };
    return out.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
  }

  function resumen(st) {
    const r = { total: 0, operativo: 0, mantenimiento: 0, inoperativo: 0, baja: 0, enServicio: 0 };
    for (const v of st.vehiculos) {
      r.total++;
      r[v.estado]++;
      if (salidaAbiertaDe(st, v.id)) r.enServicio++;
    }
    r.disponibles = r.operativo - r.enServicio;
    const activos = r.total - r.baja;
    r.operatividad = activos ? r.operativo / activos : 0;
    return r;
  }

  // Resumen por vehículo en un periodo [desde, hasta] (fechas 'YYYY-MM-DD', inclusive).
  function reportePeriodo(st, desde, hasta) {
    const d0 = parseFecha(desde) || new Date(0);
    const d1 = parseFecha(hasta) ? new Date(parseFecha(hasta).getTime() + DIA) : new Date(8.64e15);
    const dentro = (f) => { const d = parseFecha(f); return d && d >= d0 && d < d1; };
    return st.vehiculos.map((v) => {
      const movs = st.movimientos.filter((m) => m.vehiculoId === v.id && m.fechaRetorno && dentro(m.fechaSalida));
      const comb = st.combustible.filter((c) => c.vehiculoId === v.id && dentro(c.fecha));
      const mant = st.mantenimientos.filter((m) => m.vehiculoId === v.id && dentro(m.fecha));
      const km = movs.reduce((s, m) => s + (m.kmRetorno - m.kmSalida), 0);
      const horas = movs.reduce((s, m) => s + (parseFecha(m.fechaRetorno) - parseFecha(m.fechaSalida)) / 3600000, 0);
      const galones = comb.reduce((s, c) => s + c.galones, 0);
      return {
        vehiculo: v,
        salidas: movs.length,
        km,
        horas,
        galones,
        gastoCombustible: comb.reduce((s, c) => s + (c.monto || 0), 0),
        mantenimientos: mant.length,
        gastoMantenimiento: mant.reduce((s, m) => s + (m.costo || 0), 0),
        kmPorGalon: galones ? km / galones : null,
      };
    });
  }

  /* ---------- formato y exportación ---------- */
  function fmtFecha(s) {
    const d = parseFecha(s);
    if (!d) return '—';
    const p = (n) => String(n).padStart(2, '0');
    const f = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
    return /T\d/.test(s) ? `${f} ${p(d.getHours())}:${p(d.getMinutes())}` : f;
  }

  function fmtNum(n, dec = 0) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function csv(filas, columnas) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lineas = [columnas.map((c) => esc(c.titulo)).join(';')];
    for (const f of filas) lineas.push(columnas.map((c) => esc(c.valor(f))).join(';'));
    return '﻿' + lineas.join('\r\n');
  }

  const api = {
    TIPOS, ESTADOS, COMBUSTIBLES, GRADOS, LICENCIAS, LICENCIA_POR_TIPO, CONFIG_DEFECTO,
    uid, parseFecha, diasHasta, normPlaca, fmtFecha, fmtNum, csv,
    estadoVacio, cargar, registrar,
    vehiculo, conductor, salidaAbiertaDe, salidaAbiertaConductor, nombreConductor,
    guardarVehiculo, eliminarVehiculo, guardarConductor, eliminarConductor,
    impedimentosSalida, registrarSalida, registrarRetorno,
    registrarCombustible, rendimientos, registrarMantenimiento,
    alertas, resumen, reportePeriodo,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Flota = api;
})(typeof self !== 'undefined' ? self : this);
