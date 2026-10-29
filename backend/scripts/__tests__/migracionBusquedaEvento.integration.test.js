// Integración de la migración 20261029120000_add_domicilio_busqueda_evento (revisión S3.2):
// columna Domicilio.nombreBusqueda + su BACKFILL, tabla DomicilioEvento y rollback manual,
// contra Postgres real y en una base DESECHABLE propia (mismo patrón que migracionDomicilio).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sinTildes } from '../../src/domain/apartamento.js';

const dbUrl = process.env.DATABASE_URL;
let dbHost = null;
try { dbHost = dbUrl ? new URL(dbUrl).hostname : null; } catch { dbHost = null; }
const esLocal = !!dbHost && new Set(['localhost', '127.0.0.1', '::1']).has(dbHost);
const razonSkip = !dbUrl
  ? 'DATABASE_URL no definida'
  : !esLocal ? `DATABASE_URL apunta a un host NO local (${dbHost}); esta prueba crea una base` : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[migracionBusquedaEvento.integration] OMITIDA: ${razonSkip}`);
const skip = omitir && razonSkip;

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..', 'prisma');
const NUEVA = '20261029120000_add_domicilio_busqueda_evento';
const SQL_ROLLBACK = readFileSync(join(RAIZ, 'manual', 'rollback_add_domicilio_busqueda_evento.sql'), 'utf8');
const NOMBRE = `itest_s32_${process.pid}`;
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

const NOMBRES = ['Ana Gómez', 'JOSÉ ÑANDÚ', 'Ángela Pérez-Ríos', 'Üma Çelik', 'María Ñ. Núñez', 'Sin tildes', 'ÁÉÍÓÚ áéíóú ñÑ'];

test('setup: base desechable con el esquema previo y domicilios con nombres acentuados', { skip }, () => {
  psql(dbUrl, `CREATE DATABASE "${NOMBRE}"`);
  const u = new URL(dbUrl);
  u.pathname = `/${NOMBRE}`;
  urlScratch = u.toString();
  const previas = readdirSync(join(RAIZ, 'migrations')).filter((n) => /^\d{14}_/.test(n) && n < NUEVA).sort();
  assert.ok(previas.includes('20261029110000_add_domicilio'));
  for (const n of previas) psql(urlScratch, migracion(n));
  psql(urlScratch, `CREATE TABLE "_prisma_migrations" (migration_name text); INSERT INTO "_prisma_migrations" VALUES ('${NUEVA}');`);
  psql(urlScratch, `
    INSERT INTO "Conjunto" ("id","nombre","slug","codigoInvitacion","operadorNombre","operadorWhatsapp","operadorDomicilio","puntoRecepcion","updatedAt")
      VALUES ('cjA','A','s32-a','cod-a','o','1','d','r', NOW());
    INSERT INTO "User" ("id","email","passwordHash","role","nombre","telefono","termsAcceptedAt","conjuntoId") VALUES
      ${NOMBRES.map((_, i) => `('u${i}','u${i}@x.local','x','RESIDENT','n','300',NOW(),'cjA')`).join(',\n      ')};
    INSERT INTO "Domicilio" ("id","conjuntoId","usuarioId","torre","apto","nombreRecibe","telefono") VALUES
      ${NOMBRES.map((n, i) => `('d${i}','cjA','u${i}','1','${100 + i}','${n.replace(/'/g, "''")}','300')`).join(',\n      ')};
  `);
});

test('la migración aplica y el backfill de nombreBusqueda coincide con sinTildes (JS)', { skip }, () => {
  psql(urlScratch, migracion(NUEVA));
  NOMBRES.forEach((n, i) => {
    assert.equal(uno(`SELECT "nombreBusqueda" FROM "Domicilio" WHERE id='d${i}'`), sinTildes(n), n);
  });
  assert.equal(uno(`SELECT count(*) FROM "Domicilio"`), String(NOMBRES.length), 'no se pierde ninguna fila');
  assert.equal(uno(`SELECT count(*) FROM information_schema.tables WHERE table_name='DomicilioEvento'`), '1');
});

test('el backfill es idempotente y no pisa lo que ya está relleno', { skip }, () => {
  psql(urlScratch, `UPDATE "Domicilio" SET "nombreBusqueda"='manual' WHERE id='d0'`);
  const sql = migracion(NUEVA);
  psql(urlScratch, sql.slice(sql.indexOf('UPDATE "Domicilio"')));
  assert.equal(uno(`SELECT "nombreBusqueda" FROM "Domicilio" WHERE id='d0'`), 'manual');
  assert.equal(uno(`SELECT "nombreBusqueda" FROM "Domicilio" WHERE id='d1'`), sinTildes(NOMBRES[1]));
});

test('rollback: quita la columna y la tabla, conserva los domicilios; re-aplicar recalcula', { skip }, () => {
  psql(urlScratch, `INSERT INTO "DomicilioEvento" ("id","conjuntoId","domicilioId","tipo") VALUES ('e1','cjA','d0','DESACTIVAR')`);
  psql(urlScratch, SQL_ROLLBACK);
  assert.equal(uno(`SELECT count(*) FROM information_schema.columns WHERE table_name='Domicilio' AND column_name='nombreBusqueda'`), '0');
  assert.equal(uno(`SELECT count(*) FROM information_schema.tables WHERE table_name='DomicilioEvento'`), '0');
  assert.equal(uno(`SELECT count(*) FROM "_prisma_migrations"`), '0');
  assert.equal(uno('SELECT count(*) FROM "Domicilio"'), String(NOMBRES.length));
  psql(urlScratch, migracion(NUEVA));
  assert.equal(uno(`SELECT "nombreBusqueda" FROM "Domicilio" WHERE id='d0'`), sinTildes(NOMBRES[0]));
});

test('teardown: borra la base desechable', { skip }, () => {
  psql(dbUrl, `DROP DATABASE IF EXISTS "${NOMBRE}" WITH (FORCE)`);
});
