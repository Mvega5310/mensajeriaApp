import test from 'node:test';
import assert from 'node:assert/strict';
import {
  almacenMemoria, backoffMs, clasificarError, ColaLlena, crearCola, LIMITE_ELEMENTOS, separarPorOperador,
} from './colaPura.js';

const err = (status, message = 'x') => Object.assign(new Error(message), status ? { status } : {});

test('clasificarError: red, 4xx, 5xx', () => {
  assert.equal(clasificarError(new TypeError('Failed to fetch')), 'red');
  assert.equal(clasificarError(Object.assign(new Error('t'), { name: 'AbortError' })), 'red');
  assert.equal(clasificarError(err(400)), 'cliente');
  assert.equal(clasificarError(err(404)), 'cliente');
  assert.equal(clasificarError(err(409)), 'cliente');
  assert.equal(clasificarError(err(500)), 'servidor');
  assert.equal(clasificarError(err(503)), 'servidor');
  assert.equal(clasificarError(err(401)), 'servidor');
  assert.equal(clasificarError(err(429)), 'servidor');
});

test('backoffMs: exponencial con tope de 5 min', () => {
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 60_000);
  assert.equal(backoffMs(3), 120_000);
  assert.equal(backoffMs(4), 240_000);
  assert.equal(backoffMs(5), 300_000);
  assert.equal(backoffMs(50), 300_000);
});

test('reenvía en orden con la misma clave y vacía la cola', async () => {
  const vistos = [];
  const cola = crearCola({ operadorActual: () => 'op', almacen: almacenMemoria(), enviar: async (el) => { vistos.push(el.claveIdempotencia); return { ok: 1 }; } });
  for (const c of ['a', 'b', 'c']) await cola.encolar({ claveIdempotencia: c, body: { c } });
  const r = await cola.procesar();
  assert.deepEqual(vistos, ['a', 'b', 'c']);
  assert.equal(r.enviados, 3);
  assert.deepEqual(await cola.listar(), []);
});

test('un fallo de red detiene la cola, conserva el orden y aplica backoff', async () => {
  const t = 1000; let falla = true; const vistos = [];
  const cola = crearCola({ operadorActual: () => 'op',
    almacen: almacenMemoria(), ahora: () => t,
    enviar: async (el) => { vistos.push(el.claveIdempotencia); if (falla) throw new TypeError('red'); return {}; },
  });
  await cola.encolar({ claveIdempotencia: 'a', body: {} });
  await cola.encolar({ claveIdempotencia: 'b', body: {} });
  let r = await cola.procesar();
  assert.equal(r.detenido, 'red');
  assert.deepEqual(vistos, ['a']); // b no se intenta antes que a
  const [a] = await cola.listar();
  assert.equal(a.intentos, 1);
  assert.equal(a.proximoIntento, 1000 + 30_000);
  r = await cola.procesar(); // dentro de la espera no reintenta
  assert.equal(r.detenido, 'espera');
  assert.deepEqual(vistos, ['a']);
  falla = false;
  r = await cola.procesar({ forzar: true }); // evento online ignora la espera
  assert.equal(r.enviados, 2);
  assert.deepEqual(vistos, ['a', 'a', 'b']);
});

test('5xx sigue en cola; 4xx pasa a fallido y no bloquea a los siguientes', async () => {
  const cola = crearCola({ operadorActual: () => 'op',
    almacen: almacenMemoria(),
    enviar: async (el) => { if (el.claveIdempotencia === 'a') throw err(400, 'Datos inválidos'); return {}; },
  });
  await cola.encolar({ claveIdempotencia: 'a', body: {} });
  await cola.encolar({ claveIdempotencia: 'b', body: {} });
  const r = await cola.procesar();
  assert.equal(r.fallidos, 1);
  assert.equal(r.enviados, 1);
  const [a] = await cola.listar();
  assert.equal(a.estado, 'fallido');
  assert.equal(a.ultimoError, 'Datos inválidos');

  const c5 = crearCola({ operadorActual: () => 'op', almacen: almacenMemoria(), enviar: async () => { throw err(503); } });
  await c5.encolar({ claveIdempotencia: 'z', body: {} });
  assert.equal((await c5.procesar()).detenido, 'servidor');
  assert.equal((await c5.listar())[0].estado, 'pendiente');
});

test('reintentar un fallido conserva la clave; descartar lo borra', async () => {
  let ok = false;
  const cola = crearCola({ operadorActual: () => 'op', almacen: almacenMemoria(), enviar: async () => { if (!ok) throw err(422, 'no'); return {}; } });
  await cola.encolar({ claveIdempotencia: 'k', body: {} });
  await cola.procesar();
  await cola.reintentar('k');
  ok = true;
  assert.equal((await cola.procesar()).enviados, 1);
  await cola.encolar({ claveIdempotencia: 'd', body: {} });
  await cola.descartar('d');
  assert.deepEqual(await cola.listar(), []);
});

test('límite de elementos y de tamaño con mensaje claro', async () => {
  const cola = crearCola({ operadorActual: () => 'op', almacen: almacenMemoria(), enviar: async () => ({}) });
  for (let i = 0; i < LIMITE_ELEMENTOS; i++) await cola.encolar({ claveIdempotencia: `k${i}`, body: {} });
  await assert.rejects(cola.encolar({ claveIdempotencia: 'extra', body: {} }), (e) => e instanceof ColaLlena && /sin enviar/.test(e.message));

  const c2 = crearCola({ operadorActual: () => 'op', almacen: almacenMemoria(), enviar: async () => ({}) });
  await assert.rejects(c2.encolar({ claveIdempotencia: 'g', body: { fotos: ['x'.repeat(41 * 1024 * 1024)] } }), ColaLlena);
});

test('cada elemento guarda el operador que lo encoló', async () => {
  let sesion = 'A';
  const cola = crearCola({ almacen: almacenMemoria(), enviar: async () => ({}), operadorActual: () => sesion });
  await cola.encolar({ claveIdempotencia: 'k1', body: {}, operadorNombre: 'Ana' });
  const [el] = await cola.listar();
  assert.equal(el.operadorId, 'A');
  assert.equal(el.operadorNombre, 'Ana');
});

test('solo reenvía los del operador en sesión; los de otro nunca salen con otra sesión', async () => {
  let sesion = 'A'; const vistos = [];
  const cola = crearCola({
    almacen: almacenMemoria(), operadorActual: () => sesion,
    enviar: async (el) => { vistos.push(`${sesion}:${el.claveIdempotencia}`); return {}; },
  });
  await cola.encolar({ claveIdempotencia: 'de-a', body: {} });
  sesion = 'B';
  await cola.encolar({ claveIdempotencia: 'de-b', body: {} });
  const r = await cola.procesar({ forzar: true });
  assert.deepEqual(vistos, ['B:de-b']); // 'de-a' no se envía con la sesión de B
  assert.equal(r.enviados, 1);
  assert.deepEqual((await cola.listar()).map((x) => x.claveIdempotencia), ['de-a']);
  sesion = 'A';
  await cola.procesar({ forzar: true });
  assert.deepEqual(vistos, ['B:de-b', 'A:de-a']); // al volver A, se envía con su sesión
  assert.deepEqual(await cola.listar(), []);
});

test('sin sesión no se envía nada; un elemento sin operador se trata como de otra sesión', async () => {
  let sesion = null; let llamadas = 0;
  const almacen = almacenMemoria();
  await almacen.guardar({ claveIdempotencia: 'viejo', body: {}, creadoEn: 1, seq: 1, intentos: 0, estado: 'pendiente', proximoIntento: 0 });
  const cola = crearCola({ almacen, operadorActual: () => sesion, enviar: async () => { llamadas += 1; return {}; } });
  await cola.encolar({ claveIdempotencia: 'sin-sesion', body: {}, operadorId: 'A' });
  await cola.procesar({ forzar: true });
  assert.equal(llamadas, 0);
  sesion = 'A';
  await cola.procesar({ forzar: true });
  assert.equal(llamadas, 1); // solo 'sin-sesion'; 'viejo' sigue guardado
  assert.deepEqual((await cola.listar()).map((x) => x.claveIdempotencia), ['viejo']);
});

test('los pendientes de otro operador no se cuentan como enviados del operador en sesión', async () => {
  let sesion = 'A';
  const cola = crearCola({ almacen: almacenMemoria(), operadorActual: () => sesion, enviar: async () => ({}) });
  await cola.encolar({ claveIdempotencia: 'a1', body: {} });
  sesion = 'B';
  await cola.encolar({ claveIdempotencia: 'b1', body: {} });
  assert.equal((await cola.procesar({ forzar: true })).enviados, 1);
});

test('separarPorOperador y descartar un ajeno', async () => {
  const items = [{ claveIdempotencia: '1', operadorId: 'A' }, { claveIdempotencia: '2', operadorId: 'B' }, { claveIdempotencia: '3' }];
  const { propios, ajenos } = separarPorOperador(items, 'A');
  assert.deepEqual(propios.map((x) => x.claveIdempotencia), ['1']);
  assert.deepEqual(ajenos.map((x) => x.claveIdempotencia), ['2', '3']);
  assert.deepEqual(separarPorOperador(items, null).propios, []);

  let sesion = 'B';
  const cola = crearCola({ almacen: almacenMemoria(), operadorActual: () => sesion, enviar: async () => ({}) });
  await cola.encolar({ claveIdempotencia: 'x', body: {}, operadorId: 'A' });
  await cola.descartar('x'); // descartar un ajeno es posible desde la hoja
  assert.deepEqual(await cola.listar(), []);
});

test('reintentar solo aplica a los del operador en sesión', async () => {
  let sesion = 'A';
  const cola = crearCola({ almacen: almacenMemoria(), operadorActual: () => sesion, enviar: async () => { throw err(422, 'no'); } });
  await cola.encolar({ claveIdempotencia: 'k', body: {} });
  await cola.procesar({ forzar: true });
  sesion = 'B';
  await cola.reintentar('k');
  assert.equal((await cola.listar())[0].estado, 'fallido');
  sesion = 'A';
  await cola.reintentar('k');
  assert.equal((await cola.listar())[0].estado, 'pendiente');
});
