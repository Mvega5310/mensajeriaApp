import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, downloadFile } from '../services/api.js';
import { formatCOP } from '../utils/format.js';
import { TIERS } from '../utils/tiers.js';
import { compressImage } from '../utils/image.js';
import { parseFotos } from '../utils/fotos.js';
import { BONOS_HABILITADOS } from '../utils/features.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Pagination from '../components/Pagination.jsx';
import { paginar } from '../utils/pagination.js';

const MAX_FOTOS = 3;
const PAGE_SIZE = 10;

const ESTADOS_FILTRO = [
  { value: 'TODOS', label: 'Todos los estados' },
  { value: 'PREALERTADO', label: '🟡 Pre-alertado' },
  { value: 'EN_RECEPCION', label: '📦 En Recepción' },
  { value: 'PROGRAMADO', label: '🕒 Programado' },
  { value: 'ENTREGADO', label: '✅ Entregado' },
];

// Por qué un paquete no se cobra: cortesía de primera entrega (siempre
// gana, no consume bono) o un bono prepago con crédito disponible en esa
// categoría de peso. Se usa igual en las tarjetas, los modales y la
// bitácora para no repetir la misma lógica cuatro veces.
// Compara solo año/mes/día (con la hora local del dispositivo, igual
// que el resto de la app) — sirve para "¿esto pasó hoy?" sin que la
// hora del día afecte la comparación.
function esHoy(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const hoy = new Date();
  return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
}

function truncar(texto, max = 140) {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

function cobroInfo(pkg) {
  if (pkg.esPrimeraEntrega) {
    return { gratis: true, texto: '🎁 Primera vez — NO cobrar' };
  }
  if (pkg.bono) {
    const quedan = pkg.bono.cantidadTotal - pkg.bono.cantidadUsada;
    return { gratis: true, texto: `🎟️ Pagado con bono — quedan ${quedan} de ${pkg.bono.cantidadTotal}` };
  }
  return { gratis: false, texto: null };
}

export default function OperatorView() {
  const [packages, setPackages] = useState([]);
  const [tab, setTab] = useState('reception');
  const [error, setError] = useState('');

  const [checkinPkg, setCheckinPkg] = useState(null);
  const [tier, setTier] = useState('ESTANDAR');
  const [photos, setPhotos] = useState([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [checkinError, setCheckinError] = useState('');
  const [checkinSaving, setCheckinSaving] = useState(false);

  const [pinPkg, setPinPkg] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [delivered, setDelivered] = useState(false);

  const [logSearch, setLogSearch] = useState('');
  const [logDesde, setLogDesde] = useState('');
  const [logHasta, setLogHasta] = useState('');
  const [logEstado, setLogEstado] = useState('TODOS');
  const [detailPkg, setDetailPkg] = useState(null);

  const [comentarios, setComentarios] = useState([]);
  const [comentariosSearch, setComentariosSearch] = useState('');
  const [detailComentario, setDetailComentario] = useState(null);

  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const inviteUrl = `${window.location.origin}/registro`;

  const [recepcionPage, setRecepcionPage] = useState(1);
  const [repartoPage, setRepartoPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [comentariosPage, setComentariosPage] = useState(1);

  const [checkinBonos, setCheckinBonos] = useState([]);

  const [bonoPkg, setBonoPkg] = useState(null); // paquete cuyo residente estamos gestionando
  const [bonos, setBonos] = useState([]);
  const [bonoForm, setBonoForm] = useState({ categoriaPeso: 'ESTANDAR', cantidad: '', precioPagado: '' });
  const [bonoError, setBonoError] = useState('');
  const [bonoSaving, setBonoSaving] = useState(false);

  async function refresh() {
    setPackages(await api('/packages'));
  }

  async function refreshComentarios() {
    setComentarios(await api('/comments'));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    refreshComentarios().catch((err) => setError(err.message));
  }, []);

  function openQr() {
    setQrOpen(true);
    QRCode.toDataURL(inviteUrl, { width: 320, margin: 2 }).then(setQrDataUrl);
  }

  // Un <a href={dataUrl} download> simple no dispara descarga real en
  // Safari/iOS (ignora `download` para URIs data:) — pasar por un Blob +
  // URL de objeto es lo que sí funciona de forma consistente. (Nota: NO
  // uses window.open(dataUrl) como respaldo — los navegadores modernos
  // bloquean navegar a un data: URI en una pestaña nueva por seguridad,
  // así que ese "plan B" nunca funciona.)
  async function handleDownloadQr() {
    if (!qrDataUrl) return;
    try {
      const res = await fetch(qrDataUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'puertaya-ipanema-qr.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      setError('No se pudo descargar el QR. Intenta de nuevo.');
    }
  }

  const enRecepcion = packages.filter((p) => p.estado === 'EN_RECEPCION').length;
  const programado = packages.filter((p) => p.estado === 'PROGRAMADO').length;
  const entregado = packages.filter((p) => p.estado === 'ENTREGADO' && esHoy(p.fechaEntrega)).length;
  const activeDeliveries = packages.filter((p) => p.estado === 'PROGRAMADO' || p.estado === 'EN_RECEPCION');

  // Recepción solo muestra lo que todavía no se ha recibido
  // (PREALERTADO). Apenas el operador hace el checkin pasa a
  // EN_RECEPCION y desaparece de aquí automáticamente — ya vive en
  // Reparto (activeDeliveries, arriba). Cada pestaña se despeja sola a
  // medida que el paquete avanza; el historial completo sigue intacto
  // en Bitácora sin importar el estado.
  const recepcionHoy = packages.filter((p) => p.estado === 'PREALERTADO');

  const logEntries = [...packages]
    .sort((a, b) => new Date(b.fechaIngreso) - new Date(a.fechaIngreso))
    .filter((p) => {
      const q = logSearch.trim().toLowerCase();
      const coincideTexto = !q
        || p.residente.nombre.toLowerCase().includes(q)
        || p.residente.apto.toLowerCase().includes(q)
        || p.residente.torre.toLowerCase().includes(q)
        || p.proveedor.toLowerCase().includes(q);

      const coincideEstado = logEstado === 'TODOS' || p.estado === logEstado;

      const fechaIngreso = new Date(p.fechaIngreso);
      const coincideDesde = !logDesde || fechaIngreso >= new Date(`${logDesde}T00:00:00`);
      const coincideHasta = !logHasta || fechaIngreso <= new Date(`${logHasta}T23:59:59`);

      return coincideTexto && coincideEstado && coincideDesde && coincideHasta;
    });

  const comentariosFiltrados = comentarios.filter((c) => {
    const q = comentariosSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.residente.nombre.toLowerCase().includes(q) ||
      c.residente.apto.toLowerCase().includes(q) ||
      c.residente.torre.toLowerCase().includes(q) ||
      c.mensaje.toLowerCase().includes(q)
    );
  });

  const recepcionPaginada = paginar(recepcionHoy, recepcionPage, PAGE_SIZE);
  const repartoPaginado = paginar(activeDeliveries, repartoPage, PAGE_SIZE);
  const logPaginado = paginar(logEntries, logPage, PAGE_SIZE);
  const comentariosPaginados = paginar(comentariosFiltrados, comentariosPage, PAGE_SIZE);

  function formatFecha(iso) {
    return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  async function handleExportCsv() {
    setError('');
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      await downloadFile('/packages/export', `puertaya-ipanema-paquetes-${hoy}.csv`);
    } catch (err) {
      setError(err.message);
    }
  }

  function openCheckin(pkg) {
    setCheckinPkg(pkg);
    setTier(pkg.categoriaPeso || 'ESTANDAR');
    setPhotos(parseFotos(pkg.fotoUrl));
    setCheckinError('');
    setCheckinBonos([]);
    if (BONOS_HABILITADOS) {
      api(`/bonos/residente/${pkg.residenteId}`).then(setCheckinBonos).catch(() => {});
    }
  }

  async function handlePhotoSelect(e) {
    const file = e.target.files[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo si se quita y se repite
    if (!file || photos.length >= MAX_FOTOS) return;
    setPhotoBusy(true);
    setCheckinError('');
    try {
      const compressed = await compressImage(file);
      setPhotos((prev) => [...prev, compressed]);
    } catch {
      setCheckinError('No se pudo procesar la foto. Intenta con otra.');
    } finally {
      setPhotoBusy(false);
    }
  }

  function removePhoto(index) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCheckinSubmit(e) {
    e.preventDefault();
    setCheckinError('');
    setCheckinSaving(true);
    try {
      await api(`/packages/${checkinPkg.id}/checkin`, {
        method: 'PATCH',
        body: { categoriaPeso: tier, fotos: photos },
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
    setDelivered(false);
  }

  function closePinModal() {
    setPinPkg(null);
    setDelivered(false);
  }

  async function handleConfirmDelivery() {
    setPinError('');
    try {
      await api(`/packages/${pinPkg.id}/confirm-delivery`, { method: 'POST', body: { pin: pinInput.trim() } });
      setDelivered(true);
      await refresh();
    } catch (err) {
      setPinError(err.message);
    }
  }

  async function openBonoModal(pkg) {
    setBonoPkg(pkg);
    setBonoForm({ categoriaPeso: 'ESTANDAR', cantidad: '', precioPagado: '' });
    setBonoError('');
    setBonos([]);
    try {
      setBonos(await api(`/bonos/residente/${pkg.residenteId}`));
    } catch (err) {
      setBonoError(err.message);
    }
  }

  async function handleCrearBono(e) {
    e.preventDefault();
    setBonoError('');
    setBonoSaving(true);
    try {
      await api('/bonos', {
        method: 'POST',
        body: {
          residenteId: bonoPkg.residenteId,
          categoriaPeso: bonoForm.categoriaPeso,
          cantidad: Number(bonoForm.cantidad),
          precioPagado: Number(bonoForm.precioPagado),
        },
      });
      setBonos(await api(`/bonos/residente/${bonoPkg.residenteId}`));
      setBonoForm({ categoriaPeso: 'ESTANDAR', cantidad: '', precioPagado: '' });
    } catch (err) {
      setBonoError(err.message);
    } finally {
      setBonoSaving(false);
    }
  }

  return (
    <div className="shell">
      <div className="stat-row">
        <div className="stat"><div className="n">{enRecepcion}</div><div className="l">En Recepción</div></div>
        <div className="stat"><div className="n">{programado}</div><div className="l">Para Reparto</div></div>
        <div className="stat"><div className="n">{entregado}</div><div className="l">Entregados Hoy</div></div>
      </div>

      <button className="btn btn-secondary" style={{ marginBottom: 14 }} onClick={openQr}>
        🔗 Invitar residentes (QR de registro)
      </button>

      <div className="tabs">
        <button className={`tab ${tab === 'reception' ? 'active' : ''}`} onClick={() => setTab('reception')}>📥 Recepción</button>
        <button className={`tab ${tab === 'delivery' ? 'active' : ''}`} onClick={() => setTab('delivery')}>🚪 Reparto</button>
        <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>🗂️ Bitácora</button>
        <button className={`tab ${tab === 'comentarios' ? 'active' : ''}`} onClick={() => setTab('comentarios')}>💬 Buzón</button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {tab === 'reception' && (
        recepcionHoy.length === 0 ? (
          <div className="empty">
            No hay paquetes pre-alertados por recibir. Lo que ya recibiste está en Reparto.
          </div>
        ) : (
          <>
          {recepcionPaginada.items.map((pkg) => {
            const info = cobroInfo(pkg);
            return (
            <div className="card" key={pkg.id} style={{ cursor: 'pointer' }} onClick={() => setDetailPkg(pkg)}>
              <div className="card-head">
                <div>
                  <div className="card-title">{pkg.residente.torre} - {pkg.residente.apto} · {pkg.residente.nombre}</div>
                  <div className="card-sub">{pkg.proveedor} · Guía: {pkg.guia}</div>
                  {pkg.pinProveedor && <div className="card-sub">🔑 PIN proveedor: <strong>{pkg.pinProveedor}</strong></div>}
                  {pkg.franjaHoraria && <div className="card-sub">🕒 Prefiere: {pkg.franjaHoraria}</div>}
                </div>
                <StatusBadge estado={pkg.estado} />
              </div>
              {info.gratis ? (
                <div className="gold-box"><span>{info.texto}</span></div>
              ) : (
                <div className="cod-box-muted"><span>💰 Ya afiliado — cobrar el servicio</span></div>
              )}
              {pkg.notas && (
                <div className="cod-box"><span>📝 {pkg.notas}</span></div>
              )}
              <div className="grid-2" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-primary" onClick={() => openCheckin(pkg)}>📷 Recibir y Fotografiar</button>
                <a className="btn btn-whatsapp"
                  href={`https://wa.me/57${pkg.residente.telefono}?text=${encodeURIComponent(`Hola ${pkg.residente.nombre}, te confirmamos que tu paquete de ${pkg.proveedor} ya está en recepción.`)}`}
                  target="_blank" rel="noreferrer">💬 WhatsApp</a>
              </div>
              {BONOS_HABILITADOS && (
                <button className="btn btn-secondary" style={{ marginTop: 8 }}
                  onClick={(e) => { e.stopPropagation(); openBonoModal(pkg); }}>🎟️ Bono</button>
              )}
              <p className="field-hint" style={{ marginTop: 8 }}>Toca la tarjeta para ver el detalle completo →</p>
            </div>
            );
          })}
          <Pagination page={recepcionPaginada.safePage} totalPages={recepcionPaginada.totalPages} onChange={setRecepcionPage} />
          </>
        )
      )}

      {tab === 'delivery' && (
        activeDeliveries.length === 0 ? (
          <div className="empty">No hay entregas pendientes para reparto en este momento.</div>
        ) : (
          <>
          {repartoPaginado.items.map((pkg) => {
            const info = cobroInfo(pkg);
            return (
            <div className="card" key={pkg.id} style={{ borderLeft: '4px solid var(--brand)', cursor: 'pointer' }}
              onClick={() => setDetailPkg(pkg)}>
              <div className="card-head">
                <div>
                  <div className="card-title">{pkg.residente.torre} - Apto {pkg.residente.apto}</div>
                  <div className="card-sub">
                    {pkg.residente.nombre} · {pkg.proveedor} ·{' '}
                    {info.gratis ? 'No se cobra' : `Tarifa: ${formatCOP(pkg.costoServicio)}`}
                  </div>
                </div>
                <span className="card-sub">{pkg.franjaHoraria || 'Inmediata'}</span>
              </div>
              {info.gratis ? (
                <div className="gold-box" style={{ marginTop: 10 }}><span>{info.texto}</span></div>
              ) : (
                <div className="cod-box-muted" style={{ marginTop: 10 }}><span>💰 Cobrar en puerta</span></div>
              )}
              {pkg.notas && (
                <div className="cod-box" style={{ marginTop: 10 }}><span>📝 {pkg.notas}</span></div>
              )}
              <button className="btn btn-primary" style={{ marginTop: 10 }}
                onClick={(e) => { e.stopPropagation(); openPinModal(pkg); }}>🔑 Validar PIN en Puerta</button>
              <p className="field-hint" style={{ marginTop: 8 }}>Toca la tarjeta para ver el detalle completo →</p>
            </div>
            );
          })}
          <Pagination page={repartoPaginado.safePage} totalPages={repartoPaginado.totalPages} onChange={setRepartoPage} />
          </>
        )
      )}

      {tab === 'log' && (
        <>
          <button className="btn btn-secondary" style={{ marginBottom: 12 }} onClick={handleExportCsv}>
            ⬇️ Exportar historial (CSV)
          </button>
          <div className="field">
            <input placeholder="Buscar por residente, torre, apto o proveedor…"
              value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />
          </div>
          <div className="field field-inline">
            <label>Desde</label>
            <input type="date" value={logDesde} onChange={(e) => setLogDesde(e.target.value)} />
          </div>
          <div className="field field-inline">
            <label>Hasta</label>
            <input type="date" value={logHasta} onChange={(e) => setLogHasta(e.target.value)} />
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={logEstado} onChange={(e) => setLogEstado(e.target.value)}>
              {ESTADOS_FILTRO.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          {(logSearch || logDesde || logHasta || logEstado !== 'TODOS') && (
            <button className="btn btn-secondary" style={{ marginBottom: 12 }}
              onClick={() => { setLogSearch(''); setLogDesde(''); setLogHasta(''); setLogEstado('TODOS'); }}>
              ✕ Limpiar filtros
            </button>
          )}

          {logEntries.length === 0 ? (
            <div className="empty">No hay paquetes que coincidan con la búsqueda.</div>
          ) : (
            <>
            {logPaginado.items.map((pkg) => (
              <div className="card" key={pkg.id} style={{ cursor: 'pointer' }} onClick={() => setDetailPkg(pkg)}>
                <div className="card-head">
                  <div>
                    <div className="card-title">{pkg.residente.torre} - Apto {pkg.residente.apto} · {pkg.residente.nombre}</div>
                    <div className="card-sub">{pkg.proveedor} · Guía: {pkg.guia}</div>
                    <div className="card-sub">Recibido: {formatFecha(pkg.fechaIngreso)}{pkg.fechaEntrega && ` · Entregado: ${formatFecha(pkg.fechaEntrega)}`}</div>
                  </div>
                  <StatusBadge estado={pkg.estado} />
                </div>
                <p className="field-hint" style={{ marginTop: 8 }}>Toca para ver el detalle{pkg.fotoUrl ? ' y las fotos' : ''} →</p>
              </div>
            ))}
            <Pagination page={logPaginado.safePage} totalPages={logPaginado.totalPages} onChange={setLogPage} />
            </>
          )}
        </>
      )}

      {tab === 'comentarios' && (
        <>
          <div className="field">
            <input placeholder="Buscar por residente, torre, apto o texto…"
              value={comentariosSearch} onChange={(e) => setComentariosSearch(e.target.value)} />
          </div>

          {comentariosFiltrados.length === 0 ? (
            <div className="empty">No hay comentarios que coincidan con la búsqueda.</div>
          ) : (
            <>
            {comentariosPaginados.items.map((c) => (
              <div className="card" key={c.id} style={{ cursor: 'pointer' }} onClick={() => setDetailComentario(c)}>
                <div className="card-head">
                  <div>
                    <div className="card-title">{c.residente.torre} - Apto {c.residente.apto} · {c.residente.nombre}</div>
                    <div className="card-sub">{formatFecha(c.createdAt)}</div>
                  </div>
                  <a className="btn btn-whatsapp" style={{ width: 'auto', padding: '6px 12px' }}
                    onClick={(e) => e.stopPropagation()}
                    href={`https://wa.me/57${c.residente.telefono}`} target="_blank" rel="noreferrer">💬</a>
                </div>
                <p style={{ fontSize: 13.5, margin: '10px 0 0' }}>{truncar(c.mensaje)}</p>
              </div>
            ))}
            <Pagination page={comentariosPaginados.safePage} totalPages={comentariosPaginados.totalPages} onChange={setComentariosPage} />
            </>
          )}
        </>
      )}

      {detailPkg && (
        <div className="modal-overlay" onClick={() => setDetailPkg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{detailPkg.residente.torre} - Apto {detailPkg.residente.apto}</h3>
              <button className="modal-close" onClick={() => setDetailPkg(null)}>✕</button>
            </div>

            <div className="card-head" style={{ marginBottom: 10 }}>
              <div>
                <div className="card-title">{detailPkg.residente.nombre}</div>
                <div className="card-sub">{detailPkg.residente.telefono}</div>
              </div>
              <StatusBadge estado={detailPkg.estado} />
            </div>

            <div className="grid-2" style={{ marginTop: 0 }}>
              <div className="tariff-box">
                <div className="l">Proveedor</div>
                <div className="v">{detailPkg.proveedor}</div>
              </div>
              <div className="tariff-box">
                <div className="l">Guía</div>
                <div className="v">{detailPkg.guia}</div>
              </div>
            </div>

            {detailPkg.pinProveedor && (
              <div className="cod-box-muted" style={{ marginTop: 10 }}>
                <span>🔑 PIN del proveedor:</span>
                <strong>{detailPkg.pinProveedor}</strong>
              </div>
            )}

            <div className="grid-2">
              <div className="tariff-box">
                <div className="l">Categoría</div>
                <div className="v">{detailPkg.categoriaPeso}</div>
              </div>
              <div className="tariff-box">
                <div className="l">Costo servicio</div>
                <div className="v">{formatCOP(detailPkg.costoServicio)}</div>
              </div>
            </div>

            {cobroInfo(detailPkg).gratis && (
              <div className="gold-box" style={{ marginTop: 10 }}>
                <span>{cobroInfo(detailPkg).texto}</span>
              </div>
            )}

            <div className="cod-box-muted" style={{ marginTop: 10 }}>
              <span>Recibido:</span>
              <strong>{formatFecha(detailPkg.fechaIngreso)}</strong>
            </div>
            {detailPkg.fechaEntrega && (
              <div className="cod-box-muted" style={{ marginTop: 10 }}>
                <span>Entregado:</span>
                <strong>{formatFecha(detailPkg.fechaEntrega)}</strong>
              </div>
            )}
            {detailPkg.franjaHoraria && (
              <div className="cod-box-muted" style={{ marginTop: 10 }}>
                <span>Franja / pago:</span>
                <strong>{detailPkg.franjaHoraria} · {detailPkg.metodoPagoServicio || '—'}</strong>
              </div>
            )}
            {detailPkg.esContraEntregaProveedor && (
              <div className="cod-box" style={{ marginTop: 10 }}>
                <span>Recaudo transportista:</span>
                <strong>{formatCOP(detailPkg.valorProductoProveedor)}</strong>
              </div>
            )}
            {detailPkg.valorDeclarado > 0 && (
              <div className="cod-box-muted" style={{ marginTop: 10 }}>
                <span>Valor declarado:</span>
                <strong>{formatCOP(detailPkg.valorDeclarado)}</strong>
              </div>
            )}
            {detailPkg.notas && (
              <div className="cod-box" style={{ marginTop: 10 }}><span>📝 {detailPkg.notas}</span></div>
            )}

            {parseFotos(detailPkg.fotoUrl).length > 0 ? (
              <div className="field" style={{ marginTop: 14 }}>
                <label>Fotos de evidencia</label>
                {parseFotos(detailPkg.fotoUrl).map((src, i) => (
                  <img key={i} src={src} alt={`Evidencia ${i + 1}`}
                    style={{ width: '100%', borderRadius: 12, marginTop: 8, border: '1px solid var(--line)' }} />
                ))}
              </div>
            ) : (
              <p className="field-hint" style={{ marginTop: 14 }}>Sin foto de evidencia todavía.</p>
            )}
          </div>
        </div>
      )}

      {detailComentario && (
        <div className="modal-overlay" onClick={() => setDetailComentario(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{detailComentario.residente.torre} - Apto {detailComentario.residente.apto}</h3>
              <button className="modal-close" onClick={() => setDetailComentario(null)}>✕</button>
            </div>
            <div className="card-head" style={{ marginBottom: 10 }}>
              <div>
                <div className="card-title">{detailComentario.residente.nombre}</div>
                <div className="card-sub">{detailComentario.residente.telefono}</div>
              </div>
            </div>
            <div className="cod-box-muted" style={{ marginBottom: 10 }}>
              <span>Enviado:</span>
              <strong>{formatFecha(detailComentario.createdAt)}</strong>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>{detailComentario.mensaje}</p>
            <a className="btn btn-whatsapp" style={{ marginTop: 14 }}
              href={`https://wa.me/57${detailComentario.residente.telefono}`} target="_blank" rel="noreferrer">
              💬 Responder por WhatsApp
            </a>
          </div>
        </div>
      )}

      {qrOpen && (
        <div className="modal-overlay" onClick={() => setQrOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Invitar residentes</h3>
              <button className="modal-close" onClick={() => setQrOpen(false)}>✕</button>
            </div>
            <p className="card-sub" style={{ marginBottom: 12 }}>
              Comparte este código en carteleras o zonas comunes de Conjunto Ipanema para que los residentes se registren.
            </p>
            {qrDataUrl && (
              <img src={qrDataUrl} alt="Código QR de registro" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line)' }} />
            )}
            <p className="field-hint" style={{ textAlign: 'center', margin: '10px 0 14px' }}>{inviteUrl}</p>
            {qrDataUrl && (
              <button className="btn btn-primary" type="button" onClick={handleDownloadQr}>
                ⬇️ Descargar QR
              </button>
            )}
          </div>
        </div>
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
                <label>Fotos de Custodia (hasta {MAX_FOTOS}, ej. distintos lados del paquete)</label>
                <div className="photo-grid">
                  {photos.map((src, i) => (
                    <div className="photo-slot" key={i}>
                      <img src={src} alt={`Foto ${i + 1}`} />
                      <button type="button" className="photo-remove" onClick={() => removePhoto(i)} aria-label="Quitar foto">✕</button>
                    </div>
                  ))}
                  {photos.length < MAX_FOTOS && (
                    <label htmlFor="pkg-photo-input" className="photo-picker photo-slot photo-slot-empty">
                      <span className="photo-picker-empty">📷 {photos.length === 0 ? 'Tomar foto' : 'Agregar'}</span>
                    </label>
                  )}
                </div>
                <input id="pkg-photo-input" type="file" accept="image/*" capture="environment"
                  onChange={handlePhotoSelect} className="sr-only" disabled={photoBusy || photos.length >= MAX_FOTOS} />
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
              {checkinPkg.esPrimeraEntrega ? (
                <div className="gold-box" style={{ marginBottom: 12 }}>
                  <span>🎁 Primera entrega — no se cobra, sin importar la categoría</span>
                </div>
              ) : (() => {
                const bonoTier = checkinBonos.find((b) => b.categoriaPeso === tier && b.cantidadUsada < b.cantidadTotal);
                return bonoTier ? (
                  <div className="gold-box" style={{ marginBottom: 12 }}>
                    <span>🎟️ Tiene bono activo — quedan {bonoTier.cantidadTotal - bonoTier.cantidadUsada} de {bonoTier.cantidadTotal}, este no se cobra</span>
                  </div>
                ) : (
                  <div className="tariff-box" style={{ marginBottom: 12 }}>
                    <div className="l">Tarifa calculada</div>
                    <div className="v">{formatCOP(TIERS.find((t) => t.value === tier)?.costo)} COP</div>
                  </div>
                );
              })()}

              {checkinError && <p className="error-text" style={{ marginBottom: 10 }}>{checkinError}</p>}

              <button className="btn btn-primary" type="submit" disabled={photoBusy || checkinSaving}>
                {checkinSaving ? 'Guardando…' : '✔ Confirmar Recepción'}
              </button>
            </form>
          </div>
        </div>
      )}

      {pinPkg && (
        <div className="modal-overlay" onClick={closePinModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{delivered ? '✅ Entrega Confirmada' : 'Validar Entrega en Puerta'}</h3>
              <button className="modal-close" onClick={closePinModal}>✕</button>
            </div>

            {!delivered ? (
              <>
                <p className="card-sub">Pide al residente el PIN de 4 dígitos que aparece en su pantalla:</p>
                <input className="pin-input" maxLength={4} placeholder="••••" value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))} />
                {pinError && <p className="error-text" style={{ textAlign: 'center' }}>{pinError}</p>}

                {cobroInfo(pinPkg).gratis ? (
                  <div className="gold-box" style={{ margin: '14px 0' }}>
                    <span>{cobroInfo(pinPkg).texto}</span>
                    <strong>NO COBRAR</strong>
                  </div>
                ) : (
                  <div className="tariff-box" style={{ margin: '14px 0' }}>
                    <div className="l">Cobro por entrega</div>
                    <div className="v">{formatCOP(pinPkg.costoServicio)}</div>
                  </div>
                )}
                {pinPkg.esContraEntregaProveedor && (
                  <div className="cod-box" style={{ marginBottom: 14 }}>
                    <span>Recaudo transportista:</span>
                    <strong>{formatCOP(pinPkg.valorProductoProveedor)}</strong>
                  </div>
                )}
                {pinPkg.notas && (
                  <div className="cod-box" style={{ marginBottom: 14 }}><span>📝 {pinPkg.notas}</span></div>
                )}

                <button className="btn btn-primary" onClick={handleConfirmDelivery}>🛡 Confirmar y Finalizar Entrega</button>
              </>
            ) : (
              <>
                <p className="card-sub">
                  El paquete de {pinPkg.proveedor} para {pinPkg.residente.nombre} quedó marcado como entregado.
                  Si quieres, envíale un agradecimiento por WhatsApp:
                </p>
                <a className="btn btn-whatsapp" style={{ marginTop: 14 }}
                  href={`https://wa.me/57${pinPkg.residente.telefono}?text=${encodeURIComponent(`¡Hola ${pinPkg.residente.nombre}! Tu paquete de ${pinPkg.proveedor} ya fue entregado. ¡Gracias por confiar en Puertaya Ipanema! 🙌`)}`}
                  target="_blank" rel="noreferrer">💬 Enviar agradecimiento por WhatsApp</a>
                <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={closePinModal}>Cerrar</button>
              </>
            )}
          </div>
        </div>
      )}

      {bonoPkg && (
        <div className="modal-overlay" onClick={() => setBonoPkg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Bonos — {bonoPkg.residente.nombre}</h3>
              <button className="modal-close" onClick={() => setBonoPkg(null)}>✕</button>
            </div>

            {bonos.length === 0 ? (
              <p className="field-hint">Todavía no tiene bonos registrados.</p>
            ) : (
              bonos.map((b) => {
                const quedan = b.cantidadTotal - b.cantidadUsada;
                const tierLabel = TIERS.find((t) => t.value === b.categoriaPeso)?.label || b.categoriaPeso;
                return (
                  <div className={quedan > 0 ? 'gold-box' : 'cod-box-muted'} key={b.id} style={{ marginBottom: 8 }}>
                    <span>{tierLabel} · pagó {formatCOP(b.precioPagado)}</span>
                    <strong>{quedan > 0 ? `Quedan ${quedan} de ${b.cantidadTotal}` : 'Agotado'}</strong>
                  </div>
                );
              })
            )}

            <form onSubmit={handleCrearBono} style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <p className="card-sub" style={{ marginBottom: 10 }}>Registrar bono nuevo (pago ya recibido)</p>
              <div className="field">
                <label>Categoría de peso que cubre</label>
                <select value={bonoForm.categoriaPeso}
                  onChange={(e) => setBonoForm({ ...bonoForm, categoriaPeso: e.target.value })}>
                  {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label} - {formatCOP(t.costo)} c/u</option>)}
                </select>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Cantidad de entregas</label>
                  <input type="number" min="1" required placeholder="Ej. 5" value={bonoForm.cantidad}
                    onChange={(e) => setBonoForm({ ...bonoForm, cantidad: e.target.value })} />
                </div>
                <div className="field">
                  <label>Precio total pagado (COP)</label>
                  <input type="number" min="0" required placeholder="Ej. 18000" value={bonoForm.precioPagado}
                    onChange={(e) => setBonoForm({ ...bonoForm, precioPagado: e.target.value })} />
                </div>
              </div>
              {bonoError && <p className="error-text" style={{ marginBottom: 10 }}>{bonoError}</p>}
              <button className="btn btn-primary" type="submit" disabled={bonoSaving}>
                {bonoSaving ? 'Guardando…' : '➕ Registrar bono'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
