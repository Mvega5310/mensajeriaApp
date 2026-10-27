// Verificación estática (T2.4): el código del backend no incrusta "Ipanema".
// El nombre del conjunto sale de la configuración (tabla Conjunto). Se excluyen
// las pruebas (__tests__) y test-support; seed y scripts viven fuera de src/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const SRC = join(aqui, '..', '..'); // backend/src

function fuentes(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === '__tests__') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...fuentes(full));
    else if (/\.(js|mjs|cjs)$/.test(e)) out.push(full);
  }
  return out;
}

test('ningún archivo de backend/src (fuera de pruebas) menciona "Ipanema"', () => {
  const ofensores = fuentes(SRC).filter((f) => /ipanema/i.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f));
  assert.deepEqual(ofensores, [], `"Ipanema" aparece en: ${ofensores.join(', ')}`);
});
