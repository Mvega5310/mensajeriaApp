// Integración de la migración 20261028120000_add_recepcion_sin_prealerta (T2.1) y
// su rollback manual, contra Postgres real y en una base DESECHABLE propia
// (no toca la base compartida de las demás pruebas): se construye el esquema
// previo aplicando las migraciones anteriores con psql, se siembran datos
// "viejos", se aplica la migración nueva y se prueba el rollback (incluido el
// guard que aborta si hay paquetes sin residente).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbUrl = process.env.DATABASE_URL;
let dbHost = null;
try { dbHost = dbUrl ? new URL(dbUrl).hostname : null; } catch { dbHost = null; }
const esLocal = !!dbHost && new Set(['localhost', '127.0.0.1', '::1']).has(dbHost);
const razonSkip = !dbUrl
  ? 'DATABASE_URL no definida'
  : !esLocal
    ? `DATABASE_URL apunta a un host NO local (${dbHost}); esta prueba crea una base`
    : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[migracionRecepcion.integration] OMITIDA: ${razonSkip}`);

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..', 'prisma');
const NUEVA = '20261028120000_add_recepcion_sin_prealerta';
const SQL_ROLLBACK = readFileSync(join(RAIZ, 'manual', 'rollback_add_recepcion_sin_prealerta.sql'), 'utf8');

const NOMBRE = `itest_t21_${process.pid}`;
let urlScratch = null;

function psql(url, sql, { tuplas = false } = {}) {
  const args = [url, '-v', 'ON_ERROR_STOP=1', '-q'];
  if (tuplas) args.push('-t', '-A');
  const r = spawnSync('psql', args, { input: sql, encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || `psql salió con código ${r.status}`);
  return r.stdout.trim();
}
const migracion = (n) => readFileSync(join(RAIZ, 'migrations', n, 'migration.sql'), 'utf8');

test('setup: base desechable con el esquema previo (migraciones anteriores) y datos viejos', { skip: omitir && razonSkip }, () => {
  psql(dbUrl, `CREATE DATABASE "${NOMBRE}"`);
  const u = new URL(dbUrl);
  u.pathname = `/${NOMBRE}`;
  urlScratch = u.toString();

  const previas = readdirSync(join(RAIZ, 'migrations'))
    .filter((n) => /^\d{14}_/.test(n) && n < NUEVA)
    .sort();
  assert.ok(previas.includes('20261027120000_add_paquete_evento'));
  for (const n of previas) psql(urlScratch, migracion(n));
  // El rollback borra su fila de _prisma_migrations; la tabla no existe porque aquí
  // no se usó `prisma migrate`, así que se crea mínima.
  psql(urlScratch, 'CREATE TABLE "_prisma_migrations" (migration_name text); '
    + `INSERT INTO "_prisma_migrations" VALUES ('${NUEVA}');`);

  psql(urlScratch, `
    INSERT INTO "Conjunto" ("id","nombre","slug","codigoInvitacion","operadorNombre","operadorWhatsapp","operadorDomicilio","puntoRecepcion","updatedAt")
      VALUES ('c1','Viejo','viejo','cod-viejo','o','1','d','r', NOW());
    INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","termsAcceptedAt","conjuntoId")
      VALUES ('u1','u1@x.local','x','RESIDENT','Ana','1', NOW(), 'c1');
    INSERT INTO "Package" ("id","residenteId","conjuntoId","proveedor","pin","estado","updatedAt")
      VALUES ('p1','u1','c1','Amazon','111111','PREALERTADO', NOW());
  `);
});

test('la migración aplica limpio sobre datos existentes y deja defaults', { skip: omitir && razonSkip }, () => {
  psql(urlScratch, migracion(NUEVA));
  // Datos previos intactos.
  assert.equal(psql(urlScratch, 'SELECT "residenteId" FROM "Package" WHERE id=\'p1\'', { tuplas: true }), 'u1');
  // Columnas nuevas nulas en filas viejas; defaults en el conjunto.
  assert.equal(
    psql(urlScratch, 'SELECT coalesce("etiquetaNombre",\'~\')||coalesce("transportadora",\'~\')||coalesce("metodoPago",\'~\')||coalesce("recibidoEn"::text,\'~\') FROM "Package" WHERE id=\'p1\'', { tuplas: true }),
    '~~~~',
  );
  assert.equal(
    psql(urlScratch, 'SELECT "prefijoPais"||\'|\'||"maxFotos"||\'|\'||"custodiaMaxDias"||\'|\'||coalesce("franjasEntrega"::text,\'null\') FROM "Conjunto" WHERE id=\'c1\'', { tuplas: true }),
    '57|3|30|null',
  );
  // residenteId admite NULL ahora, e índice por guía creado.
  psql(urlScratch, `INSERT INTO "Package" ("id","conjuntoId","proveedor","pin","estado","updatedAt","etiquetaNombre") VALUES ('p2','c1','X','222222','SIN_ASIGNAR', NOW(),'Sra. Gómez')`);
  assert.equal(psql(urlScratch, `SELECT count(*) FROM pg_indexes WHERE indexname='Package_conjuntoId_guia_idx'`, { tuplas: true }), '1');
  // La FK sigue siendo RESTRICT (no SET NULL).
  assert.equal(
    psql(urlScratch, `SELECT confdeltype FROM pg_constraint WHERE conname='Package_residenteId_fkey'`, { tuplas: true }),
    'r',
  );
});

test('el rollback ABORTA con mensaje claro si hay paquetes sin residente y no cambia nada', { skip: omitir && razonSkip }, () => {
  assert.throws(() => psql(urlScratch, SQL_ROLLBACK), /ROLLBACK abortado: 1 paquete\(s\) tienen residenteId NULL/);
  // Nada cambió: la columna nueva sigue y la fila de migraciones también.
  assert.equal(psql(urlScratch, `SELECT count(*) FROM information_schema.columns WHERE table_name='Package' AND column_name='etiquetaNombre'`, { tuplas: true }), '1');
  assert.equal(psql(urlScratch, `SELECT count(*) FROM "_prisma_migrations" WHERE migration_name='${NUEVA}'`, { tuplas: true }), '1');
});

test('sin filas null el rollback revierte el esquema y conserva los datos', { skip: omitir && razonSkip }, () => {
  psql(urlScratch, `DELETE FROM "Package" WHERE id='p2'`); // paquete sin dueño: aquí se asigna/borra a mano
  psql(urlScratch, SQL_ROLLBACK);
  const cols = psql(urlScratch, `SELECT count(*) FROM information_schema.columns WHERE (table_name='Package' AND column_name IN ('etiquetaNombre','transportadora','metodoPago','recibidoEn')) OR (table_name='Conjunto' AND column_name IN ('prefijoPais','franjasEntrega','maxFotos','custodiaMaxDias'))`, { tuplas: true });
  assert.equal(cols, '0');
  assert.equal(psql(urlScratch, `SELECT is_nullable FROM information_schema.columns WHERE table_name='Package' AND column_name='residenteId'`, { tuplas: true }), 'NO');
  assert.equal(psql(urlScratch, `SELECT count(*) FROM pg_indexes WHERE indexname='Package_conjuntoId_guia_idx'`, { tuplas: true }), '0');
  assert.equal(psql(urlScratch, `SELECT count(*) FROM "Package" WHERE id='p1'`, { tuplas: true }), '1');
  assert.equal(psql(urlScratch, `SELECT count(*) FROM "_prisma_migrations"`, { tuplas: true }), '0');
});

test('teardown: borra la base desechable', { skip: omitir && razonSkip }, () => {
  psql(dbUrl, `DROP DATABASE IF EXISTS "${NOMBRE}" WITH (FORCE)`);
});
