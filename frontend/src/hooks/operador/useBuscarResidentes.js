import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

/**
 * Búsqueda con debounce desde el primer carácter. → { resultados, buscando, error, resuelta }.
 * `resuelta` es el texto para el que son válidos `resultados` (mientras se teclea, los
 * resultados son los de la consulta anterior: quien actúe sobre ellos debe comprobarlo).
 */
export default function useBuscarResidentes(q, demora = 200) {
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
      api(`/residentes/buscar?q=${encodeURIComponent(texto)}`)
        .then((r) => vigente && (setResultados(r), setResuelta(texto), setError('')))
        .catch((e) => vigente && setError(e.message))
        .finally(() => vigente && setBuscando(false));
    }, demora);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q, demora]);

  return { resultados, buscando, error, resuelta };
}
