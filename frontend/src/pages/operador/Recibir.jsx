import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Icon, Keypad } from '../../design';
import useRecibir from '../../hooks/operador/useRecibir.js';
import useResumen from '../../hooks/operador/useResumen.js';
import useConfig from '../../hooks/operador/useConfig.js';
import Pantalla from './Pantalla.jsx';
import MasSheet from './MasSheet.jsx';

export default function Recibir() {
  const navigate = useNavigate();
  const config = useConfig();
  const { resumen } = useResumen();
  const porEntregar = resumen?.porEntregar ?? 0;
  const { texto, tecla, resultados, buscando, error, hayConsulta } = useRecibir();
  const [sinDueno, setSinDueno] = useState(false);
  const [etiqueta, setEtiqueta] = useState('');
  const [masAbierto, setMasAbierto] = useState(false);

  function elegir(r) {
    navigate(`/op/recibir/${r.id}`, { state: { residente: r } });
  }

  function continuarSinDueno(e) {
    e.preventDefault();
    if (!etiqueta.trim()) return;
    navigate('/op/recibir/sin-dueno', { state: { sinDueno: true, etiquetaNombre: etiqueta.trim() } });
  }

  return (
    <Pantalla activo="recibir" pendientes={porEntregar}>
      <div className="op-marca">
        <span className="op-marca__logo">Puerta<b>yá</b></span>
        <span className="op-marca__conjunto">
          {config?.nombre}
          <button type="button" className="op-mas" onClick={() => setMasAbierto(true)}>Más</button>
        </span>
      </div>
      <div className="op-tit">
        <h1>Recibir</h1>
        <p>Hoy: <b>{resumen?.hoy.recibidos ?? '–'}</b> recibidos · <b>{resumen ? porEntregar : '–'}</b> por entregar</p>
      </div>

      {sinDueno ? (
        <form className="op-apto" onSubmit={continuarSinDueno}>
          <Field
            label="Nombre en la etiqueta"
            ayuda="Escribe lo que dice el paquete. Lo asignas después."
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            maxLength={80}
            autoFocus
            autoComplete="off"
          />
          <Button type="submit" disabled={!etiqueta.trim()}>Continuar</Button>
          <button type="button" className="op-link" onClick={() => setSinDueno(false)}>Buscar apartamento</button>
        </form>
      ) : (
        <>
          <div className="op-apto">
            <span className="op-apto__label" id="apto-label">Apartamento</span>
            <span className="op-apto__valor" role="status" aria-labelledby="apto-label">
              {texto}
              <span className="op-apto__cursor" aria-hidden="true" />
            </span>
          </div>
          <div className="op-lista" aria-live="polite">
            {resultados.map((r) => (
              <button type="button" key={r.id} className="op-sug" onClick={() => elegir(r)}>
                <span className="op-sug__apto">{r.etiqueta}</span>
                <span className="op-sug__nombre">{r.nombre}</span>
                {r.pendientes > 0 && <span className="op-chip" aria-label={`${r.pendientes} pendientes`}>{r.pendientes}</span>}
                <Icon nombre="siguiente" size={22} trazo={2.5} />
              </button>
            ))}
            {error && <p className="op-vacio" role="alert">{error}</p>}
            {hayConsulta && !buscando && !error && resultados.length === 0 && (
              <p className="op-vacio">No hay residentes con ese apartamento. Revisa el número.</p>
            )}
            <button type="button" className="op-link" onClick={() => setSinDueno(true)}>No sé de quién es</button>
          </div>
          <div className="op__relleno" />
          <div className="op-teclado">
            <Keypad onKey={tecla} extra={{ id: 'torre', label: 'Torre', ariaLabel: 'Agregar torre' }} />
          </div>
        </>
      )}
      {sinDueno && <div className="op__relleno" />}
      <MasSheet open={masAbierto} onClose={() => setMasAbierto(false)} config={config} />
    </Pantalla>
  );
}
