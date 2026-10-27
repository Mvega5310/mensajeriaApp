import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, CODIGOS } from '../errores.js';
import {
  ESTADOS, EVENTOS, transicionar, puede, eventosPosibles,
} from '../paquete.machine.js';

const { SIN_ASIGNAR, PREALERTADO, EN_RECEPCION, PROGRAMADO, ENTREGADO } = ESTADOS;

// Tabla esperada, escrita a mano e independiente de la implementación.
// evento -> [[desde, hacia], ...]  (null = el paquete aún no existe)
const VALIDAS = {
  RECIBIR_SIN_DUENO: [[null, SIN_ASIGNAR]],
  PREALERTAR: [[null, PREALERTADO]],
  RECIBIR: [[null, EN_RECEPCION], [PREALERTADO, EN_RECEPCION]],
  ASIGNAR: [[SIN_ASIGNAR, EN_RECEPCION]],
  PROGRAMAR: [[EN_RECEPCION, PROGRAMADO], [PROGRAMADO, PROGRAMADO]],
  DESPROGRAMAR: [[PROGRAMADO, EN_RECEPCION]],
  ENTREGAR: [[EN_RECEPCION, ENTREGADO], [PROGRAMADO, ENTREGADO]],
};

const esperado = (estado, evento) => {
  const par = VALIDAS[evento].find(([d]) => d === estado);
  return par ? par[1] : undefined;
};

test('los catálogos están congelados y completos', () => {
  assert.ok(Object.isFrozen(ESTADOS));
  assert.ok(Object.isFrozen(EVENTOS));
  assert.deepEqual(Object.keys(ESTADOS).sort(), ['ENTREGADO', 'EN_RECEPCION', 'PREALERTADO', 'PROGRAMADO', 'SIN_ASIGNAR']);
  assert.deepEqual(Object.keys(EVENTOS).sort(), Object.keys(VALIDAS).sort());
});

const estados = [null, ...Object.values(ESTADOS)];
let validas = 0;
let invalidas = 0;

for (const estado of estados) {
  for (const evento of Object.values(EVENTOS)) {
    const destino = esperado(estado, evento);
    if (destino) {
      validas += 1;
      test(`${estado ?? 'null'} + ${evento} -> ${destino}`, () => {
        assert.equal(transicionar(estado, evento), destino);
        assert.equal(puede(estado, evento), true);
        assert.ok(eventosPosibles(estado).includes(evento));
      });
    } else {
      invalidas += 1;
      test(`${estado ?? 'null'} + ${evento} es inválida (409)`, () => {
        assert.equal(puede(estado, evento), false);
        assert.ok(!eventosPosibles(estado).includes(evento));
        assert.throws(() => transicionar(estado, evento), (err) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, CODIGOS.TRANSICION_INVALIDA);
          assert.equal(err.status, 409);
          assert.deepEqual(err.details, { estado, evento });
          assert.ok(err.message.length > 10 && !err.message.includes('!'));
          return true;
        });
      });
    }
  }
}

test('la tabla cubre 6 x 7 = 42 combinaciones (10 válidas)', () => {
  assert.equal(validas + invalidas, 42);
  assert.equal(validas, 10);
});

test('undefined se trata como "no existe" (null)', () => {
  assert.equal(transicionar(undefined, EVENTOS.RECIBIR), EN_RECEPCION);
  assert.equal(puede(undefined, EVENTOS.PREALERTAR), true);
});

test('evento desconocido lanza TRANSICION_INVALIDA', () => {
  for (const ev of ['VOLAR', '', undefined, null, 'toString', '__proto__', 'constructor']) {
    assert.throws(() => transicionar(EN_RECEPCION, ev), (e) => e instanceof AppError && e.code === CODIGOS.TRANSICION_INVALIDA && e.status === 409);
    assert.equal(puede(EN_RECEPCION, ev), false);
  }
});

test('estado desconocido lanza TRANSICION_INVALIDA', () => {
  for (const est of ['PERDIDO', '', 'null', 'toString', '__proto__', 42]) {
    for (const ev of Object.values(EVENTOS)) {
      assert.throws(() => transicionar(est, ev), (e) => e instanceof AppError && e.code === CODIGOS.TRANSICION_INVALIDA);
      assert.equal(puede(est, ev), false);
    }
    assert.deepEqual(eventosPosibles(est), []);
  }
});

test('mensajes específicos: ya entregado y entregar sin recibir', () => {
  assert.throws(() => transicionar(ENTREGADO, EVENTOS.RECIBIR), /ya fue entregado/);
  assert.throws(() => transicionar(PREALERTADO, EVENTOS.ENTREGAR), /no ingresó a portería/);
  assert.throws(() => transicionar(SIN_ASIGNAR, EVENTOS.ENTREGAR), /no ingresó a portería/);
});

test('eventosPosibles', () => {
  assert.deepEqual(eventosPosibles(ENTREGADO), []);
  assert.deepEqual(eventosPosibles(null).sort(), ['PREALERTAR', 'RECIBIR', 'RECIBIR_SIN_DUENO']);
  assert.deepEqual(eventosPosibles(PROGRAMADO).sort(), ['DESPROGRAMAR', 'ENTREGAR', 'PROGRAMAR']);
});
