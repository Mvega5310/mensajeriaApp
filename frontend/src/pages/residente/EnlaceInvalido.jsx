import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../design';
import { MensajeCentral } from './Pantalla.jsx';

/** Enlace de WhatsApp vencido, alterado o viejo: qué pasó y qué hacer. */
export default function EnlaceInvalido() {
  // Un enlace viejo (/p/<token>) no debe quedarse en la barra de direcciones.
  useEffect(() => {
    if (/^\/p\/./.test(window.location.pathname)) window.history.replaceState(null, '', '/p');
  }, []);
  return (
    <MensajeCentral
      titulo="Este enlace ya no sirve"
      texto="Abre el más reciente que te enviamos o entra con tu correo."
    >
      <Button as={Link} to="/acceso">Entrar con correo</Button>
    </MensajeCentral>
  );
}
