import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, Sheet, Toast } from '../../design';
import { api } from '../../services/api.js';
import useBuscarResidentes from '../../hooks/operador/useBuscarResidentes.js';
import { invalidarPaquetes } from '../../hooks/operador/usePaquetes.js';

/** Asigna un paquete SIN_ASIGNAR a un residente (búsqueda + PATCH asignar) y pasa a Guardado. */
export default function AsignarSheet({ paquete, onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { resultados } = useBuscarResidentes(q);

  async function asignar(r) {
    if (enviando) return;
    setEnviando(true);
    setError('');
    try {
      const resultado = await api(`/packages/${paquete.id}/asignar`, { method: 'PATCH', body: { domicilioId: r.domicilioId } });
      invalidarPaquetes();
      navigate(`/op/guardado/${paquete.id}`, { state: { resultado } });
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  }

  return (
    <Sheet open={!!paquete} onClose={onClose} title="Asignar paquete">
      <p className="op-muted" style={{ margin: 0 }}>Etiqueta: {paquete?.etiquetaNombre}</p>
      <Field label="Apartamento o nombre" placeholder="Ej. 304 o Ana" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {error && <Toast tipo="error">{error}</Toast>}
      <div className="op-hoja">
        {resultados.map((r) => (
          <button type="button" key={r.domicilioId} className="op-sug" disabled={enviando} onClick={() => asignar(r)}>
            <span className="op-sug__apto">{r.etiqueta}</span>
            <span className="op-sug__nombre">{r.nombre}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
