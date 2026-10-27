import { useState } from 'react';
import useBuscarResidentes from './useBuscarResidentes.js';

const MAX_APTO = 4;
const MAX_TORRE = 2;

/** Estado del teclado de Recibir: apartamento (o torre + apartamento) y sus sugerencias. */
export default function useRecibir() {
  const [torre, setTorre] = useState(null); // null = aún sin torre
  const [digitos, setDigitos] = useState('');

  const consulta = torre !== null ? (digitos ? `T${torre} ${digitos}` : '') : digitos;
  const { resultados, buscando, error } = useBuscarResidentes(consulta);
  const texto = torre !== null ? `T${torre} · ${digitos}` : digitos;

  function tecla(k) {
    if (k === 'borrar') {
      if (digitos) setDigitos(digitos.slice(0, -1));
      else if (torre !== null) { setDigitos(torre); setTorre(null); }
    } else if (k === 'torre') {
      if (torre === null && digitos) { setTorre(digitos); setDigitos(''); }
    } else if (torre !== null) {
      if (digitos.length < MAX_APTO) setDigitos(digitos + k);
    } else if (digitos.length < MAX_APTO + MAX_TORRE) {
      setDigitos(digitos + k);
    }
  }

  // Con torre el backend compara el apartamento exacto (sin prefijo): no se avisa "sin resultados" a medio escribir.
  return { texto, tecla, resultados, buscando, error, hayConsulta: consulta !== '' && torre === null };
}
