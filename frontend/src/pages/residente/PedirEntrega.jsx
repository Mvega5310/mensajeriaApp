import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button, Icon, Toast } from '../../design';
import useMisPaquetes from '../../hooks/residente/useMisPaquetes.js';
import useProgramarEntrega from '../../hooks/residente/useProgramarEntrega.js';
import { etiquetaMetodoPago } from '../../utils/metodosPago.js';
import { formatCOP } from '../../utils/format.js';
import EnlaceInvalido from './EnlaceInvalido.jsx';
import Pantalla from './Pantalla.jsx';

function Chips({ etiqueta, valores, valor, onPick, texto = (v) => v, mono = false }) {
  return (
    <div className="res-seccion">
      <p className="res-sec">{etiqueta}</p>
      <div role="radiogroup" aria-label={etiqueta} className={valores.some((v) => texto(v).length > 12) ? 'res-chips--1' : 'res-chips--2'}>
        {valores.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={valor === v} className="res-chip" onClick={() => onPick(v)}>
            <span className={mono ? 'mono' : undefined}>{texto(v)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PedirEntrega() {
  const { modo, datos, estado, recargar } = useMisPaquetes();
  const { programar, enviando } = useProgramarEntrega(modo);
  const navigate = useNavigate();
  const [franja, setFranja] = useState(null);
  const [pago, setPago] = useState(null);
  const [fallo, setFallo] = useState('');

  if (estado === 'vencido') return <EnlaceInvalido />;
  if (estado === 'listo' && !datos.paquetes.some((p) => p.pin)) return <Navigate to="/paquetes" replace />;

  const listos = (datos?.paquetes ?? []).filter((p) => p.pin);
  const franjas = datos?.franjasEntrega ?? [];
  const metodos = datos?.metodosPago ?? [];
  const franjaElegida = franja ?? listos.find((p) => p.franjaHoraria && franjas.includes(p.franjaHoraria))?.franjaHoraria ?? null;
  const pagoElegido = pago ?? listos.find((p) => metodos.includes(p.metodoPagoServicio))?.metodoPagoServicio ?? metodos[0] ?? null;
  const total = listos.filter((p) => p.motivoCobro !== 'CORTESIA' && p.motivoCobro !== 'BONO').reduce((s, p) => s + (p.costo || 0), 0);

  async function confirmar() {
    setFallo('');
    const { fallidos, mensaje } = await programar(listos.map((p) => p.id), franjaElegida, pagoElegido);
    if (fallidos.length === 0) { navigate('/paquetes', { replace: true }); return; }
    await recargar();
    setFallo(`No pudimos programar ${fallidos.length} de ${listos.length} paquetes. ${mensaje} Toca Confirmar para intentarlo otra vez.`);
  }

  async function recoger() {
    setFallo('');
    const { fallidos, mensaje } = await programar(listos.map((p) => p.id), null, null, 'RECOGER');
    if (fallidos.length === 0) { navigate('/paquetes', { replace: true }); return; }
    await recargar();
    setFallo(`No pudimos registrar ${fallidos.length} de ${listos.length} paquetes. ${mensaje} Intenta otra vez.`);
  }

  return (
    <Pantalla>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px var(--sp-1) 0' }}>
        <Link to="/paquetes" aria-label="Volver" className="ds-topbar__volver"><Icon nombre="volver" size={24} trazo={2.5} /></Link>
      </div>
      <div className="res-tit" style={{ paddingTop: 8 }}>
        <h1>¿Cuándo te lo llevamos?</h1>
        <p>
          {listos.length} {listos.length === 1 ? 'paquete' : 'paquetes'}
          {datos?.residente?.etiquetaApto && <> a <b className="mono">{datos.residente.etiquetaApto}</b></>}
          {' · '}total <b className="mono">{total > 0 ? formatCOP(total) : 'Gratis'}</b>
        </p>
      </div>
      <div>
        <Chips etiqueta="Franja de entrega" valores={franjas} valor={franjaElegida} onPick={setFranja} mono />
        {metodos.length > 0 && (
          <Chips etiqueta="Forma de pago" valores={metodos} valor={pagoElegido} onPick={setPago} texto={etiquetaMetodoPago} />
        )}
      </div>
      {fallo && <div className="res-aviso"><Toast tipo="error">{fallo}</Toast></div>}
      <div className="res__relleno" />
      <div className="res__acciones">
        <Button disabled={!franjaElegida || enviando || listos.length === 0} aria-busy={enviando} onClick={confirmar}>
          {franjaElegida ? `Confirmar ${franjaElegida}` : 'Elige una franja'}
        </Button>
        <Button variante="secundario" disabled={enviando || listos.length === 0} onClick={recoger}>Prefiero recogerlo en portería</Button>
      </div>
    </Pantalla>
  );
}
