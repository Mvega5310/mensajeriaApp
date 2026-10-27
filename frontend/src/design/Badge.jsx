import Icon from './Icon.jsx';

const ESTADOS = {
  'en-porteria': { icono: 'casa', texto: 'En portería' },
  programado: { icono: 'reloj', texto: 'Programado' },
  entregado: { icono: 'check', texto: 'Entregado' },
  'sin-asignar': { icono: 'alerta', texto: 'Sin asignar' },
  demo: { icono: null, texto: 'DEMO' },
};

/** Estado = ícono + palabra, nunca solo color.
 *  estado: 'en-porteria' | 'programado' | 'entregado' | 'sin-asignar' | 'demo'.
 *  children reemplaza la palabra (p. ej. "Programado 6-8 p. m."). */
export default function Badge({ estado = 'en-porteria', children, className = '' }) {
  const e = ESTADOS[estado] ?? ESTADOS['en-porteria'];
  return (
    <span className={`ds-badge ds-badge--${estado} ${className}`.trim()}>
      {e.icono && <Icon nombre={e.icono} size={14} trazo={3} />}
      {children ?? e.texto}
    </span>
  );
}
