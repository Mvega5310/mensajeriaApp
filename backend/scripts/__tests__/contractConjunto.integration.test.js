// Integración de la migración CONTRACT manual (KAN-8, Fase F — C5).
// Aplica prisma/manual/contract_conjunto_not_null.sql sobre un dataset ya
// backfilleado y verifica el endurecimiento; luego el rollback lo revierte.
// Misma guarda de localhost.
//
// NOTA: esta prueba MUTA el esquema (NOT NULL / FKs) de la base de prueba. Al
// final SIEMPRE corre el rollback para dejar la base como la encontró (columnas
// nullable), de modo que no interfiera con otras integraciones en la misma base.
//
// Depende del estado GLOBAL de la base: el guard del contract exige 0 filas con
// conjuntoId NULL en TODA la base, y el ALTER afecta a todas las pruebas. Por
// eso las integraciones corren en serie (`--test-concurrency=1` en `npm test`);
// la limpieza solo borra lo suyo (usuarios `@x.local` y conjuntos `itestct-%`).

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const aqui = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(aqui, '..', '..');
const MANUAL = join(BACKEND, 'prisma', 'manual');
const SQL_CONTRACT = join(MANUAL, 'contract_conjunto_not_null.sql');
const SQL_ROLLBACK = join(MANUAL, 'rollback_contract_conjunto.sql');
const PRISMA_CLI = join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(BACKEND, 'prisma', 'schema.prisma');

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

// Ejecuta un archivo SQL completo (BEGIN/COMMIT y DO $$) con `prisma db execute`.
// No sirve `$executeRawUnsafe`: Prisma usa el protocolo extendido (sentencia
// preparada) y Postgres rechaza varios comandos en una (42601). `db execute`
// manda el script entero y, si el guard aborta, devuelve el mensaje del RAISE
// ("CONTRACT abortado...") en stderr, que se relanza en la excepción. Se invoca
// el CLI con node (sin npx) para que funcione igual en Windows.
async function ejecutarScript(rutaSql) {
  try {
    execFileSync(process.execPath, [PRISMA_CLI, 'db', 'execute', '--file', rutaSql, '--schema', SCHEMA], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(`${e.stderr?.toString() || ''}${e.stdout?.toString() || ''}${e.message}`);
  }
}

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../../src/config/db.js'));
  ({ runWithTenant } = await import('../../src/config/tenantContext.js'));
  await limpiarTodo();
  // Asegura estado base nullable por si una corrida previa dejó el contract
  // puesto. El rollback es idempotente: si ya estaba nullable no falla.
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

test('teardown: dejar la base en estado nullable', { skip: omitir && razonSkip }, async () => {
  await ejecutarScript(SQL_ROLLBACK); // idempotente; si falla, que falle la prueba
  await limpiarTodo();
  await prisma.$disconnect();
});
