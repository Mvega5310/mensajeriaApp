import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button, Toast } from '../../design';

/** QR de registro del conjunto (para carteleras). El código sale de GET /conjunto/config. */
export default function InvitarVista({ config, onVolver }) {
  const [qr, setQr] = useState(null);
  const [error, setError] = useState('');
  const codigo = config?.codigoInvitacion;
  const url = codigo ? `${window.location.origin}/registro?c=${encodeURIComponent(codigo)}` : null;

  useEffect(() => {
    if (url) QRCode.toDataURL(url, { width: 320, margin: 2 }).then(setQr).catch(() => setError('No pudimos crear el QR. Intenta de nuevo.'));
  }, [url]);

  // Un <a download> con data: no funciona en Safari/iOS: se pasa por Blob.
  async function descargar() {
    try {
      const blob = await (await fetch(qr)).blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = 'puertaya-qr-registro.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
    } catch {
      setError('No pudimos descargar el QR. Intenta de nuevo.');
    }
  }

  return (
    <div className="op-hoja">
      <p className="op-muted">Compártelo en carteleras o zonas comunes{config?.nombre ? ` de ${config.nombre}` : ''} para que los residentes se registren.</p>
      {qr && <img className="op-qr" src={qr} alt="Código QR de registro" />}
      {url && <p className="op-muted mono" style={{ overflowWrap: 'anywhere' }}>{url}</p>}
      {error && <Toast tipo="error">{error}</Toast>}
      {qr && <Button icono="check" variante="secundario" onClick={descargar}>Descargar QR</Button>}
      <Button variante="secundario" onClick={onVolver}>Volver</Button>
    </div>
  );
}
