import { useEffect, useState } from 'react';
import { getConjuntoConfig } from '../../services/conjunto.js';

/** ¿Este conjunto tiene los bonos prepago encendidos? (GET /conjunto/config; solo se pide si `activo`). */
export default function useBonosHabilitados(activo) {
  const [habilitados, setHabilitados] = useState(false);
  useEffect(() => {
    if (!activo) return;
    getConjuntoConfig().then((c) => setHabilitados(!!c.bonosHabilitados)).catch(() => setHabilitados(false));
  }, [activo]);
  return habilitados;
}
