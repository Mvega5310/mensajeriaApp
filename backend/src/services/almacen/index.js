// Interfaz AlmacenFotos (T5.1). Tres implementaciones:
//   s3        bucket compatible con S3 (Railway Buckets)
//   fake      memoria, para desarrollo y pruebas
//   bd-legado base64 en Package.fotoUrl (lectura de lo antiguo; en producción sin
//             bucket se sigue escribiendo así, con aviso fuerte en el arranque)
//
// Contrato:
//   guardar({ conjuntoId, paqueteId|null, contenido: Buffer, tipo }) -> { clave }
//   urlFirmada(clave, { expiraSeg }) -> string
//   borrar(clave) -> void
//   nombre: string, esLegado: boolean

import { resolverConfigFotos } from './config.js';
import { crearAlmacenFake } from './fake.js';
import { crearAlmacenLegado } from './legado.js';
import { crearAlmacenS3 } from './s3.js';

export { resolverConfigFotos } from './config.js';
export { crearAlmacenFake } from './fake.js';
export { crearAlmacenLegado, fotosDeFotoUrl } from './legado.js';
export { crearAlmacenS3 } from './s3.js';
export { decodificarDataUri, MAX_BYTES_FOTO, TIPOS_FOTO } from './dataUri.js';

/** Crea el almacén que corresponde a una configuración ya resuelta. */
export function crearAlmacenDesdeConfig(cfg) {
  if (cfg.modo === 's3') return crearAlmacenS3({ ...cfg.s3 });
  if (cfg.modo === 'legado') return crearAlmacenLegado();
  return crearAlmacenFake();
}

/** Atajo: variables de entorno -> almacén. Falla si la configuración está a medias. */
export function crearAlmacenDesdeEntorno(env = process.env) {
  const cfg = resolverConfigFotos(env);
  if (cfg.problemas.length) throw new Error(cfg.problemas.join(' '));
  return crearAlmacenDesdeConfig(cfg);
}
