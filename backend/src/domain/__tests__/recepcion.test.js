import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarRecepcion, validarFotos, normalizarGuia, elegirPrealerta, validarClaveIdempotencia,
} from '../recepcion.js';
import { construirEnlace, textoLlegada } from '../whatsapp.js';

const ok = { residenteId: 'r1', categoriaPeso: 'ESTANDAR' };
const lanza = (fn, code = 'DATOS_INVALIDOS') => assert.throws(fn, (e) => e.code === code && e.status === 400 && typeof e.message === 'string');

test('validarRecepcion: con residente normaliza opcionales a null y fotos a []', () => {
  assert.deepEqual(validarRecepcion(ok, { maxFotos: 3 }), {
    residenteId: 'r1', domicilioId: null, etiquetaNombre: null, categoriaPeso: 'ESTANDAR', guia: null, transportadora: null, fotos: [],
  });
});

test('validarRecepcion: residenteId null/""/ausente exige etiquetaNombre', () => {
  for (const residenteId of [undefined, null, '']) {
    lanza(() => validarRecepcion({ residenteId, categoriaPeso: 'MANO' }, { maxFotos: 3 }));
    lanza(() => validarRecepcion({ residenteId, etiquetaNombre: '   ', categoriaPeso: 'MANO' }, { maxFotos: 3 }));
  }
  const v = validarRecepcion({ residenteId: null, etiquetaNombre: '  Ana  ', categoriaPeso: 'MANO', guia: ' G1 ' }, { maxFotos: 3 });
  assert.equal(v.residenteId, null);
  assert.equal(v.etiquetaNombre, 'Ana');
  assert.equal(v.guia, 'G1');
});

test('validarRecepcion: categoría, tipos y largos inválidos', () => {
  lanza(() => validarRecepcion({ ...ok, categoriaPeso: 'GIGANTE' }, { maxFotos: 3 }));
  lanza(() => validarRecepcion({ residenteId: 'r1' }, { maxFotos: 3 }));
  lanza(() => validarRecepcion({ ...ok, residenteId: 5 }, { maxFotos: 3 }));
  lanza(() => validarRecepcion({ ...ok, guia: 7 }, { maxFotos: 3 }));
  lanza(() => validarRecepcion({ ...ok, transportadora: 'x'.repeat(121) }, { maxFotos: 3 }));
  lanza(() => validarRecepcion(null, { maxFotos: 3 }));
  lanza(() => validarRecepcion([], { maxFotos: 3 }));
});

test('validarFotos: respeta el máximo del conjunto', () => {
  assert.deepEqual(validarFotos(undefined, 3), []);
  assert.deepEqual(validarFotos(['a'], 1), ['a']);
  lanza(() => validarFotos(['a', 'b'], 1));
  lanza(() => validarFotos('a', 3));
  lanza(() => validarFotos([1], 3));
  lanza(() => validarFotos(['a'], 0));
  assert.throws(() => validarFotos(['a', 'b'], 1), /hasta 1 foto\./);
  assert.throws(() => validarFotos(['a', 'b', 'c', 'd', 'e'], 4), /hasta 4 fotos\./);
});

test('normalizarGuia: sin espacios/guiones, mayúsculas; "Sin Guía" y vacío no comparan', () => {
  assert.equal(normalizarGuia(' ab-12 3 '), 'AB123');
  assert.equal(normalizarGuia('Sin Guía'), '');
  assert.equal(normalizarGuia('sin guia'), '');
  assert.equal(normalizarGuia(null), '');
  assert.equal(normalizarGuia(''), '');
});

test('elegirPrealerta: por guía, si no la más antigua; "Sin Guía" nunca coincide', () => {
  const t = (s) => new Date(2026, 0, 1, 0, 0, s);
  const l = [
    { id: 'c', guia: 'Sin Guía', createdAt: t(30) },
    { id: 'a', guia: 'X-1', createdAt: t(20) },
    { id: 'b', guia: 'x 1', createdAt: t(10) },
  ];
  assert.equal(elegirPrealerta(l, 'x1').id, 'b'); // coincide por guía: la más antigua de las que coinciden
  assert.equal(elegirPrealerta(l, 'nada').id, 'b'); // sin coincidencia: la más antigua
  assert.equal(elegirPrealerta(l, 'Sin Guía').id, 'b');
  assert.equal(elegirPrealerta(l, undefined).id, 'b');
  assert.equal(elegirPrealerta([l[0]], 'Sin Guía').id, 'c');
  assert.equal(elegirPrealerta([], 'x'), null);
});

test('validarClaveIdempotencia', () => {
  assert.equal(validarClaveIdempotencia(undefined), null);
  assert.equal(validarClaveIdempotencia(''), null);
  assert.equal(validarClaveIdempotencia(' abc-123 '), 'abc-123');
  lanza(() => validarClaveIdempotencia('con espacio'));
  lanza(() => validarClaveIdempotencia('x'.repeat(129)));
  assert.equal(validarClaveIdempotencia('x'.repeat(128)).length, 128);
});

test('construirEnlace: prefijo + teléfono + texto codificado', () => {
  assert.equal(
    construirEnlace({ prefijoPais: '57', telefono: '300 123-4567', texto: 'Hola, llegó tu paquete & más' }),
    `https://wa.me/573001234567?text=${encodeURIComponent('Hola, llegó tu paquete & más')}`,
  );
  assert.equal(construirEnlace({ prefijoPais: '+1', telefono: '3001234567', texto: 'x' }), 'https://wa.me/13001234567?text=x');
  // ya trae el prefijo
  assert.equal(construirEnlace({ prefijoPais: '57', telefono: '573001234567', texto: 'x' }), 'https://wa.me/573001234567?text=x');
  // ceros a la izquierda
  assert.equal(construirEnlace({ prefijoPais: '57', telefono: '03001234567', texto: 'x' }), 'https://wa.me/573001234567?text=x');
});

test('construirEnlace: sin teléfono => null', () => {
  for (const telefono of ['', '   ', null, undefined, 'abc']) {
    assert.equal(construirEnlace({ prefijoPais: '57', telefono, texto: 'x' }), null);
  }
});

test('textoLlegada: primer nombre y categoría; NUNCA el PIN (el PIN va en el enlace)', () => {
  assert.equal(
    textoLlegada({ nombre: 'Ana María Gómez', categoria: 'ESTANDAR', pin: '1234', enlace: 'https://app/p#tok' }),
    'Hola Ana, llegó tu paquete a portería (Paquete estándar). Tu PIN de entrega está aquí: https://app/p#tok',
  );
  const sin = textoLlegada({ nombre: '', categoria: 'X', pin: '1' });
  assert.equal(sin, 'Hola, llegó tu paquete a portería. Consulta tu PIN de entrega en la app de Puertaya.');
  assert.ok(!sin.includes('1234'));
});
