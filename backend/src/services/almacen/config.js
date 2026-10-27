// Selección del almacén de fotos a partir de variables de entorno (T5.1).
// Pura: recibe `env`, no lee process.env por su cuenta.
//
//   FOTOS_S3_ENDPOINT, FOTOS_S3_BUCKET, FOTOS_S3_ACCESS_KEY, FOTOS_S3_SECRET  (juntas)
//   FOTOS_S3_REGION (por defecto "auto"), FOTOS_S3_FORCE_PATH_STYLE (por defecto true)
//
//  - Completas             -> 's3'
//  - Ninguna, desarrollo   -> 'fake' (memoria; las fotos se pierden al reiniciar)
//  - Ninguna, producción   -> 'legado' (base64 en Package.fotoUrl) con aviso fuerte,
//                             para no romper un despliegue que aún no tiene bucket
//  - Algunas pero no todas -> problema (configuración a medias)

const OBLIGATORIAS = [
  ['FOTOS_S3_ENDPOINT', 'endpoint'],
  ['FOTOS_S3_BUCKET', 'bucket'],
  ['FOTOS_S3_ACCESS_KEY', 'accessKey'],
  ['FOTOS_S3_SECRET', 'secret'],
];

function leer(env, nombre) {
  const v = env[nombre];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** @returns {{modo:'s3'|'fake'|'legado', s3?:object, problemas:string[], avisos:string[]}} */
export function resolverConfigFotos(env = process.env, { esProduccion = env.NODE_ENV === 'production' } = {}) {
  const valores = Object.fromEntries(OBLIGATORIAS.map(([n, k]) => [k, leer(env, n)]));
  const presentes = OBLIGATORIAS.filter(([n]) => leer(env, n));
  const problemas = [];
  const avisos = [];

  if (presentes.length === OBLIGATORIAS.length) {
    const forzar = leer(env, 'FOTOS_S3_FORCE_PATH_STYLE');
    return {
      modo: 's3',
      s3: {
        ...valores,
        region: leer(env, 'FOTOS_S3_REGION') ?? 'auto',
        forcePathStyle: forzar === undefined ? true : !['false', '0', 'no'].includes(forzar.toLowerCase()),
      },
      problemas,
      avisos,
    };
  }
  if (presentes.length > 0) {
    const faltan = OBLIGATORIAS.filter(([n]) => !leer(env, n)).map(([n]) => n);
    problemas.push(`Faltan variables del almacén de fotos: ${faltan.join(', ')}. Define las cuatro (ENDPOINT, BUCKET, ACCESS_KEY, SECRET) o ninguna.`);
    return { modo: esProduccion ? 'legado' : 'fake', problemas, avisos };
  }
  if (esProduccion) {
    avisos.push('ATENCIÓN: no hay almacén de fotos configurado (FOTOS_S3_*). Las fotos nuevas se guardan en la base de datos como base64 (modo legado), lo que infla la base y ya causó una caída. Crea un Bucket en Railway y define FOTOS_S3_ENDPOINT, FOTOS_S3_BUCKET, FOTOS_S3_ACCESS_KEY y FOTOS_S3_SECRET.');
    return { modo: 'legado', problemas, avisos };
  }
  avisos.push('FOTOS_S3_* no está definida: las fotos se guardan en memoria (almacén "fake") y se pierden al reiniciar el servidor.');
  return { modo: 'fake', problemas, avisos };
}
