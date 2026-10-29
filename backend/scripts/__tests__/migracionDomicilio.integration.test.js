// Integración de la migración 20261029110000_add_domicilio (PLAN-conjunto S1.1), su
// MIGRACIÓN DE DATOS y su rollback manual, contra Postgres real y en una base DESECHABLE
// propia: se construye el esquema previo con las migraciones anteriores (psql), se
// siembran datos "viejos" (2 conjuntos, residentes con direcciones sucias, paquetes con y
// sin residente), se aplica la migración y se verifican conteos, enlaces y la paridad de la
// forma canónica SQL/JS; luego rollback y re-aplicar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizarDireccion } from '../../src/services/domicilio.service.js';

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
if (omitir) console.warn(`[migracionDomicilio.integration] OMITIDA: ${razonSkip}`);
const skip = omitir && razonSkip;

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..', 'prisma');
const NUEVA = '20261029110000_add_domicilio';
const SQL_ROLLBACK = readFileSync(join(RAIZ, 'manual', 'rollback_add_domicilio.sql'), 'utf8');

const NOMBRE = `itest_s11_${process.pid}`;
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
const uno = (sql) => psql(urlScratch, sql, { tuplas: true });

// [id, conjunto, nombre, torre, apto]
const RESIDENTES = [
  ['rA1', 'cjA', 'Ana Gómez', 'TORRE 2', '304'],
  ['rA2', 'cjA', 'Luis Pérez', 't2', 'Apto 304'],
  ['rA3', 'cjA', 'Marta Ríos', 'Torre 02', '0301'],
  ['rA4', 'cjA', 'Sin Dirección', null, null],
  ['rA5', 'cjA', 'Nombre Torre', 'Torre Ñandú', '12-A'],
  ['rA6', 'cjA', 'Solo Apto', '', '101'],
  ['rB1', 'cjB', 'Beto Ruiz', 'T3', '301'],
  ['rB2', 'cjB', 'Clara Soto', ' Torre A ', 'apto-502'],
];
const lit = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

test('setup: base desechable con el esquema previo y datos viejos', { skip }, () => {
  psql(dbUrl, `CREATE DATABASE "${NOMBRE}"`);
  const u = new URL(dbUrl);
  u.pathname = `/${NOMBRE}`;
  urlScratch = u.toString();

  const previas = readdirSync(join(RAIZ, 'migrations')).filter((n) => /^\d{14}_/.test(n) && n < NUEVA).sort();
  assert.ok(previas.includes('20261029100800_add_paquete_residente_idx'));
  for (const n of previas) psql(urlScratch, migracion(n));
  psql(urlScratch, 'CREATE TABLE "_prisma_migrations" (migration_name text); '
    + `INSERT INTO "_prisma_migrations" VALUES ('${NUEVA}');`);

  psql(urlScratch, `
    INSERT INTO "Conjunto" ("id","nombre","slug","codigoInvitacion","operadorNombre","operadorWhatsapp","operadorDomicilio","puntoRecepcion","updatedAt") VALUES
      ('cjA','A','dom-a','cod-a','o','1','d','r', NOW()), ('cjB','B','dom-b','cod-b','o','1','d','r', NOW());
    INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","torre","apto","termsAcceptedAt","conjuntoId") VALUES
      ('opA','opa@x.local','x','OPERATOR','Op A','1',NULL,NULL, NOW(),'cjA'),
      ('opB','opb@x.local','x','OPERATOR','Op B','1',NULL,NULL, NOW(),'cjB'),
      ${RESIDENTES.map(([id, c, n, t, a]) => `('${id}','${id}@x.local','x','RESIDENT',${lit(n)},'300${id}',${lit(t)},${lit(a)}, NOW(),'${c}')`).join(',\n      ')};
    INSERT INTO "Package" ("id","residenteId","conjuntoId","proveedor","pin","estado","updatedAt") VALUES
      ('pA1','rA1','cjA','Amazon','1111','PREALERTADO', NOW()),
      ('pA2','rA1','cjA','ML','1112','EN_RECEPCION', NOW()),
      ('pA3','rA2','cjA','ML','1113','ENTREGADO', NOW()),
      ('pA4','rA3','cjA','ML','1114','PROGRAMADO', NOW()),
      ('pA5','rA4','cjA','ML','1115','EN_RECEPCION', NOW()),
      ('pA6',NULL,'cjA','ML','1116','SIN_ASIGNAR', NOW()),
      ('pB1','rB1','cjB','Amazon','2111','EN_RECEPCION', NOW()),
      ('pB2',NULL,'cjB','Amazon','2113','SIN_ASIGNAR', NOW());
  `);
});

function verificarDatosMigrados() {
  assert.equal(uno('SELECT count(*) FROM "Domicilio"'), String(RESIDENTES.length), 'un Domicilio por residente');
  assert.equal(uno('SELECT count(*) FROM "UsuarioConjunto"'), String(RESIDENTES.length));
  assert.equal(uno(`SELECT count(*) FROM "User" u WHERE role='RESIDENT' AND NOT EXISTS (SELECT 1 FROM "Domicilio" d WHERE d."usuarioId"=u.id AND d."conjuntoId"=u."conjuntoId")`), '0');
  assert.equal(uno(`SELECT count(*) FROM "Domicilio" d JOIN "User" u ON u.id=d."usuarioId" WHERE u.role='OPERATOR'`), '0', 'los operadores no reciben Domicilio');
  assert.equal(uno(`SELECT count(*) FROM "Package" WHERE "residenteId" IS NOT NULL AND "domicilioId" IS NULL`), '0');
  assert.equal(uno(`SELECT count(*) FROM "Package" WHERE "residenteId" IS NULL AND "domicilioId" IS NOT NULL`), '0');
  assert.equal(uno(`SELECT count(*) FROM "Package" p JOIN "Domicilio" d ON d.id=p."domicilioId" WHERE d."usuarioId" IS DISTINCT FROM p."residenteId" OR d."conjuntoId" <> p."conjuntoId"`), '0', 'ningún enlace cruzado');
  // Datos viejos intactos.
  assert.equal(uno('SELECT count(*) FROM "Package"'), '8');
  assert.equal(uno('SELECT count(*) FROM "User"'), String(RESIDENTES.length + 2));
  assert.equal(uno(`SELECT torre||'|'||apto FROM "User" WHERE id='rA1'`), 'TORRE 2|304', 'User.torre/apto no se tocan');
}

test('la migración aplica sobre datos existentes: un Domicilio por residente y paquetes enlazados', { skip }, () => {
  psql(urlScratch, migracion(NUEVA));
  verificarDatosMigrados();
  assert.equal(uno(`SELECT "domicilioId" FROM "Package" WHERE id='pA1'`), uno(`SELECT id FROM "Domicilio" WHERE "usuarioId"='rA1'`));
  assert.equal(uno(`SELECT "nombreRecibe"||'|'||telefono FROM "Domicilio" WHERE "usuarioId"='rA1'`), 'Ana Gómez|300rA1');
});

test('la forma canónica de torre/apto en SQL coincide con canonicalizarDireccion (JS)', { skip }, () => {
  for (const [id, , , torre, apto] of RESIDENTES) {
    const esperado = canonicalizarDireccion({ torre, apto });
    assert.equal(uno(`SELECT torre||'|'||apto FROM "Domicilio" WHERE "usuarioId"='${id}'`), `${esperado.torre}|${esperado.apto}`, `${id}: ${torre} / ${apto}`);
  }
  // Direcciones equivalentes deduplican (mismo torre/apto canónicos).
  assert.equal(uno(`SELECT count(DISTINCT torre||'|'||apto) FROM "Domicilio" WHERE "usuarioId" IN ('rA1','rA2')`), '1');
});

test('el SQL de datos es idempotente: correrlo otra vez no duplica nada', { skip }, () => {
  const sql = migracion(NUEVA);
  psql(urlScratch, sql.slice(sql.indexOf('-- 1) Un Domicilio por residente')));
  verificarDatosMigrados();
});

test('rollback: quita tablas y columna, borra la fila de migraciones y conserva los datos; re-aplicar funciona', { skip }, () => {
  psql(urlScratch, SQL_ROLLBACK);
  assert.equal(uno(`SELECT count(*) FROM information_schema.tables WHERE table_name IN ('Domicilio','UsuarioConjunto')`), '0');
  assert.equal(uno(`SELECT count(*) FROM information_schema.columns WHERE table_name='Package' AND column_name='domicilioId'`), '0');
  assert.equal(uno(`SELECT count(*) FROM "_prisma_migrations"`), '0');
  assert.equal(uno('SELECT count(*) FROM "Package"'), '8');
  assert.equal(uno('SELECT count(*) FROM "User"'), String(RESIDENTES.length + 2));
  assert.equal(uno(`SELECT "residenteId" FROM "Package" WHERE id='pA1'`), 'rA1');
  // Re-aplicar deja el mismo resultado.
  psql(urlScratch, migracion(NUEVA));
  verificarDatosMigrados();
});

test('teardown: borra la base desechable', { skip }, () => {
  psql(dbUrl, `DROP DATABASE IF EXISTS "${NOMBRE}" WITH (FORCE)`);
});
