// Endpoints de configuración por conjunto (KAN-8, Fase D — design.md §4.3).
import { AppError, CODIGOS } from '../domain/errores.js';
import { franjasDe } from '../domain/conjuntoConfig.js';
import { METODOS_PAGO } from '../domain/pago.js';
import { soloPresentacionales, tarifasDe, conjuntoDelContexto, resolverConjuntoPublico, listarConjuntosActivos } from '../services/conjunto.service.js';

// GET /api/conjuntos  (PÚBLICO, pre-sesión; PLAN-conjunto S1.3)
// Selector de conjunto del registro y de las solicitudes: solo `{ slug, nombre }` de los
// conjuntos con la invitación activa, por nombre. Nada más (ni código, ni operador, ni
// tarifas). Caché corto: cambia rara vez. El límite por IP lo pone el limitador de la app.
export async function listarPublicos(req, res) {
  const limitador = req.app.locals.limitadorConjuntos;
  const intento = limitador.intentar(req.ip);
  if (!intento.permitido) {
    res.set('Retry-After', String(intento.segundosRestantes));
    throw new AppError(CODIGOS.DEMASIADOS_INTENTOS, 'Demasiadas consultas. Espera un momento e inténtalo de nuevo.', 429);
  }
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await listarConjuntosActivos());
}

// GET /api/conjuntos/config-publica?conjunto=<slug>  |  ?c=<codigo>  (PÚBLICO, pre-sesión)
// Devuelve solo campos presentacionales. Conjunto es modelo exento, así que la
// lectura no requiere contexto. No expone tarifas ni flags.
// Mismo criterio que el registro (resolverConjuntoPublico): `conjunto` (slug) o `c` (código
// antiguo); sin ninguno, solo si hay UN ÚNICO conjunto activo; con varios, 400 CONJUNTO_REQUERIDO.
export async function configPublica(req, res) {
  const conjunto = await resolverConjuntoPublico({ slug: req.query.conjunto, codigo: req.query.c });
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
    // Recepción/entrega (T2.1). franjasEntrega usa el default si la columna es null.
    prefijoPais: conjunto.prefijoPais,
    franjasEntrega: franjasDe(conjunto),
    maxFotos: conjunto.maxFotos,
    custodiaMaxDias: conjunto.custodiaMaxDias,
    metodosPago: METODOS_PAGO,
  };
  if (req.user?.role === 'OPERATOR') {
    payload.codigoInvitacion = conjunto.codigoInvitacion;
  }
  return res.json(payload);
}
