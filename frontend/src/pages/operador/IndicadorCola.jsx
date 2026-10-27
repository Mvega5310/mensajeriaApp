import { useState } from 'react';
import { Button, Icon, Sheet } from '../../design';
import { TIERS } from '../../utils/tiers.js';
import { descartar, enviarPendientes, reintentarFallido, useCola } from '../../offline/colaRecepciones.js';

function titulo(el) {
  const r = el.resumen;
  if (!r) return 'Recepción';
  return r.etiquetaApto ? `${r.etiquetaApto} · ${r.nombre ?? ''}`.trim() : `Sin dueño · ${r.etiquetaNombre ?? ''}`.trim();
}

/** "N por enviar" con estado (enviando / sin señal). Abre la lista de pendientes y de los que no se pudieron enviar. */
export default function IndicadorCola() {
  const cola = useCola();
  const [abierto, setAbierto] = useState(false);
  const total = cola.pendientes.length;
  const nFallidos = cola.fallidos.length;
  if (total + nFallidos === 0) return null;

  const estado = cola.enviando ? 'Enviando' : cola.sinSenal ? 'Sin señal' : 'En espera';
  const texto = total > 0 ? `${total} por enviar` : `${nFallidos} sin enviar`;

  return (
    <>
      <div className="op-cola" role="status">
        <button type="button" className="op-cola__btn" onClick={() => setAbierto(true)}>
          <Icon nombre={cola.sinSenal ? 'sinSenal' : 'recibir'} size={20} trazo={2.5} />
          <span><b>{texto}</b> · {estado}</span>
          <span className="op-cola__ver">Ver</span>
        </button>
      </div>
      <Sheet open={abierto} onClose={() => setAbierto(false)} title="Por enviar">
        {cola.pendientes.length > 0 && (
          <ul className="op-cola__lista">
            {cola.pendientes.map((el) => (
              <li key={el.claveIdempotencia}>
                <b>{titulo(el)}</b>
                <span className="op-muted">
                  {TIERS.find((t) => t.value === el.body?.categoriaPeso)?.label ?? ''}
                  {el.intentos > 0 ? ` · ${el.intentos} intento${el.intentos === 1 ? '' : 's'}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {cola.pendientes.length > 0 && (
          <Button variante="secundario" onClick={() => enviarPendientes({ forzar: true })} disabled={cola.enviando}>Enviar ahora</Button>
        )}
        {nFallidos > 0 && (
          <>
            <h3 className="op-cola__sub">No se pudieron enviar</h3>
            <ul className="op-cola__lista">
              {cola.fallidos.map((el) => (
                <li key={el.claveIdempotencia}>
                  <b>{titulo(el)}</b>
                  <span className="op-cola__error">{el.ultimoError}</span>
                  <span className="op-cola__acciones">
                    <Button variante="secundario" block={false} onClick={() => reintentarFallido(el.claveIdempotencia)}>Reintentar</Button>
                    <Button variante="secundario" block={false} onClick={() => descartar(el.claveIdempotencia)}>Descartar</Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {!cola.persistente && (
          <p className="op-nota">Este navegador no guarda datos sin conexión: si cierras la app antes de enviar, se pierden.</p>
        )}
      </Sheet>
    </>
  );
}
