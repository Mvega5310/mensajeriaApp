// Pruebas unitarias de la interpretación de búsqueda de residentes (T2.2). Sin BD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarBusqueda, tokenTorre, etiquetaApartamento, sinTildes } from '../apartamento.js';

test('solo apto', () => {
  assert.deepEqual(interpretarBusqueda('304'), { apto: '304' });
  assert.deepEqual(interpretarBusqueda('30'), { apto: '30' });
  assert.deepEqual(interpretarBusqueda('  304  '), { apto: '304' });
});

test('torre + apto en todos los formatos', () => {
  for (const q of ['T2 304', 't2-304', '2-304', '2 304', 'Torre 2 apto 304', '2/304', 'TORRE 2 304', 'torre 2, apto 304', 'T2/304', 't 2 304']) {
    assert.deepEqual(interpretarBusqueda(q), { torre: '2', apto: '304' }, q);
  }
});

test('torre sola y torre con letra', () => {
  assert.deepEqual(interpretarBusqueda('Torre 2'), { torre: '2' });
  assert.deepEqual(interpretarBusqueda('t3'), { torre: '3' });
  assert.deepEqual(interpretarBusqueda('Torre A apto 12'), { torre: 'A', apto: '12' });
});

test('texto libre de nombre, sin tildes ni mayúsculas', () => {
  assert.deepEqual(interpretarBusqueda('ana'), { texto: 'ana' });
  assert.deepEqual(interpretarBusqueda('Ana Gó'), { texto: 'ana go' });
  assert.deepEqual(interpretarBusqueda('GÓMEZ'), { texto: 'gomez' });
  assert.deepEqual(interpretarBusqueda('t'), { texto: 't' });
});

test('mezcla que no es clave de apartamento cae a texto', () => {
  assert.deepEqual(interpretarBusqueda('ana 304'), { texto: 'ana 304' });
  assert.deepEqual(interpretarBusqueda('1 2 3'), { texto: '1 2 3' });
});

test('vacío', () => {
  assert.deepEqual(interpretarBusqueda(''), {});
  assert.deepEqual(interpretarBusqueda('   '), {});
});

test('tokenTorre unifica el formato guardado', () => {
  for (const t of ['TORRE 2', 'Torre 2', 'T2', 't-2', '2', ' 02 ']) assert.equal(tokenTorre(t), '2', t);
  assert.equal(tokenTorre('TORRE A'), 'A');
  assert.equal(tokenTorre(null), null);
  assert.equal(tokenTorre('  '), null);
});

test('etiquetaApartamento', () => {
  assert.equal(etiquetaApartamento('TORRE 2', '304'), 'T2 · 304');
  assert.equal(etiquetaApartamento('T1', '101'), 'T1 · 101');
  assert.equal(etiquetaApartamento(null, '101'), '101');
  assert.equal(etiquetaApartamento('TORRE 3', null), 'T3');
  assert.equal(etiquetaApartamento(null, null), '');
});

test('sinTildes', () => {
  assert.equal(sinTildes('Gómez Ñandú'), 'gomez nandu');
});
