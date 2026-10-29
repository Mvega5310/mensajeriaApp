import { useState } from 'react';
import { Icon, Sheet } from '../../design';
import useFotoPaquete from '../../hooks/residente/useFotoPaquete.js';
import { formatCOP } from '../../utils/format.js';
import { NOMBRES_CORTOS, quienTrajo } from '../../utils/tiers.js';

export const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });

function estadoDe(p) {
  if (p.estado === 'PREALERTADO') return { icono: 'reloj', texto: 'Avisado. Te escribimos cuando llegue', espera: true };
  if (p.estado === 'PROGRAMADO') return { icono: 'reloj', texto: `Programado ${p.franjaHoraria ?? ''}`.trim() };
  return { icono: 'casa', texto: p.recibidoEn ? `En portería desde las ${hora(p.recibidoEn)}` : 'En portería' };
}

/** Tarjeta de un paquete (Res-MisPaquetes): estado, foto si hay, monto y PIN en grande. */
export default function TarjetaPaquete({ p, modo, conAyuda = true, conConjunto = false }) {
  const [verFotos, setVerFotos] = useState(false);
  // Funciona con la sesión del enlace y con la normal (el backend valida que sea tu paquete).
  const fotos = useFotoPaquete(p.id, modo, p.estado !== 'PREALERTADO');
  const e = estadoDe(p);
  const gratis = p.motivoCobro === 'CORTESIA' || p.motivoCobro === 'BONO';
  const categoria = NOMBRES_CORTOS[p.categoriaPeso]?.nombre;
  const miniatura = fotos[0]
    ? <img src={fotos[0]} alt="Foto del paquete" />
    : <Icon nombre="recibir" size={32} />;

  return (
    <article className="res-card">
      <div className="res-card__cab">
        {fotos[0] ? (
          <button type="button" className="res-card__foto" aria-label="Ver fotos del paquete" onClick={() => setVerFotos(true)}>{miniatura}</button>
        ) : (
          <div className="res-card__foto" aria-hidden="true">{miniatura}</div>
        )}
        <div className="res-card__txt">
          {conConjunto && p.conjunto?.nombre && <span className="res-linea"><b>{p.conjunto.nombre}</b></span>}
          <span className={`res-estado${e.espera ? ' res-estado--espera' : ''}`}><Icon nombre={e.icono} size={16} trazo={3} />{e.texto}</span>
          {p.estado !== 'PREALERTADO' && (
            <span className="res-linea">
              {quienTrajo(p)}{categoria ? ` · ${categoria}` : ''} · {gratis
                ? <b className="res-gratis">Gratis</b>
                : <b>{formatCOP(p.costo)}</b>}
            </span>
          )}
        </div>
      </div>
      {p.pin && (
        <div className="res-pin">
          <span className="res-pin__rotulo">Tu PIN de entrega</span>
          <span className="res-pin__valor" aria-label={`PIN ${p.pin.split('').join(' ')}`}>{p.pin}</span>
          {conAyuda && <span className="res-pin__ayuda">Díselo al operador cuando te entregue. No lo compartas por chat.</span>}
        </div>
      )}
      <Sheet open={verFotos} onClose={() => setVerFotos(false)} title="Fotos del paquete">
        <div className="res-fotos">{fotos.map((u, i) => <img key={u} src={u} alt={`Foto ${i + 1} del paquete`} />)}</div>
      </Sheet>
    </article>
  );
}
