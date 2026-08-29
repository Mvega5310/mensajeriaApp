import { parseFotos } from '../utils/fotos.js';

export default function PhotoGallery({ fotoUrl }) {
  const fotos = parseFotos(fotoUrl);
  if (fotos.length === 0) return null;

  return (
    <details className="photo-toggle">
      <summary>📷 Ver {fotos.length > 1 ? `fotos (${fotos.length})` : 'foto'} de evidencia</summary>
      {fotos.map((src, i) => (
        <img key={i} src={src} alt={`Evidencia de recepción ${i + 1}`} />
      ))}
    </details>
  );
}
