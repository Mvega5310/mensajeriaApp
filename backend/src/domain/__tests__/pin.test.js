// Pruebas unitarias del límite de intentos del PIN (T1.4). Sin base de datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarIntento } from '../pin.js';

const ahora = new Date('2026-10-27T12:00:00Z');
const min = (n) => new Date(ahora.getTime() + n * 60000);
const base = { intentos: 0, bloqueadoHasta: null, ahora, correcto: false };

test('primer fallo: cuenta 1, quedan 4, sin bloqueo', () => {
  const r = evaluarIntento(base);
  assert.deepEqual(r, { permitido: true, bloquear: false, nuevosIntentos: 1, bloqueadoHasta: null, minutosRestantes: 0, intentosRestantes: 4 });
});

test('quinto fallo: bloquea 15 minutos', () => {
  const r = evaluarIntento({ ...base, intentos: 4 });
  assert.equal(r.bloquear, true);
  assert.equal(r.nuevosIntentos, 5);
  assert.equal(r.bloqueadoHasta.getTime(), min(15).getTime());
  assert.equal(r.minutosRestantes, 15);
  assert.equal(r.intentosRestantes, 0);
});

test('bloqueado: no se permite ni con PIN correcto, y no cambia el contador', () => {
  const r = evaluarIntento({ intentos: 5, bloqueadoHasta: min(7.2), ahora, correcto: true });
  assert.equal(r.permitido, false);
  assert.equal(r.bloquear, false);
  assert.equal(r.nuevosIntentos, 5);
  assert.equal(r.minutosRestantes, 8, 'redondea hacia arriba');
});

test('bloqueo vencido: acertar resetea; fallar arranca la cuenta en 1', () => {
  const vencido = min(-1);
  const ok = evaluarIntento({ intentos: 5, bloqueadoHasta: vencido, ahora, correcto: true });
  assert.deepEqual([ok.permitido, ok.nuevosIntentos, ok.bloqueadoHasta], [true, 0, null]);
  const mal = evaluarIntento({ intentos: 5, bloqueadoHasta: vencido, ahora, correcto: false });
  assert.deepEqual([mal.permitido, mal.bloquear, mal.nuevosIntentos, mal.bloqueadoHasta], [true, false, 1, null]);
});

test('acierto con fallos previos resetea el contador', () => {
  const r = evaluarIntento({ ...base, intentos: 3, correcto: true });
  assert.equal(r.nuevosIntentos, 0);
  assert.equal(r.permitido, true);
});

test('max y bloqueoMin configurables', () => {
  const r = evaluarIntento({ ...base, intentos: 2, max: 3, bloqueoMin: 1 });
  assert.equal(r.bloquear, true);
  assert.equal(r.minutosRestantes, 1);
});

test('bloqueo con menos de un minuto restante muestra 1', () => {
  const r = evaluarIntento({ intentos: 5, bloqueadoHasta: new Date(ahora.getTime() + 1000), ahora, correcto: false });
  assert.equal(r.minutosRestantes, 1);
});
