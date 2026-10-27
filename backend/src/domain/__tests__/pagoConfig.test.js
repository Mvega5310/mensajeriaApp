import test from 'node:test';
import assert from 'node:assert/strict';
import { METODOS_PAGO, esMetodoPagoValido } from '../pago.js';
import { franjasDe, FRANJAS_ENTREGA_DEFAULT } from '../conjuntoConfig.js';

test('metodos de pago validos', () => {
  assert.deepEqual([...METODOS_PAGO], ['EFECTIVO', 'TRANSFERENCIA']);
  assert.equal(esMetodoPagoValido('EFECTIVO'), true);
  assert.equal(esMetodoPagoValido('TRANSFERENCIA'), true);
  for (const x of ['efectivo', '', null, undefined, 'TARJETA']) assert.equal(esMetodoPagoValido(x), false);
});

test('franjasDe: default si null, vacio o malformado; JSON propio si valido', () => {
  for (const f of [null, undefined, [], 'x', [1], ['']]) {
    assert.deepEqual(franjasDe({ franjasEntrega: f }), [...FRANJAS_ENTREGA_DEFAULT]);
  }
  assert.deepEqual(franjasDe({ franjasEntrega: ['8-10'] }), ['8-10']);
});
