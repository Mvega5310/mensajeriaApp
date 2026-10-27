// Pruebas unitarias del almacén de fotos (T5.1). Sin red ni base de datos.
// El adaptador S3 se prueba con un cliente simulado (guardar/borrar) y con la firma
// real de URL, que es local (no necesita red).

import test from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import {
  decodificarDataUri, MAX_BYTES_FOTO, resolverConfigFotos, crearAlmacenDesdeConfig,
  crearAlmacenFake, crearAlmacenS3, crearAlmacenLegado, fotosDeFotoUrl,
} from '../index.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('decodificarDataUri: acepta jpeg/png/webp y devuelve Buffer y tipo', () => {
  const r = decodificarDataUri(PNG);
  assert.equal(r.tipo, 'image/png');
  assert.ok(Buffer.isBuffer(r.contenido) && r.contenido.length === 8);
  assert.equal(decodificarDataUri('data:image/jpg;base64,/9j/4AAQ').tipo, 'image/jpeg');
  assert.equal(decodificarDataUri('data:image/webp;base64,UklGRg==').tipo, 'image/webp');
});

test('decodificarDataUri: rechaza formato, tipo y vacío con 400', () => {
  for (const malo of ['hola', 'data:image/gif;base64,R0lGODlh', 'data:text/html;base64,PGI+', 'data:image/png;base64,', 'data:image/png,abc', 42, null]) {
    assert.throws(() => decodificarDataUri(malo, 2), (e) => e.status === 400 && /foto 2/.test(e.message), String(malo));
  }
});

test('decodificarDataUri: más de 1,5 MB decodificado -> 413', () => {
  const justo = Buffer.alloc(MAX_BYTES_FOTO, 1).toString('base64');
  assert.equal(decodificarDataUri(`data:image/jpeg;base64,${justo}`).contenido.length, MAX_BYTES_FOTO);
  const grande = Buffer.alloc(MAX_BYTES_FOTO + 10, 1).toString('base64');
  assert.throws(() => decodificarDataUri(`data:image/jpeg;base64,${grande}`), (e) => e.status === 413 && e.code === 'CARGA_DEMASIADO_GRANDE');
});

const S3 = {
  FOTOS_S3_ENDPOINT: 'https://bucket.example', FOTOS_S3_BUCKET: 'b', FOTOS_S3_ACCESS_KEY: 'ak', FOTOS_S3_SECRET: 'sk',
};

test('selección: sin variables -> fake en desarrollo, legado en producción (con aviso)', () => {
  const dev = resolverConfigFotos({}, { esProduccion: false });
  assert.equal(dev.modo, 'fake');
  assert.equal(dev.avisos.length, 1);
  assert.equal(crearAlmacenDesdeConfig(dev).nombre, 'fake');
  const prod = resolverConfigFotos({}, { esProduccion: true });
  assert.equal(prod.modo, 'legado');
  assert.match(prod.avisos[0], /ATENCIÓN/);
  assert.equal(crearAlmacenDesdeConfig(prod).esLegado, true);
});

test('selección: variables completas -> s3 (región auto y path-style por defecto)', () => {
  const c = resolverConfigFotos(S3, { esProduccion: true });
  assert.equal(c.modo, 's3');
  assert.deepEqual(c.s3, { endpoint: 'https://bucket.example', bucket: 'b', accessKey: 'ak', secret: 'sk', region: 'auto', forcePathStyle: true });
  assert.deepEqual(c.avisos, []);
  const v = resolverConfigFotos({ ...S3, FOTOS_S3_REGION: 'us-east-1', FOTOS_S3_FORCE_PATH_STYLE: 'false' });
  assert.equal(v.s3.region, 'us-east-1');
  assert.equal(v.s3.forcePathStyle, false);
});

test('selección: variables a medias -> problema que nombra las que faltan', () => {
  const c = resolverConfigFotos({ FOTOS_S3_BUCKET: 'b' }, { esProduccion: true });
  assert.equal(c.problemas.length, 1);
  assert.match(c.problemas[0], /FOTOS_S3_ENDPOINT.*FOTOS_S3_ACCESS_KEY.*FOTOS_S3_SECRET/);
});

test('fake: guardar, urlFirmada (data-URI) y borrar', async () => {
  const a = crearAlmacenFake();
  const { contenido, tipo } = decodificarDataUri(PNG);
  const { clave } = await a.guardar({ conjuntoId: 'c1', paqueteId: 'p1', contenido, tipo });
  assert.match(clave, /^c1\/p1\/.+\.png$/);
  assert.equal(await a.urlFirmada(clave, { expiraSeg: 600 }), PNG);
  await a.borrar(clave);
  assert.equal(await a.urlFirmada(clave), null);
});

test('legado: fotosDeFotoUrl lee JSON, string plano y vacío; no guarda', async () => {
  assert.deepEqual(fotosDeFotoUrl(JSON.stringify([PNG, PNG])), [PNG, PNG]);
  assert.deepEqual(fotosDeFotoUrl(PNG), [PNG]);
  assert.deepEqual(fotosDeFotoUrl(null), []);
  await assert.rejects(() => crearAlmacenLegado().guardar({}));
});

test('s3: guardar y borrar usan Put/Delete con bucket y clave; la firma es local', async () => {
  const enviados = [];
  const cliente = new S3Client({
    endpoint: 'https://bucket.example', region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
  });
  cliente.send = async (cmd) => { enviados.push(cmd); return {}; };
  const a = crearAlmacenS3({ bucket: 'mi-bucket', cliente });
  const { clave } = await a.guardar({ conjuntoId: 'c1', paqueteId: null, contenido: Buffer.from('x'), tipo: 'image/webp' });
  assert.match(clave, /^c1\/nuevo\/.+\.webp$/);
  assert.equal(enviados[0].constructor.name, 'PutObjectCommand');
  assert.deepEqual([enviados[0].input.Bucket, enviados[0].input.Key, enviados[0].input.ContentType], ['mi-bucket', clave, 'image/webp']);
  await a.borrar(clave);
  assert.equal(enviados[1].constructor.name, 'DeleteObjectCommand');

  // La firma no toca la red: se usa el cliente real (send simulado no interviene).
  const url = new URL(await a.urlFirmada('c1/p1/foto.png', { expiraSeg: 600 }));
  assert.equal(url.host, 'bucket.example');
  assert.equal(url.pathname, '/mi-bucket/c1/p1/foto.png'); // path-style
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
  assert.ok(url.searchParams.get('X-Amz-Signature'));
});
