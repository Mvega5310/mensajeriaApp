import { Link, Navigate, useLocation } from 'react-router-dom';
import { Badge, Button, Icon, Stamp } from '../../design';
import { formatCOP } from '../../utils/format.js';
import { TIERS } from '../../utils/tiers.js';
import Pantalla from './Pantalla.jsx';

function hora(iso) {
  return iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

// Qué se cobra (o por qué no) según motivoCobro de la respuesta de recepción.
function cobro(p) {
  if (p.motivoCobro === 'CORTESIA') return <Stamp>Primera entrega gratis</Stamp>;
  if (p.motivoCobro === 'BONO') return <span className="op-muted">Pagado con bono</span>;
  if (p.motivoCobro === 'TARIFA') return <span>Cobro: <b className="mono">{formatCOP(p.costo)}</b></span>;
  return null;
}

export default function Guardado() {
  const { state } = useLocation();
  const resultado = state?.resultado;
  // Los datos vienen de la recepción; sin ellos (recarga) no hay aviso que mostrar.
  if (!resultado) return <Navigate to="/op/pendientes" replace />;

  const { paquete: p, aviso } = resultado;
  const sinDueno = !p.residenteId;
  const categoria = TIERS.find((t) => t.value === p.categoriaPeso)?.label ?? p.categoriaPeso;
  const puedeAvisar = !!aviso?.waUrl;
  const primerNombre = (p.nombre || '').split(' ')[0];

  return (
    <Pantalla>
      <div className="op-ok">
        <div className="op-ok__sello"><Icon nombre="check" size={48} trazo={2.5} /></div>
        <h1>Guardado</h1>
        {sinDueno ? (
          <>
            <p style={{ fontSize: 18 }}>Etiqueta: <b>{p.etiquetaNombre}</b></p>
            <Badge estado="sin-asignar" />
          </>
        ) : (
          <p style={{ fontSize: 18 }}><b className="mono">{p.etiquetaApto}</b> · {p.nombre}</p>
        )}
        <p className="op-muted" style={{ fontSize: 16 }}>{categoria} · {hora(p.recibidoEn)}</p>
        {cobro(p)}
      </div>

      {sinDueno && <p className="op-nota" style={{ textAlign: 'center' }}>Asígnalo cuando sepas de quién es, desde Pendientes.</p>}
      {aviso && (
        <>
          <div className="op-msg">
            <span className="op-msg__rotulo">Mensaje para {primerNombre}</span>
            <p className="op-msg__burbuja">{aviso.texto}</p>
          </div>
          <p className="op-nota" style={{ textAlign: 'center' }}>
            {puedeAvisar
              ? 'Se abre WhatsApp con el mensaje listo. Solo tocas Enviar.'
              : 'Este residente no tiene celular registrado.'}
          </p>
        </>
      )}

      <div className="op__relleno" />
      <div className="op__acciones">
        {puedeAvisar ? (
          <>
            <Button variante="whatsapp" as="a" icono="whatsapp" href={aviso.waUrl} target="_blank" rel="noreferrer">Avisar por WhatsApp</Button>
            <Button variante="secundario" as={Link} to="/op/recibir">Recibir otro</Button>
          </>
        ) : (
          <>
            <Button as={Link} to="/op/recibir">Recibir otro</Button>
            <Button variante="secundario" as={Link} to="/op/pendientes">Ver pendientes</Button>
          </>
        )}
      </div>
    </Pantalla>
  );
}
