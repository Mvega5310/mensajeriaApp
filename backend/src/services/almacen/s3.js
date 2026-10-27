// Almacén S3 (T5.1): Railway Buckets u otro servicio compatible con S3.
// `cliente` es inyectable para pruebas; la firma de URL es local (sin red).

import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extensionDe } from './dataUri.js';

export const EXPIRA_POR_DEFECTO_SEG = 600;

export function crearClienteS3({ endpoint, region, accessKey, secret, forcePathStyle }) {
  return new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId: accessKey, secretAccessKey: secret },
  });
}

export function crearAlmacenS3({ bucket, cliente, ...config }) {
  const s3 = cliente ?? crearClienteS3(config);
  return {
    nombre: 's3',
    esLegado: false,
    async guardar({ conjuntoId, paqueteId, contenido, tipo }) {
      const clave = `${conjuntoId}/${paqueteId ?? 'nuevo'}/${randomUUID()}.${extensionDe(tipo)}`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: clave, Body: contenido, ContentType: tipo }));
      return { clave };
    },
    async urlFirmada(clave, { expiraSeg = EXPIRA_POR_DEFECTO_SEG } = {}) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: clave }), { expiresIn: expiraSeg });
    },
    async borrar(clave) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: clave }));
    },
  };
}
