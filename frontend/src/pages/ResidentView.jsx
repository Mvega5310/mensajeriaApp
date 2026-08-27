import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { formatCOP } from '../utils/format.js';
import StatusBadge from '../components/StatusBadge.jsx';

const emptyForm = { proveedor: '', guia: '', esContraEntregaProveedor: false, valorProductoProveedor: '' };

export default function ResidentView() {
  const [packages, setPackages] = useState([]);
  const [tab, setTab] = useState('list');
  const [form, setForm] = useState(emptyForm);
  const [scheduling, setScheduling] = useState(null); // paquete a programar
  const [slot, setSlot] = useState('12:00 m - 1:30 pm (Mediodía)');
  const [paymentMethod, setPaymentMethod] = useState('Contra entrega en puerta (Efectivo / Nequi)');
  const [error, setError] = useState('');

  async function refresh() {
    setPackages(await api('/packages/mine'));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function handleCreatePrealert(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/packages', {
        method: 'POST',
        body: {
          proveedor: form.proveedor,
          guia: form.guia,
          esContraEntregaProveedor: form.esContraEntregaProveedor,
          valorProductoProveedor: form.esContraEntregaProveedor ? Number(form.valorProductoProveedor) || 0 : 0,
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
      <div className="tabs">
        <button className={`tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
          Mis Paquetes ({packages.length})
        </button>
        <button className={`tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>
          + Notificar Paquete
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

          <button className="btn btn-primary" type="submit" style={{ marginTop: 12 }}>Guardar Pre-alerta</button>
        </form>
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
                </div>
                <StatusBadge estado={pkg.estado} />
              </div>

              {pkg.fotoUrl && (
                <img src={pkg.fotoUrl} alt="Evidencia de recepción" style={{ width: '100%', height: 128, objectFit: 'cover', borderRadius: 12, marginTop: 10 }} />
              )}

              {pkg.esContraEntregaProveedor && (
                <div className="cod-box">
                  <span>Cobro transportista:</span>
                  <strong>{formatCOP(pkg.valorProductoProveedor)}</strong>
                </div>
              )}

              <div className="grid-2">
                <div className="tariff-box">
                  <div className="l">Tarifa Servicio</div>
                  <div className="v">{formatCOP(pkg.costoServicio)} COP</div>
                </div>
                <div className="pin-box">
                  <div className="l">PIN de Entrega</div>
                  <div className="v">{pkg.pin}</div>
                </div>
              </div>

              {pkg.estado === 'EN_RECEPCION' && (
                <button className="btn btn-primary" style={{ marginTop: 12 }}
                  onClick={() => setScheduling(pkg)}>
                  🕒 Programar Horario de Entrega
                </button>
              )}
              {pkg.franjaHoraria && (
                <div className="cod-box" style={{ marginTop: 12, background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#334155' }}>
                  <span>🕒 {pkg.franjaHoraria}</span>
                  <span style={{ fontWeight: 400 }}>Programado</span>
                </div>
              )}
            </div>
          ))
        )
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
                  <option value="12:00 m - 1:30 pm (Mediodía)">Mediodía · 12:00 m - 1:30 pm</option>
                  <option value="6:00 pm - 7:30 pm (Tarde/Noche)">Tarde/Noche · 6:00 pm - 7:30 pm</option>
                </select>
              </div>
              <div className="field">
                <label>Método de pago del servicio</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="Contra entrega en puerta (Efectivo / Nequi)">💵 Contra entrega en puerta</option>
                  <option value="Transferencia digital previa">📱 Transferencia digital previa</option>
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
