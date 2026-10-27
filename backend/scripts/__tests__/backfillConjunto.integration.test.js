// Integración del backfill (KAN-8, Fase F). Prueba backfillConjunto() contra un
// Postgres real, con un dataset de "legado" (filas con conjuntoId NULL insertadas
// por SQL crudo, simulando producción pre-KAN-8). Misma guarda de localhost.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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
if (omitir) console.warn(`[backfillConjunto.integration] OMITIDA: ${razonSkip}`);

let prisma, runWithTenant, backfillConjunto, RESULTADO;

const SLUG = 'itestbf-ipanema';

function configBase(overrides = {}) {
  return {
    nombre: 'Conjunto Ipanema (test)',
    slug: SLUG,
    operadorNombre: 'Francisco Caro Yances',
    operadorWhatsapp: '573001112233',
    operadorDomicilio: 'Ipanema Torre 1, Ap. 302',
    puntoRecepcion: 'Portería',
    tarifaMano: 3000,
    tarifaEstandar: 4500,
    tarifaVolumen: 7000,
    tarifaPesado: 12000,
    ...overrides,
  };
}

const cuid = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;

// Inserta una fila de legado (conjuntoId NULL) con SQL crudo, imitando datos
// pre-KAN-8. En tests el SQL crudo está permitido (E7 excluye __tests__).
async function insertarUserLegado({ role = 'RESIDENT', torre = 'Torre 1', apto = '101' } = {}) {
  const id = cuid('u');
  const email = `${id}@legado.local`;
  await prisma.$executeRaw`
    INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","torre","apto","termsAcceptedAt","createdAt","conjuntoId")
    VALUES (${id}, ${email}, 'x', ${role}, ${'N ' + id}, '1', ${torre}, ${apto}, NOW(), NOW(), NULL)
  `;
  return id;
}
async function insertarPaqueteLegado(residenteId) {
  const id = cuid('p');
  await prisma.$executeRaw`
    INSERT INTO "Package" ("id","residenteId","proveedor","guia","categoriaPeso","costoServicio","estado","pin","fechaIngreso","createdAt","updatedAt","conjuntoId","esContraEntregaProveedor","valorProductoProveedor","valorDeclarado")
    VALUES (${id}, ${residenteId}, 'Prov', 'Sin Guía', 'ESTANDAR', 4500, 'PREALERTADO', '1234', NOW(), NOW(), NOW(), NULL, false, 0, 0)
  `;
  return id;
}
async function insertarComentarioLegado(residenteId) {
  const id = cuid('c');
  await prisma.$executeRaw`
    INSERT INTO "Comentario" ("id","residenteId","mensaje","createdAt","conjuntoId")
    VALUES (${id}, ${residenteId}, 'hola', NOW(), NULL)
  `;
  return id;
}
async function insertarBonoLegado(residenteId) {
  const id = cuid('b');
  await prisma.$executeRaw`
    INSERT INTO "Bono" ("id","residenteId","categoriaPeso","cantidadTotal","cantidadUsada","precioPagado","createdAt","conjuntoId")
    VALUES (${id}, ${residenteId}, 'ESTANDAR', 5, 0, 18000, NOW(), NULL)
  `;
  return id;
}

async function contarNulosCrudo() {
  const q = async (sql) => (await prisma.$queryRawUnsafe(sql))[0].n;
  return {
    User: await q(`SELECT COUNT(*)::int AS n FROM "User" WHERE "conjuntoId" IS NULL`),
    Package: await q(`SELECT COUNT(*)::int AS n FROM "Package" WHERE "conjuntoId" IS NULL`),
    Bono: await q(`SELECT COUNT(*)::int AS n FROM "Bono" WHERE "conjuntoId" IS NULL`),
    Comentario: await q(`SELECT COUNT(*)::int AS n FROM "Comentario" WHERE "conjuntoId" IS NULL`),
  };
}

// Limpia TODO (el dataset de legado no tiene conjunto; se borra por SQL crudo).
async function limpiarTodo() {
  await prisma.$executeRaw`DELETE FROM "Comentario"`;
  await prisma.$executeRaw`DELETE FROM "Bono"`;
  await prisma.$executeRaw`DELETE FROM "Package"`;
  await prisma.$executeRaw`DELETE FROM "User"`;
  await prisma.$executeRaw`DELETE FROM "Conjunto" WHERE "slug" LIKE 'itestbf-%'`;
}

// Siembra un dataset de legado típico: 1 operador + 2 residentes, con paquetes,
// bono y comentario. Todo conjuntoId NULL.
async function sembrarLegado() {
  const op = await insertarUserLegado({ role: 'OPERATOR', torre: 'Torre 1', apto: '302' });
  const r1 = await insertarUserLegado({ role: 'RESIDENT', torre: 'Torre 2', apto: '201' });
  const r2 = await insertarUserLegado({ role: 'RESIDENT', torre: 'Torre 3', apto: '301' });
  await insertarPaqueteLegado(r1);
  await insertarPaqueteLegado(r2);
  await insertarComentarioLegado(r1);
  await insertarBonoLegado(r2);
  return { op, r1, r2 };
}

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../../src/config/db.js'));
  ({ runWithTenant } = await import('../../src/config/tenantContext.js'));
  ({ backfillConjunto, RESULTADO } = await import('../lib/backfillConjunto.js'));
  await limpiarTodo();
});

test('1+2: backfill feliz; luego la app ve los datos y están aislados', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  const { op } = await sembrarLegado();

  const rep = await backfillConjunto({ config: configBase(), apply: true });
  assert.equal(rep.resultado, RESULTADO.APLICADO);
  assert.equal(rep.conjunto.bonosHabilitados, false);

  // 0 NULLs en las 4 tablas.
  const nulos = await contarNulosCrudo();
  assert.deepEqual(nulos, { User: 0, Package: 0, Bono: 0, Comentario: 0 });

  // La app ve los datos dentro del conjunto, y operadorDelConjuntoActual = Francisco.
  const conjId = rep.conjunto.id;
  await runWithTenant({ conjuntoId: conjId, role: 'OPERATOR' }, async () => {
    const { operadorDelConjuntoActual } = await import('../../src/services/conjunto.service.js');
    const operador = await operadorDelConjuntoActual();
    assert.equal(operador.id, op);
    const users = await prisma.user.findMany({});
    assert.equal(users.length, 3);
    const paquetes = await prisma.package.findMany({});
    assert.equal(paquetes.length, 2);
  });

  // Un segundo conjunto no ve nada.
  const otro = await prisma.conjunto.create({
    data: { nombre: 'Otro', slug: 'itestbf-otro', codigoInvitacion: 'itestbf-otro-X', operadorNombre: 'o', operadorWhatsapp: '1', operadorDomicilio: 'd', puntoRecepcion: 'r' },
  });
  await runWithTenant({ conjuntoId: otro.id, role: 'OPERATOR' }, async () => {
    assert.equal((await prisma.user.findMany({})).length, 0);
    assert.equal((await prisma.package.findMany({})).length, 0);
  });
});

test('3: idempotencia — segunda corrida no cambia nada', { skip: omitir && razonSkip }, async () => {
  const rep2 = await backfillConjunto({ config: configBase(), apply: true });
  assert.equal(rep2.resultado, RESULTADO.SIN_CAMBIOS);
  assert.equal(rep2.filasPorAsignar, 0);
});

test('4: reanudación C3 — 2 filas NULL nuevas se asignan exactamente', { skip: omitir && razonSkip }, async () => {
  // Simula lo que el código viejo escribió entre C1 y el deploy: 2 users NULL.
  await insertarUserLegado({ role: 'RESIDENT' });
  await insertarUserLegado({ role: 'RESIDENT' });
  const rep = await backfillConjunto({ config: configBase(), apply: true });
  assert.equal(rep.resultado, RESULTADO.APLICADO);
  assert.equal(rep.afectadas.User, 2);
  assert.equal(rep.afectadas.Package, 0);
});

test('5a: pre-chequeo — filas de otro conjunto abortan ANTES de abrir la transacción', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  await sembrarLegado(); // incluye 1 operador

  // Insertar un User con conjuntoId de un conjunto "intruso" -> el pre-chequeo de
  // "filas de otro conjunto" aborta ANTES de crear nada.
  const intruso = await prisma.conjunto.create({
    data: { nombre: 'Intruso', slug: 'itestbf-intruso', codigoInvitacion: 'itestbf-intruso-X', operadorNombre: 'o', operadorWhatsapp: '1', operadorDomicilio: 'd', puntoRecepcion: 'r' },
  });
  const rIntruso = await insertarUserLegado({ role: 'RESIDENT' });
  await prisma.$executeRaw`UPDATE "User" SET "conjuntoId" = ${intruso.id} WHERE "id" = ${rIntruso}`;

  await assert.rejects(backfillConjunto({ config: configBase(), apply: true }), /otro conjunto/i);

  // El conjunto Ipanema NO quedó creado.
  const ipa = await prisma.conjunto.findUnique({ where: { slug: SLUG } });
  assert.equal(ipa, null);

  await prisma.$executeRaw`DELETE FROM "User" WHERE "id" = ${rIntruso}`;
  await prisma.conjunto.deleteMany({ where: { slug: 'itestbf-intruso' } });
});

test('5b: rollback transaccional — un fallo DENTRO de la txn no deja nada escrito', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  await sembrarLegado(); // 1 operador + residentes con paquete/bono/comentario, todo NULL

  // Trigger temporal que lanza al actualizar "Comentario": el backfill crea el
  // conjunto y actualiza User/Package/Bono DENTRO de la transacción, y al llegar
  // al UPDATE de Comentario el trigger revienta -> debe hacer ROLLBACK COMPLETO.
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION itestbf_boom() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'boom de prueba'; END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER itestbf_boom_trg BEFORE UPDATE ON "Comentario"
    FOR EACH ROW EXECUTE FUNCTION itestbf_boom();
  `);

  try {
    await assert.rejects(backfillConjunto({ config: configBase(), apply: true }), /boom de prueba/i);

    // Nada quedó escrito: User/Package/Bono siguen TODOS en NULL...
    const nulos = await contarNulosCrudo();
    const q = async (sql) => (await prisma.$queryRawUnsafe(sql))[0].n;
    const totalUser = await q(`SELECT COUNT(*)::int AS n FROM "User"`);
    const totalPackage = await q(`SELECT COUNT(*)::int AS n FROM "Package"`);
    const totalBono = await q(`SELECT COUNT(*)::int AS n FROM "Bono"`);
    assert.equal(nulos.User, totalUser, 'todos los User siguen en NULL (rollback)');
    assert.equal(nulos.Package, totalPackage, 'todos los Package siguen en NULL (rollback)');
    assert.equal(nulos.Bono, totalBono, 'todos los Bono siguen en NULL (rollback)');
    // ...y el Conjunto NO existe (su creación también se revirtió).
    assert.equal(await prisma.conjunto.findUnique({ where: { slug: SLUG } }), null);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS itestbf_boom_trg ON "Comentario"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS itestbf_boom()`);
  }
});

test('6: pre-chequeo de operadores — 0 y 2 abortan sin escribir', { skip: omitir && razonSkip }, async () => {
  // 0 operadores.
  await limpiarTodo();
  await insertarUserLegado({ role: 'RESIDENT' });
  await assert.rejects(backfillConjunto({ config: configBase(), apply: true }), /exactamente 1 operador/i);
  assert.equal(await prisma.conjunto.findUnique({ where: { slug: SLUG } }), null);

  // 2 operadores.
  await insertarUserLegado({ role: 'OPERATOR' });
  await insertarUserLegado({ role: 'OPERATOR' });
  await assert.rejects(backfillConjunto({ config: configBase(), apply: true }), /exactamente 1 operador/i);
  assert.equal(await prisma.conjunto.findUnique({ where: { slug: SLUG } }), null);
});

test('7: conjunto preexistente (P1) — config igual reutiliza; distinta aborta', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  const { } = await sembrarLegado();

  // Crea el conjunto de antemano (P1) con la config base.
  const rep1 = await backfillConjunto({ config: configBase(), apply: true });
  assert.equal(rep1.resultado, RESULTADO.APLICADO);

  // Nueva corrida con config IGUAL -> reutiliza (idempotente, 0 por asignar).
  const repIgual = await backfillConjunto({ config: configBase(), apply: true });
  assert.equal(repIgual.resultado, RESULTADO.SIN_CAMBIOS);

  // Config DISTINTA -> aborta sin tocar.
  await assert.rejects(
    backfillConjunto({ config: configBase({ operadorWhatsapp: '570000000000' }), apply: true }),
    /config DISTINTA/i
  );
});

test('8: filas ya asignadas a otro conjunto -> aborta', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  await sembrarLegado();
  const intruso = await prisma.conjunto.create({
    data: { nombre: 'Intruso2', slug: 'itestbf-intruso2', codigoInvitacion: 'itestbf-intruso2-X', operadorNombre: 'o', operadorWhatsapp: '1', operadorDomicilio: 'd', puntoRecepcion: 'r' },
  });
  const r = await insertarUserLegado({ role: 'RESIDENT' });
  await prisma.$executeRaw`UPDATE "User" SET "conjuntoId" = ${intruso.id} WHERE "id" = ${r}`;
  await assert.rejects(backfillConjunto({ config: configBase(), apply: true }), /otro conjunto/i);
  await prisma.$executeRaw`DELETE FROM "User" WHERE "id" = ${r}`;
  await prisma.conjunto.deleteMany({ where: { slug: 'itestbf-intruso2' } });
});

test('9: dry-run no escribe nada', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  await sembrarLegado();
  const nulosAntes = await contarNulosCrudo();
  const rep = await backfillConjunto({ config: configBase(), apply: false });
  assert.equal(rep.resultado, RESULTADO.DRY_RUN);
  const nulosDespues = await contarNulosCrudo();
  assert.deepEqual(nulosDespues, nulosAntes); // nada cambió
  assert.equal(await prisma.conjunto.findUnique({ where: { slug: SLUG } }), null);
});

test('10: el SQL de rollback impreso, ejecutado, deja todo en NULL otra vez', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  await sembrarLegado();
  const rep = await backfillConjunto({ config: configBase(), apply: true });
  assert.equal(rep.resultado, RESULTADO.APLICADO);
  // Ejecutar el SQL de rollback que el reporte entregó.
  for (const sql of rep.sqlRollback) {
    await prisma.$executeRawUnsafe(sql);
  }
  const nulos = await contarNulosCrudo();
  // Todas las filas vuelven a NULL (quedan "de legado" otra vez).
  assert.ok(nulos.User > 0 && nulos.Package > 0 && nulos.Bono > 0 && nulos.Comentario > 0);
});

test('C1: --solo-conjunto crea el conjunto y DEJA las filas en NULL', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  await sembrarLegado(); // filas con conjuntoId NULL
  const nulosAntes = await contarNulosCrudo();
  assert.ok(nulosAntes.User > 0 && nulosAntes.Package > 0);

  const rep = await backfillConjunto({ config: configBase(), apply: true, soloConjunto: true });
  assert.equal(rep.resultado, RESULTADO.CONJUNTO_CREADO);
  assert.ok(rep.codigoInvitacion);

  // El conjunto existe...
  assert.ok(await prisma.conjunto.findUnique({ where: { slug: SLUG } }));
  // ...pero NINGUNA fila fue tocada (siguen NULL, iguales a antes).
  const nulosDespues = await contarNulosCrudo();
  assert.deepEqual(nulosDespues, nulosAntes);
});

test('C1: --solo-conjunto es idempotente (segunda corrida no hace nada)', { skip: omitir && razonSkip }, async () => {
  const rep = await backfillConjunto({ config: configBase(), apply: true, soloConjunto: true });
  assert.equal(rep.resultado, RESULTADO.CONJUNTO_YA_EXISTE);
});

test('C1: --solo-conjunto con config distinta aborta', { skip: omitir && razonSkip }, async () => {
  await assert.rejects(
    backfillConjunto({ config: configBase({ operadorWhatsapp: '570000000000' }), apply: true, soloConjunto: true }),
    /config DISTINTA/i
  );
});

test('C1: P1 (solo-conjunto) -> C1 (backfill normal) reutiliza y asigna todo', { skip: omitir && razonSkip }, async () => {
  // Estado: conjunto creado por --solo-conjunto, filas aún NULL (de los tests
  // anteriores de este bloque). Un backfill normal reutiliza ese conjunto y
  // asigna todas las filas.
  const nulosAntes = await contarNulosCrudo();
  const totalNulos = nulosAntes.User + nulosAntes.Package + nulosAntes.Bono + nulosAntes.Comentario;
  assert.ok(totalNulos > 0, 'debe haber filas NULL por asignar');

  const rep = await backfillConjunto({ config: configBase(), apply: true });
  assert.equal(rep.resultado, RESULTADO.APLICADO);
  const nulosDespues = await contarNulosCrudo();
  assert.deepEqual(nulosDespues, { User: 0, Package: 0, Bono: 0, Comentario: 0 });
});

test('C3: un INSERT concurrente espera al lock y termina después, sin romper el backfill', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  await sembrarLegado(); // filas NULL + 1 operador

  const orden = [];

  // Backfill (toma LOCK SHARE ROW EXCLUSIVE dentro de su transacción).
  const pBackfill = backfillConjunto({ config: configBase(), apply: true }).then((r) => {
    orden.push('backfill');
    return r;
  });

  // Tras un pequeño delay (para que el backfill ya tenga el lock), un INSERT
  // concurrente de un User NULL (simula al código viejo). Debe QUEDAR ESPERANDO
  // por el lock y resolver DESPUÉS del backfill.
  const uid = cuid('u');
  const pInsert = new Promise((resolve, reject) => {
    setTimeout(() => {
      prisma.$executeRaw`
        INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","termsAcceptedAt","createdAt","conjuntoId")
        VALUES (${uid}, ${uid + '@x.local'}, 'x', 'RESIDENT', 'N', '1', NOW(), NOW(), NULL)
      `.then(() => { orden.push('insert'); resolve(); }, reject);
    }, 250);
  });

  const [rep] = await Promise.all([pBackfill, pInsert]);

  // El backfill terminó correctamente...
  assert.equal(rep.resultado, RESULTADO.APLICADO);
  // ...y el insert concurrente resolvió DESPUÉS del backfill (esperó el lock).
  assert.deepEqual(orden, ['backfill', 'insert']);

  // La fila insertada quedó en NULL (la recogería C3), no rompió el backfill.
  const fila = await prisma.$queryRawUnsafe(`SELECT "conjuntoId" FROM "User" WHERE "id" = '${uid}'`);
  assert.equal(fila[0].conjuntoId, null);
});

test('teardown', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  await prisma.$disconnect();
});
