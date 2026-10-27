// Endpoints de configuración por conjunto (KAN-8, Fase D — design.md §4.3).
import { prisma } from '../config/db.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { normalizarCodigoInvitacion } from '../services/invitacion.service.js';
import { soloPresentacionales, tarifasDe, conjuntoDelContexto } from '../services/conjunto.service.js';

// GET /api/conjuntos/config-publica?c=<codigo>  (PÚBLICO, pre-sesión)
// Devuelve solo campos presentacionales. Conjunto es modelo exento, así que la
// lectura no requiere contexto. No expone tarifas ni flags. No parsea slug.
export async function configPublica(req, res) {
  const c = req.query.c;
  if (!c) {
    throw new AppError(CODIGOS.INVITACION_INVALIDA, 'Necesitas el enlace de invitación de tu conjunto. Pídelo a la administración.', 400);
  }
  const codigo = normalizarCodigoInvitacion(c);
  const conjunto = await prisma.conjunto.findUnique({ where: { codigoInvitacion: codigo } });
  if (!conjunto || !conjunto.invitacionActiva) {
    throw new AppError(CODIGOS.INVITACION_INVALIDA, 'El enlace de invitación no es válido o ya venció. Pide uno nuevo a la administración.', 400);
  }
  return res.json(soloPresentacionales(conjunto));
}

// GET /api/conjunto/config  (requireAuth + requireTenant)
// Presentacionales + tarifas + bonosHabilitados. codigoInvitacion SOLO para
// OPERATOR (para el QR/cartelera de invitación).
export async function config(req, res) {
  const conjunto = await conjuntoDelContexto();
  const payload = {
    ...soloPresentacionales(conjunto),
    slug: conjunto.slug, // presentacional: nombre de archivos (CSV), URLs de soporte
    tarifas: tarifasDe(conjunto),
    bonosHabilitados: conjunto.bonosHabilitados,
  };
  if (req.user?.role === 'OPERATOR') {
    payload.codigoInvitacion = conjunto.codigoInvitacion;
  }
  return res.json(payload);
}
