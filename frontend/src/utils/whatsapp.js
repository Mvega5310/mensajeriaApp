// Enlace wa.me para escribirle a un residente. El prefijo del país sale de
// GET /conjunto/config (prefijoPais); sin config cargada no hay enlace.
export function enlaceWhatsapp(prefijoPais, telefono, texto) {
  if (!prefijoPais || !telefono) return undefined;
  const base = `https://wa.me/${prefijoPais}${telefono}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}
