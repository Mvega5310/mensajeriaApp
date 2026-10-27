import { api } from './api.js';

export async function login(email, password) {
  const data = await api('/auth/login', { method: 'POST', body: { email, password } });
  localStorage.setItem('token', data.token);
  try { localStorage.setItem('usuarioNombre', data.user?.nombre ?? ''); } catch { /* solo para mostrar */ }
  return data.user;
}

export async function register(fields) {
  return api('/auth/register', { method: 'POST', body: fields });
}

export async function requestPasswordReset(email) {
  return api('/auth/forgot-password', { method: 'POST', body: { email } });
}

export async function confirmPasswordReset(token, password) {
  return api('/auth/reset-password', { method: 'POST', body: { token, password } });
}

export function logout() {
  localStorage.removeItem('token');
  try { localStorage.removeItem('usuarioNombre'); } catch { /* ignorar */ }
}

/** Id del usuario en sesión (claim `sub` del JWT) o null. Solo para la cola sin señal. */
export function usuarioId() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1])).sub ?? null;
  } catch {
    return null;
  }
}

/** Nombre del usuario en sesión, guardado al entrar (solo para mostrarlo). */
export function usuarioNombre() {
  try { return localStorage.getItem('usuarioNombre') || null; } catch { return null; }
}

export function isAuthenticated() {
  return !!localStorage.getItem('token');
}

// Solo para decidir qué vista renderizar en el cliente. La autorización
// real sobre cada endpoint la hace el backend a partir del propio token.
export function getRole() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1])).role;
  } catch {
    return null;
  }
}
