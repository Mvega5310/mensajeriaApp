import test from 'node:test';
import assert from 'node:assert/strict';
import { inicioDiaBogota, rangoHoyBogota, parsearFiltroFecha } from '../fechas.js';

test('el día de Bogotá empieza a las 05:00 UTC', () => {
  // 2026-10-27 03:00 UTC = 26 oct 22:00 en Bogotá -> el día es el 26.
  assert.equal(inicioDiaBogota(new Date('2026-10-27T03:00:00Z')).toISOString(), '2026-10-26T05:00:00.000Z');
  // 2026-10-27 05:00 UTC = 00:00 en Bogotá -> ya es el 27.
  assert.equal(inicioDiaBogota(new Date('2026-10-27T05:00:00Z')).toISOString(), '2026-10-27T05:00:00.000Z');
  assert.equal(inicioDiaBogota(new Date('2026-10-27T23:59:00Z')).toISOString(), '2026-10-27T05:00:00.000Z');
});

test('rangoHoyBogota mide 24 h con fin exclusivo', () => {
  const { inicio, fin } = rangoHoyBogota(new Date('2026-10-27T12:00:00Z'));
  assert.equal(inicio.toISOString(), '2026-10-27T05:00:00.000Z');
  assert.equal(fin.toISOString(), '2026-10-28T05:00:00.000Z');
});

test('parsearFiltroFecha: día de Bogotá, hasta incluye todo el día', () => {
  assert.equal(parsearFiltroFecha('2026-10-27', 'desde').toISOString(), '2026-10-27T05:00:00.000Z');
  assert.equal(parsearFiltroFecha('2026-10-27', 'hasta').toISOString(), '2026-10-28T05:00:00.000Z');
  assert.equal(parsearFiltroFecha('2026-10-27T10:00:00Z', 'desde').toISOString(), '2026-10-27T10:00:00.000Z');
});

test('parsearFiltroFecha rechaza lo inválido', () => {
  for (const v of ['hola', '2026-02-31', '', undefined, '2026-13-01']) assert.equal(parsearFiltroFecha(v, 'desde'), null, String(v));
});
