import { useEffect, useId, useRef } from 'react';
import Icon from './Icon.jsx';

const FOCALIZABLES =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Hoja inferior modal. open, onClose, title. Foco atrapado, Esc y toque al fondo cierran,
 *  el foco vuelve al elemento que la abrió. Va dentro de un contenedor `.pt` (hereda tema
 *  de <html data-tema>). */
export default function Sheet({ open, onClose, title, children, cerrarLabel = 'Cerrar' }) {
  const ref = useRef(null);
  const tituloId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previo = document.activeElement;
    const nodo = ref.current;
    const primero = nodo?.querySelector(FOCALIZABLES);
    (primero ?? nodo)?.focus();

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !nodo) return;
      const items = [...nodo.querySelectorAll(FOCALIZABLES)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const a = items[0];
      const z = items[items.length - 1];
      // Si el foco se perdió fuera de la hoja (p. ej. quedó en el fondo), Tab lo devuelve adentro.
      if (!nodo.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? z : a).focus();
        return;
      }
      if (e.shiftKey && (document.activeElement === a || document.activeElement === nodo)) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previo?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ds-sheet__scrim pt" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={ref}
        className="ds-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? tituloId : undefined}
        tabIndex={-1}
      >
        <div className="ds-sheet__asa" aria-hidden="true" />
        <div className="ds-sheet__cab">
          {title && (
            <h2 id={tituloId} className="ds-sheet__titulo">
              {title}
            </h2>
          )}
          <button type="button" className="ds-sheet__cerrar" aria-label={cerrarLabel} onClick={onClose}>
            <Icon nombre="cerrar" size={24} />
          </button>
        </div>
        <div className="ds-sheet__cuerpo">{children}</div>
      </div>
    </div>
  );
}
