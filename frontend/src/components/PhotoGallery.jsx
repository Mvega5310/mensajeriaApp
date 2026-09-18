import { useEffect, useState } from 'react';
import { parseFotos } from '../utils/fotos.js';

// Miniaturas recortadas a 96x96 para escanear rápido; al tocar una se
// abre en un lightbox de pantalla completa sin recorte (object-fit:
// contain) — antes solo había una miniatura chica y recortada, sin
// forma de verla más grande. Compartido entre el detalle del operador
// y el del residente para que ambos vean las fotos de la misma forma.
export default function PhotoGallery({ fotoUrl }) {
  const fotos = parseFotos(fotoUrl);
  const [abierta, setAbierta] = useState(null); // índice en el lightbox, o null si está cerrado

  useEffect(() => {
    if (abierta === null) return;
    function onKey(e) {
      if (e.key === 'Escape') setAbierta(null);
      if (e.key === 'ArrowLeft' && fotos.length > 1) setAbierta((a) => (a - 1 + fotos.length) % fotos.length);
      if (e.key === 'ArrowRight' && fotos.length > 1) setAbierta((a) => (a + 1) % fotos.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierta, fotos.length]);

  if (fotos.length === 0) return null;

  return (
    <div className="field">
      <label>{fotos.length > 1 ? `Fotos de evidencia (${fotos.length})` : 'Foto de evidencia'}</label>
      <div className="photo-grid-view">
        {fotos.map((src, i) => (
          <button key={i} type="button" className="photo-thumb" onClick={() => setAbierta(i)}>
            <img src={src} alt={`Evidencia ${i + 1}`} />
          </button>
        ))}
      </div>

      {abierta !== null && (
        <div className="lightbox-overlay" onClick={() => setAbierta(null)}>
          <button type="button" className="lightbox-close" onClick={() => setAbierta(null)} aria-label="Cerrar">✕</button>
          {fotos.length > 1 && (
            <>
              <button type="button" className="lightbox-nav lightbox-prev" aria-label="Foto anterior"
                onClick={(e) => { e.stopPropagation(); setAbierta((abierta - 1 + fotos.length) % fotos.length); }}>‹</button>
              <button type="button" className="lightbox-nav lightbox-next" aria-label="Foto siguiente"
                onClick={(e) => { e.stopPropagation(); setAbierta((abierta + 1) % fotos.length); }}>›</button>
            </>
          )}
          <img src={fotos[abierta]} alt={`Evidencia ${abierta + 1} de ${fotos.length}`}
            className="lightbox-img" onClick={(e) => e.stopPropagation()} />
          {fotos.length > 1 && <div className="lightbox-counter">{abierta + 1} / {fotos.length}</div>}
        </div>
      )}
    </div>
  );
}
