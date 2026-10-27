// CLI del backfill de un conjunto sobre datos de legado (KAN-8, Fase F).
//
//   npm run backfill-conjunto -- --config ipanema.json            # DRY-RUN (default)
//   npm run backfill-conjunto -- --config ipanema.json --apply     # escribe
//
// Dry-run por defecto: solo escribe con --apply. Contra un host remoto y con
// --apply, exige reescribir el slug como confirmación (igual que alta-conjunto).
// La escritura real la hace scripts/lib/backfillConjunto.js (lógica pura).

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma } from '../src/config/db.js';
import { backfillConjunto, RESULTADO, BackfillError } from './lib/backfillConjunto.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SOLO_CONJUNTO = args.includes('--solo-conjunto');
const idxConfig = args.indexOf('--config');
const CONFIG_PATH = idxConfig !== -1 ? args[idxConfig + 1] : null;

const linea = (s = '') => output.write(`${s}\n`);
const negrita = (s) => `\x1b[1m${s}\x1b[0m`;

function hostDeDatabaseUrl() {
  try { return new URL(process.env.DATABASE_URL || '').hostname || '(desconocido)'; }
  catch { return '(DATABASE_URL no parseable)'; }
}
const esLocal = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1';

async function main() {
  linea();
  linea(negrita(`== ${SOLO_CONJUNTO ? 'Crear conjunto (P1, sin backfill)' : 'Backfill de conjunto (legado)'} — Puertaya ==`));
  if (!CONFIG_PATH) throw new Error('Falta --config <archivo.json>');

  // Cargar y parsear la config.
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`No se pudo leer/parsear ${CONFIG_PATH}: ${e.message}`);
  }
  // bonosHabilitados nunca se acepta (la lib también lo rechaza si viene true).
  delete config.bonosHabilitados;

  // --- Salvaguarda de host ---
  const host = hostDeDatabaseUrl();
  linea(`Base de datos destino (host): ${negrita(host)}`);
  linea(`Modo: ${APPLY ? negrita('APPLY (escribe)') : 'DRY-RUN (no escribe)'}`);
  if (!esLocal(host)) {
    linea(negrita('⚠️  ATENCIÓN: DATABASE_URL NO ES LOCAL — ESTO APUNTA A UNA BASE REMOTA.'));
  }
  linea();

  // --- Confirmación extra: --apply contra host remoto exige reescribir el slug ---
  if (APPLY && !esLocal(host)) {
    const rl = readline.createInterface({ input, output });
    const r = await rl.question(`Confirmación: reescribe el slug exacto "${config.slug}" para continuar: `);
    rl.close();
    if (r.trim() !== config.slug) {
      linea('El slug no coincide. Abortado, no se escribió nada.');
      await cerrar(0);
      return;
    }
  }

  // --- Ejecutar (o ensayar) ---
  const reporte = await backfillConjunto({ config, apply: APPLY, soloConjunto: SOLO_CONJUNTO, log: (m) => linea(`  ${m}`) });

  // --- Reporte final ---
  linea();
  linea(negrita('Conteos ANTES (total / NULL / asignados):'));
  for (const [t, c] of Object.entries(reporte.conteosAntes)) {
    linea(`  ${t.padEnd(12)} ${c.total} / ${c.nulos} / ${c.asignados}`);
  }

  // --- Modo --solo-conjunto (P1): crea el conjunto sin tocar filas ---
  if (reporte.soloConjunto) {
    linea();
    if (reporte.resultado === RESULTADO.DRY_RUN) {
      linea(negrita('*** DRY-RUN (--solo-conjunto): no se escribió nada. Crearía el conjunto, sin tocar filas. ***'));
      linea('Para aplicar: repite el comando con --apply --solo-conjunto.');
    } else if (reporte.resultado === RESULTADO.CONJUNTO_YA_EXISTE) {
      linea(negrita(`El conjunto "${reporte.conjunto.nombre}" ya existía (config igual). No se tocó nada.`));
      imprimirInvitacion(reporte);
    } else {
      linea(negrita(`✅ Conjunto "${reporte.conjunto.nombre}" creado (P1), SIN tocar filas.`));
      linea('   Ninguna fila fue asignada. El backfill de filas es un paso posterior (C1).');
      imprimirInvitacion(reporte);
    }
    await cerrar(0);
    return;
  }

  if (reporte.resultado === RESULTADO.DRY_RUN) {
    linea();
    linea(negrita(`*** DRY-RUN: no se escribió nada. Filas por asignar: ${reporte.filasPorAsignar}. ***`));
    linea('Para aplicar: repite el comando con --apply.');
    await cerrar(0);
    return;
  }

  if (reporte.resultado === RESULTADO.SIN_CAMBIOS) {
    linea();
    linea(negrita('0 filas por asignar: nada que hacer (idempotente).'));
    imprimirInvitacion(reporte);
    imprimirRollback(reporte);
    await cerrar(0);
    return;
  }

  // APLICADO
  linea();
  linea(negrita('Conteos DESPUÉS (total / NULL / asignados):'));
  for (const [t, c] of Object.entries(reporte.conteosDespues)) {
    linea(`  ${t.padEnd(12)} ${c.total} / ${c.nulos} / ${c.asignados}`);
  }
  linea();
  linea(negrita(`✅ Backfill APLICADO al conjunto "${reporte.conjunto.nombre}".`));
  linea(`   Filas asignadas: ${JSON.stringify(reporte.afectadas)}`);
  imprimirInvitacion(reporte);
  imprimirRollback(reporte);
  await cerrar(0);
}

function imprimirInvitacion(reporte) {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  linea();
  linea(`Código de invitación: ${reporte.codigoInvitacion}`);
  linea(`Enlace de registro:   ${base}/registro?c=${reporte.codigoInvitacion}`);
}

function imprimirRollback(reporte) {
  linea();
  linea(negrita('SQL de rollback (deja en NULL lo asignado a este conjunto):'));
  for (const s of reporte.sqlRollback) linea(`  ${s}`);
}

async function cerrar(code) {
  await prisma.$disconnect();
  process.exitCode = code;
}

main().catch(async (err) => {
  const msg = err instanceof BackfillError ? err.message : (err.stack || err.message);
  linea(`\n${negrita('Error:')} ${msg}`);
  await cerrar(1);
});
