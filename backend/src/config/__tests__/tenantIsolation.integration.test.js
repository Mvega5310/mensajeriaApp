// Prueba de INTEGRACIÓN del aislamiento de tenant contra Postgres real
// (KAN-8, Fase B — B6 / revisión punto 5).
//
// Por qué existe: las pruebas con fakes no pueden detectar si Prisma acepta el
// `where` resultante (WhereUniqueInput vs WhereInput). Esta prueba ejerce el
// cliente extendido real contra una base Postgres desechable.
//
// CÓMO CORRERLA EN LOCAL (Docker):
//   docker run --rm -d --name kan8-pg -e POSTGRES_PASSWORD=postgres \
//     -e POSTGRES_DB=kan8_test -p 5433:5432 postgres:16
//   export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/kan8_test"
//   npx prisma migrate deploy         # aplica el esquema (incl. migración A4)
//   node --test src/config/__tests__/tenantIsolation.integration.test.js
//   docker rm -f kan8-pg
//
// Si DATABASE_URL no está definida, la suite se OMITE (skip) para no fallar en
// entornos sin base de datos (como el sandbox).

import test from 'node:test';
import assert from 'node:assert/strict';

const hayDB = !!process.env.DATABASE_URL;

// Import dinámico: solo cargamos Prisma si hay DB (evita el coste de importar
// @prisma/client cuando se va a omitir).
let prisma, runWithTenant, resolverConjuntoIdPorUsuario, buscarUsuarioPorEmailSinTenant;

test('setup: importar módulos y limpiar datos de prueba', { skip: !hayDB }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ resolverConjuntoIdPorUsuario } = await import('../tenantBootstrap.js'));
  ({ buscarUsuarioPorEmailSinTenant } = await import('../../controllers/auth.controller.js'));

  // Limpieza best-effort de datos previos de esta prueba (por slug conocido).
  // Se usa deleteMany dentro de contexto por-conjunto donde aplica; los
  // Conjunto se borran directo (modelo sin tenant) al final.
  await limpiar();
});

// --- Helpers ---

const SLUG_A = 'itest-conjunto-a';
const SLUG_B = 'itest-conjunto-b';

async function crearConjunto(slug, codigo) {
  return prisma.conjunto.create({
    data: {
      nombre: `Integración ${slug}`,
      slug,
      codigoInvitacion: codigo,
      operadorNombre: 'Op',
      operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir',
      puntoRecepcion: 'Recepción',
    },
  });
}

async function limpiar() {
  // Conjunto es sin tenant: podemos leerlo/borrarlo directo.
  const conjuntos = await prisma.conjunto.findMany({
    where: { slug: { in: [SLUG_A, SLUG_B] } },
  });
  for (const c of conjuntos) {
    // Dentro del contexto del conjunto, borrar sus filas hijas.
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.package.deleteMany({});
      await prisma.bono.deleteMany({});
      await prisma.comentario.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
}

// Estado compartido entre pruebas.
const ctx = {};

test('crear dos conjuntos, cada uno con su usuario y su paquete', { skip: !hayDB }, async () => {
  const A = await crearConjunto(SLUG_A, 'itest-cod-A');
  const B = await crearConjunto(SLUG_B, 'itest-cod-B');
  ctx.A = A.id;
  ctx.B = B.id;

  // Usuario y paquete de A, dentro del contexto de A.
  await runWithTenant({ conjuntoId: A.id, role: 'OPERATOR' }, async () => {
    const uA = await prisma.user.create({
      data: {
        email: 'a@itest.local',
        passwordHash: 'x',
        role: 'RESIDENT',
        nombre: 'UA',
        telefono: '1',
        termsAcceptedAt: new Date(),
      },
    });
    const pA = await prisma.package.create({
      data: { residenteId: uA.id, proveedor: 'PA', pin: '1111' },
    });
    ctx.uA = uA.id;
    ctx.pA = pA.id;
    // El create debe haber fijado conjuntoId = A automáticamente.
    assert.equal(pA.conjuntoId, A.id);
    assert.equal(uA.conjuntoId, A.id);
  });

  // Usuario y paquete de B, dentro del contexto de B.
  await runWithTenant({ conjuntoId: B.id, role: 'OPERATOR' }, async () => {
    const uB = await prisma.user.create({
      data: {
        email: 'b@itest.local',
        passwordHash: 'x',
        role: 'RESIDENT',
        nombre: 'UB',
        telefono: '1',
        termsAcceptedAt: new Date(),
      },
    });
    const pB = await prisma.package.create({
      data: { residenteId: uB.id, proveedor: 'PB', pin: '2222' },
    });
    ctx.uB = uB.id;
    ctx.pB = pB.id;
  });
});

test('findUnique por id de un paquete de OTRO conjunto -> null', { skip: !hayDB }, async () => {
  // Desde el contexto de A, buscar el paquete de B por su id debe dar null.
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, async () => {
    const encontrado = await prisma.package.findUnique({ where: { id: ctx.pB } });
    assert.equal(encontrado, null);
  });
});

test('findUnique por id del propio conjunto -> encuentra', { skip: !hayDB }, async () => {
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, async () => {
    const encontrado = await prisma.package.findUnique({ where: { id: ctx.pA } });
    assert.ok(encontrado);
    assert.equal(encontrado.id, ctx.pA);
  });
});

test('update por id de un paquete de OTRO conjunto -> no afecta filas', { skip: !hayDB }, async () => {
  // update sobre WhereUniqueInput con conjunto que no coincide: Prisma no
  // encuentra la fila y lanza P2025 (Record to update not found).
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, async () => {
    await assert.rejects(
      prisma.package.update({ where: { id: ctx.pB }, data: { proveedor: 'HACKEADO' } })
    );
  });
  // Verificar desde B que el paquete de B NO cambió.
  await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, async () => {
    const pB = await prisma.package.findUnique({ where: { id: ctx.pB } });
    assert.equal(pB.proveedor, 'PB');
  });
});

test('update por id del propio conjunto -> funciona', { skip: !hayDB }, async () => {
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, async () => {
    const actualizado = await prisma.package.update({
      where: { id: ctx.pA },
      data: { proveedor: 'PA-actualizado' },
    });
    assert.equal(actualizado.proveedor, 'PA-actualizado');
  });
});

test('findMany solo devuelve los paquetes del conjunto activo', { skip: !hayDB }, async () => {
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, async () => {
    const paquetes = await prisma.package.findMany({});
    assert.ok(paquetes.every((p) => p.conjuntoId === ctx.A));
    assert.ok(paquetes.some((p) => p.id === ctx.pA));
    assert.ok(!paquetes.some((p) => p.id === ctx.pB));
  });
});

test('operación sobre User SIN contexto -> lanza (falla cerrado)', { skip: !hayDB }, async () => {
  await assert.rejects(prisma.user.findMany({}), /sin contexto de conjunto/);
  await assert.rejects(
    prisma.user.create({
      data: {
        email: 'z@itest.local',
        passwordHash: 'x',
        role: 'RESIDENT',
        nombre: 'Z',
        telefono: '1',
        termsAcceptedAt: new Date(),
      },
    }),
    /sin contexto de conjunto/
  );
});

test('buscarUsuarioPorEmailSinTenant encuentra usuarios de cualquier conjunto', { skip: !hayDB }, async () => {
  // Sin contexto de tenant (GLOBAL_LOOKUP interno): debe resolver aunque el
  // usuario esté en A o en B.
  const a = await buscarUsuarioPorEmailSinTenant('a@itest.local');
  const b = await buscarUsuarioPorEmailSinTenant('b@itest.local');
  assert.equal(a.id, ctx.uA);
  assert.equal(b.id, ctx.uB);
});

test('resolverConjuntoIdPorUsuario devuelve el conjunto correcto', { skip: !hayDB }, async () => {
  assert.equal(await resolverConjuntoIdPorUsuario(ctx.uA), ctx.A);
  assert.equal(await resolverConjuntoIdPorUsuario(ctx.uB), ctx.B);
  assert.equal(await resolverConjuntoIdPorUsuario('inexistente'), null);
});

test('flujo forgotPassword: crea token para el usuario correcto', { skip: !hayDB }, async () => {
  // Simula lo esencial de forgotPassword: lookup por email + crear token
  // (PasswordResetToken es sin tenant, no requiere contexto).
  const user = await buscarUsuarioPorEmailSinTenant('a@itest.local');
  assert.ok(user);
  const rec = await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: 'itest-hash', expiresAt: new Date(Date.now() + 3600_000) },
  });
  assert.equal(rec.userId, ctx.uA);
});

test('flujo resetPassword: update de User dentro del contexto resuelto', { skip: !hayDB }, async () => {
  // Simula lo esencial de resetPassword: resolver conjunto por userId del token
  // y actualizar User dentro de runWithTenant.
  const record = await prisma.passwordResetToken.findFirst({ where: { tokenHash: 'itest-hash' } });
  assert.ok(record);
  const conjuntoId = await resolverConjuntoIdPorUsuario(record.userId);
  assert.equal(conjuntoId, ctx.A);

  await runWithTenant({ conjuntoId, role: 'RESIDENT' }, async () => {
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: 'nuevo' } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
    ]);
  });

  // Verificar el cambio dentro del contexto de A.
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, async () => {
    const u = await prisma.user.findUnique({ where: { id: ctx.uA } });
    assert.equal(u.passwordHash, 'nuevo');
  });
});

test('teardown: limpiar datos de prueba', { skip: !hayDB }, async () => {
  await limpiar();
  await prisma.$disconnect();
});
