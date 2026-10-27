import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Toast } from '../../design';
import useMisPaquetes from '../../hooks/residente/useMisPaquetes.js';
import EnlaceInvalido from './EnlaceInvalido.jsx';
import MasSheet from './MasSheet.jsx';
import Pantalla, { Marca } from './Pantalla.jsx';
import TarjetaPaquete from './TarjetaPaquete.jsx';

function resumen(listos, avisados) {
  if (listos > 0) return <>Tienes <b>{listos} {listos === 1 ? 'paquete' : 'paquetes'}</b> en portería.</>;
  if (avisados > 0) return <>Avisaste <b>{avisados} {avisados === 1 ? 'paquete' : 'paquetes'}</b>. Te escribimos cuando llegue.</>;
  return 'No tienes paquetes en portería por ahora.';
}

export default function MisPaquetes() {
  const { modo, datos, estado, error, recargar } = useMisPaquetes();
  const [masAbierto, setMasAbierto] = useState(false);

  if (estado === 'vencido') return <EnlaceInvalido />;
  const paquetes = datos?.paquetes ?? [];
  const listos = paquetes.filter((p) => p.pin);
  const porLlegar = paquetes.filter((p) => !p.pin);
  const hayPorProgramar = listos.some((p) => p.estado === 'EN_RECEPCION');
  const nombre = datos?.residente?.nombre?.split(' ')[0];

  return (
    <Pantalla>
      <Marca>
        {modo === 'normal' && <Link to="/paquetes/avisar" className="res-chip-link">Avisar</Link>}
        <button type="button" className="res-chip-link" onClick={() => setMasAbierto(true)}>Más</button>
      </Marca>
      <div className="res-tit" aria-busy={estado === 'cargando'}>
        <h1>{nombre ? `Hola, ${nombre}` : 'Hola'}</h1>
        <p>{estado === 'cargando' ? 'Buscando tus paquetes…' : resumen(listos.length, porLlegar.length)}</p>
      </div>
      {estado === 'error' && (
        <div className="res-aviso">
          <Toast tipo="error">{error || 'No pudimos cargar tus paquetes.'} Revisa tu conexión y toca Reintentar.</Toast>
          <Button variante="secundario" onClick={recargar} style={{ marginTop: 8 }}>Reintentar</Button>
        </div>
      )}
      <div className="res-lista">
        {[...listos, ...porLlegar].map((p, i) => <TarjetaPaquete key={p.id} p={p} modo={modo} conAyuda={i === 0} />)}
      </div>
      {modo === 'enlace' && (
        <p className="res-nota">
          Para avisar un paquete que viene en camino, <Link to="/acceso" className="res-link--tinta" style={{ display: 'inline', fontWeight: 700 }}>entra con tu correo</Link>.
        </p>
      )}
      <div className="res__relleno" />
      <div className="res__acciones">
        {listos.length > 0 && (
          <Button as={Link} to="/paquetes/entrega">{hayPorProgramar ? 'Pedir entrega' : 'Cambiar franja'}</Button>
        )}
        {listos.length === 0 && estado === 'listo' && modo === 'normal' && (
          <Button as={Link} to="/paquetes/avisar">Avisar paquete</Button>
        )}
        {modo === 'normal' && <Link to="/paquetes/historial" className="res-link">Ver historial</Link>}
      </div>
      <MasSheet open={masAbierto} onClose={() => setMasAbierto(false)} modo={modo} />
    </Pantalla>
  );
}
