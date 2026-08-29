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
