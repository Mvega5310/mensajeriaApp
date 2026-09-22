// CLI de alta de un conjunto (KAN-8, Fase F). Pregunta los campos con validación,
// muestra salvaguardas y confirma antes de escribir. La escritura real la hace
// scripts/lib/altaConjunto.js (lógica pura). Uso:
//
//   npm run alta-conjunto            # alta real (con confirmaciones)
//   npm run alta-conjunto -- --dry-run   # ensayo: pregunta y resume, NO escribe
//
// NO usar en un flujo automatizado: es interactivo a propósito (produce
// escrituras en la base a la que apunte DATABASE_URL).

import 'dotenv/config';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma } from '../src/config/db.js';
import { cumplePoliticaPassword, PASSWORD_POLICY_MSG } from '../src/services/password.service.js';
import { altaDeConjunto, esSlugValido, ESTADO } from './lib/altaConjunto.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Tarifas actuales de Ipanema como sugerencia (editables).
const TARIFAS_SUGERIDAS = { MANO: 3000, ESTANDAR: 4500, VOLUMEN: 7000, PESADO: 12000 };

// --- helpers de consola ---
const rl = readline.createInterface({ input, output });
const linea = (s = '') => output.write(`${s}\n`);
const negrita = (s) => `\x1b[1m${s}\x1b[0m`;

async function preguntar(etiqueta, { def, validar, transformar } = {}) {
  // Repite hasta que la respuesta valide. `def` se usa si el usuario deja vacío.
  for (;;) {
    const sufijo = def !== undefined && def !== '' ? ` [${def}]` : '';
    let resp = (await rl.question(`${etiqueta}${sufijo}: `)).trim();
    if (resp === '' && def !== undefined) resp = String(def);
    if (transformar) resp = transformar(resp);
    if (validar) {
      const err = validar(resp);
      if (err) { linea(`  ⚠️  ${err}`); continue; }
    }
    return resp;
  }
}

// slug sugerido a partir del nombre.
function slugSugerido(nombre) {
  return String(nombre)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Contraseña temporal segura que cumple la política (letra + número + longitud).
function generarPasswordTemporal() {
  // 12 chars base64url + garantiza al menos una letra y un dígito.
  const base = crypto.randomBytes(9).toString('base64url'); // 12 chars
  return `Aa1${base}`; // prefijo asegura letra mayús, minús y dígito
}

function hostDeDatabaseUrl() {
  const url = process.env.DATABASE_URL || '';
  try {
    const u = new URL(url);
    return u.hostname || '(desconocido)';
  } catch {
    return '(DATABASE_URL no parseable)';
  }
}

const enteroTarifa = (v) => {
  const n = Number(String(v).replace(/[.\s]/g, '')); // acepta 4.500 o 4500
  return n;
};

async function main() {
  linea();
  linea(negrita('== Alta de conjunto — Puertaya =='));
  if (DRY_RUN) linea(negrita('*** MODO --dry-run: no se escribirá nada ***'));
  linea();

  // --- preguntas ---
  const nombre = await preguntar('Nombre del conjunto', {
    validar: (v) => (v.length >= 2 ? null : 'El nombre es obligatorio'),
  });

  const slug = await preguntar('Slug (minúsculas, números y guiones)', {
    def: slugSugerido(nombre),
    transformar: (v) => v.toLowerCase(),
    validar: (v) => (esSlugValido(v) ? null : 'Formato inválido: solo minúsculas, números y guiones (sin guiones al inicio/fin)'),
  });

  const operadorNombre = await preguntar('Nombre del operador', {
    validar: (v) => (v.length >= 2 ? null : 'Obligatorio'),
  });

  const operadorWhatsapp = await preguntar('WhatsApp del operador (con indicativo, ej. 573001112233)', {
    transformar: (v) => v.replace(/[^\d]/g, ''),
    validar: (v) => (/^\d{11,15}$/.test(v) ? null : 'Debe ser el número con indicativo de país, solo dígitos (11 a 15)'),
  });

  const operadorDomicilio = await preguntar('Domicilio del operador', {
    validar: (v) => (v.length >= 3 ? null : 'Obligatorio'),
  });

  const puntoRecepcion = await preguntar('Punto de recepción', {
    validar: (v) => (v.length >= 2 ? null : 'Obligatorio'),
  });

  const tarifaMano = Number(await preguntar('Tarifa MANO (COP)', { def: TARIFAS_SUGERIDAS.MANO, transformar: enteroTarifa, validar: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? null : 'Entero >= 0') }));
  const tarifaEstandar = Number(await preguntar('Tarifa ESTANDAR (COP)', { def: TARIFAS_SUGERIDAS.ESTANDAR, transformar: enteroTarifa, validar: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? null : 'Entero >= 0') }));
  const tarifaVolumen = Number(await preguntar('Tarifa VOLUMEN (COP)', { def: TARIFAS_SUGERIDAS.VOLUMEN, transformar: enteroTarifa, validar: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? null : 'Entero >= 0') }));
  const tarifaPesado = Number(await preguntar('Tarifa PESADO (COP)', { def: TARIFAS_SUGERIDAS.PESADO, transformar: enteroTarifa, validar: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? null : 'Entero >= 0') }));

  const operadorEmail = await preguntar('Email del operador', {
    transformar: (v) => v.toLowerCase(),
    validar: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Email inválido'),
  });

  const passwordGenerada = generarPasswordTemporal();
  const operadorPassword = await preguntar(
    `Contraseña del operador (Enter = usar una temporal segura)`,
    {
      def: passwordGenerada,
      validar: (v) => (cumplePoliticaPassword(v) ? null : PASSWORD_POLICY_MSG),
    }
  );
  const passwordEsGenerada = operadorPassword === passwordGenerada;

  // bonosHabilitados NO se pregunta: siempre false (misma decisión de "nunca se
  // activa por accidente" que rige en todo el proyecto).

  // --- Salvaguarda 1: host de destino ---
  linea();
  const host = hostDeDatabaseUrl();
  linea(`Base de datos destino (host): ${negrita(host)}`);
  if (host !== 'localhost' && host !== '127.0.0.1') {
    linea(negrita('⚠️  ADVERTENCIA: ESTO VA A ESCRIBIR EN UNA BASE DE DATOS REMOTA (NO LOCAL).'));
  }

  // --- Salvaguarda 2: resumen completo + confirmación ---
  linea();
  linea(negrita('Resumen de lo que se va a crear:'));
  linea(`  Conjunto:         ${nombre}  (slug: ${slug})`);
  linea(`  Operador:         ${operadorNombre}`);
  linea(`  WhatsApp:         ${operadorWhatsapp}`);
  linea(`  Domicilio:        ${operadorDomicilio}`);
  linea(`  Punto recepción:  ${puntoRecepcion}`);
  linea(`  Tarifas (COP):    MANO ${tarifaMano} · ESTANDAR ${tarifaEstandar} · VOLUMEN ${tarifaVolumen} · PESADO ${tarifaPesado}`);
  linea(`  Bonos:            deshabilitados (false) — siempre, por diseño`);
  linea(`  Email operador:   ${operadorEmail}`);
  linea(`  Contraseña:       ${passwordEsGenerada ? `${operadorPassword}  (generada — anótala, no se vuelve a mostrar)` : '(la que ingresaste)'}`);
  linea();

  if (DRY_RUN) {
    linea(negrita('*** --dry-run: ENSAYO. No se llamó a altaDeConjunto(); NO se escribió nada. ***'));
    await cerrar(0);
    return;
  }

  const conf1 = await preguntar('¿Confirmas crear esto? (escribe "si" para continuar)');
  if (conf1.toLowerCase() !== 'si') { linea('Cancelado.'); await cerrar(0); return; }

  // --- Salvaguarda 3: reescribir el slug exacto ---
  const conf2 = await preguntar(`Confirmación final: escribe el slug exacto "${slug}"`);
  if (conf2 !== slug) { linea('El slug no coincide. Cancelado, no se escribió nada.'); await cerrar(0); return; }

  // --- alta real ---
  const res = await altaDeConjunto({
    nombre, slug, operadorNombre, operadorWhatsapp, operadorDomicilio, puntoRecepcion,
    tarifaMano, tarifaEstandar, tarifaVolumen, tarifaPesado,
    operadorEmail, operadorPassword,
  });

  linea();
  if (res.estado === ESTADO.YA_EXISTE) {
    linea(negrita(`El conjunto "${res.conjunto.nombre}" (slug: ${slug}) YA EXISTÍA. No se creó ni modificó nada.`));
    await cerrar(0);
    return;
  }

  linea(negrita(`✅ Conjunto "${res.conjunto.nombre}" creado.`));
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  linea(`Código de invitación: ${res.codigoInvitacion}`);
  linea(`Enlace de registro:   ${base}/registro?c=${res.codigoInvitacion}`);
  if (passwordEsGenerada) {
    linea(negrita(`Contraseña temporal del operador: ${operadorPassword}  (anótala ahora)`));
  }
  await cerrar(0);
}

async function cerrar(code) {
  rl.close();
  await prisma.$disconnect();
  process.exitCode = code;
}

main().catch(async (err) => {
  linea(`\nError: ${err.message}`);
  await cerrar(1);
});
