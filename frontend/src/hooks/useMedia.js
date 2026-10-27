import { useEffect, useState } from 'react';

/** true mientras la consulta de medios (p. ej. '(min-width: 1024px)') coincide. */
export default function useMedia(consulta) {
  const [coincide, setCoincide] = useState(() => window.matchMedia?.(consulta).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(consulta);
    if (!mq) return undefined;
    const cambio = () => setCoincide(mq.matches);
    cambio();
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, [consulta]);
  return coincide;
}
