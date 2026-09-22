// Integración de altaDeConjunto() (KAN-8, Fase F). Prueba la LÓGICA PURA sin el
// CLI. Misma guarda de localhost que las demás integraciones: crea/borra datos,
// solo corre si DATABASE_URL apunta a localhost/127.0.0.1/::1.

import test from 'node:test';
import assert from 'node:assert/strict';

function hostDeDatabaseUrl(url) {
  if (!url) return null;
  try { return new URL(url).hostname; } catch { return null; }
}
const dbUrl = process.env.DATABASE_URL;
const dbHost = hostDeDatabaseUrl(dbUrl);
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1']);
const esLocal = !!dbHost && HOSTS_LOCALES.has(dbHost);
const razonSkip = !dbUrl
  ? 'DATABASE_URL no definida'
  : !esLocal
    ? `DATABASE_URL apunta a un host NO local (${dbHost}); esta prueba crea/borra datos y solo corre contra localhost/127.0.0.1`
    : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[altaConjunto.integration] OMITIDA: ${razonSkip}`);

let prisma, runWithTenant, altaDeConjunto, ESTADO;

const SLUG = 'itestf-alta';
const EMAIL = 'op-itestf@local';

function datos(overrides = {}) {
  return {
    nombre: 'Conjunto Alta Test',
    slug: SLUG,
    operadorNombre: 'Operador Alta',
    operadorWhatsapp: '573001112233',
    operadorDomicilio: 'Calle 1 # 2-3',
    puntoRecepcion: 'Portería',
    tarifaMano: 3000,
    tarifaEstandar: 4500,
    tarifaVolumen: 7000,
    tarifaPesado: 12000,
    operadorEmail: EMAIL,
    operadorPassword: 'Password1',
    ...overrides,
  };
}

async function limpiar() {
  const c = await prisma.conjunto.findUnique({ where: { slug: SLUG } });
  if (c) {
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.user.deleteMany({});
    });
    await prisma.conjunto.deleteMany({ where: { slug: SLUG } });
  }
  // Por si el email quedó suelto en otro conjunto (no debería).
}

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../../src/config/db.js'));
  ({ runWithTenant } = await import('../../src/config/tenantContext.js'));
  ({ altaDeConjunto, ESTADO } = await import('../lib/altaConjunto.js'));
  await limpiar();
});

test('altaDeConjunto crea el conjunto y su operador correctamente', { skip: omitir && razonSkip }, async () => {
  const res = await altaDeConjunto(datos());
  assert.equal(res.estado, ESTADO.CREADO);
  assert.equal(res.conjunto.slug, SLUG);
  assert.equal(res.conjunto.bonosHabilitados, false);
  assert.ok(res.codigoInvitacion, 'debe generar codigoInvitacion');

  // El operador quedó con conjuntoId correcto y role OPERATOR.
  assert.ok(res.operador);
  assert.equal(res.operador.role, 'OPERATOR');
  assert.equal(res.operador.conjuntoId, res.conjunto.id);
  assert.equal(res.operador.email, EMAIL);
});

test('segunda llamada con el mismo slug devuelve YA_EXISTE sin crear ni modificar nada', { skip: omitir && razonSkip }, async () => {
  // Estado antes: 1 conjunto, 1 usuario.
  const conjAntes = await prisma.conjunto.findUnique({ where: { slug: SLUG } });
  const usuariosAntes = await runWithTenant({ conjuntoId: conjAntes.id, role: 'OPERATOR' }, () =>
    prisma.user.count({})
  );

  // Segunda alta con el MISMO slug pero datos de operador distintos: no debe
  // crear el operador nuevo ni tocar nada.
  const res = await altaDeConjunto(datos({ operadorEmail: 'otro-op@local', operadorNombre: 'Otro' }));
  assert.equal(res.estado, ESTADO.YA_EXISTE);
  assert.equal(res.conjunto.slug, SLUG);

  // Nada cambió: mismo código de invitación y mismo número de usuarios.
  assert.equal(res.conjunto.codigoInvitacion, conjAntes.codigoInvitacion);
  const usuariosDespues = await runWithTenant({ conjuntoId: conjAntes.id, role: 'OPERATOR' }, () =>
    prisma.user.count({})
  );
  assert.equal(usuariosDespues, usuariosAntes);
  // El operador "otro-op@local" NO se creó.
  const otro = await runWithTenant({ conjuntoId: conjAntes.id, role: 'OPERATOR' }, () =>
    prisma.user.findFirst({ where: { email: 'otro-op@local' } })
  );
  assert.equal(otro, null);
});

test('bonosHabilitados queda en false sin importar qué se pase', { skip: omitir && razonSkip }, async () => {
  // Limpia y crea un conjunto nuevo pasando bonosHabilitados:true en los datos:
  // la función lo ignora (no es un parámetro que use).
  await limpiar();
  const res = await altaDeConjunto(datos({ bonosHabilitados: true }));
  assert.equal(res.estado, ESTADO.CREADO);
  assert.equal(res.conjunto.bonosHabilitados, false);
});

test('teardown', { skip: omitir && razonSkip }, async () => {
  await limpiar();
  await prisma.$disconnect();
});
