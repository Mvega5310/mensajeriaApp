// En dev, Vite redirige /api al backend local (ver vite.config.js).
// En producción no hay proxy: VITE_API_URL debe apuntar al backend real.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

function authHeaders() {
  const token = localStorage.getItem('token'); // solo el JWT vive aquí, nunca datos de negocio
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem('token');
    if (location.pathname !== '/login') location.href = '/login';
  }
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}
