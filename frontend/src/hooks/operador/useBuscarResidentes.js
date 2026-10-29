import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

/**
 * Búsqueda con debounce desde el primer carácter. → { resultados, buscando, error, resuelta }.
 * `guia` (opcional): la del paquete que se asigna; sube primero la dirección con su pre-alerta.
 * `resuelta` es el texto para el que son válidos `resultados` (mientras se teclea, los
 * resultados son los de la consulta anterior: quien actúe sobre ellos debe comprobarlo).
 */
export default function useBuscarResidentes(q, demora = 200, { guia } = {}) {
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const [resuelta, setResuelta] = useState('');

  useEffect(() => {
    const texto = q.trim();
    if (!texto) {
      setResultados([]);
      setResuelta('');
      setError('');
      return undefined;
    }
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(() => {
      api(`/residentes/buscar?q=${encodeURIComponent(texto)}${guia ? `&guia=${encodeURIComponent(guia)}` : ''}`)
        .then((r) => vigente && (setResultados(r), setResuelta(texto), setError('')))
        .catch((e) => vigente && setError(e.message))
        .finally(() => vigente && setBuscando(false));
    }, demora);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q, demora, guia]);

  return { resultados, buscando, error, resuelta };
}
