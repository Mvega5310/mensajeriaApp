// Pruebas del limitador de intentos en memoria (T1.4), con reloj inyectado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearLimitadorMemoria } from '../limitador.js';

function crear(max = 3, ventanaMs = 1000) {
  const reloj = { t: 0 };
  const l = crearLimitadorMemoria({ max, ventanaMs, ahora: () => reloj.t });
  return { l, reloj };
}

test('bloquea al llegar al máximo de fallos, no antes', () => {
  const { l } = crear();
  l.registrarFallo('a'); l.registrarFallo('a');
  assert.equal(l.estaBloqueado('a').bloqueado, false);
  l.registrarFallo('a');
  const b = l.estaBloqueado('a');
  assert.equal(b.bloqueado, true);
  assert.equal(b.segundosRestantes, 1);
});

test('las claves son independientes', () => {
  const { l } = crear(1);
  l.registrarFallo('a');
  assert.equal(l.estaBloqueado('a').bloqueado, true);
  assert.equal(l.estaBloqueado('b').bloqueado, false);
});

test('al vencer la ventana se libera y la cuenta reinicia', () => {
  const { l, reloj } = crear();
  for (let i = 0; i < 3; i++) l.registrarFallo('a');
  reloj.t = 999;
  assert.equal(l.estaBloqueado('a').bloqueado, true);
  reloj.t = 1000;
  assert.equal(l.estaBloqueado('a').bloqueado, false);
  l.registrarFallo('a');
  assert.equal(l.estaBloqueado('a').bloqueado, false, 'cuenta desde 1');
});

test('la ventana es fija: nuevos fallos no la extienden', () => {
  const { l, reloj } = crear();
  l.registrarFallo('a');
  reloj.t = 900;
  l.registrarFallo('a'); l.registrarFallo('a');
  reloj.t = 1000;
  assert.equal(l.estaBloqueado('a').bloqueado, false);
});

test('limpiar quita el bloqueo', () => {
  const { l } = crear(1);
  l.registrarFallo('a');
  l.limpiar('a');
  assert.equal(l.estaBloqueado('a').bloqueado, false);
});
