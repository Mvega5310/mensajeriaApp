import { useState } from 'react';
import useBuscarResidentes from './useBuscarResidentes.js';

const MAX_APTO = 4;
const MAX_TORRE = 2;
const MIN_DIGITOS_DIRECTO = 3;

/** Estado del teclado de Recibir: apartamento (o torre + apartamento) y sus sugerencias. */
export default function useRecibir() {
  const [torre, setTorre] = useState(null); // null = aún sin torre
  const [digitos, setDigitos] = useState('');

  const consulta = torre !== null ? (digitos ? `T${torre} ${digitos}` : '') : digitos;
  const { resultados, buscando, error, resuelta } = useBuscarResidentes(consulta);
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

  // Guardado directo ("4 toques", T8.1): una ÚNICA sugerencia, ya resuelta para lo que
  // está escrito, y el apartamento escrito completo (>= 3 dígitos, o torre + el apto
  // exacto del residente). Con varias sugerencias o un apto a medias, flujo normal.
  const unico = !buscando && !error && resuelta === consulta.trim() && resultados.length === 1 ? resultados[0] : null;
  const aptoCompleto = !!unico && (
    digitos.length >= MIN_DIGITOS_DIRECTO
    || (torre !== null && digitos !== '' && String(unico.apto ?? '').replace(/\D/g, '') === digitos)
  );

  return {
    texto, tecla, resultados, buscando, error, hayConsulta: consulta !== '',
    directo: aptoCompleto ? unico : null,
  };
}
