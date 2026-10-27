// Verificación estática (KAN-8, Fase D — D7): el frontend no debe tener textos
// fijos de "Ipanema" ni montos de tarifa fijos. Autónomo (no toca BD ni Prisma).
// Runner: node:test. Ejecutar: npm test
//
// Escanea frontend/src en busca de:
// - la palabra "Ipanema" (cualquier caja);
// - los montos de tarifa conocidos (3000, 4500, 7000, 12000) como números
//   "sueltos", que indicarían una tarifa hardcodeada en el cliente.
//
// También (T2.6): prefijo "57" / wa.me/57, franjas horarias fijas, métodos de
// pago fijos, máximo de fotos fijo y rangos de peso en kg.
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

// T2.6: franjas, métodos de pago, prefijo telefónico y máximo de fotos vienen
// de GET /conjunto/config. Aquí se busca cada valor fijo por línea, para que el
// fallo diga dónde está.
function ofensoresPorPatron(patrones) {
  const ofensores = [];
  for (const f of archivos) {
    const lineas = readFileSync(f, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      for (const { re, motivo } of patrones) {
        if (re.test(linea)) ofensores.push(`${relative(FRONTEND_SRC, f)}:${i + 1} [${motivo}]`);
      }
    });
  }
  return ofensores;
}

test('ningún archivo del frontend tiene el prefijo "57" fijo (wa.me/57 ni literal)', () => {
  const ofensores = ofensoresPorPatron([
    { re: /wa\.me\/57/, motivo: 'wa.me/57' },
    { re: /['"`]57['"`]/, motivo: 'literal "57"' },
  ]);
  assert.deepEqual(ofensores, [], `Prefijo 57 fijo en: ${ofensores.join(', ')}`);
});

test('ningún archivo del frontend tiene franjas horarias fijas (a.m./p.m.)', () => {
  const ofensores = ofensoresPorPatron([
    { re: /\d{1,2}:\d{2}\s*[ap]\.\s?m\./i, motivo: 'hora a.m./p.m.' },
    { re: /\d{1,2}:\d{2}\s*m\./, motivo: 'hora m.' },
  ]);
  assert.deepEqual(ofensores, [], `Franjas fijas en: ${ofensores.join(', ')}`);
});

test('ningún archivo del frontend tiene métodos de pago fijos', () => {
  const ofensores = ofensoresPorPatron([
    { re: /Efectivo en puerta|Transferencia digital previa/, motivo: 'etiqueta de método de pago' },
    { re: /['"`](EFECTIVO|TRANSFERENCIA)['"`]/, motivo: 'código de método de pago' },
  ]);
  assert.deepEqual(ofensores, [], `Métodos de pago fijos en: ${ofensores.join(', ')}`);
});

test('ningún archivo del frontend tiene máximo de fotos fijo', () => {
  const ofensores = ofensoresPorPatron([
    { re: /MAX_FOTOS\s*=\s*\d/, motivo: 'MAX_FOTOS = n' },
    // Respaldo distinto de 0 (0 = "todavía no cargó la config", no es un límite).
    { re: /maxFotos\s*(\|\||\?\?)\s*[1-9]\d*/, motivo: 'maxFotos con respaldo numérico' },
  ]);
  assert.deepEqual(ofensores, [], `Máximo de fotos fijo en: ${ofensores.join(', ')}`);
});

test('ningún archivo del frontend tiene rangos de peso fijos (kg)', () => {
  const ofensores = ofensoresPorPatron([
    { re: /\d\s*kg\b/i, motivo: 'peso en kg' },
  ]);
  assert.deepEqual(ofensores, [], `Rangos de peso fijos en: ${ofensores.join(', ')}`);
});
