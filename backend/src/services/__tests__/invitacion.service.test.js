// Pruebas del generador/normalizador de códigos de invitación (KAN-8, C5).
// Runner: node:test. Autónomo (no importa @prisma/client). Ejecutar: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { generarCodigoInvitacion, normalizarCodigoInvitacion } from '../invitacion.service.js';

// --- normalizarCodigoInvitacion ---

test('con guion: minúsculas antes del último guion, mayúsculas después', () => {
  assert.equal(normalizarCodigoInvitacion('LOCAL-skrupcewt3wx'), 'local-SKRUPCEWT3WX');
  assert.equal(normalizarCodigoInvitacion('local-SKRUPCEWT3WX'), 'local-SKRUPCEWT3WX');
  assert.equal(normalizarCodigoInvitacion('Local-Skrupcewt3wx'), 'local-SKRUPCEWT3WX');
});

test('sin guion: todo en mayúsculas', () => {
  assert.equal(normalizarCodigoInvitacion('skrupcewt3wx'), 'SKRUPCEWT3WX');
  assert.equal(normalizarCodigoInvitacion('SKRUPCEWT3WX'), 'SKRUPCEWT3WX');
});

test('quita espacios al inicio, al final y en medio', () => {
  assert.equal(normalizarCodigoInvitacion('  local-SKRUP CEWT3WX  '), 'local-SKRUPCEWT3WX');
  assert.equal(normalizarCodigoInvitacion('local - SKRUPCEWT3WX'), 'local-SKRUPCEWT3WX');
  assert.equal(normalizarCodigoInvitacion(' SKRU PCEWT '), 'SKRUPCEWT');
});

test('usa el ÚLTIMO guion (prefijos con guiones internos)', () => {
  // slug con guion: itesth-a -> prefijo 'itesth-a' (minúsculas), token mayúsculas
  assert.equal(normalizarCodigoInvitacion('ITESTH-A-k7q2m9xr4tv'), 'itesth-a-K7Q2M9XR4TV');
});

test('tolera null/undefined/vacío', () => {
  assert.equal(normalizarCodigoInvitacion(null), '');
  assert.equal(normalizarCodigoInvitacion(undefined), '');
  assert.equal(normalizarCodigoInvitacion(''), '');
});

// --- generarCodigoInvitacion produce forma canónica ---

test('generarCodigoInvitacion() ya está en forma canónica (con prefijo)', () => {
  for (let i = 0; i < 20; i += 1) {
    const code = generarCodigoInvitacion({ prefijo: 'local' });
    assert.equal(normalizarCodigoInvitacion(code), code, `no canónico: ${code}`);
  }
});

test('generarCodigoInvitacion() ya está en forma canónica (sin prefijo)', () => {
  for (let i = 0; i < 20; i += 1) {
    const code = generarCodigoInvitacion();
    assert.equal(normalizarCodigoInvitacion(code), code, `no canónico: ${code}`);
  }
});

test('generarCodigoInvitacion() con slug que tiene guiones sigue siendo canónico', () => {
  const code = generarCodigoInvitacion({ prefijo: 'Conjunto Ipanema Norte' });
  // El prefijo se limpia a [a-z0-9-]; el resultado debe ser idempotente al normalizar.
  assert.equal(normalizarCodigoInvitacion(code), code);
});
