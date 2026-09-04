// Recorta una lista ya filtrada a una página de `pageSize`. `page` puede
// quedar desactualizado si el filtro reduce el total (ej. una búsqueda
// nueva) — por eso se recalcula "safePage" en vez de confiar ciegamente
// en el state, así nunca se pide una página que ya no existe.
export function paginar(lista, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(lista.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const items = lista.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { items, totalPages, safePage };
}
