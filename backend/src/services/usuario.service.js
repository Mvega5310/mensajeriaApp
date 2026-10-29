// ÚNICO punto de acceso a la tabla `User` (PLAN-conjunto S1.1).
//
// Por qué existe: la cuenta del RESIDENT es de la persona y sirve en cualquier conjunto,
// así que `User` salió de MODELOS_CON_TENANT (config/tenantModels.js) y la extensión de
// Prisma ya no la filtra. El aislamiento de los usuarios se hace AQUÍ, a mano y con una
// API mínima, en vez de repartir `prisma.user.*` por los controladores:
//
//   - OPERATOR: siempre filtrado por el conjunto del contexto (`conjuntoId` del
//     contexto de tenant) y rol OPERATOR. Un operador nunca lee a otro conjunto.
//   - RESIDENT: solo por el `id` de la sesión (cada persona ve únicamente su propia
//     cuenta). Un operador NUNCA lee cuentas de residentes: de la persona solo ve lo
//     que hay en su Domicilio (nombre de quien recibe, teléfono, torre, apto), jamás el
//     correo ni sus otros conjuntos. `contactoParaNotificar` es de uso interno del
//     servidor (correos transaccionales) y solo debe recibir ids que salieron de filas ya
//     filtradas por tenant (p. ej. Package.residenteId).
//
// auditoriaInvariantes.test.js falla si `prisma.user`/`tx.user` aparece fuera de este
// archivo, de buscarUsuarioPorEmailSinTenant (login/forgot, auth.controller.js), del
// bootstrap (tenantBootstrap.js), del seed y de los scripts de alta/backfill. No agregues
// funciones genéricas (findMany/findFirst con where libre): cada función nueva debe decir
// de quién filtra.

import { prisma } from '../config/db.js';
import { getContext } from '../config/tenantContext.js';

const SELECT_CONTACTO = { id: true, nombre: true, email: true, telefono: true };

function conjuntoDelContextoId() {
  const ctx = getContext();
  if (!ctx?.conjuntoId) throw new Error('usuario.service: se requiere un contexto de tenant (runWithTenant)');
  return ctx.conjuntoId;
}

/** Cuenta propia completa (incluye passwordHash: quien llama debe quitarlo). Por id de la sesión. */
export async function obtenerCuentaPropia(usuarioId) {
  return prisma.user.findUnique({ where: { id: usuarioId } });
}

/** Cuenta propia sin el hash de la contraseña. */
export async function obtenerPerfilPropio(usuarioId) {
  const user = await obtenerCuentaPropia(usuarioId);
  if (!user) return null;
  const { passwordHash, ...perfil } = user;
  return perfil;
}

/** Solo nombre, torre y apto de la cuenta propia (vista "Mis paquetes" por enlace). */
export async function obtenerResumenPropio(usuarioId) {
  return prisma.user.findFirst({
    where: { id: usuarioId, role: 'RESIDENT' },
    select: { id: true, nombre: true, torre: true, apto: true },
  });
}

/**
 * Crea la cuenta de un RESIDENT (registro público; el rol nunca sale del body).
 * `conjuntoId` es el conjunto validado del registro: queda como "último conjunto usado".
 */
export async function crearResidente({ conjuntoId, email, passwordHash, nombre, telefono, torre, apto }) {
  return prisma.user.create({
    data: {
      conjuntoId, email, passwordHash, role: 'RESIDENT', nombre, telefono, torre, apto,
      termsAcceptedAt: new Date(),
    },
  });
}

/**
 * Crea la cuenta del OPERATOR de un conjunto (seed y alta de conjunto; nunca el registro
 * público). `conjuntoId` es SU conjunto: aquí sí aísla. `cliente` permite hacerlo dentro de
 * la transacción del alta (por defecto, el cliente global).
 */
export async function crearOperador({ conjuntoId, email, passwordHash, nombre, telefono }, cliente = prisma) {
  return cliente.user.create({
    data: { conjuntoId, email, passwordHash, role: 'OPERATOR', nombre, telefono, termsAcceptedAt: new Date() },
  });
}

/** Cambia la contraseña de una cuenta (restablecer): por id del token ya validado. */
export async function actualizarPassword(usuarioId, passwordHash) {
  return prisma.user.update({ where: { id: usuarioId }, data: { passwordHash } });
}

/**
 * Anota el último conjunto con el que la persona operó (solo RESIDENT; un OPERATOR
 * sigue ligado al suyo y nunca se mueve). Hoy abre el contexto de sus requests; S1.3 lo
 * reemplaza por el conjunto de cada solicitud.
 */
export async function marcarUltimoConjunto(usuarioId, conjuntoId) {
  return prisma.user.updateMany({
    where: { id: usuarioId, role: 'RESIDENT' },
    data: { conjuntoId },
  });
}

/** Operador (rol OPERATOR) del conjunto del contexto, o null. Nunca el de otro conjunto. */
export async function operadorDelConjuntoActual() {
  return prisma.user.findFirst({
    where: { role: 'OPERATOR', conjuntoId: conjuntoDelContextoId() },
  });
}

/**
 * Datos para un correo transaccional: nombre, correo y teléfono de la cuenta. Uso
 * interno del servidor; nunca se devuelve tal cual a un operador. `usuarioId` debe salir
 * de una fila ya filtrada por tenant (p. ej. Package.residenteId).
 */
export async function contactoParaNotificar(usuarioId) {
  if (!usuarioId) return null;
  return prisma.user.findUnique({ where: { id: usuarioId }, select: SELECT_CONTACTO });
}
