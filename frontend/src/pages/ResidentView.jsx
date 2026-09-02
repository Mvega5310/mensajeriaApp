import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { formatCOP } from '../utils/format.js';
import { TIERS } from '../utils/tiers.js';
import { TIME_SLOTS, PAYMENT_METHODS } from '../utils/schedule.js';
import StatusBadge from '../components/StatusBadge.jsx';
import PhotoGallery from '../components/PhotoGallery.jsx';

const emptyForm = {
  proveedor: '', guia: '', categoriaPeso: 'ESTANDAR',
  esContraEntregaProveedor: false, valorProductoProveedor: '', valorDeclarado: '',
  franjaHoraria: TIME_SLOTS[0], metodoPagoServicio: PAYMENT_METHODS[0].value, notas: '',
  pinProveedor: '',
};

// Cada cuánto se revisa si algo cambió (ej. el operador confirmó la
// entrega) mientras el residente tiene la pestaña abierta y visible.
const POLL_MS = 20000;

export default function ResidentView() {
  const [packages, setPackages] = useState([]);
  const [tab, setTab] = useState('list');
  const [form, setForm] = useState(emptyForm);
  const [scheduling, setScheduling] = useState(null); // paquete a programar
  const [slot, setSlot] = useState(TIME_SLOTS[0]);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0].value);
  const [error, setError] = useState('');

  const [comentarios, setComentarios] = useState([]);
  const [mensaje, setMensaje] = useState('');
  const [enviandoComentario, setEnviandoComentario] = useState(false);

  const [bonos, setBonos] = useState([]);

  function openSchedule(pkg) {
    setScheduling(pkg);
    setSlot(pkg.franjaHoraria || TIME_SLOTS[0]);
    setPaymentMethod(pkg.metodoPagoServicio || PAYMENT_METHODS[0].value);
  }

  async function refresh() {
    setPackages(await api('/packages/mine'));
  }

  async function refreshComentarios() {
    setComentarios(await api('/comments/mine'));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    refreshComentarios().catch((err) => setError(err.message));
    api('/bonos/mine').then(setBonos).catch(() => {});

    // El estado (ej. "Entregado") lo cambia el operador desde su propio
    // celular — sin esto, el residente solo lo vería al recargar la
    // página a mano. Revisamos seguido mientras la pestaña está visible,
    // y de una vez apenas vuelve a estar visible (se pausa en segundo
    // plano para no gastar batería/datos sin necesidad).
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refresh().catch(() => {});
    }, POLL_MS);
    function onVisible() {
      if (document.visibilityState === 'visible') refresh().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  async function handleEnviarComentario(e) {
    e.preventDefault();
    setError('');
    setEnviandoComentario(true);
    try {
      await api('/comments', { method: 'POST', body: { mensaje } });
      setMensaje('');
      await refreshComentarios();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviandoComentario(false);
    }
  }

  async function handleCreatePrealert(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/packages', {
        method: 'POST',
        body: {
          proveedor: form.proveedor,
          guia: form.guia,
          categoriaPeso: form.categoriaPeso,
          esContraEntregaProveedor: form.esContraEntregaProveedor,
          valorProductoProveedor: form.esContraEntregaProveedor ? Number(form.valorProductoProveedor) || 0 : 0,
          valorDeclarado: Number(form.valorDeclarado) || 0,
          franjaHoraria: form.franjaHoraria,
          metodoPagoServicio: form.metodoPagoServicio,
          notas: form.notas,
          pinProveedor: form.pinProveedor,
        },
      });
      setForm(emptyForm);
      await refresh();
      setTab('list');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSchedule(e) {
    e.preventDefault();
    setError('');
    try {
      await api(`/packages/${scheduling.id}/schedule`, {
        method: 'PATCH',
        body: { franjaHoraria: slot, metodoPagoServicio: paymentMethod },
      });
      setScheduling(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="shell">
      <div className="how-it-works">
        <strong>Así funciona:</strong> notifica tu paquete apenas lo compres → te avisamos cuando llega a
        recepción → programas la franja en que estarás en tu apartamento → lo recibes en la puerta con tu PIN.
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
          Mis Paquetes ({packages.length})
        </button>
        <button className={`tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>
          + Notificar Paquete
        </button>
        <button className={`tab ${tab === 'comentarios' ? 'active' : ''}`} onClick={() => setTab('comentarios')}>
          💬 Comentarios
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {tab === 'form' && (
        <form className="card" onSubmit={handleCreatePrealert}>
          <div className="field">
            <label htmlFor="proveedor">Tienda / Proveedor</label>
            <input id="proveedor" required placeholder="Ej. Mercado Libre" value={form.proveedor}
              onChange={(e) => setForm({ ...form, proveedor: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="guia">No. Guía (opcional)</label>
            <input id="guia" placeholder="Ej. 98421034" value={form.guia}
              onChange={(e) => setForm({ ...form, guia: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="pinProveedor">PIN del proveedor (opcional)</label>
            <input id="pinProveedor" placeholder="Ej. 4821" value={form.pinProveedor}
              onChange={(e) => setForm({ ...form, pinProveedor: e.target.value })} />
            <p className="field-hint">
              Algunas plataformas (ej. Mercado Libre) generan su propio código para que su
              mensajero confirme la entrega. Si lo tienes, el operador lo necesita a mano
              cuando ese mensajero llegue a recepción — no es tu PIN de Puertaya.
            </p>
          </div>

          <div className="field">
            <label htmlFor="categoriaPeso">Tamaño / Peso aproximado</label>
            <select id="categoriaPeso" value={form.categoriaPeso}
              onChange={(e) => setForm({ ...form, categoriaPeso: e.target.value })}>
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <p className="field-hint">
              Es tu estimado — el operador confirma el tamaño real al recibirlo y ahí queda la tarifa definitiva.
            </p>
          </div>
          <div className="tariff-box" style={{ marginBottom: 12 }}>
            <div className="l">Tarifa estimada</div>
            <div className="v">{formatCOP(TIERS.find((t) => t.value === form.categoriaPeso)?.costo)} COP</div>
          </div>

          <div className="field">
            <label htmlFor="valorDeclarado">Valor declarado del producto (opcional)</label>
            <input id="valorDeclarado" type="number" min="0" placeholder="Ej. 150000"
              value={form.valorDeclarado} onChange={(e) => setForm({ ...form, valorDeclarado: e.target.value })} />
            <p className="field-hint">
              Es el monto máximo que reconocemos si el paquete se pierde o daña en custodia — ver{' '}
              <Link to="/terminos" target="_blank" rel="noreferrer">Términos, sección 4</Link>. Si lo dejas vacío, no hay valor de referencia.
            </p>
          </div>

          <div className="field">
            <label htmlFor="franjaHoraria">Franja en la que sueles estar en tu apartamento</label>
            <select id="franjaHoraria" value={form.franjaHoraria}
              onChange={(e) => setForm({ ...form, franjaHoraria: e.target.value })}>
              {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="field-hint">La confirmas de nuevo cuando el paquete llegue a recepción, por si cambia.</p>
          </div>

          <div className="field">
            <label htmlFor="metodoPagoServicio">Método de pago del servicio de entrega</label>
            <select id="metodoPagoServicio" value={form.metodoPagoServicio}
              onChange={(e) => setForm({ ...form, metodoPagoServicio: e.target.value })}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="cod-box" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
              ⚠️ ¿Cobro contra entrega del producto?
              <input type="checkbox" checked={form.esContraEntregaProveedor}
                onChange={(e) => setForm({ ...form, esContraEntregaProveedor: e.target.checked })} />
            </label>
            {form.esContraEntregaProveedor && (
              <input type="number" min="0" placeholder="Monto a pagar al transportista (COP)"
                value={form.valorProductoProveedor}
                onChange={(e) => setForm({ ...form, valorProductoProveedor: e.target.value })} />
            )}
          </div>

          <div className="field">
            <label htmlFor="notas">Comentario para el operador (opcional)</label>
            <textarea id="notas" rows={3} maxLength={500} value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
              placeholder="Ej. Pago en efectivo con billete de $100.000, por favor llevar vueltos." />
            <p className="field-hint">
              Para algo puntual de este paquete. Si es un tema general, usa la pestaña Comentarios.
            </p>
          </div>

          <button className="btn btn-primary" type="submit" style={{ marginTop: 12 }}>Guardar Pre-alerta</button>
        </form>
      )}

      {tab === 'list' && bonos.some((b) => b.cantidadUsada < b.cantidadTotal) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p className="card-sub" style={{ marginBottom: 8 }}>🎟️ Tus entregas prepagas</p>
          {bonos.filter((b) => b.cantidadUsada < b.cantidadTotal).map((b) => (
            <div className="gold-box" key={b.id} style={{ marginTop: 6 }}>
              <span>{TIERS.find((t) => t.value === b.categoriaPeso)?.label || b.categoriaPeso}</span>
              <strong>Quedan {b.cantidadTotal - b.cantidadUsada} de {b.cantidadTotal}</strong>
            </div>
          ))}
        </div>
      )}

      {tab === 'list' && (
        packages.length === 0 ? (
          <div className="empty">
            <h3>No tienes paquetes registrados</h3>
            <p>Notifica tus compras en camino para recibir seguimiento en tiempo real.</p>
            <button className="btn btn-primary" onClick={() => setTab('form')}>+ Notificar nuevo paquete</button>
          </div>
        ) : (
          packages.map((pkg) => (
            <div className="card" key={pkg.id}>
              <div className="card-head">
                <div>
                  <div className="card-id">{pkg.id.slice(0, 8).toUpperCase()}</div>
                  <div className="card-title">{pkg.proveedor}</div>
                  <div className="card-sub">Guía: {pkg.guia}</div>
                  {pkg.pinProveedor && <div className="card-sub">PIN proveedor: {pkg.pinProveedor}</div>}
                </div>
                <StatusBadge estado={pkg.estado} />
              </div>

              <PhotoGallery fotoUrl={pkg.fotoUrl} />

              {pkg.esContraEntregaProveedor && (
                <div className="cod-box">
                  <span>Cobro transportista:</span>
                  <strong>{formatCOP(pkg.valorProductoProveedor)}</strong>
                </div>
              )}

              {pkg.valorDeclarado > 0 && (
                <div className="cod-box-muted">
                  <span>Valor declarado:</span>
                  <strong>{formatCOP(pkg.valorDeclarado)}</strong>
                </div>
              )}

              {pkg.notas && (
                <p className="field-hint" style={{ marginTop: 8 }}>📝 Tu nota: {pkg.notas}</p>
              )}

              <div className="grid-2">
                <div className="tariff-box">
                  <div className="l">{pkg.estado === 'PREALERTADO' ? 'Tarifa Estimada' : 'Tarifa Servicio'}</div>
                  <div className="v">{formatCOP(pkg.costoServicio)} COP</div>
                </div>
                <div className="pin-box">
                  <div className="l">PIN de Entrega</div>
                  <div className="v">{pkg.pin}</div>
                </div>
              </div>

              {pkg.estado === 'EN_RECEPCION' && (
                <button className="btn btn-primary" style={{ marginTop: 12 }}
                  onClick={() => openSchedule(pkg)}>
                  🕒 Programar Horario de Entrega
                </button>
              )}
              {pkg.franjaHoraria && (
                <div className="cod-box-muted" style={{ marginTop: 12 }}>
                  <span>🕒 {pkg.franjaHoraria}</span>
                  <span style={{ fontWeight: 400 }}>{pkg.estado === 'PROGRAMADO' ? 'Programado' : 'Preferencia'}</span>
                </div>
              )}
            </div>
          ))
        )
      )}

      {tab === 'comentarios' && (
        <>
          <form className="card" onSubmit={handleEnviarComentario}>
            <div className="field">
              <label htmlFor="mensaje">Cuéntanos tu comentario o inquietud</label>
              <textarea id="mensaje" rows={4} required maxLength={1000} value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                placeholder="Ej. Preferiría una franja más temprano, o una pregunta sobre mi último paquete..." />
            </div>
            <button className="btn btn-primary" type="submit" disabled={enviandoComentario}>
              {enviandoComentario ? 'Enviando…' : 'Enviar comentario'}
            </button>
          </form>

          {comentarios.length === 0 ? (
            <div className="empty">Todavía no has enviado comentarios.</div>
          ) : (
            comentarios.map((c) => (
              <div className="card" key={c.id}>
                <p style={{ fontSize: 13.5, margin: 0 }}>{c.mensaje}</p>
                <p className="card-sub" style={{ marginTop: 8 }}>
                  {new Date(c.createdAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ))
          )}
        </>
      )}

      {scheduling && (
        <div className="modal-overlay" onClick={() => setScheduling(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Programar Entrega en Puerta</h3>
              <button className="modal-close" onClick={() => setScheduling(null)}>✕</button>
            </div>
            <form onSubmit={handleSchedule}>
              <div className="field">
                <label>Franja de reparto</label>
                <select value={slot} onChange={(e) => setSlot(e.target.value)}>
                  {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Método de pago del servicio</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" type="submit">Confirmar Horario</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
