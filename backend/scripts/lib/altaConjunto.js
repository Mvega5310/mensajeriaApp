// Lógica PURA de alta de un conjunto (KAN-8, Fase F). Sin readline ni console.log
// de interacción: recibe datos ya validados y hace el alta. Reutiliza los mismos
// bloques que prisma/seed.js (generarCodigoInvitacion, runWithTenant,
// buscarUsuarioPorEmailSinTenant) pero con una regla más estricta para
// producción.
//
// Reutilizable para dar de alta Ipanema y cualquier conjunto futuro.

import bcrypt from 'bcryptjs';
import { prisma } from '../../src/config/db.js';
import { runWithTenant } from '../../src/config/tenantContext.js';
import { buscarUsuarioPorEmailSinTenant } from '../../src/controllers/auth.controller.js';
import { generarCodigoInvitacion } from '../../src/services/invitacion.service.js';
import { cumplePoliticaPassword, PASSWORD_POLICY_MSG } from '../../src/services/password.service.js';

// Estados posibles del alta.
export const ESTADO = Object.freeze({
  CREADO: 'CREADO',
  YA_EXISTE: 'YA_EXISTE',
});

// Valida el formato de slug: minúsculas, números y guiones únicamente, sin
// guiones al inicio/fin ni dobles.
export function esSlugValido(slug) {
  return typeof slug === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/**
 * Da de alta un conjunto y su operador.
 *
 * REGLA ESTRICTA (a diferencia de seed.js): si ya existe un Conjunto con ese
 * slug, NO continúa a crear el operador ni escribe nada — devuelve
 * { estado: 'YA_EXISTE', conjunto } tal cual. En producción, sobre un conjunto
 * existente no queremos ninguna escritura implícita.
 *
 * bonosHabilitados NO es un parámetro: siempre queda en false. Es la misma
 * decisión de "los bonos nunca se activan por accidente" que rige en todo el
 * proyecto; activarlos es una acción deliberada y explícita, aparte.
 *
 * @param {object} datos  campos YA validados por el llamador (el CLI valida).
 * @param {string} datos.nombre
 * @param {string} datos.slug
 * @param {string} datos.operadorNombre
 * @param {string} datos.operadorWhatsapp
 * @param {string} datos.operadorDomicilio
 * @param {string} datos.puntoRecepcion
 * @param {number} datos.tarifaMano
 * @param {number} datos.tarifaEstandar
 * @param {number} datos.tarifaVolumen
 * @param {number} datos.tarifaPesado
 * @param {string} datos.operadorEmail
 * @param {string} datos.operadorPassword
 * @returns {Promise<{estado:string, conjunto:object, operador?:object, codigoInvitacion:string}>}
 */
export async function altaDeConjunto(datos) {
  const {
    nombre, slug, operadorNombre, operadorWhatsapp, operadorDomicilio, puntoRecepcion,
    tarifaMano, tarifaEstandar, tarifaVolumen, tarifaPesado,
    operadorEmail, operadorPassword,
  } = datos;

  // Validaciones mínimas de contrato (el CLI ya valida de cara al usuario;
  // aquí protegemos la función para cualquier llamador, incl. las pruebas).
  if (!nombre || !slug) throw new Error('altaDeConjunto: nombre y slug son obligatorios');
  if (!esSlugValido(slug)) throw new Error(`altaDeConjunto: slug inválido "${slug}"`);
  for (const [k, v] of Object.entries({ tarifaMano, tarifaEstandar, tarifaVolumen, tarifaPesado })) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`altaDeConjunto: ${k} debe ser un entero >= 0`);
  }
  if (!operadorEmail) throw new Error('altaDeConjunto: operadorEmail es obligatorio');
  if (!cumplePoliticaPassword(operadorPassword)) throw new Error(`altaDeConjunto: ${PASSWORD_POLICY_MSG}`);

  // 1) ¿Ya existe el conjunto por slug? Conjunto es modelo SIN tenant, se lee
  //    directo. Si existe -> YA_EXISTE, sin tocar nada más.
  const existente = await prisma.conjunto.findUnique({ where: { slug } });
  if (existente) {
    return { estado: ESTADO.YA_EXISTE, conjunto: existente, codigoInvitacion: existente.codigoInvitacion };
  }

  // 2) Crear el conjunto. bonosHabilitados NO se pasa: usa el default del
  //    esquema (false).
  const codigoInvitacion = generarCodigoInvitacion({ prefijo: slug });
  const conjunto = await prisma.conjunto.create({
    data: {
      nombre,
      slug,
      codigoInvitacion,
      operadorNombre,
      operadorWhatsapp,
      operadorDomicilio,
      puntoRecepcion,
      tarifaMano,
      tarifaEstandar,
      tarifaVolumen,
      tarifaPesado,
      // bonosHabilitados: omitido a propósito -> false por default del esquema.
    },
  });

  // 3) Crear el operador dentro del contexto del conjunto (la extensión fija
  //    conjuntoId; NO se pasa en data). Antes, verificar que el email no exista
  //    ya (email es @unique global) por la vía autorizada sin tenant.
  const yaExisteEmail = await buscarUsuarioPorEmailSinTenant(operadorEmail);
  if (yaExisteEmail) {
    throw new Error(`altaDeConjunto: el email ${operadorEmail} ya está registrado`);
  }
  const passwordHash = await bcrypt.hash(operadorPassword, 10);
  const operador = await runWithTenant({ conjuntoId: conjunto.id, role: 'OPERATOR' }, () =>
    prisma.user.create({
      data: {
        email: operadorEmail,
        passwordHash,
        role: 'OPERATOR',
        nombre: operadorNombre,
        telefono: '',
        termsAcceptedAt: new Date(),
      },
    })
  );

  return { estado: ESTADO.CREADO, conjunto, operador, codigoInvitacion };
}
