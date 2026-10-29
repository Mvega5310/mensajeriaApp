// Ayudas para las pruebas del backfill y del contract (KAN-8).
//
// Desde que la migración 20261028165010_contract_conjunto está en prisma/migrations/,
// TODA base de pruebas nace con conjuntoId NOT NULL y FK RESTRICT. El backfill
// (y la propia prueba del contract) necesitan el esquema "legado" (nullable) para
// sembrar filas sin conjunto. Estas ayudas lo bajan al principio y, MUY
// IMPORTANTE, lo vuelven a subir al terminar para dejar la base como la deja
// `migrate deploy` (el resto de las integraciones asume NOT NULL).
//
// El SQL es el de prisma/manual/ (rollback_contract_conjunto.sql y
// contract_conjunto_not_null.sql), el mismo que usa el runbook. Se ejecuta con
// `prisma db execute` (Prisma no admite varios comandos en una sentencia
// preparada; ver contractConjunto.integration.test.js).

import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(aqui, '..', '..', '..');
export const SQL_CONTRACT = join(BACKEND, 'prisma', 'manual', 'contract_conjunto_not_null.sql');
export const SQL_ROLLBACK = join(BACKEND, 'prisma', 'manual', 'rollback_contract_conjunto.sql');
const PRISMA_CLI = join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(BACKEND, 'prisma', 'schema.prisma');

// Ejecuta un archivo SQL completo. Si el guard aborta, relanza el mensaje del RAISE.
export async function ejecutarScript(rutaSql) {
  try {
    execFileSync(process.execPath, [PRISMA_CLI, 'db', 'execute', '--file', rutaSql, '--schema', SCHEMA], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(`${e.stderr?.toString() || ''}${e.stdout?.toString() || ''}${e.message}`);
  }
}

// Esquema legado: conjuntoId nullable y FK SET NULL. Idempotente.
export const volverNullable = async () => ejecutarScript(SQL_ROLLBACK);

// Esquema actual: NOT NULL + RESTRICT. El guard exige 0 filas con conjuntoId NULL
// en toda la base: limpiar antes de llamarlo.
export const restaurarContract = async () => ejecutarScript(SQL_CONTRACT);
