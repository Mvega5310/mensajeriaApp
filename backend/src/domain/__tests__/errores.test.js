// Pruebas del formato único de error (T0.2). No requieren base de datos:
// montan un app mínimo de Express con el manejador global real.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { AppError, CODIGOS, asyncHandler, manejadorErrores } from '../errores.js';

async function conServidor(fn) {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.get('/app-error', asyncHandler(async () => {
    await Promise.resolve();
    throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos eso.', 404, { campo: 'id' });
  }));
  app.get('/sin-details', asyncHandler(async () => {
    throw new AppError(CODIGOS.PROHIBIDO, 'No permitido.', 403);
  }));
  app.get('/generico', asyncHandler(async () => {
    throw new Error('secreto interno: password=abc stack');
  }));
  app.get('/con-status', (req, res, next) => next(Object.assign(new Error('x'), { status: 415, type: 'charset.unsupported' })));
  app.get('/prisma', asyncHandler(async () => {
    const e = new Error('fallo de BD'); e.name = 'PrismaClientKnownRequestError'; e.code = 'P2002';
    e.meta = { email: 'persona@privada.com' };
    throw e;
  }));
  app.get('/ok', asyncHandler(async (req, res) => { res.json({ ok: true }); }));
  app.post('/eco', asyncHandler(async (req, res) => { res.json(req.body); }));
  app.use(manejadorErrores);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

test('un handler async que lanza AppError responde { code, message, details } con su status', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/app-error`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { code: 'NO_ENCONTRADO', message: 'No encontramos eso.', details: { campo: 'id' } });
    const r2 = await fetch(`${base}/sin-details`);
    assert.equal(r2.status, 403);
    assert.deepEqual(await r2.json(), { code: 'PROHIBIDO', message: 'No permitido.' });
  });
});

test('un Error genérico responde 500 ERROR_INTERNO sin filtrar detalles y el proceso sigue vivo', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    await conServidor(async (base) => {
      const res = await fetch(`${base}/generico`);
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.code, 'ERROR_INTERNO');
      assert.ok(body.message);
      assert.ok(!JSON.stringify(body).includes('secreto'));
      assert.ok(!('stack' in body));
      // El siguiente request responde bien.
      const ok = await fetch(`${base}/ok`);
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { ok: true });
    });
  } finally { console.error = original; }
});

test('entity.too.large -> 413 CARGA_DEMASIADO_GRANDE', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/eco`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 'a'.repeat(5000) }),
    });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).code, 'CARGA_DEMASIADO_GRANDE');
  });
});

test('errores 4xx de middlewares (err.status) responden ese status con DATOS_INVALIDOS, no 500', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/con-status`);
    assert.equal(res.status, 415);
    assert.equal((await res.json()).code, 'DATOS_INVALIDOS');
    // Charset no soportado real de body-parser.
    const r2 = await fetch(`${base}/eco`, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=iso-8859-1' }, body: '{}',
    });
    assert.equal(r2.status, 415);
    assert.equal((await r2.json()).code, 'DATOS_INVALIDOS');
  });
});

test('el log del 500 no vuelca meta de Prisma (datos personales)', async () => {
  const original = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a);
  try {
    await conServidor(async (base) => {
      assert.equal((await fetch(`${base}/prisma`)).status, 500);
    });
  } finally { console.error = original; }
  const texto = JSON.stringify(logs);
  assert.ok(!texto.includes('persona@privada.com'));
  assert.match(texto, /PrismaClientKnownRequestError/);
  assert.match(texto, /P2002/);
});

test('JSON inválido -> 400 DATOS_INVALIDOS', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/eco`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'DATOS_INVALIDOS');
  });
});
