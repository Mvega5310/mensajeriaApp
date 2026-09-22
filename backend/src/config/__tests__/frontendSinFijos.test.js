// Verificación estática (KAN-8, Fase D — D7): el frontend no debe tener textos
// fijos de "Ipanema" ni montos de tarifa fijos. Autónomo (no toca BD ni Prisma).
// Runner: node:test. Ejecutar: npm test
//
// Escanea frontend/src en busca de:
// - la palabra "Ipanema" (cualquier caja);
// - los montos de tarifa conocidos (3000, 4500, 7000, 12000) como números
//   "sueltos", que indicarían una tarifa hardcodeada en el cliente.
//
// La única fuente de tarifas del frontend es /conjunto/config (design.md §4.3).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
// backend/src/config/__tests__ -> raíz del repo -> frontend/src
const FRONTEND_SRC = join(aqui, '..', '..', '..', '..', 'frontend', 'src');

function archivosFuente(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...archivosFuente(full));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const archivos = archivosFuente(FRONTEND_SRC);

test('ningún archivo del frontend menciona "Ipanema"', () => {
  const ofensores = [];
  for (const f of archivos) {
    const texto = readFileSync(f, 'utf8');
    if (/ipanema/i.test(texto)) ofensores.push(relative(FRONTEND_SRC, f));
  }
  assert.deepEqual(ofensores, [], `"Ipanema" aparece en: ${ofensores.join(', ')}`);
});

test('ningún archivo del frontend tiene montos de tarifa fijos (3000/4500/7000/12000)', () => {
  // Números "sueltos": no precedidos ni seguidos por otro dígito (evita 30000,
  // 145000, etc.). Cubre los 4 montos de tarifa actuales.
  const MONTOS = [3000, 4500, 7000, 12000];
  const ofensores = [];
  for (const f of archivos) {
    const texto = readFileSync(f, 'utf8');
    for (const m of MONTOS) {
      const re = new RegExp(`(?<!\\d)${m}(?!\\d)`);
      if (re.test(texto)) {
        ofensores.push(`${relative(FRONTEND_SRC, f)} (${m})`);
      }
    }
  }
  assert.deepEqual(ofensores, [], `Montos de tarifa fijos en: ${ofensores.join(', ')}`);
});
