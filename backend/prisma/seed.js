import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/db.js';
import { runWithTenant } from '../src/config/tenantContext.js';
import { buscarUsuarioPorEmailSinTenant } from '../src/controllers/auth.controller.js';
import { generarCodigoInvitacion } from '../src/services/invitacion.service.js';

// Seed multi-conjunto (KAN-8). Crea (idempotente):
//   1) un Conjunto local para desarrollo/pruebas,
//   2) la única cuenta de operador de ese conjunto.
// El registro público (/api/auth/register) nunca puede crear el rol OPERATOR.
//
// Puede correrse varias veces sin duplicar nada: reutiliza el Conjunto por slug
// (sin regenerar su código, para no invalidar registros previos) y no recrea el
// operador si ya existe.

async function obtenerOCrearConjunto() {
  const slug = process.env.SEED_CONJUNTO_SLUG || 'local';

  // Conjunto es un modelo SIN tenant: se consulta/crea sin contexto.
  const existente = await prisma.conjunto.findUnique({ where: { slug } });
  if (existente) {
    console.log(`Conjunto ya existe: "${existente.nombre}" (slug=${slug})`);
    return existente;
  }

  const codigoInvitacion = generarCodigoInvitacion({ prefijo: slug });
  const conjunto = await prisma.conjunto.create({
    data: {
      nombre: process.env.SEED_CONJUNTO_NOMBRE || 'Conjunto Local (desarrollo)',
      slug,
      codigoInvitacion,
      operadorNombre: process.env.OPERATOR_NOMBRE || 'Operador',
      operadorWhatsapp: process.env.SEED_OPERADOR_WHATSAPP || '573000000000',
      operadorDomicilio: process.env.SEED_OPERADOR_DOMICILIO || 'Domicilio de desarrollo',
      puntoRecepcion: process.env.SEED_PUNTO_RECEPCION || 'Recepción',
    },
  });
  console.log(`Conjunto creado: "${conjunto.nombre}" (slug=${slug})`);
  return conjunto;
}

function imprimirEnlaceRegistro(conjunto) {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  const enlace = `${base}/registro?c=${conjunto.codigoInvitacion}`;
  console.log(`Código de invitación: ${conjunto.codigoInvitacion}`);
  console.log(`Enlace de registro:   ${enlace}`);
}

async function crearOperador(conjunto) {
  const email = process.env.OPERATOR_EMAIL;
  const password = process.env.OPERATOR_PASSWORD;

  if (!email || !password) {
    console.log('Define OPERATOR_EMAIL y OPERATOR_PASSWORD en .env para crear la cuenta de operador.');
    return;
  }

  // Lookup sin sesión: email es @unique global; usamos el único punto
  // autorizado a resolver por email sin contexto de tenant.
  const existing = await buscarUsuarioPorEmailSinTenant(email);
  if (existing) {
    console.log('La cuenta de operador ya existe:', email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  // Creación dentro del contexto del conjunto: la extensión fija conjuntoId
  // desde el contexto; NO se pasa conjuntoId en data.
  await runWithTenant({ conjuntoId: conjunto.id, role: 'OPERATOR' }, () =>
    prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'OPERATOR',
        nombre: process.env.OPERATOR_NOMBRE || 'Operador',
        telefono: process.env.OPERATOR_TELEFONO || '',
        termsAcceptedAt: new Date(),
      },
    })
  );

  console.log('Cuenta de operador creada:', email);
}

async function main() {
  const conjunto = await obtenerOCrearConjunto();
  imprimirEnlaceRegistro(conjunto);
  await crearOperador(conjunto);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
