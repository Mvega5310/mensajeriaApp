// No se muestra nada si todo cabe en una sola página — evita el ruido
// visual de controles inútiles en listas cortas.
export default function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination">
      <button className="btn btn-secondary" disabled={page <= 1}
        onClick={() => onChange(page - 1)}>← Anterior</button>
      <span className="pagination-info">Página {page} de {totalPages}</span>
      <button className="btn btn-secondary" disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}>Siguiente →</button>
    </div>
  );
}
