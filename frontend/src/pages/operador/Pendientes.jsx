import { useState } from 'react';
import { Badge, Icon } from '../../design';
import usePendientes from '../../hooks/operador/usePendientes.js';
import useConfig from '../../hooks/operador/useConfig.js';
import useMedia from '../../hooks/useMedia.js';
import { haceCuanto, horaCorta } from '../../utils/apto.js';
import { quienTrajo } from '../../utils/tiers.js';
import Pantalla, { useAbrirMas } from './Pantalla.jsx';
import AsignarSheet from './AsignarSheet.jsx';
import DetalleSheet, { DetallePanel } from './DetalleSheet.jsx';

const ESCRITORIO = '(min-width: 1024px)';

/** "Más" de la cabecera móvil. Va como componente aparte: useAbrirMas debe llamarse DENTRO de
 *  <Pantalla> (que provee el contexto); en Pendientes mismo devolvía la función vacía y no abría nada. */
function BotonMas() {
  const abrirMas = useAbrirMas();
  return <button type="button" className="op-mas" onClick={abrirMas}>Más</button>;
}

export default function Pendientes() {
  const config = useConfig();
  const p = usePendientes();
  const esEscritorio = useMedia(ESCRITORIO);
  const [asignando, setAsignando] = useState(null);
  const [detalle, setDetalle] = useState(null); // { titulo, paquetes }
  const total = p.porEntregar.length;
  // En escritorio el panel muestra siempre un apartamento: el elegido, o el primero de la lista.
  const primero = p.grupos[0] ? { titulo: p.grupos[0].apto, paquetes: p.grupos[0].paquetes } : null;
  const seleccion = detalle ?? (esEscritorio ? primero : null);

  return (
    <Pantalla activo="pendientes" pendientes={total} ancho="amplio">
      <div className="op-dos">
        <div className="op-dos__lista">
          <div className="op-tit" style={{ paddingTop: 20, gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h1>Pendientes</h1>
              <BotonMas />
            </div>
            <label className="op-busca">
              <Icon nombre="lupa" size={20} trazo={2.5} />
              <input type="search" placeholder="Buscar apartamento o nombre" aria-label="Buscar" value={p.q} onChange={(e) => p.setQ(e.target.value)} />
            </label>
          </div>

          <div className="op-lista" style={{ paddingTop: 16 }}>
            {p.error && <p className="op-vacio" role="alert">{p.error}</p>}
            {p.sinAsignarFiltrados.length > 0 && <h2 className="op-sec op-sec--aviso">Sin asignar · {p.sinAsignarFiltrados.length}</h2>}
            {p.sinAsignarFiltrados.map((x) => (
              <div className="op-fila op-fila--aviso" key={x.id}>
                <div className="op-fila__col">
                  <b>Etiqueta: {x.etiquetaNombre}</b>
                  <span>{quienTrajo(x)} · {haceCuanto(x.fechaIngreso)} {horaCorta(x.fechaIngreso)}</span>
                </div>
                <button type="button" className="op-asignar" onClick={() => setAsignando(x)}>Asignar</button>
              </div>
            ))}

            <h2 className="op-sec" style={{ marginTop: 10 }}>Por entregar · {p.grupos.reduce((n, g) => n + g.paquetes.length, 0)}</h2>
            {p.grupos.map((g) => {
              const franja = g.paquetes.find((x) => x.franjaHoraria)?.franjaHoraria;
              const recoge = g.paquetes.some((x) => x.modalidadEntrega === 'RECOGER');
              const activa = seleccion?.paquetes?.[0]?.id === g.paquetes[0].id;
              return (
                <button type="button" className="op-fila" key={g.clave} aria-pressed={esEscritorio ? activa : undefined} onClick={() => setDetalle({ titulo: g.apto, paquetes: g.paquetes })}>
                  <span className="op-fila__apto">{g.apto}</span>
                  <span className="op-fila__col">
                    <b>{g.nombre}</b>
                    {recoge
                      ? <span className="op-programado">Recoge en portería</span>
                      : franja
                      ? <span className="op-programado">Programado {franja}</span>
                      : <span>En portería · {haceCuanto(g.paquetes[0].recibidoEn ?? g.paquetes[0].fechaIngreso)}</span>}
                  </span>
                  <span className="op-chip" aria-label={`${g.paquetes.length} paquetes`}>{g.paquetes.length}</span>
                </button>
              );
            })}
            {!p.cargando && p.grupos.length === 0 && <p className="op-vacio">{p.q ? 'Sin resultados. Prueba con otro apartamento.' : 'No hay paquetes por entregar.'}</p>}

            {p.prealertadosFiltrados.length > 0 && <h2 className="op-sec" style={{ marginTop: 10 }}>Avisados por residentes · {p.prealertadosFiltrados.length}</h2>}
            {p.prealertadosFiltrados.map((x) => (
              <button type="button" className="op-fila" key={x.id} onClick={() => setDetalle({ titulo: x.residente?.nombre ?? 'Aviso', paquetes: [x] })}>
                <span className="op-fila__col"><b>{x.residente?.nombre}</b><span>{x.proveedor} · guía {x.guia}</span></span>
                <Badge estado="programado">En camino</Badge>
              </button>
            ))}
          </div>
        </div>

        {esEscritorio && (
          <section className="op-panel" aria-label="Detalle del apartamento">
            <DetallePanel key={seleccion?.paquetes?.[0]?.id ?? 'vacio'} detalle={seleccion} config={config} />
          </section>
        )}
      </div>

      <AsignarSheet paquete={asignando} onClose={() => setAsignando(null)} />
      {!esEscritorio && <DetalleSheet detalle={detalle} onClose={() => setDetalle(null)} config={config} />}
    </Pantalla>
  );
}
