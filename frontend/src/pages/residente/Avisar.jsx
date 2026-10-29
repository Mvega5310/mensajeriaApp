import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, DireccionEntrega, Field, Icon, Toast } from '../../design';
import useAvisar from '../../hooks/residente/useAvisar.js';
import useDirecciones from '../../hooks/residente/useDirecciones.js';
import DetallesAviso from './DetallesAviso.jsx';
import Pantalla from './Pantalla.jsx';

const TRANSPORTADORAS = ['Servientrega', 'Interrapidísimo', 'Coordinadora', 'Envía', 'Rappi', 'Otra'];
const VACIO = {
  transportadora: '', guia: '', tienda: '', categoriaPeso: 'ESTANDAR', contraEntrega: false,
  valorProducto: '', valorDeclarado: '', pinProveedor: '', notas: '',
};

export default function Avisar() {
  const [form, setForm] = useState(VACIO);
  const [detalles, setDetalles] = useState(false);
  const { avisar, enviando, error } = useAvisar();
  // Regla de oro (PLAN-conjunto): la última dirección ya viene puesta; "Cambiar" es opcional.
  const dir = useDirecciones(true, { conConjuntos: true });
  const [elegida, setElegida] = useState(null);
  const valor = elegida ?? dir.direcciones[0]?.id;
  const mostrarConjunto = dir.conjuntos.length > 1 || dir.conjuntosDePersona.length > 1;
  async function crearDireccion(datos) {
    setElegida(await dir.agregar(datos));
  }
  const navigate = useNavigate();
  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  async function enviar(e) {
    e.preventDefault();
    // `proveedor` = tienda; `transportadora` = quién lo trae. Van por separado ("Otra" no es un nombre).
    const quien = form.transportadora && form.transportadora !== 'Otra' ? form.transportadora : '';
    const ok = await avisar({
      ...(valor ? { domicilioId: valor } : {}),
      proveedor: form.tienda.trim() || undefined,
      transportadora: quien || undefined,
      guia: form.guia.trim() || undefined,
      categoriaPeso: form.categoriaPeso,
      esContraEntregaProveedor: form.contraEntrega,
      valorProductoProveedor: form.contraEntrega ? Number(form.valorProducto) || 0 : 0,
      valorDeclarado: Number(form.valorDeclarado) || 0,
      pinProveedor: form.pinProveedor.trim() || undefined,
      notas: form.notas.trim() || undefined,
    });
    if (ok) navigate('/paquetes', { replace: true });
  }

  return (
    <Pantalla>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px var(--sp-1) 0' }}>
        <Link to="/paquetes" aria-label="Volver" className="ds-topbar__volver"><Icon nombre="volver" size={24} trazo={2.5} /></Link>
      </div>
      <div className="res-tit" style={{ paddingTop: 8 }}>
        <h1>Avisar un paquete</h1>
        <p>Opcional. Si no avisas, igual lo recibimos.</p>
      </div>
      {/* Fuera del <form>: la hoja de "Otra dirección" tiene su propio formulario (los formularios no se anidan). */}
      <div className="res-form" style={{ paddingBottom: 0 }}>
      {!dir.cargando && !dir.error && (
        <DireccionEntrega
          direcciones={dir.direcciones}
          valor={valor}
          onElegir={setElegida}
          onCrear={crearDireccion}
          conjuntos={dir.conjuntos}
          mostrarConjunto={mostrarConjunto}
          precarga={dir.direcciones[0] && { nombreRecibe: dir.direcciones[0].nombreRecibe, telefono: dir.direcciones[0].telefono }}
        />
      )}
      </div>
      <form onSubmit={enviar} style={{ display: 'contents' }}>
        <div className="res-form">
          <div className="res-seccion" style={{ padding: 0 }}>
            <span className="res-etiqueta">¿Quién lo trae?</span>
            <div role="radiogroup" aria-label="Transportadora" className="res-chips">
              {TRANSPORTADORAS.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={form.transportadora === t} className="res-chip"
                  onClick={() => set('transportadora', t)}>{t}</button>
              ))}
            </div>
          </div>
          <Field label="Número de guía (si lo tienes)" mono value={form.guia} onChange={(e) => set('guia', e.target.value)} maxLength={60} />
          {detalles ? <DetallesAviso form={form} set={set} /> : (
            <button type="button" className="res-link res-link--tinta" onClick={() => setDetalles(true)}>
              Agregar detalles
            </button>
          )}
        </div>
        {error && <div className="res-aviso"><Toast tipo="error">{error}</Toast></div>}
        <div className="res__relleno" />
        <div className="res__acciones">
          <Button type="submit" disabled={enviando || dir.cargando} aria-busy={enviando}>Avisar</Button>
        </div>
      </form>
    </Pantalla>
  );
}
