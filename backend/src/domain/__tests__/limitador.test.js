// Pruebas del limitador de intentos en memoria (T1.4), con reloj inyectado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearLimitadorMemoria } from '../limitador.js';

function crear(max = 3, ventanaMs = 1000) {
  const reloj = { t: 0 };
  const l = crearLimitadorMemoria({ max, ventanaMs, ahora: () => reloj.t });
  return { l, reloj };
}

test('permite exactamente `max` intentos y bloquea el siguiente, sin await de por medio', () => {
  const { l } = crear();
  const rs = Array.from({ length: 5 }, () => l.intentar('a'));
  assert.deepEqual(rs.map((r) => r.permitido), [true, true, true, false, false]);
  assert.equal(rs[3].segundosRestantes, 1);
  assert.equal(rs[3].minutosRestantes, 1);
});

test('las claves son independientes', () => {
  const { l } = crear(1);
  assert.equal(l.intentar('a').permitido, true);
  assert.equal(l.intentar('a').permitido, false);
  assert.equal(l.intentar('b').permitido, true);
});

test('al vencer la ventana se libera y la cuenta reinicia', () => {
  const { l, reloj } = crear();
  for (let i = 0; i < 3; i++) l.intentar('a');
  reloj.t = 999;
  assert.equal(l.intentar('a').permitido, false);
  reloj.t = 1000;
  assert.equal(l.intentar('a').permitido, true);
});

test('la ventana es fija: nuevos intentos no la extienden', () => {
  const { l, reloj } = crear();
  l.intentar('a');
  reloj.t = 900;
  l.intentar('a'); l.intentar('a');
  reloj.t = 1000;
  assert.equal(l.intentar('a').permitido, true);
});

test('devolver deshace solo la reserva propia', () => {
  const { l } = crear(2);
  const fallo = l.intentar('a'); // queda contado (no se devuelve)
  const acierto = l.intentar('a');
  l.devolver('a', acierto.reserva); // el acierto libera su cupo
  assert.equal(l.intentar('a').permitido, true); // 2.º de 2
  assert.equal(l.intentar('a').permitido, false);
  assert.ok(fallo.permitido);
});

test('devolver no permite reiniciar el contador: N aciertos no borran fallos', () => {
  const { l } = crear(3);
  l.intentar('a'); l.intentar('a'); // 2 fallos
  for (let i = 0; i < 10; i++) {
    const r = l.intentar('a');
    if (r.permitido) l.devolver('a', r.reserva);
  }
  assert.equal(l.intentar('a').permitido, true); // 3.º
  assert.equal(l.intentar('a').permitido, false);
});

test('devolver con reserva de una ventana vencida no toca la ventana nueva', () => {
  const { l, reloj } = crear(2);
  const vieja = l.intentar('a');
  reloj.t = 1000;
  l.intentar('a'); // ventana nueva, 1 usado
  l.devolver('a', vieja.reserva); // ignorada
  assert.equal(l.intentar('a').permitido, true);
  assert.equal(l.intentar('a').permitido, false);
});

test('limpiar quita el bloqueo', () => {
  const { l } = crear(1);
  l.intentar('a');
  l.limpiar('a');
  assert.equal(l.intentar('a').permitido, true);
});
