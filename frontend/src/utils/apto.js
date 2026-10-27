// "TORRE 2" + "304" -> "T2 · 304". Mismo formato que la etiqueta que devuelve el backend.
export function etiquetaApto(torre, apto) {
  const t = String(torre ?? '').match(/\d+/)?.[0] ?? String(torre ?? '').trim();
  return t ? `T${t} · ${apto}` : String(apto ?? '');
}

// Hora corta de un instante ("10:42"), con la hora local del dispositivo.
export function horaCorta(iso) {
  return iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

// "hoy", "ayer" o "N días" desde una fecha.
export function haceCuanto(iso) {
  if (!iso) return '';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  return dias === 1 ? 'ayer' : `${dias} días`;
}
