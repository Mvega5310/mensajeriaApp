// En dev, Vite redirige /api al backend local (ver vite.config.js).
// En producción no hay proxy: VITE_API_URL debe apuntar al backend real.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

function authHeaders() {
  const token = localStorage.getItem('token'); // solo el JWT vive aquí, nunca datos de negocio
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api(path, { method = 'GET', body, headers, sinCierreDeSesion = false, timeoutMs } = {}) {
  // timeoutMs (opcional): corta la petición con AbortError, que se trata como falla de red.
  const ctl = timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !sinCierreDeSesion) {
    localStorage.removeItem('token');
    if (location.pathname !== '/login') location.href = '/login';
  }
  if (!res.ok) {
    // Contrato de error de la API: { code, message, details? }. `error` es
    // respaldo para respuestas viejas (antes de T0.2).
    const err = new Error(data.message || data.error || 'Error de red');
    // Conserva el código estable (ej. 'INVITACION_INVALIDA') para que la UI no
    // dependa del texto del mensaje, y los detalles si vienen.
    if (data.code) err.code = data.code;
    if (data.details !== undefined) err.details = data.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Para respuestas que no son JSON (ej. CSV) — dispara la descarga real vía
// Blob, que es lo que funciona de forma consistente entre navegadores
// (un <a href download> simple falla en Safari/iOS para algunos casos).
export async function downloadFile(path, filename) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data.error || 'No se pudo descargar el archivo. Intenta de nuevo.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
