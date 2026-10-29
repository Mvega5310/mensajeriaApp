// Integración de la migración CONTRACT manual (KAN-8, Fase F — C5).
// Aplica prisma/manual/contract_conjunto_not_null.sql sobre un dataset ya
// backfilleado y verifica el endurecimiento; luego el rollback lo revierte.
// Misma guarda de localhost.
//
// NOTA: esta prueba MUTA el esquema (NOT NULL / FKs) de la base de prueba. La
// base nace con el contract aplicado (migración 20261028165010 en
// prisma/migrations/); la prueba la baja a nullable para ejercitar el script y su
// rollback, y al final SIEMPRE vuelve a aplicar el contract para dejarla como la
// encontró y no interferir con otras integraciones.
//
// Depende del estado GLOBAL de la base: el guard del contract exige 0 filas con
// conjuntoId NULL en TODA la base, y el ALTER afecta a todas las pruebas. Por
// eso las integraciones corren en serie (`--test-concurrency=1` en `npm test`);
// la limpieza solo borra lo suyo (usuarios `@x.local` y conjuntos `itestct-%`).

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SQL_CONTRACT, SQL_ROLLBACK, ejecutarScript } from './helpers/esquemaContract.js';

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
    ? `DATABASE_URL apunta a un host NO local (${dbHost}); esta prueba muta el esquema y solo corre contra localhost/127.0.0.1`
    : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[contractConjunto.integration] OMITIDA: ${razonSkip}`);

let prisma, runWithTenant;
const SLUG = 'itestct-ipanema';
const cuid = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;

// Solo lo de esta prueba: usuarios `@x.local` (y sus hijos) y conjuntos `itestct-%`.
async function limpiarTodo() {
  await prisma.$executeRaw`DELETE FROM "Comentario" WHERE "residenteId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@x.local')`;
  await prisma.$executeRaw`DELETE FROM "Bono" WHERE "residenteId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@x.local')`;
  await prisma.$executeRaw`DELETE FROM "Package" WHERE "residenteId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@x.local')`;
  await prisma.$executeRaw`DELETE FROM "User" WHERE "email" LIKE '%@x.local'`;
  await prisma.$executeRaw`DELETE FROM "Conjunto" WHERE "slug" LIKE 'itestct-%'`;
}

// Dataset ya backfilleado: un conjunto + 1 user con su conjuntoId puesto.
async function sembrarBackfilleado() {
  const conj = await prisma.conjunto.create({
    data: { nombre: 'Ipa', slug: SLUG, codigoInvitacion: 'itestct-X', operadorNombre: 'o', operadorWhatsapp: '1', operadorDomicilio: 'd', puntoRecepcion: 'r' },
  });
  const uid = cuid('u');
  await prisma.$executeRaw`
    INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","termsAcceptedAt","createdAt","conjuntoId")
    VALUES (${uid}, ${uid + '@x.local'}, 'x', 'OPERATOR', 'Op', '1', NOW(), NOW(), ${conj.id})
  `;
  return { conj, uid };
}

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../../src/config/db.js'));
  ({ runWithTenant } = await import('../../src/config/tenantContext.js'));
  await limpiarTodo();
  // La base nace con el contract aplicado; se baja a nullable para poder
  // reaplicarlo. El rollback es idempotente: si ya estaba nullable no falla.
  await ejecutarScript(SQL_ROLLBACK);
});

test('contract: aplica sobre dataset backfilleado y endurece el esquema', { skip: omitir && razonSkip }, async () => {
  await limpiarTodo();
  const { conj } = await sembrarBackfilleado();

  // Aplicar CONTRACT.
  await ejecutarScript(SQL_CONTRACT);

  // (a) un INSERT sin conjuntoId ahora FALLA (NOT NULL).
  const uid = cuid('u');
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","termsAcceptedAt","createdAt")
      VALUES (${uid}, ${uid + '@x.local'}, 'x', 'RESIDENT', 'N', '1', NOW(), NOW())
    `,
    // Prisma muestra el SQLSTATE y el DETAIL, no siempre el texto del error:
    // 23502 = not_null_violation.
    /23502|not-null|null value/i
  );

  // (b) borrar un conjunto con datos FALLA (RESTRICT).
  await assert.rejects(
    prisma.$executeRaw`DELETE FROM "Conjunto" WHERE "id" = ${conj.id}`,
    /23503|violates foreign key|restrict/i // 23503 = foreign_key_violation
  );
});

test('contract: aborta si quedan NULLs (guard DO $$)', { skip: omitir && razonSkip }, async () => {
  // Primero revertir al estado nullable para poder insertar una fila NULL.
  await ejecutarScript(SQL_ROLLBACK);
  await limpiarTodo();
  const { } = await sembrarBackfilleado();
  // Insertar una fila con conjuntoId NULL (legado sin backfillear).
  const uid = cuid('u');
  await prisma.$executeRaw`
    INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","termsAcceptedAt","createdAt","conjuntoId")
    VALUES (${uid}, ${uid + '@x.local'}, 'x', 'RESIDENT', 'N', '1', NOW(), NOW(), NULL)
  `;
  // El contract debe ABORTAR por el guard (hay NULLs), sin aplicar a medias.
  await assert.rejects(ejecutarScript(SQL_CONTRACT), /CONTRACT abortado/);
  // Y como abortó, un INSERT sin conjuntoId sigue permitido (esquema intacto).
  const uid2 = cuid('u');
  await prisma.$executeRaw`
    INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","termsAcceptedAt","createdAt","conjuntoId")
    VALUES (${uid2}, ${uid2 + '@x.local'}, 'x', 'RESIDENT', 'N', '1', NOW(), NOW(), NULL)
  `;
});

test('rollback: revierte el contract (vuelve a permitir NULL y borrar)', { skip: omitir && razonSkip }, async () => {
  await ejecutarScript(SQL_ROLLBACK);
  await limpiarTodo();
  const { conj } = await sembrarBackfilleado();
  await ejecutarScript(SQL_CONTRACT); // endurecer
  await ejecutarScript(SQL_ROLLBACK); // revertir

  // Ahora un INSERT sin conjuntoId vuelve a permitirse.
  const uid = cuid('u');
  await prisma.$executeRaw`
    INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","termsAcceptedAt","createdAt")
    VALUES (${uid}, ${uid + '@x.local'}, 'x', 'RESIDENT', 'N', '1', NOW(), NOW())
  `;
  // Y borrar el conjunto vuelve a estar permitido (SET NULL): primero quitamos
  // sus usuarios para no chocar con nada, luego el conjunto.
  await prisma.$executeRaw`UPDATE "User" SET "conjuntoId" = NULL WHERE "conjuntoId" = ${conj.id}`;
  await prisma.$executeRaw`DELETE FROM "Conjunto" WHERE "id" = ${conj.id}`;
});

test('teardown: dejar la base como la deja migrate deploy (contract aplicado)', { skip: omitir && razonSkip }, async () => {
  // La migración 20261028165010_contract_conjunto ya está en prisma/migrations/:
  // las demás integraciones esperan NOT NULL + RESTRICT. Se limpia primero (el
  // guard exige 0 NULL en toda la base) y se vuelve a aplicar el contract.
  await ejecutarScript(SQL_ROLLBACK);
  await limpiarTodo();
  await ejecutarScript(SQL_CONTRACT);
  await prisma.$disconnect();
});
