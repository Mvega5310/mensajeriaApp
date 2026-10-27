import test from 'node:test';
import assert from 'node:assert/strict';
import { firmarTokenEntrega, verificarTokenEntrega } from '../tokenEntrega.js';
import { seleccionarLote } from '../entregaLote.js';

const secreto = 's3creto';
const base = { operadorId: 'op1', conjuntoId: 'c1', residenteId: 'r1', paqueteIds: ['b', 'a'] };
const t0 = new Date('2026-01-01T10:00:00Z');

test('token: firma y verifica; ids ordenados; vence a los 10 min', () => {
  const { token, venceEn } = firmarTokenEntrega(base, { secreto, ahora: t0 });
  assert.equal(venceEn.getTime(), t0.getTime() + 600000);
  const v = verificarTokenEntrega(token, { secreto, ahora: new Date(t0.getTime() + 599000) });
  assert.equal(v.ok, true);
  assert.deepEqual(v.paqueteIds, ['a', 'b']);
  assert.equal(v.operadorId, 'op1');
  assert.equal(verificarTokenEntrega(token, { secreto, ahora: new Date(t0.getTime() + 600000) }).motivo, 'VENCIDO');
});

test('token: alterado, otro secreto o malformado se rechazan', () => {
  const { token } = firmarTokenEntrega(base, { secreto, ahora: t0 });
  const [c, f] = token.split('.');
  const p = JSON.parse(Buffer.from(c, 'base64url').toString());
  p.p.push('z');
  const falso = `${Buffer.from(JSON.stringify(p)).toString('base64url')}.${f}`;
  assert.equal(verificarTokenEntrega(falso, { secreto, ahora: t0 }).motivo, 'FIRMA');
  assert.equal(verificarTokenEntrega(token, { secreto: 'otro', ahora: t0 }).motivo, 'FIRMA');
  for (const x of ['', 'abc', 'a.b.c', null, undefined, 42]) {
    assert.equal(verificarTokenEntrega(x, { secreto, ahora: t0 }).ok, false);
  }
});

const R = (id, torre, apto) => ({ id, torre, apto });
const P = (id, pin, residente, estado = 'EN_RECEPCION', min = 0) => ({
  id, pin, estado, residente, recibidoEn: new Date(t0.getTime() + min * 60000), createdAt: t0,
});

test('selección: el PIN trae TODO el apartamento (otro PIN y otro residente del apto), solo entregables', () => {
  const ana = R('ana', 'TORRE 2', '304');
  const luis = R('luis', 'torre 2 ', '304'); // mismo apto, otra cuenta (normaliza igual)
  const otro = R('otro', 'TORRE 2', '305');
  const entregables = [
    P('p1', '1111', ana, 'EN_RECEPCION', 2),
    P('p2', '2222', ana, 'PROGRAMADO', 1),
    P('p3', '3333', luis, 'EN_RECEPCION', 3),
    P('p4', '1111', ana, 'ENTREGADO'),
    P('p5', '1111', ana, 'PREALERTADO'),
    P('p6', '1111', ana, 'SIN_ASIGNAR'),
    P('p7', '1111', otro, 'EN_RECEPCION'), // mismo PIN, otro apto -> ambiguo
  ];
  const a = seleccionarLote({ entregables, pin: '2222' });
  assert.equal(a.tipo, 'OK');
  assert.deepEqual(a.lote.map((p) => p.id), ['p2', 'p1', 'p3']);
  assert.equal(a.residente.id, 'ana');
  const amb = seleccionarLote({ entregables, pin: '1111' });
  assert.equal(amb.tipo, 'AMBIGUO');
  assert.deepEqual(amb.opciones.map((o) => o.etiquetaApto), ['T2 · 304', 'T2 · 305']);
  assert.equal(seleccionarLote({ entregables, pin: '1111', residenteId: 'otro' }).lote.length, 1);
  assert.equal(seleccionarLote({ entregables, pin: '1111', apto: 'T2 304' }).lote.length, 3);
  assert.equal(seleccionarLote({ entregables, pin: '1111', apto: '305' }).residente.id, 'otro');
  assert.equal(seleccionarLote({ entregables, pin: '1111', apto: '999' }).tipo, 'NINGUNO');
  assert.equal(seleccionarLote({ entregables, pin: '9999' }).tipo, 'NINGUNO');
});

test('selección: cuentas sin torre/apto no se agrupan entre sí', () => {
  const a = R('a', null, null);
  const b = R('b', null, null);
  const r = seleccionarLote({ entregables: [P('p1', '1', a), P('p2', '2', b)], pin: '1' });
  assert.deepEqual(r.lote.map((p) => p.id), ['p1']);
});
