// Pruebas puras del enlace firmado (T3.1). Sin base de datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { firmar, verificar, vencimientoPorDefecto, VIGENCIA_ENLACE_MS } from '../enlace.js';

const SECRETO = 's'.repeat(40);
const AHORA = 1_700_000_000_000;
const datos = { residenteId: 'res_1', conjuntoId: 'con_1', exp: AHORA + 1000 };

const codigoDe = (fn) => { try { fn(); } catch (e) { return { code: e.code, status: e.status }; } return null; };

test('token válido: devuelve el payload y es URL-safe', () => {
  const t = firmar(datos, SECRETO);
  assert.match(t, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(verificar(t, SECRETO, AHORA), datos);
});

test('vencido: ENLACE_VENCIDO 401 (justo en exp ya vence)', () => {
  const t = firmar(datos, SECRETO);
  assert.deepEqual(codigoDe(() => verificar(t, SECRETO, datos.exp)), { code: 'ENLACE_VENCIDO', status: 401 });
  assert.deepEqual(codigoDe(() => verificar(t, SECRETO, datos.exp + 5000)), { code: 'ENLACE_VENCIDO', status: 401 });
});

test('payload alterado (otro residente, o exp extendido): ENLACE_INVALIDO', () => {
  const t = firmar(datos, SECRETO);
  const [v, , firma] = t.split('.');
  for (const alt of [
    { r: 'res_2', c: 'con_1', e: datos.exp },
    { r: 'res_1', c: 'con_2', e: datos.exp },
    { r: 'res_1', c: 'con_1', e: datos.exp + 10 ** 12 },
  ]) {
    const payload = Buffer.from(JSON.stringify(alt)).toString('base64url');
    assert.deepEqual(codigoDe(() => verificar(`${v}.${payload}.${firma}`, SECRETO, AHORA)), { code: 'ENLACE_INVALIDO', status: 401 });
  }
});

test('firma alterada o truncada: ENLACE_INVALIDO', () => {
  const t = firmar(datos, SECRETO);
  const malo = t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA');
  assert.equal(codigoDe(() => verificar(malo, SECRETO, AHORA)).code, 'ENLACE_INVALIDO');
  assert.equal(codigoDe(() => verificar(t.slice(0, -5), SECRETO, AHORA)).code, 'ENLACE_INVALIDO');
});

test('otro secreto: ENLACE_INVALIDO', () => {
  const t = firmar(datos, SECRETO);
  assert.equal(codigoDe(() => verificar(t, 'o'.repeat(40), AHORA)).code, 'ENLACE_INVALIDO');
});

test('un exp vencido no se "arregla" cambiando solo el texto: sigue firmado con el exp original', () => {
  const vencidoYFirmado = firmar({ ...datos, exp: AHORA - 1 }, SECRETO);
  assert.equal(codigoDe(() => verificar(vencidoYFirmado, SECRETO, AHORA)).code, 'ENLACE_VENCIDO');
});

test('basura: vacío, tipos raros, versión desconocida, partes de más', () => {
  for (const basura of ['', 'abc', 'a.b', 'v1..', 'v1.a.b.c', 'v2.e30.AAAA', '....', null, undefined, 42, {}, 'x'.repeat(5000), 'v1.%%%.***']) {
    assert.equal(codigoDe(() => verificar(basura, SECRETO, AHORA))?.code, 'ENLACE_INVALIDO', String(basura).slice(0, 20));
  }
});

test('firmado válido pero con payload que no es JSON o le faltan campos: ENLACE_INVALIDO', () => {
  const firmarCrudo = (payloadTexto) => {
    const payload = Buffer.from(payloadTexto).toString('base64url');
    const firma = createHmac('sha256', SECRETO).update(`v1.${payload}`).digest('base64url');
    return `v1.${payload}.${firma}`;
  };
  for (const p of ['no es json', '{}', '{"r":"a","c":"b"}', '{"r":1,"c":"b","e":9999999999999}', 'null']) {
    assert.equal(codigoDe(() => verificar(firmarCrudo(p), SECRETO, AHORA)).code, 'ENLACE_INVALIDO', p);
  }
});

test('firmar exige secreto, ids y exp', () => {
  assert.throws(() => firmar(datos, ''));
  assert.throws(() => firmar({ ...datos, residenteId: '' }, SECRETO));
  assert.throws(() => firmar({ ...datos, exp: NaN }, SECRETO));
});

test('vigencia por defecto: 7 días (D1)', () => {
  assert.equal(VIGENCIA_ENLACE_MS, 7 * 24 * 3600 * 1000);
  assert.equal(vencimientoPorDefecto(AHORA), AHORA + VIGENCIA_ENLACE_MS);
});
