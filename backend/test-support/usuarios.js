// SOLO PARA PRUEBAS. Desde PLAN-conjunto S1.1 `User` ya no está bajo la extensión de
// tenant: el conjunto de la cuenta se pasa explícito y, para un RESIDENT, su dirección
// vive en un Domicilio. Este helper conserva el patrón de las pruebas existentes (crear
// el usuario DENTRO de runWithTenant del conjunto): toma el conjunto del contexto,
// fija User.conjuntoId y, si es RESIDENT, crea también su Domicilio (con torre/apto/
// nombre/teléfono del usuario, en la forma canónica) y la fila del índice UsuarioConjunto.
// Nunca se importa desde src/ (las carpetas de pruebas quedan fuera de la auditoría E7).

import { getContext } from '../src/config/tenantContext.js';
import { tokenTorre } from '../src/domain/apartamento.js';

export const direccionCanonica = (torre, apto) => ({
  torre: tokenTorre(torre) ?? '',
  apto: String(apto ?? '').replace(/\D/g, ''),
});

/**
 * Domicilio de prueba para `usuario` en el conjunto del contexto (idempotente por
 * [conjunto, usuario, torre, apto]).
 */
export async function crearDomicilioDeContexto(prisma, usuario, extra = {}) {
  const ctx = getContext();
  if (!ctx?.conjuntoId) throw new Error('crearDomicilioDeContexto requiere runWithTenant');
  const dir = direccionCanonica(extra.torre ?? usuario.torre, extra.apto ?? usuario.apto);
  await prisma.usuarioConjunto.upsert({
    where: { usuarioId_conjuntoId: { usuarioId: usuario.id, conjuntoId: ctx.conjuntoId } },
    create: { usuarioId: usuario.id, conjuntoId: ctx.conjuntoId },
    update: {},
  });
  return prisma.domicilio.create({
    data: {
      usuarioId: usuario.id,
      ...dir,
      nombreRecibe: extra.nombreRecibe ?? usuario.nombre,
      telefono: extra.telefono ?? usuario.telefono,
      ...(extra.ultimoUsoEn ? { ultimoUsoEn: extra.ultimoUsoEn } : {}),
    },
  });
}

/** Igual que `prisma.user.create(args)`, con conjuntoId del contexto y Domicilio si es RESIDENT. */
export async function crearUsuarioDeContexto(prisma, args) {
  const ctx = getContext();
  if (!ctx?.conjuntoId) throw new Error('crearUsuarioDeContexto requiere runWithTenant');
  const usuario = await prisma.user.create({ ...args, data: { ...args.data, conjuntoId: ctx.conjuntoId } });
  if (usuario.role === 'RESIDENT') await crearDomicilioDeContexto(prisma, usuario);
  return usuario;
}
