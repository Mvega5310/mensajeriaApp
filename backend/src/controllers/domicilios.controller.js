// Direcciones de entrega de la persona (PLAN-conjunto S1.3). La cuenta es de la persona; cada
// dirección es de un conjunto. El conjunto de una dirección NUEVA sale del slug que manda el
// cliente (validado: activo); el cliente nunca manda un conjuntoId.
import { runWithTenant } from '../config/tenantContext.js';
import { conjuntoActivoPorSlug } from '../services/conjunto.service.js';
import {
  listarDomiciliosDePersona, guardarDireccionDePersona, direccionDeCuerpo, vistaDomicilio,
} from '../services/domicilio.service.js';

// GET /api/domicilios: sus direcciones guardadas en TODOS sus conjuntos activos, la última
// usada primero. { id, conjunto:{slug,nombre}, torre, apto, etiqueta, nombreRecibe, telefono, ultimoUsoEn }.
export async function listar(req, res) {
  const lista = await listarDomiciliosDePersona(req.user.sub);
  res.json(lista.map((d) => vistaDomicilio(d, d.conjunto)));
}

// POST /api/domicilios { conjunto, torre, apto, nombreRecibe?, telefono? }: crea o reutiliza
// (misma persona + conjunto + torre + apto) y la deja como la última usada. Nombre y teléfono
// que falten se precargan de la cuenta al crear. 201 con la dirección.
export async function crear(req, res) {
  const conjunto = await conjuntoActivoPorSlug(req.body?.conjunto);
  const dir = direccionDeCuerpo(req.body);
  const d = await runWithTenant({ conjuntoId: conjunto.id, role: 'RESIDENT' }, () =>
    guardarDireccionDePersona(req.user.sub, dir));
  res.status(201).json(vistaDomicilio(d, conjunto));
}
