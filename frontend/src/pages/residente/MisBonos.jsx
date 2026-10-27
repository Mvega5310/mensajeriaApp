import { Link } from 'react-router-dom';
import { Icon, Toast } from '../../design';
import useMisBonos from '../../hooks/residente/useMisBonos.js';
import Pantalla from './Pantalla.jsx';

/** Mis bonos: entregas prepagas que te quedan por categoría (solo si el conjunto tiene bonos). */
export default function MisBonos() {
  const { saldos, error } = useMisBonos();
  return (
    <Pantalla>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px var(--sp-1) 0' }}>
        <Link to="/paquetes" aria-label="Volver" className="ds-topbar__volver"><Icon nombre="volver" size={24} trazo={2.5} /></Link>
      </div>
      <div className="res-tit" style={{ paddingTop: 8 }}>
        <h1>Mis bonos</h1>
        <p>Entregas prepagas que te quedan.</p>
      </div>
      {error && <div className="res-aviso"><Toast tipo="error">{error}</Toast></div>}
      {saldos && saldos.length === 0 && <p className="res-nota">Todavía no tienes bonos. Pídelos en portería.</p>}
      <ul className="res-lista" style={{ listStyle: 'none', margin: 0 }}>
        {(saldos ?? []).map((s) => (
          <li key={s.categoria} className="res-hist">
            <div className="res-card__txt" style={{ flex: 1 }}>
              <span className="res-linea">{s.nombre}</span>
              <span className="res-hist__fecha">de {s.total} entregas</span>
            </div>
            <b className="mono">{s.restantes}</b>
          </li>
        ))}
      </ul>
    </Pantalla>
  );
}
