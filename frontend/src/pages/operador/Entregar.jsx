import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Keypad, PinInput, Toast } from '../../design';
import useEntrega from '../../hooks/operador/useEntrega.js';
import usePaquetes from '../../hooks/operador/usePaquetes.js';
import Pantalla from './Pantalla.jsx';

export default function Entregar() {
  const { porEntregar } = usePaquetes();
  const { pin, error, opciones, verificando, tecla, elegir } = useEntrega();
  const { state } = useLocation();
  const navigate = useNavigate();
  const [aviso, setAviso] = useState(state?.aviso ?? null);

  // El aviso viene de Cobrar; se limpia del historial para que no reaparezca al recargar.
  useEffect(() => {
    if (state?.aviso) navigate('/op/entregar', { replace: true, state: null });
  }, [state, navigate]);

  return (
    <Pantalla activo="entregar" pendientes={porEntregar.length}>
      <div className="op-tit" style={{ paddingTop: 28 }}>
        <h1>Entregar</h1>
        <p style={{ fontSize: 17 }}>Pide el PIN al residente.</p>
      </div>
      <div className="op-pin" aria-busy={verificando}>
        <PinInput value={pin} error={!!error} label="PIN del residente" />
      </div>

      {aviso && !error && (
        <div className="op-aviso">
          <Toast tipo={aviso.tipo} onClose={() => setAviso(null)}>{aviso.texto}</Toast>
        </div>
      )}
      {error && <div className="op-aviso"><Toast tipo="error">{error}</Toast></div>}

      {opciones && (
        <div className="op-opciones" role="group" aria-label="Elige el apartamento">
          <p>Ese PIN coincide con varios apartamentos. Elige uno.</p>
          {opciones.map((o) => (
            <button type="button" key={o.residenteId} className="op-sug" disabled={verificando} onClick={() => elegir(o.residenteId)}>
              <span className="op-sug__apto">{o.etiquetaApto}</span>
            </button>
          ))}
        </div>
      )}

      <div className="op__relleno" />
      <div className="op-teclado">
        <Keypad onKey={tecla} extra={{ id: 'limpiar', label: 'C', ariaLabel: 'Limpiar' }} />
      </div>
    </Pantalla>
  );
}
