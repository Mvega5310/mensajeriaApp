import { useEffect, useState } from 'react';
import { Icon } from '../design';
import { parseFotos } from '../utils/fotos.js';
import './photoGallery.css';

// Miniaturas recortadas para escanear rápido; al tocar una se abre en pantalla
// completa sin recorte. Lo usa el detalle del operador. Solo tokens, sin emoji.
export default function PhotoGallery({ fotoUrl }) {
  const fotos = parseFotos(fotoUrl);
  const [abierta, setAbierta] = useState(null); // índice en el visor, o null si está cerrado

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
    <div className="pg">
      <span className="pg__rotulo">{fotos.length > 1 ? `Fotos de evidencia (${fotos.length})` : 'Foto de evidencia'}</span>
      <div className="pg__grid">
        {fotos.map((src, i) => (
          <button key={i} type="button" className="pg__thumb" onClick={() => setAbierta(i)} aria-label={`Ver foto ${i + 1}`}>
            <img src={src} alt={`Evidencia ${i + 1}`} />
          </button>
        ))}
      </div>

      {abierta !== null && (
        <div className="pg__visor pt" role="dialog" aria-modal="true" aria-label="Foto de evidencia" onClick={() => setAbierta(null)}>
          <button type="button" className="pg__cerrar" onClick={() => setAbierta(null)} aria-label="Cerrar"><Icon nombre="cerrar" size={24} /></button>
          {fotos.length > 1 && (
            <>
              <button type="button" className="pg__nav pg__nav--ant" aria-label="Foto anterior"
                onClick={(e) => { e.stopPropagation(); setAbierta((abierta - 1 + fotos.length) % fotos.length); }}><Icon nombre="volver" size={24} trazo={2.5} /></button>
              <button type="button" className="pg__nav pg__nav--sig" aria-label="Foto siguiente"
                onClick={(e) => { e.stopPropagation(); setAbierta((abierta + 1) % fotos.length); }}><Icon nombre="siguiente" size={24} trazo={2.5} /></button>
            </>
          )}
          <img src={fotos[abierta]} alt={`Evidencia ${abierta + 1} de ${fotos.length}`} className="pg__img" onClick={(e) => e.stopPropagation()} />
          {fotos.length > 1 && <div className="pg__cuenta">{abierta + 1} / {fotos.length}</div>}
        </div>
      )}
    </div>
  );
}
