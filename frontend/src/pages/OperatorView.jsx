import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { formatCOP } from '../utils/format.js';
import { TIERS } from '../utils/tiers.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function OperatorView() {
  const [packages, setPackages] = useState([]);
  const [tab, setTab] = useState('reception');
  const [error, setError] = useState('');

  const [checkinPkg, setCheckinPkg] = useState(null);
  const [tier, setTier] = useState('ESTANDAR');
  const [photo, setPhoto] = useState(null);

  const [pinPkg, setPinPkg] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  async function refresh() {
    setPackages(await api('/packages'));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  const enRecepcion = packages.filter((p) => p.estado === 'EN_RECEPCION').length;
  const programado = packages.filter((p) => p.estado === 'PROGRAMADO').length;
  const entregado = packages.filter((p) => p.estado === 'ENTREGADO').length;
  const activeDeliveries = packages.filter((p) => p.estado === 'PROGRAMADO' || p.estado === 'EN_RECEPCION');

  function openCheckin(pkg) {
    setCheckinPkg(pkg);
    setTier(pkg.categoriaPeso || 'ESTANDAR');
    setPhoto(pkg.fotoUrl || null);
  }

  function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhoto(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function handleCheckinSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await api(`/packages/${checkinPkg.id}/checkin`, {
        method: 'PATCH',
        body: { categoriaPeso: tier, fotoUrl: photo },
      });
      setCheckinPkg(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function openPinModal(pkg) {
    setPinPkg(pkg);
    setPinInput('');
    setPinError('');
  }

  async function handleConfirmDelivery() {
    setPinError('');
    try {
      await api(`/packages/${pinPkg.id}/confirm-delivery`, { method: 'POST', body: { pin: pinInput.trim() } });
      setPinPkg(null);
      await refresh();
    } catch (err) {
      setPinError(err.message);
    }
  }

  return (
    <div className="shell">
      <div className="stat-row">
        <div className="stat"><div className="n">{enRecepcion}</div><div className="l">En Recepción</div></div>
        <div className="stat"><div className="n">{programado}</div><div className="l">Para Reparto</div></div>
        <div className="stat"><div className="n">{entregado}</div><div className="l">Entregados Hoy</div></div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'reception' ? 'active' : ''}`} onClick={() => setTab('reception')}>📥 Recepción</button>
        <button className={`tab ${tab === 'delivery' ? 'active' : ''}`} onClick={() => setTab('delivery')}>🚪 Ronda de Reparto</button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {tab === 'reception' && packages.map((pkg) => (
        <div className="card" key={pkg.id}>
          <div className="card-head">
            <div>
              <div className="card-title">{pkg.residente.torre} - {pkg.residente.apto} · {pkg.residente.nombre}</div>
              <div className="card-sub">{pkg.proveedor} · Guía: {pkg.guia}</div>
            </div>
            <StatusBadge estado={pkg.estado} />
          </div>
          <div className="grid-2">
            {pkg.estado === 'PREALERTADO' ? (
              <button className="btn btn-primary" onClick={() => openCheckin(pkg)}>📷 Recibir y Fotografiar</button>
            ) : (
              <button className="btn btn-secondary" onClick={() => openCheckin(pkg)}>✏️ Editar</button>
            )}
            <a className="btn btn-whatsapp"
              href={`https://wa.me/57${pkg.residente.telefono}?text=${encodeURIComponent(`Hola ${pkg.residente.nombre}, te confirmamos que tu paquete de ${pkg.proveedor} ya está en recepción.`)}`}
              target="_blank" rel="noreferrer">💬 WhatsApp</a>
          </div>
        </div>
      ))}

      {tab === 'delivery' && (
        activeDeliveries.length === 0 ? (
          <div className="empty">No hay entregas pendientes para reparto en este momento.</div>
        ) : (
          activeDeliveries.map((pkg) => (
            <div className="card" key={pkg.id} style={{ borderLeft: '4px solid var(--brand)' }}>
              <div className="card-head">
                <div>
                  <div className="card-title">{pkg.residente.torre} - Apto {pkg.residente.apto}</div>
                  <div className="card-sub">{pkg.residente.nombre} · {pkg.proveedor} · Tarifa: {formatCOP(pkg.costoServicio)}</div>
                </div>
                <span className="card-sub">{pkg.franjaHoraria || 'Inmediata'}</span>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => openPinModal(pkg)}>🔑 Validar PIN en Puerta</button>
            </div>
          ))
        )
      )}

      {checkinPkg && (
        <div className="modal-overlay" onClick={() => setCheckinPkg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Registrar Entrada en Recepción</h3>
              <button className="modal-close" onClick={() => setCheckinPkg(null)}>✕</button>
            </div>
            <form onSubmit={handleCheckinSubmit}>
              <div className="field">
                <label>Foto de Custodia (Evidencia de estado)</label>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} />
                <p className="field-hint">En el celular abre la cámara directo; en computador deja elegir un archivo.</p>
                {photo && <img src={photo} alt="Vista previa" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 12, marginTop: 8 }} />}
              </div>
              <div className="field">
                <label>Categoría de Peso / Tamaño</label>
                <select value={tier} onChange={(e) => setTier(e.target.value)}>
                  {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label} - {formatCOP(t.costo)}</option>)}
                </select>
              </div>
              <div className="tariff-box" style={{ marginBottom: 12 }}>
                <div className="l">Tarifa calculada</div>
                <div className="v">{formatCOP(TIERS.find((t) => t.value === tier)?.costo)} COP</div>
              </div>
              <button className="btn btn-primary" type="submit">✔ Confirmar Recepción</button>
            </form>
          </div>
        </div>
      )}

      {pinPkg && (
        <div className="modal-overlay" onClick={() => setPinPkg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Validar Entrega en Puerta</h3>
              <button className="modal-close" onClick={() => setPinPkg(null)}>✕</button>
            </div>
            <p className="card-sub">Pide al residente el PIN de 4 dígitos que aparece en su pantalla:</p>
            <input className="pin-input" maxLength={4} placeholder="••••" value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))} />
            {pinError && <p className="error-text" style={{ textAlign: 'center' }}>{pinError}</p>}

            <div className="tariff-box" style={{ margin: '14px 0' }}>
              <div className="l">Cobro por entrega</div>
              <div className="v">{formatCOP(pinPkg.costoServicio)}</div>
            </div>
            {pinPkg.esContraEntregaProveedor && (
              <div className="cod-box" style={{ marginBottom: 14 }}>
                <span>Recaudo transportista:</span>
                <strong>{formatCOP(pinPkg.valorProductoProveedor)}</strong>
              </div>
            )}

            <button className="btn btn-primary" onClick={handleConfirmDelivery}>🛡 Confirmar y Finalizar Entrega</button>
          </div>
        </div>
      )}
    </div>
  );
}
