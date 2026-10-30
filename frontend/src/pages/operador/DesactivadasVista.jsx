import { useCallback, useEffect, useState } from 'react';
import { Button, Field, Toast } from '../../design';
import { api } from '../../services/api.js';

const POR_PAGINA = 50;

const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '');
const fin = (f) => (f.telefonoFin ? ` (•••• ${f.telefonoFin})` : '');

/** "Direcciones desactivadas": las del conjunto, con "Reactivar" (con confirmación) para
 *  deshacer una desactivación hecha por error. Sin correo ni teléfono completo. */
export default function DesactivadasVista({ onVolver }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [confirmando, setConfirmando] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [errorFila, setErrorFila] = useState('');
  const [hayMas, setHayMas] = useState(false);
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback((buscar, pag) => {
    const qs = new URLSearchParams({ limite: POR_PAGINA, pagina: pag });
    if (buscar.trim()) qs.set('q', buscar.trim());
    return api(`/domicilios/desactivados?${qs}`);
  }, []);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setPagina(1);
    const t = setTimeout(() => {
      cargar(q, 1)
        .then((r) => vigente && (setItems(r), setHayMas(r.length === POR_PAGINA), setError('')))
        .catch((e) => vigente && setError(e.message))
        .finally(() => vigente && setCargando(false));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [q, cargar]);

  async function verMas() {
    try {
      const r = await cargar(q, pagina + 1);
      setItems((prev) => [...prev, ...r.filter((x) => !prev.some((p) => p.domicilioId === x.domicilioId))]);
      setHayMas(r.length === POR_PAGINA);
      setPagina(pagina + 1);
    } catch (e) {
      setError(e.message);
    }
  }

  async function reactivar(f) {
    setEnviando(true);
    setErrorFila('');
    try {
      await api(`/domicilios/${f.domicilioId}/reactivar`, { method: 'PATCH' });
      setItems((prev) => prev.filter((x) => x.domicilioId !== f.domicilioId));
      setConfirmando(null);
      setAviso('Dirección reactivada');
    } catch (e) {
      setErrorFila(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="op-hoja">
      <Field label="Buscar" placeholder="Apartamento o nombre" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {aviso && <div role="status"><Toast tipo="info">{aviso}</Toast></div>}
      {error && <Toast tipo="error">{error}</Toast>}
      <p className="op-muted" aria-live="polite">
        {cargando ? 'Cargando…' : `${items.length} ${items.length === 1 ? 'dirección desactivada' : 'direcciones desactivadas'}`}
      </p>
      {!cargando && !error && items.length === 0 && (
        <p className="op-vacio">No hay direcciones desactivadas.</p>
      )}
      {items.map((f) => (
        <div className="op-fila op-fila--lectura" key={f.domicilioId}>
          <b>{[f.etiqueta, f.nombre].filter(Boolean).join(' · ')}</b>
          <span className="op-muted">
            {f.telefonoFin ? `•••• ${f.telefonoFin}` : 'Sin teléfono'}
            {f.desactivadoEn ? ` · desactivada el ${dia(f.desactivadoEn)}` : ''}
          </span>
          {confirmando === f.domicilioId ? (
            <>
              <b>¿Reactivar la dirección de {f.nombre}{fin(f)}?</b>
              {errorFila && <Toast tipo="error">{errorFila}</Toast>}
              <Button onClick={() => reactivar(f)} disabled={enviando}>{enviando ? 'Reactivando' : 'Sí, reactivar'}</Button>
              <Button variante="secundario" onClick={() => { setConfirmando(null); setErrorFila(''); }} disabled={enviando}>Cancelar</Button>
            </>
          ) : (
            <Button variante="secundario" onClick={() => { setConfirmando(f.domicilioId); setErrorFila(''); setAviso(''); }}>
              Reactivar
            </Button>
          )}
        </div>
      ))}
      {hayMas && <Button variante="secundario" onClick={verMas}>Ver más</Button>}
      <Button variante="secundario" onClick={onVolver}>Volver</Button>
    </div>
  );
}
