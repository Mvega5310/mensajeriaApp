const LABELS = {
  PREALERTADO: '🟡 Pre-alertado',
  EN_RECEPCION: '📦 En Recepción',
  PROGRAMADO: '🕒 Programado',
  ENTREGADO: '✅ Entregado',
};

export default function StatusBadge({ estado }) {
  return <span className={`badge badge-${estado}`}>{LABELS[estado] || estado}</span>;
}
