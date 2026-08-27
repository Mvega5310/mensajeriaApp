import { api } from './api.js';

export async function login(email, password) {
  const data = await api('/auth/login', { method: 'POST', body: { email, password } });
  localStorage.setItem('token', data.token);
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
