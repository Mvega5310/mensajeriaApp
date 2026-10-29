import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Sheet, Toast } from '../../design';
import { api } from '../../services/api.js';
import PhotoGallery from '../../components/PhotoGallery.jsx';
import useFotosPaquete from '../../hooks/operador/useFotosPaquete.js';
import { formatCOP } from '../../utils/format.js';
import { etiquetaMetodoPago } from '../../utils/metodosPago.js';
import { TIERS, quienTrajo } from '../../utils/tiers.js';
import BonosVista from './BonosVista.jsx';

const ESTADO_BADGE = { EN_RECEPCION: 'en-porteria', PROGRAMADO: 'programado', ENTREGADO: 'entregado', SIN_ASIGNAR: 'sin-asignar', PREALERTADO: 'programado' };

function fecha(iso) {
  return iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

// Por qué no se cobra: cortesía de primera entrega o bono prepago.
function motivo(p) {
  if (p.esPrimeraEntrega) return 'Primera entrega: no cobrar.';
  if (p.bono) return `Pagado con bono. Quedan ${p.bono.cantidadTotal - p.bono.cantidadUsada} de ${p.bono.cantidadTotal}.`;
  return null;
}

function Tarjeta({ p, paraQuien }) {
  const [verFotos, setVerFotos] = useState(false);
  const { fotoUrl, cargando } = useFotosPaquete(p.id, verFotos);
  const nota = motivo(p);
  return (
    <div className="op-fila op-fila--lectura">
      <b>{TIERS.find((t) => t.value === p.categoriaPeso)?.label ?? p.categoriaPeso}</b>
      <Badge estado={ESTADO_BADGE[p.estado] ?? 'en-porteria'} />
      {paraQuien && <span className="op-muted">Para: {paraQuien}</span>}
      <span className="op-muted">{quienTrajo(p)}{p.guia && p.guia !== "Sin Guía" ? ` · guía ${p.guia}` : ""}</span>
      <span className="op-muted">Recibido {fecha(p.recibidoEn ?? p.fechaIngreso)} · {formatCOP(p.costoServicio)}</span>
      {nota && <span className="op-muted">{nota}</span>}
      {p.modalidadEntrega === 'RECOGER'
        ? <span className="op-muted">Recoge en portería</span>
        : p.franjaHoraria && <span className="op-muted">Franja {p.franjaHoraria} · {etiquetaMetodoPago(p.metodoPagoServicio)}</span>}
      {p.pinProveedor && <span className="op-muted">PIN del proveedor: <b className="mono">{p.pinProveedor}</b></span>}
      {p.notas && <span className="op-muted">Nota: {p.notas}</span>}
      {!verFotos && <Button variante="secundario" icono="camara" onClick={() => setVerFotos(true)}>Ver fotos</Button>}
      {verFotos && cargando && <span className="op-muted">Cargando fotos</span>}
      {verFotos && !cargando && (fotoUrl ? <PhotoGallery fotoUrl={fotoUrl} /> : <span className="op-muted">Sin foto todavía.</span>)}
    </div>
  );
}

const ENTREGABLES = new Set(['EN_RECEPCION', 'PROGRAMADO']);

// Direcciones (Domicilio) distintas que aparecen en los paquetes del detalle.
function direccionesDe(paquetes = []) {
  const por = new Map();
  for (const p of paquetes) {
    if (p.domicilioId && !por.has(p.domicilioId)) {
      por.set(p.domicilioId, { id: p.domicilioId, nombre: p.residente?.nombre ?? '', fin: String(p.residente?.telefono ?? '').replace(/\D/g, '').slice(-4) });
    }
  }
  return [...por.values()];
}

/** "Desactivar dirección" (revisión S3.2, C5): para una dirección impostor o equivocada. Pide
 *  confirmar; ya no recibe paquetes nuevos ni sale en la búsqueda (los que tiene siguen su curso). */
function DesactivarDireccion({ dir, varias }) {
  const [paso, setPaso] = useState('inicio'); // inicio | confirmar | hecho
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  async function desactivar() {
    setEnviando(true);
    setError('');
    try {
      await api(`/domicilios/${dir.id}/desactivar`, { method: 'PATCH' });
      setPaso('hecho');
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }
  if (paso === 'hecho') return <Toast tipo="info">Dirección desactivada. No recibirá paquetes nuevos.</Toast>;
  if (paso === 'confirmar') {
    return (
      <div className="op-fila op-fila--lectura">
        <b>¿Desactivar la dirección de {dir.nombre}{dir.fin ? ` (•••• ${dir.fin})` : ''}?</b>
        <span className="op-muted">Ya no saldrá en la búsqueda ni recibirá paquetes nuevos. Los que tiene ahora se entregan igual.</span>
        {error && <Toast tipo="error">{error}</Toast>}
        <Button className="op-peligro" onClick={desactivar} disabled={enviando}>{enviando ? 'Desactivando' : 'Sí, desactivar'}</Button>
        <Button variante="secundario" onClick={() => setPaso('inicio')} disabled={enviando}>Cancelar</Button>
      </div>
    );
  }
  return (
    <Button variante="secundario" onClick={() => setPaso('confirmar')}>
      {varias ? `Desactivar dirección de ${dir.nombre}${dir.fin ? ` (•••• ${dir.fin})` : ''}` : 'Desactivar dirección'}
    </Button>
  );
}

/** Cuerpo del detalle: fotos, cobro, notas y bonos. Lo usan la hoja (móvil) y el panel (escritorio). */
export function DetalleCuerpo({ detalle, config, bonos, onBonos }) {
  const residente = detalle?.paquetes?.[0]?.residente ? detalle.paquetes[0] : null;
  if (bonos) {
    return <BonosVista residenteId={residente.residenteId} config={config} onVolver={() => onBonos(false)} />;
  }
  const direcciones = direccionesDe(detalle?.paquetes);
  return (
    <div className="op-hoja">
      {detalle?.paquetes.map((p) => <Tarjeta key={p.id} p={p} paraQuien={direcciones.length > 1 ? p.residente?.nombre : null} />)}
      {config?.bonosHabilitados && residente?.residenteId && (
        <Button variante="secundario" icono="regalo" onClick={() => onBonos(true)}>Ver bonos</Button>
      )}
      {detalle?.paquetes.some((p) => ENTREGABLES.has(p.estado)) && (
        <Button as={Link} to="/op/entregar">Entregar con PIN</Button>
      )}
      {direcciones.map((d) => <DesactivarDireccion key={d.id} dir={d} varias={direcciones.length > 1} />)}
    </div>
  );
}

/** Detalle en hoja modal (móvil). */
export default function DetalleSheet({ detalle, onClose, config }) {
  const [bonos, setBonos] = useState(false);
  const cerrar = () => { setBonos(false); onClose(); };
  return (
    <Sheet open={!!detalle} onClose={cerrar} title={bonos ? 'Bonos' : detalle?.titulo}>
      <DetalleCuerpo detalle={detalle} config={config} bonos={bonos} onBonos={setBonos} />
    </Sheet>
  );
}

/** Mismo detalle renderizado como panel fijo a la derecha (escritorio). Usar con key por apartamento. */
export function DetallePanel({ detalle, config }) {
  const [bonos, setBonos] = useState(false);
  if (!detalle) return <p className="op-vacio">Elige un apartamento de la lista.</p>;
  return (
    <>
      <h2 className="op-panel__titulo">{bonos ? 'Bonos' : detalle.titulo}</h2>
      <DetalleCuerpo detalle={detalle} config={config} bonos={bonos} onBonos={setBonos} />
    </>
  );
}
