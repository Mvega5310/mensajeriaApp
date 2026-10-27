// Integración de la migración CONTRACT manual (KAN-8, Fase F — C5).
// Aplica prisma/manual/contract_conjunto_not_null.sql sobre un dataset ya
// backfilleado y verifica el endurecimiento; luego el rollback lo revierte.
// Misma guarda de localhost.
//
// NOTA: esta prueba MUTA el esquema (NOT NULL / FKs) de la base de prueba. Al
// final SIEMPRE corre el rollback para dejar la base como la encontró (columnas
// nullable), de modo que no interfiera con otras integraciones en la misma base.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
const MANUAL = join(aqui, '..', '..', 'prisma', 'manual');
const SQL_CONTRACT = readFileSync(join(MANUAL, 'contract_conjunto_not_null.sql'), 'utf8');
const SQL_ROLLBACK = readFileSync(join(MANUAL, 'rollback_contract_conjunto.sql'), 'utf8');

let prisma, runWithTenant;
const SLUG = 'itestct-ipanema';
const cuid = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;

async function limpiarTodo() {
  await prisma.$executeRaw`DELETE FROM "Comentario"`;
  await prisma.$executeRaw`DELETE FROM "Bono"`;
  await prisma.$executeRaw`DELETE FROM "Package"`;
  await prisma.$executeRaw`DELETE FROM "User"`;
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

// Ejecuta un script SQL (con BEGIN/COMMIT y DO $$) tal como lo corre el runbook:
// con psql. Prisma ($executeRawUnsafe) NO sirve aquí: usa sentencias preparadas
// y Postgres rechaza varios comandos en una ("cannot insert multiple commands").
// ON_ERROR_STOP aborta en el primer error; al cerrarse la sesión, Postgres revierte
// la transacción abierta (igual que el guard del script real).
async function ejecutarScript(sql) {
  const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || `psql salió con código ${r.status}`);
}

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../../src/config/db.js'));
  ({ runWithTenant } = await import('../../src/config/tenantContext.js'));
  await limpiarTodo();
  // Asegura estado base nullable por si una corrida previa dejó el contract puesto.
  try { await ejecutarScript(SQL_ROLLBACK); } catch { /* ya estaba nullable */ }
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
    /23502|not-null|null value/i
  );

  // (b) borrar un conjunto con datos FALLA (RESTRICT).
  await assert.rejects(
    prisma.$executeRaw`DELETE FROM "Conjunto" WHERE "id" = ${conj.id}`,
    /23503|23001|violates foreign key|restrict/i
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
  await assert.rejects(ejecutarScript(SQL_CONTRACT), /conjuntoId NULL|CONTRACT abortado/i);
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
  try { await ejecutarScript(SQL_ROLLBACK); } catch { /* ya nullable */ }
  await limpiarTodo();
  await prisma.$disconnect();
});
