import { useEffect, useState } from 'react';
import { Button, Toast } from '../../design';
import { api } from '../../services/api.js';
import { enlaceWhatsapp } from '../../utils/whatsapp.js';
import { etiquetaApto } from '../../utils/apto.js';

/** Buzón: comentarios de los residentes, con respuesta por WhatsApp. */
export default function BuzonVista({ config, onVolver }) {
  const [comentarios, setComentarios] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/comments').then(setComentarios).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="op-hoja">
      {error && <Toast tipo="error">{error}</Toast>}
      {comentarios?.length === 0 && <p className="op-muted">No hay comentarios.</p>}
      {comentarios?.map((c) => {
        const wa = enlaceWhatsapp(config?.prefijoPais, c.residente.telefono);
        return (
          <div className="op-fila op-fila--lectura" key={c.id}>
            <b>{etiquetaApto(c.residente.torre, c.residente.apto)} · {c.residente.nombre}</b>
            <span className="op-muted">{new Date(c.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</span>
            <span style={{ overflowWrap: 'anywhere' }}>{c.mensaje}</span>
            {wa && <Button variante="whatsapp" as="a" icono="whatsapp" href={wa} target="_blank" rel="noreferrer">Responder</Button>}
          </div>
        );
      })}
      <Button variante="secundario" onClick={onVolver}>Volver</Button>
    </div>
  );
}
