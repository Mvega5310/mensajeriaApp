// Direcciones de entrega de la persona (PLAN-conjunto S1.3). La cuenta es de la persona; cada
// dirección es de un conjunto. El conjunto de una dirección NUEVA sale del slug que manda el
// cliente (validado: activo); el cliente nunca manda un conjuntoId.
import { runWithTenant } from '../config/tenantContext.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { conjuntoActivoPorSlug } from '../services/conjunto.service.js';
import {
  listarDomiciliosDePersona, guardarDireccionDePersona, direccionDeCuerpo, vistaDomicilio, desactivarDomicilio,
  reactivarDomicilio, listarDesactivados,
} from '../services/domicilio.service.js';

/**
 * Limita cuántas direcciones puede crear una cuenta por hora (en memoria; revisión S3.2). Se
 * llama SÍNCRONO antes de cualquier await. Lanza 429 si se pasó.
 */
export function limitarCreacionDeDirecciones(req) {
  const intento = req.app.locals.limitadorDirecciones.intentar(`direcciones:${req.user.sub}`);
  if (!intento.permitido) {
    req.res.set('Retry-After', String(intento.segundosRestantes));
    throw new AppError(
      CODIGOS.DEMASIADOS_INTENTOS,
      'Creaste muchas direcciones seguidas. Usa una de las que ya tienes o inténtalo más tarde.',
      429,
      { minutosRestantes: intento.minutosRestantes },
    );
  }
}

// GET /api/domicilios: sus direcciones guardadas en TODOS sus conjuntos activos, la última
// usada primero. { id, conjunto:{slug,nombre}, torre, apto, etiqueta, nombreRecibe, telefono, ultimoUsoEn }.
export async function listar(req, res) {
  const lista = await listarDomiciliosDePersona(req.user.sub);
  res.json(lista.map((d) => vistaDomicilio(d, d.conjunto)));
}

// POST /api/domicilios { conjunto, torre, apto, nombreRecibe?, telefono? }: crea o reutiliza
// (misma persona + conjunto + torre + apto) y la deja como la última usada. Nombre y teléfono
// que falten se precargan de la cuenta al crear. 201 con la dirección. Máximo 10 activas por
// conjunto (400 LIMITE_DIRECCIONES) y 20 altas por hora por cuenta (429).
export async function crear(req, res) {
  limitarCreacionDeDirecciones(req);
  const conjunto = await conjuntoActivoPorSlug(req.body?.conjunto);
  const dir = direccionDeCuerpo(req.body);
  const d = await runWithTenant({ conjuntoId: conjunto.id, role: 'RESIDENT' }, () =>
    guardarDireccionDePersona(req.user.sub, dir));
  res.status(201).json(vistaDomicilio(d, conjunto));
}

// PATCH /api/domicilios/:id/desactivar  (OPERATOR, de SU conjunto): activo=false + evento
// auditado. Para el domicilio impostor o equivocado (revisión S3.2, C5).
export async function desactivar(req, res) {
  res.json(await desactivarDomicilio(req.params.id, req.user.sub));
}

// PATCH /api/domicilios/:id/reactivar  (OPERATOR, de SU conjunto): deshace una desactivación por
// error. activo=true + evento REACTIVAR. 409 LIMITE_DIRECCIONES si la persona ya tiene 10 activas;
// ya activa -> 200 idempotente.
export async function reactivar(req, res) {
  res.json(await reactivarDomicilio(req.params.id, req.user.sub));
}

// GET /api/domicilios/desactivados?q=&limite=&pagina=  (OPERATOR, de SU conjunto):
// [{ domicilioId, nombre, etiqueta, telefonoFin, desactivadoEn }], sin correo ni teléfono completo.
export async function desactivados(req, res) {
  res.json(await listarDesactivados({ q: req.query.q, limite: req.query.limite, pagina: req.query.pagina }));
}
