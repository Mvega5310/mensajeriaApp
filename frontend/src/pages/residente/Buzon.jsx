import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon, Toast } from '../../design';
import { api } from '../../services/api.js';
import Pantalla from './Pantalla.jsx';

const fecha = (iso) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Buzón del residente: comentarios al operador (POST /comments) y los que ya envió (GET /comments/mine). */
export default function Buzon() {
  const [mensaje, setMensaje] = useState('');
  const [enviados, setEnviados] = useState([]);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = () => api('/comments/mine').then(setEnviados).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      await api('/comments', { method: 'POST', body: { mensaje } });
      setMensaje('');
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pantalla>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px var(--sp-1) 0' }}>
        <Link to="/paquetes" aria-label="Volver" className="ds-topbar__volver"><Icon nombre="volver" size={24} trazo={2.5} /></Link>
      </div>
      <div className="res-tit" style={{ paddingTop: 8 }}>
        <h1>Escribir al operador</h1>
        <p>Una inquietud o un comentario. Te responde por WhatsApp.</p>
      </div>
      <form onSubmit={enviar} style={{ display: 'contents' }}>
        <div className="res-form">
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="buzon-mensaje">Tu mensaje</label>
            <textarea id="buzon-mensaje" className="res-area" rows={4} required maxLength={1000} value={mensaje}
              onChange={(e) => setMensaje(e.target.value)} />
          </div>
          {error && <Toast tipo="error">{error}</Toast>}
          <Button type="submit" disabled={enviando || !mensaje.trim()}>Enviar mensaje</Button>
        </div>
      </form>
      {enviados.length > 0 && (
        <div className="res-seccion">
          <p className="res-sec">Enviados</p>
          {enviados.map((c) => (
            <div key={c.id} className="res-hist" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <span>{c.mensaje}</span>
              <span className="res-hist__fecha">{fecha(c.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="res__relleno" />
    </Pantalla>
  );
}
