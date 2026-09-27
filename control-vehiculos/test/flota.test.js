const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/flota.js');

function base() {
  const st = F.estadoVacio();
  const v = F.guardarVehiculo(st, {
    placa: 'ep-1234', tipo: 'patrullero', marca: 'Toyota', modelo: 'Corolla', anio: 2020,
    unidad: 'Comisaría Miraflores', km: 10000, soatVence: '2027-01-31', revisionVence: '2027-01-31',
  });
  const c = F.guardarConductor(st, {
    cip: '31234567', grado: 'Suboficial de Primera', apellidos: 'Quispe Mamani', nombres: 'Juan',
    unidad: 'Comisaría Miraflores', licenciaNumero: 'Q12345678', licenciaCategoria: 'A-IIa', licenciaVence: '2028-05-01',
  });
  return { st, v, c };
}

const salida = (v, c, extra = {}) => ({
  vehiculoId: v.id, conductorId: c.id, fechaSalida: '2026-09-27T08:00', kmSalida: 10000,
  mision: 'Patrullaje preventivo', destino: 'Sector 3', autorizadoPor: 'Cmdte. Rojas', ...extra,
});

test('normaliza la placa y rechaza duplicados', () => {
  const { st, v } = base();
  assert.equal(v.placa, 'EP-1234');
  assert.throws(() => F.guardarVehiculo(st, { ...v, id: undefined, placa: 'EP 1234' }), /Ya existe/);
});

test('rechaza CIP duplicado y DNI inválido', () => {
  const { st, c } = base();
  assert.throws(() => F.guardarConductor(st, { ...c, id: undefined }), /Ya existe/);
  assert.throws(() => F.guardarConductor(st, { ...c, id: undefined, cip: '999999', dni: '123' }), /DNI/);
});

test('salida y retorno actualizan kilometraje y numeran correlativamente', () => {
  const { st, v, c } = base();
  const m = F.registrarSalida(st, salida(v, c, { kmSalida: 10050 }));
  assert.equal(m.numero, 1);
  assert.equal(v.km, 10050);
  assert.equal(F.resumen(st).enServicio, 1);
  assert.throws(() => F.registrarSalida(st, salida(v, c, { kmSalida: 10050 })), /ya está en servicio/);
  assert.throws(() => F.registrarRetorno(st, m.id, { fechaRetorno: '2026-09-27T14:00', kmRetorno: 10000 }), /menor que el de salida/);
  assert.throws(() => F.registrarRetorno(st, m.id, { fechaRetorno: '2026-09-27T07:00', kmRetorno: 10100 }), /anterior a la salida/);
  F.registrarRetorno(st, m.id, { fechaRetorno: '2026-09-27T14:00', kmRetorno: 10130, nuevoEstado: 'mantenimiento' });
  assert.equal(v.km, 10130);
  assert.equal(v.estado, 'mantenimiento');
  assert.equal(F.resumen(st).enServicio, 0);
  const rep = F.reportePeriodo(st, '2026-09-27', '2026-09-27')[0];
  assert.equal(rep.km, 80);
  assert.equal(rep.horas, 6);
});

test('bloquea salidas con SOAT o licencia vencidos, categoría incorrecta o vehículo no operativo', () => {
  const { st, v, c } = base();
  v.soatVence = '2026-09-01';
  assert.throws(() => F.registrarSalida(st, salida(v, c)), /SOAT/);
  v.soatVence = '2027-01-31';
  c.licenciaVence = '2026-09-26';
  assert.throws(() => F.registrarSalida(st, salida(v, c)), /licencia/);
  c.licenciaVence = '2028-01-01';
  c.licenciaCategoria = 'B-IIb';
  assert.throws(() => F.registrarSalida(st, salida(v, c)), /no habilita/);
  c.licenciaCategoria = 'A-IIa';
  v.estado = 'inoperativo';
  assert.throws(() => F.registrarSalida(st, salida(v, c)), /Inoperativo/);
  v.estado = 'operativo';
  assert.throws(() => F.registrarSalida(st, salida(v, c, { kmSalida: 9000 })), /menor que el último/);
});

test('no se puede eliminar un vehículo con historial', () => {
  const { st, v } = base();
  F.registrarCombustible(st, { vehiculoId: v.id, fecha: '2026-09-20', km: 10000, galones: 10, vale: 'A1' });
  assert.throws(() => F.eliminarVehiculo(st, v.id), /De baja/);
  assert.throws(() => F.registrarCombustible(st, { vehiculoId: v.id, fecha: '2026-09-21', km: 10300, galones: 8, vale: 'A1' }), /ya fue registrado/);
});

test('rendimiento de combustible entre cargas', () => {
  const { st, v } = base();
  F.registrarCombustible(st, { vehiculoId: v.id, fecha: '2026-09-20', km: 10000, galones: 10 });
  const r = F.registrarCombustible(st, { vehiculoId: v.id, fecha: '2026-09-22', km: 10300, galones: 10 });
  assert.equal(F.rendimientos(st, v.id).get(r.id), 30);
});

test('alertas de vencimientos, mantenimiento y salidas prolongadas', () => {
  const { st, v, c } = base();
  const ahora = new Date('2026-09-27T23:00');
  v.soatVence = '2026-10-10';
  v.ultimoMantKm = 5000;
  F.registrarSalida(st, salida(v, c));
  c.licenciaVence = '2026-09-20';
  const textos = F.alertas(st, ahora).map((a) => `${a.nivel}: ${a.texto}`);
  assert.ok(textos.some((t) => t.startsWith('aviso: SOAT de EP-1234 vence en 13 días')), textos.join('\n'));
  assert.ok(textos.some((t) => t.startsWith('critico: EP-1234 superó su mantenimiento')));
  assert.ok(textos.some((t) => t.startsWith('critico: Licencia') && t.includes('vencida hace 7 días')));
  assert.ok(textos.some((t) => t.includes('15 h fuera')));
  // Un mantenimiento preventivo reinicia el contador.
  F.registrarMantenimiento(st, { vehiculoId: v.id, fecha: '2026-09-27', km: 10000, tipo: 'preventivo', descripcion: 'Cambio de aceite' });
  assert.ok(!F.alertas(st, ahora).some((a) => a.texto.includes('mantenimiento')));
});

test('csv escapa separadores y comillas', () => {
  const out = F.csv([{ a: 'x;y', b: 'di "hola"' }], [{ titulo: 'A', valor: (r) => r.a }, { titulo: 'B', valor: (r) => r.b }]);
  assert.equal(out, '﻿A;B\r\n"x;y";"di ""hola"""');
});
