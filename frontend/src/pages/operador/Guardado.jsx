import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Badge, Button, Icon, Stamp, Toast } from '../../design';
import { api } from '../../services/api.js';
import { formatCOP } from '../../utils/format.js';
import { TIERS } from '../../utils/tiers.js';
import { respuestaEnviada, useCola } from '../../offline/colaRecepciones.js';
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
  const { id } = useParams();
  return id.startsWith('pendiente-') ? <GuardadoPendiente clave={id.slice('pendiente-'.length)} /> : <GuardadoEnviado />;
}

// Recepción guardada sin señal: se muestra el resumen local hasta que la cola la envía;
// entonces se reemplaza por la respuesta real (con el aviso y su waUrl).
function GuardadoPendiente({ clave }) {
  const { state } = useLocation();
  const cola = useCola();
  const real = respuestaEnviada(clave);
  const item = cola.items.find((x) => x.claveIdempotencia === clave);
  const resumen = state?.resumen ?? item?.resumen;
  if (real) return <Vista resultado={real} />;
  if (!cola.listo) return <Pantalla><p className="op-vacio" aria-busy="true">Cargando…</p></Pantalla>;
  if (!item || !resumen) return <Navigate to="/op/pendientes" replace />;
  const local = {
    paquete: { ...resumen, nombre: resumen.nombre ?? '', recibidoEn: new Date(item.creadoEn).toISOString() },
    aviso: null,
  };
  return <Vista resultado={local} pendiente={item} />;
}

function GuardadoEnviado() {
  const { state } = useLocation();
  const { id } = useParams();
  // Los datos vienen de la recepción; tras recargar se reconstruyen con GET /packages/:id.
  const [recuperado, setRecuperado] = useState(null);
  const [fallo, setFallo] = useState(false);
  const resultado = state?.resultado ?? recuperado;
  useEffect(() => {
    if (state?.resultado) return;
    api(`/packages/${id}`).then(setRecuperado).catch(() => setFallo(true));
  }, [id, state]);
  if (fallo) return <Navigate to="/op/pendientes" replace />;
  if (!resultado) return <Pantalla><p className="op-vacio" aria-busy="true">Cargando…</p></Pantalla>;

  return <Vista resultado={resultado} />;
}

function Vista({ resultado, pendiente = null }) {
  const { paquete: p, aviso } = resultado;
  const sinDueno = !p.residenteId;
  const categoria = TIERS.find((t) => t.value === p.categoriaPeso)?.label ?? p.categoriaPeso;
  const puedeAvisar = !!aviso?.waUrl;
  const primerNombre = (p.nombre || '').split(' ')[0];

  return (
    <Pantalla>
      {pendiente && (
        <div className="op__pad">
          {pendiente.estado === 'fallido'
            ? <Toast tipo="error">No se pudo enviar: {pendiente.ultimoError}. Revisa la lista de por enviar.</Toast>
            : <Toast tipo="aviso">Sin señal. Guardamos el registro y lo enviamos al volver.</Toast>}
        </div>
      )}
      <div className="op-ok">
        <div className="op-ok__sello"><Icon nombre="check" size={48} trazo={2.5} /></div>
        <h1>{pendiente ? 'Guardado en el teléfono' : 'Guardado'}</h1>
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

      {pendiente && <p className="op-nota" style={{ textAlign: 'center' }}>Avisaremos cuando se envíe.</p>}
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
        {pendiente ? (
          <>
            <Button variante="whatsapp" icono="whatsapp" disabled>Avisar por WhatsApp</Button>
            <Button as={Link} to="/op/recibir">Recibir otro</Button>
          </>
        ) : puedeAvisar ? (
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
