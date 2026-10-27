import { useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Button, Field, Icon, Sheet, Toast, TopBar } from '../../design';
import useConfig from '../../hooks/operador/useConfig.js';
import useGuardarPaquete from '../../hooks/operador/useGuardarPaquete.js';
import { formatCOP } from '../../utils/format.js';
import { NOMBRES_CORTOS as TILES, TIERS } from '../../utils/tiers.js';
import Pantalla from './Pantalla.jsx';

export default function RecibirPeso() {
  const { residenteId } = useParams();
  const { state } = useLocation();
  const config = useConfig();
  const sinDueno = residenteId === 'sin-dueno';
  const residente = state?.residente;
  const destino = sinDueno
    ? { residenteId: null, etiquetaNombre: state?.etiquetaNombre }
    : { residenteId, residente };
  const g = useGuardarPaquete(destino, config?.maxFotos || 0);
  const [guiaAbierta, setGuiaAbierta] = useState(false);
  const inputFoto = useRef(null);

  // Sin los datos del paso anterior (recarga de la página) se vuelve a buscar.
  if (sinDueno ? !state?.etiquetaNombre : !residente) return <Navigate to="/op/recibir" replace />;

  const maxFotos = config?.maxFotos || 0;
  const tarifas = config?.tarifas;
  const titulo = sinDueno ? 'Sin dueño' : residente.etiqueta;
  const subtitulo = sinDueno ? state.etiquetaNombre : residente.nombre;

  return (
    <Pantalla>
      <TopBar title={titulo} subtitle={subtitulo} mono={!sinDueno} backHref="/op/recibir" backAs={Link} />
      <div className="op-tit">
        <h1 style={{ fontSize: 26 }}>¿Qué tamaño tiene?</h1>
      </div>
      <div className="op-tiles" role="group" aria-label="Tamaño del paquete">
        {TIERS.map((t) => (
          <button
            key={t.value}
            type="button"
            className="op-tile"
            aria-pressed={g.categoria === t.value}
            onClick={() => g.setCategoria(t.value)}
          >
            <span className="op-tile__nombre">{TILES[t.value].nombre}</span>
            <span className="op-tile__ayuda">{TILES[t.value].ayuda}</span>
            <span className="op-tile__precio">{tarifas ? formatCOP(tarifas[t.value]) : ' '}</span>
          </button>
        ))}
      </div>
      <p className="op-nota">
        {sinDueno ? 'El cobro se calcula al asignarlo.' : 'Tarifas del conjunto. Si aplica cortesía, la verás al guardar.'}
      </p>

      <div className="op-extras">
        <button
          type="button"
          className="op-extra"
          disabled={maxFotos === 0 || g.fotos.length >= maxFotos || g.procesando}
          onClick={() => inputFoto.current?.click()}
        >
          <Icon nombre="camara" size={26} trazo={2} />
          {g.procesando ? 'Procesando' : g.fotos.length ? `Otra foto · ${g.fotos.length}/${maxFotos}` : 'Tomar foto'}
        </button>
        <button type="button" className="op-extra op-extra--chica" onClick={() => setGuiaAbierta(true)}>
          {g.guia || g.transportadora ? 'Guía lista' : '+ Guía'}
        </button>
        <input
          ref={inputFoto}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            g.agregarFoto(f);
          }}
        />
      </div>
      {g.fotos.length > 0 && (
        <div className="op-fotos">
          {g.fotos.map((src, i) => (
            <div className="op-foto" key={i}>
              <img src={src} alt={`Foto ${i + 1}`} />
              <button type="button" aria-label={`Quitar foto ${i + 1}`} onClick={() => g.setFotos(g.fotos.filter((_, j) => j !== i))}>
                <Icon nombre="cerrar" size={14} trazo={3} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="op-nota">Foto y guía son opcionales.</p>

      <div className="op__relleno" />
      {g.error && <div className="op__pad"><Toast tipo="error">{g.error}</Toast></div>}
      <div className="op__acciones">
        <Button onClick={g.guardar} disabled={g.guardando || !config}>{g.guardando ? 'Guardando' : 'Guardar'}</Button>
      </div>

      <Sheet open={guiaAbierta} onClose={() => setGuiaAbierta(false)} title="Datos de la guía">
        <Field label="Transportadora" value={g.transportadora} onChange={(e) => g.setTransportadora(e.target.value)} maxLength={60} autoComplete="off" />
        <Field label="Número de guía" mono value={g.guia} onChange={(e) => g.setGuia(e.target.value)} maxLength={60} autoComplete="off" />
        <Button variante="secundario" onClick={() => setGuiaAbierta(false)}>Listo</Button>
      </Sheet>
    </Pantalla>
  );
}
