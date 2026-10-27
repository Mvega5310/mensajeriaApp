import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, ThemeToggle } from '../../design';
import { usePedirEnlace } from '../../hooks/residente/useAcceso.js';
import Pantalla from './Pantalla.jsx';

/** Formulario "Entra con tu correo" (Res-Acceso). `aviso` explica por qué se pide otro enlace. */
export default function Acceso({ aviso }) {
  const [email, setEmail] = useState('');
  const { pedir, enviando, mensaje, error, reiniciar } = usePedirEnlace();
  const enviado = !!mensaje;

  function enviar(e) {
    e.preventDefault();
    pedir(email.trim());
  }

  return (
    <Pantalla>
      <div className="res-centro">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="res-logo">Puerta<b>yá</b></span>
          <ThemeToggle />
        </div>
        <p>Tus paquetes del conjunto, sin filas ni llamadas.</p>
      </div>
      {enviado ? (
        <div className="res-panel" role="status">
          <h1>Revisa tu correo</h1>
          <p>{mensaje}</p>
          <p>Ábrelo en este teléfono para entrar. Vence en 15 minutos.</p>
          <button type="button" className="res-link res-link--tinta" onClick={reiniciar}>Usar otro correo</button>
        </div>
      ) : (
        <form id="acceso" onSubmit={enviar} className="res-form" style={{ paddingTop: 48 }}>
          {aviso && <p className="res-nota" role="alert" style={{ margin: 0, color: 'var(--ink)', fontWeight: 700 }}>{aviso}</p>}
          <h1 className="ds-titulo" style={{ margin: 0, fontSize: 26 }}>Entra con tu correo</h1>
          <Field label="Correo" type="email" required autoComplete="email" value={email} error={error}
            onChange={(e) => setEmail(e.target.value)} ayuda="Sin contraseña: te mandamos un enlace para entrar." />
        </form>
      )}
      <div className="res__relleno" />
      <div className="res__acciones">
        {enviado ? null : (
          <>
            <Button type="submit" form="acceso" disabled={enviando || !email.trim()}>Enviarme el enlace</Button>
            <Link to="/login" className="res-link">Entrar con contraseña</Link>
          </>
        )}
      </div>
    </Pantalla>
  );
}
