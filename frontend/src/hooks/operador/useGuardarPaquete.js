import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api.js';
import { compressImage } from '../../utils/image.js';
import { invalidarPaquetes } from './usePaquetes.js';

function nuevaClave() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Datos y acciones de Op-Peso. `destino` = { residenteId | null, etiquetaNombre?, residente? }. */
export default function useGuardarPaquete(destino, maxFotos) {
  const navigate = useNavigate();
  const [categoria, setCategoria] = useState('ESTANDAR');
  const [fotos, setFotos] = useState([]);
  const [procesando, setProcesando] = useState(false);
  const [guia, setGuia] = useState('');
  const [transportadora, setTransportadora] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const clave = useRef(nuevaClave()); // una Idempotency-Key por intento de guardado

  async function agregarFoto(file) {
    if (!file || fotos.length >= maxFotos) return;
    setProcesando(true);
    try {
      const f = await compressImage(file);
      setFotos((prev) => [...prev, f]);
    } catch {
      setError('No pudimos procesar la foto. Toma otra.');
    } finally {
      setProcesando(false);
    }
  }

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError('');
    const body = {
      residenteId: destino.residenteId ?? null,
      categoriaPeso: categoria,
      ...(destino.etiquetaNombre ? { etiquetaNombre: destino.etiquetaNombre } : {}),
      ...(guia.trim() ? { guia: guia.trim() } : {}),
      ...(transportadora.trim() ? { transportadora: transportadora.trim() } : {}),
      ...(fotos.length ? { fotos } : {}),
    };
    try {
      const resultado = await api('/packages/recepcion', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': clave.current },
      });
      invalidarPaquetes();
      navigate(`/op/guardado/${resultado.paquete.id}`, { state: { resultado, residente: destino.residente ?? null }, replace: true });
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return {
    categoria, setCategoria, fotos, setFotos, procesando, agregarFoto,
    guia, setGuia, transportadora, setTransportadora, guardando, error, guardar,
  };
}
