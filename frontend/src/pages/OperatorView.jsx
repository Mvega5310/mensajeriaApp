import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { formatCOP } from '../utils/format.js';
import { TIERS } from '../utils/tiers.js';
import { compressImage } from '../utils/image.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function OperatorView() {
  const [packages, setPackages] = useState([]);
  const [tab, setTab] = useState('reception');
  const [error, setError] = useState('');

  const [checkinPkg, setCheckinPkg] = useState(null);
  const [tier, setTier] = useState('ESTANDAR');
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [checkinError, setCheckinError] = useState('');
  const [checkinSaving, setCheckinSaving] = useState(false);

  const [pinPkg, setPinPkg] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const [logSearch, setLogSearch] = useState('');

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

  const logEntries = [...packages]
    .sort((a, b) => new Date(b.fechaIngreso) - new Date(a.fechaIngreso))
    .filter((p) => {
      const q = logSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        p.residente.nombre.toLowerCase().includes(q) ||
        p.residente.apto.toLowerCase().includes(q) ||
        p.residente.torre.toLowerCase().includes(q) ||
        p.proveedor.toLowerCase().includes(q)
      );
    });

  function formatFecha(iso) {
    return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function openCheckin(pkg) {
    setCheckinPkg(pkg);
    setTier(pkg.categoriaPeso || 'ESTANDAR');
    setPhoto(pkg.fotoUrl || null);
    setCheckinError('');
  }

  async function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoBusy(true);
    setCheckinError('');
    try {
      setPhoto(await compressImage(file));
    } catch {
      setCheckinError('No se pudo procesar la foto. Intenta con otra.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleCheckinSubmit(e) {
    e.preventDefault();
    setCheckinError('');
    setCheckinSaving(true);
    try {
      await api(`/packages/${checkinPkg.id}/checkin`, {
        method: 'PATCH',
        body: { categoriaPeso: tier, fotoUrl: photo },
      });
      setCheckinPkg(null);
      await refresh();
    } catch (err) {
      setCheckinError(err.message);
    } finally {
      setCheckinSaving(false);
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
        <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>🗂️ Bitácora</button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {tab === 'reception' && packages.map((pkg) => (
        <div className="card" key={pkg.id}>
          <div className="card-head">
            <div>
              <div className="card-title">{pkg.residente.torre} - {pkg.residente.apto} · {pkg.residente.nombre}</div>
              <div className="card-sub">{pkg.proveedor} · Guía: {pkg.guia}</div>
              {pkg.franjaHoraria && <div className="card-sub">🕒 Prefiere: {pkg.franjaHoraria}</div>}
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

      {tab === 'log' && (
        <>
          <div className="field">
            <input placeholder="Buscar por residente, torre, apto o proveedor…"
              value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />
          </div>

          {logEntries.length === 0 ? (
            <div className="empty">No hay paquetes que coincidan con la búsqueda.</div>
          ) : (
            logEntries.map((pkg) => (
              <div className="card" key={pkg.id}>
                <div className="card-head">
                  <div>
                    <div className="card-title">{pkg.residente.torre} - Apto {pkg.residente.apto} · {pkg.residente.nombre}</div>
                    <div className="card-sub">{pkg.proveedor} · Guía: {pkg.guia}</div>
                    <div className="card-sub">Recibido: {formatFecha(pkg.fechaIngreso)}{pkg.fechaEntrega && ` · Entregado: ${formatFecha(pkg.fechaEntrega)}`}</div>
                  </div>
                  <StatusBadge estado={pkg.estado} />
                </div>

                {pkg.fotoUrl ? (
                  <details className="photo-toggle">
                    <summary>📷 Ver foto de evidencia</summary>
                    <img src={pkg.fotoUrl} alt="Evidencia de recepción" />
                  </details>
                ) : (
                  <p className="field-hint" style={{ marginTop: 8 }}>Sin foto de evidencia todavía.</p>
                )}
              </div>
            ))
          )}
        </>
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
                <label htmlFor="pkg-photo-input" className="photo-picker">
                  {photo ? (
                    <img src={photo} alt="Vista previa" />
                  ) : (
                    <span className="photo-picker-empty">📷 Tomar foto o subir imagen</span>
                  )}
                </label>
                <input id="pkg-photo-input" type="file" accept="image/*" capture="environment"
                  onChange={handlePhotoSelect} className="sr-only" disabled={photoBusy} />
                <p className="field-hint">
                  {photoBusy ? 'Procesando foto…' : 'En el celular abre la cámara directo; en computador deja elegir un archivo.'}
                </p>
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

              {checkinError && <p className="error-text" style={{ marginBottom: 10 }}>{checkinError}</p>}

              <button className="btn btn-primary" type="submit" disabled={photoBusy || checkinSaving}>
                {checkinSaving ? 'Guardando…' : '✔ Confirmar Recepción'}
              </button>
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
