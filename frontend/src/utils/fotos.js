// El campo fotoUrl guarda un JSON de hasta 3 imágenes. Antes de este
// cambio guardaba una sola imagen como string plano (no JSON) — el
// try/catch cubre esos registros viejos sin necesitar una migración.
export function parseFotos(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

// GET /packages/:id/foto devuelve { fotos: [{ url, orden }] } (T5.1): URLs firmadas
// del almacén (expiran en 10 min) o data-URI de las fotos antiguas. PhotoGallery
// sigue recibiendo el formato JSON de siempre; esto lo arma desde la respuesta.
export function fotoUrlDeRespuesta(respuesta) {
  const urls = (respuesta?.fotos ?? []).map((f) => f.url);
  return urls.length ? JSON.stringify(urls) : null;
}
