import { useState } from 'react';
import { Button, Sheet, ThemeToggle, Toast } from '../../design';
import { downloadFile } from '../../services/api.js';
import { logout } from '../../services/auth.js';
import { useCola } from '../../offline/colaRecepciones.js';
import BuzonVista from './BuzonVista.jsx';
import BitacoraVista from './BitacoraVista.jsx';
import InvitarVista from './InvitarVista.jsx';

const TITULOS = { menu: 'Más opciones', buzon: 'Buzón', bitacora: 'Bitácora', invitar: 'Invitar residentes', salir: 'Registros sin enviar' };

/** Opciones secundarias del operador: tema, exportar CSV, buzón, QR de invitación y salir. */
export default function MasSheet({ open, onClose, config }) {
  const [vista, setVista] = useState('menu');
  const [error, setError] = useState('');
  const { pendientes } = useCola();
  const cerrar = () => { setVista('menu'); setError(''); onClose(); };
  const volver = () => setVista('menu');

  async function exportar() {
    setError('');
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      await downloadFile('/packages/export', `puertaya-${config?.slug || 'conjunto'}-paquetes-${hoy}.csv`);
    } catch (e) {
      setError(e.message);
    }
  }

  // Con registros sin enviar, pide confirmar: se quedan guardados y salen al volver a entrar.
  function pedirSalir() {
    if (pendientes.length > 0) setVista('salir'); else salir();
  }

  function salir() {
    logout();
    window.location.href = '/login';
  }

  return (
    <Sheet open={open} onClose={cerrar} title={TITULOS[vista]}>
      {vista === 'buzon' && <BuzonVista config={config} onVolver={volver} />}
      {vista === 'bitacora' && <BitacoraVista onVolver={volver} />}
      {vista === 'invitar' && <InvitarVista config={config} onVolver={volver} />}
      {vista === 'salir' && (
        <div className="op-hoja">
          <p>
            Tienes {pendientes.length} {pendientes.length === 1 ? 'registro' : 'registros'} sin enviar.
            Si sales, se enviarán cuando vuelvas a entrar.
          </p>
          <Button onClick={volver}>Quedarme</Button>
          <Button variante="secundario" onClick={salir}>Salir igual</Button>
        </div>
      )}
      {vista === 'menu' && (
        <div className="op-hoja">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Modo día o noche</span>
            <ThemeToggle />
          </div>
          {error && <Toast tipo="error">{error}</Toast>}
          <Button variante="secundario" onClick={exportar}>Exportar CSV</Button>
          <Button variante="secundario" onClick={() => setVista('bitacora')}>Ver bitácora</Button>
          <Button variante="secundario" onClick={() => setVista('buzon')}>Abrir buzón</Button>
          <Button variante="secundario" onClick={() => setVista('invitar')}>Invitar residentes</Button>
          <Button variante="secundario" onClick={pedirSalir}>Salir</Button>
        </div>
      )}
    </Sheet>
  );
}
