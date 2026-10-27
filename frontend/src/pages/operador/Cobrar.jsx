import { Navigate } from 'react-router-dom';
import { Button, PackageLabel, Toast, TopBar } from '../../design';
import useCobro from '../../hooks/operador/useCobro.js';
import { formatCOP } from '../../utils/format.js';
import { etiquetaMetodoPago } from '../../utils/metodosPago.js';
import { NOMBRES_CORTOS, quienTrajo } from '../../utils/tiers.js';
import Pantalla from './Pantalla.jsx';

function fecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date().toDateString() === d.toDateString();
  const h = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
  return hoy ? `Hoy ${h}` : `${d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })} ${h}`;
}

function valor(p) {
  if (p.costo > 0) return formatCOP(p.costo);
  return p.motivoCobro === 'BONO' ? 'Bono' : 'Gratis';
}

export default function Cobrar() {
  const { lote, metodo, setMetodo, enviando, error, confirmar, volver } = useCobro();
  // El lote solo vive en memoria: tras recargar hay que verificar el PIN otra vez.
  if (!lote) return <Navigate to="/op/entregar" replace />;

  const { residente, paquetes, total, metodosPago } = lote;
  return (
    <Pantalla>
      <TopBar title="PIN correcto" onBack={() => volver()} backLabel="Volver a Entregar" />
      <div className="op-tit" style={{ paddingTop: 12 }}>
        <h1 className="mono">{residente.etiquetaApto}</h1>
        <p style={{ fontSize: 17 }}>{residente.nombre} · {paquetes.length} {paquetes.length === 1 ? 'paquete' : 'paquetes'}</p>
      </div>

      <div className="op-scroll">
        {paquetes.map((p) => (
          <PackageLabel
            key={p.id}
            apto={NOMBRES_CORTOS[p.categoriaPeso]?.nombre ?? p.categoriaPeso}
            hora={fecha(p.recibidoEn)}
            detalles={[{ texto: quienTrajo(p), valor: valor(p) }]}
          />
        ))}
      </div>

      <div className="op-total">
        <span>Total a cobrar</span>
        <strong>{formatCOP(total)}</strong>
      </div>
      <div className="op-seg" role="radiogroup" aria-label="Forma de pago">
        {metodosPago.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={metodo === m} onClick={() => setMetodo(m)}>
            {etiquetaMetodoPago(m)}
          </button>
        ))}
      </div>
      {error && <div className="op-aviso"><Toast tipo="error">{error}</Toast></div>}
      <div className="op__acciones">
        <Button onClick={confirmar} disabled={enviando || !metodo}>{enviando ? 'Entregando' : 'Entregar todo'}</Button>
      </div>
    </Pantalla>
  );
}
