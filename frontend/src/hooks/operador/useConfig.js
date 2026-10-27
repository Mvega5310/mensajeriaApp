import { useEffect, useState } from 'react';
import { getConjuntoConfig } from '../../services/conjunto.js';

// Config del conjunto (tarifas, maxFotos, métodos de pago, bonos...). Una lectura por carga de la página.
let promesa = null;
let valor = null;

export default function useConfig() {
  const [config, setConfig] = useState(valor);
  useEffect(() => {
    if (valor) return;
    promesa ??= getConjuntoConfig()
      .then((c) => { valor = c; return c; })
      .catch(() => { promesa = null; return null; });
    promesa.then((c) => c && setConfig(c));
  }, []);
  return config;
}
