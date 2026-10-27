// Pruebas unitarias de plantillas y selección del notificador (T2.4). Sin BD.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escaparHtml, plantillaLlegada, plantillaEntrega, plantillaEnlaceAcceso, plantillaPrealerta,
  plantillaNuevaPrealerta, plantillaRecuperacion,
} from '../plantillas.js';
import { crearNotificadorDesdeEntorno } from '../index.js';
import { construirEnlace, textoLlegada } from '../../../domain/whatsapp.js';

const XSS = '<script>alert(1)</script>';
const conjunto = { nombre: 'Conjunto Alfa', puntoRecepcion: 'Portería principal' };

test('escaparHtml escapa & < > " \' y tolera null', () => {
  assert.equal(escaparHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escaparHtml(null), '');
  assert.equal(escaparHtml(undefined), '');
  assert.equal(escaparHtml(42), '42');
});

test('ninguna plantilla deja pasar <script> de proveedor, notas ni nombre', () => {
  const residente = { nombre: XSS, torre: XSS, apto: XSS, telefono: XSS };
  const paquete = { proveedor: XSS, pin: XSS, categoriaPeso: XSS, guia: XSS, notas: XSS, franjaHoraria: XSS, esContraEntregaProveedor: true, valorProductoProveedor: 5000 };
  const conj = { nombre: XSS, puntoRecepcion: XSS };
  const salidas = [
    plantillaLlegada({ residente, paquete, conjunto: conj, aviso: { texto: XSS, enlace: XSS } }),
    plantillaEntrega({ residente, paquetes: [paquete], conjunto: conj }),
    plantillaEnlaceAcceso({ url: `https://x/?a="${XSS}`, conjunto: conj }),
    plantillaPrealerta({ residente, paquete, conjunto: conj }),
    plantillaNuevaPrealerta({ residente, paquete, conjunto: conj }),
    plantillaRecuperacion({ url: `https://x/?a="${XSS}`, conjunto: conj }),
  ];
  for (const { asunto, html } of salidas) {
    assert.ok(!html.includes('<script'), html);
    assert.ok(html.includes('&lt;script&gt;') || !html.includes('script'), html);
    assert.ok(typeof asunto === 'string' && asunto.length > 0);
  }
});

test('el asunto no admite saltos de línea (inyección de cabeceras)', () => {
  const { asunto } = plantillaPrealerta({ residente: {}, paquete: { proveedor: 'A\r\nBcc: x@y.z' }, conjunto });
  assert.ok(!/[\r\n]/.test(asunto));
});

test('las plantillas usan el nombre del conjunto y no mencionan Ipanema', () => {
  const salidas = [
    plantillaLlegada({ residente: { nombre: 'Ana Gómez' }, paquete: { proveedor: 'Amazon' }, conjunto, aviso: { texto: 'Hola Ana, llegó tu paquete.' } }),
    plantillaEntrega({ residente: { nombre: 'Ana' }, paquetes: [{ proveedor: 'Amazon' }], conjunto }),
    plantillaEnlaceAcceso({ url: 'https://app/entrar?t=1', conjunto }),
    plantillaPrealerta({ residente: { nombre: 'Ana' }, paquete: { proveedor: 'Amazon' }, conjunto }),
    plantillaNuevaPrealerta({ residente: { nombre: 'Ana' }, paquete: { proveedor: 'Amazon' }, conjunto }),
    plantillaRecuperacion({ url: 'https://app/r?t=1', conjunto }),
  ];
  for (const { asunto, html } of salidas) {
    assert.ok(!/ipanema/i.test(asunto + html));
    assert.ok(html.includes('Conjunto Alfa'), 'el pie lleva el nombre del conjunto');
    assert.ok(!/[!¡]/.test(asunto + html), 'sin exclamaciones');
    assert.ok(!/\p{Extended_Pictographic}/u.test(asunto + html), 'sin emoji');
  }
  assert.ok(salidas[0].asunto.includes('Conjunto Alfa'));
});

test('llegada: saludo UNA vez, PIN (va al residente), enlace con # enlazado y punto de recepción', () => {
  const { html } = plantillaLlegada({
    residente: { nombre: 'Ana Gómez' }, paquete: { pin: '4821', categoriaPeso: 'ESTANDAR' }, conjunto,
    aviso: { texto: 'ignorado', enlace: 'https://app.test/p#v1.abc?x=1&y=2' },
  });
  assert.equal((html.match(/Hola/g) || []).length, 1, 'el saludo no se repite');
  assert.ok(html.includes('Hola Ana,'));
  assert.ok(html.includes('<strong>4821</strong>'), 'el correo al residente lleva su PIN');
  assert.ok(html.includes('<a href="https://app.test/p#v1.abc?x=1&amp;y=2">'));
  assert.ok(html.includes('Portería principal'));
  assert.ok(html.includes('Paquete estándar'));
});

test('llegada: sin PIN ni enlace no inventa nada', () => {
  const { html } = plantillaLlegada({ residente: { nombre: 'Ana' }, paquete: {}, conjunto });
  assert.ok(!/PIN/.test(html));
  assert.ok(!/<a href/.test(html));
});

test('selección: sin RESEND_API_KEY o con la de ejemplo => fake y avisa una vez', () => {
  const avisos = [];
  const log = (m) => avisos.push(m);
  assert.equal(crearNotificadorDesdeEntorno({}, { log }).tipo, 'fake');
  assert.equal(crearNotificadorDesdeEntorno({ RESEND_API_KEY: 're_xxxxxxxxxxxx' }, { log }).tipo, 'fake');
  assert.ok(avisos.length <= 1);
  assert.equal(crearNotificadorDesdeEntorno({ RESEND_API_KEY: 're_real_123' }).tipo, 'resend');
});

test('fake: guarda los mensajes, obtenerEnviados() devuelve copia y limpiar() vacía', async () => {
  const n = crearNotificadorDesdeEntorno({});
  n.limpiar();
  await n.avisarLlegada({ residente: { nombre: 'Ana', email: 'a@x.co' }, paquete: {}, conjunto, aviso: { texto: 'hola' } });
  await n.enviarEnlaceAcceso({ email: 'b@x.co', url: 'https://u', conjunto });
  await n.avisarLlegada({ residente: { nombre: 'Sin correo' }, paquete: {}, conjunto, aviso: { texto: 'hola' } });
  const env = n.obtenerEnviados();
  assert.deepEqual(env.map((m) => [m.tipo, m.para]), [['llegada', 'a@x.co'], ['enlaceAcceso', 'b@x.co']]);
  env.length = 0;
  assert.equal(n.obtenerEnviados().length, 2);
  n.limpiar();
  assert.equal(n.obtenerEnviados().length, 0);
});

test('construirEnlace: formato wa.me definitivo', () => {
  assert.equal(
    construirEnlace({ prefijoPais: '57', telefono: '300 123-4567', texto: 'Hola, ñ & más' }),
    `https://wa.me/573001234567?text=${encodeURIComponent('Hola, ñ & más')}`,
  );
  assert.equal(construirEnlace({ prefijoPais: '57', telefono: '573001234567', texto: 'x' }), 'https://wa.me/573001234567?text=x');
  assert.equal(construirEnlace({ prefijoPais: '+57', telefono: '0300 1234567', texto: 'x' }), 'https://wa.me/573001234567?text=x');
  assert.equal(construirEnlace({ prefijoPais: '57', telefono: '', texto: 'x' }), null);
  assert.equal(construirEnlace({ prefijoPais: '57', telefono: 'abc', texto: 'x' }), null);
  assert.ok(textoLlegada({ nombre: 'Ana Gómez', categoria: 'MANO' }).includes('Hola Ana'));
});
