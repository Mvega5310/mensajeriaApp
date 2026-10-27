import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Icon, Sheet, Toast } from '../../design';
import useFotoPaquete from '../../hooks/residente/useFotoPaquete.js';
import useHistorial from '../../hooks/residente/useHistorial.js';
import { formatCOP } from '../../utils/format.js';
import { quienTrajo } from '../../utils/tiers.js';
import Pantalla from './Pantalla.jsx';

const fecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

function Fila({ p }) {
  const [abierta, setAbierta] = useState(false);
  const fotos = useFotoPaquete(p.id, 'normal', abierta);
  return (
    <li className="res-hist">
      <div className="res-card__txt" style={{ flex: 1 }}>
        <span className="res-linea">{quienTrajo(p)} · {p.motivoCobro === 'CORTESIA' || p.motivoCobro === 'BONO' ? <b className="res-gratis">Gratis</b> : <b>{formatCOP(p.costoServicio)}</b>}</span>
        <span className="res-hist__fecha">{p.fechaEntrega ? `Entregado el ${fecha(p.fechaEntrega)}` : 'Entregado'}</span>
      </div>
      <Badge estado="entregado" />
      <button type="button" className="ds-topbar__volver" aria-label="Ver fotos del paquete" onClick={() => setAbierta(true)}>
        <Icon nombre="camara" size={24} />
      </button>
      <Sheet open={abierta} onClose={() => setAbierta(false)} title="Fotos del paquete">
        {fotos.length === 0 ? <p>Este paquete no tiene fotos.</p>
          : <div className="res-fotos">{fotos.map((u, i) => <img key={u} src={u} alt={`Foto ${i + 1} del paquete`} />)}</div>}
      </Sheet>
    </li>
  );
}

export default function Historial() {
  const { lista, error } = useHistorial(true);
  return (
    <Pantalla>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px var(--sp-1) 0' }}>
        <Link to="/paquetes" aria-label="Volver" className="ds-topbar__volver"><Icon nombre="volver" size={24} trazo={2.5} /></Link>
      </div>
      <div className="res-tit" style={{ paddingTop: 8 }}>
        <h1>Historial</h1>
        <p>Los paquetes que ya recibiste.</p>
      </div>
      {error && <div className="res-aviso"><Toast tipo="error">{error} Vuelve a abrir esta pantalla para reintentar.</Toast></div>}
      {lista && lista.length === 0 && <p className="res-nota">Todavía no has recibido paquetes.</p>}
      <ul className="res-lista" style={{ listStyle: 'none', margin: 0 }}>
        {(lista ?? []).map((p) => <Fila key={p.id} p={p} />)}
      </ul>
    </Pantalla>
  );
}
