import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guardarRecepcion, nuevaClave } from '../../offline/colaRecepciones.js';
import { compressImage } from '../../utils/image.js';
import { invalidarPaquetes } from './usePaquetes.js';

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
  // Una Idempotency-Key por intento de guardado; se reutiliza solo si se reintenta el mismo cuerpo.
  const clave = useRef({ valor: null, firma: null });

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
    const firma = JSON.stringify(body);
    if (clave.current.firma !== firma) clave.current = { valor: nuevaClave(), firma };
    const claveIdempotencia = clave.current.valor;
    const resumen = {
      residenteId: destino.residenteId ?? null,
      nombre: destino.residente?.nombre ?? null,
      etiquetaApto: destino.residente?.etiqueta ?? null,
      etiquetaNombre: destino.etiquetaNombre ?? null,
      categoriaPeso: categoria,
    };
    try {
      const r = await guardarRecepcion({ claveIdempotencia, body, resumen });
      if (r.enviado) {
        invalidarPaquetes();
        navigate(`/op/guardado/${r.resultado.paquete.id}`, { state: { resultado: r.resultado, residente: destino.residente ?? null }, replace: true });
      } else {
        // Sin señal: queda en la cola y se muestra el resumen local en modo "pendiente de envío".
        navigate(`/op/guardado/pendiente-${r.clave}`, { state: { pendiente: true, resumen }, replace: true });
      }
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
