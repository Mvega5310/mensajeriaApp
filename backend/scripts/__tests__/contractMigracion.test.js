// La carpeta del contract en prisma/migrations/ debe ser BYTE A BYTE la que se
// aplicó en producción el 28-oct-2026 (CRLF, tal como la creó el corte en
// Windows): Prisma guardó su checksum en _prisma_migrations y `migrate deploy`
// compara contra él. Si este hash cambia, producción y el repo divergen.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256_PRODUCCION = '0241507b1c1b8e674ad5848893f81bee03a98b0593490ef4adbc37df8dced0fa';
const aqui = dirname(fileURLToPath(import.meta.url));
const migracion = join(aqui, '..', '..', 'prisma', 'migrations', '20261028165010_contract_conjunto', 'migration.sql');

test('contract_conjunto: migration.sql es idéntico al aplicado en producción (SHA-256)', () => {
  const bytes = readFileSync(migracion);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), SHA256_PRODUCCION);
});

test('contract_conjunto: es el mismo SQL que prisma/manual (salvo finales de línea)', () => {
  const manual = readFileSync(join(aqui, '..', '..', 'prisma', 'manual', 'contract_conjunto_not_null.sql'), 'utf8');
  const enRepo = readFileSync(migracion, 'utf8');
  assert.equal(enRepo.replace(/\r\n/g, '\n'), manual.replace(/\r\n/g, '\n'));
});
