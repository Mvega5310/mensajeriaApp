// Pruebas DE LA PROPIA AUDITORÍA E7.4 (revisión S3.2): con fixtures de código fuente demuestran que
// cada evasión que halló el revisor ahora FALLA, y que el código legítimo sigue pasando. Si un
// cambio al analizador deja de detectar alguna de estas formas, esta prueba se cae.
// Autónoma: solo parsea cadenas (acorn); no toca archivos ni base de datos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { analizarArchivo, relacionesHaciaUser } from './lib/auditoriaAst.js';

const RAIZ = '/repo/backend';
const ARCHIVO = join(RAIZ, 'src', 'controllers', 'ejemplo.controller.js');
const REL = new Set(['user', 'residente', 'usuario', 'actor', 'operador']);
const analizar = (codigo) => analizarArchivo({ codigo, archivo: ARCHIVO, raizBackend: RAIZ, relacionesUser: REL });
const IMPORT = "import { prisma } from '../config/db.js';\n";

// --- (a) importar el cliente de db.js con alias ----------------------------------------------

test('(a) alias del cliente: `import { prisma as db }` falla, y `db.user` también', () => {
  const r = analizar("import { prisma as db } from '../config/db.js';\nexport const f = () => db.user.findMany();");
  assert.equal(r.importsMalos.length, 1);
  assert.match(r.importsMalos[0].detalle, /alias/);
  assert.equal(r.accesosUser.length, 1, 'el alias no esconde `db.user`');
});

test('(a) import * as ns, import por defecto, re-export, import() dinámico y require() fallan', () => {
  for (const codigo of [
    "import * as d from '../config/db.js';\nd.prisma.user.findMany();",
    "import d from '../config/db.js';",
    "export { prisma } from '../config/db.js';",
    "export * from '../config/db.js';",
    "export const cargar = () => import('../config/db.js');",
    "const { prisma } = require('../config/db.js');",
    "import { prisma, otro } from '../config/db.js';",
  ]) {
    const r = analizar(codigo);
    assert.ok(r.importsMalos.length >= 1, `debe fallar: ${codigo}`);
    assert.equal(r.importaDb, true);
  }
});

test('(a) la ruta del import se resuelve: `./db.js` desde config/ y rutas con otros niveles también cuentan', () => {
  const desdeConfig = analizarArchivo({
    codigo: "import { prisma as p } from './db.js';", archivo: join(RAIZ, 'src', 'config', 'otro.js'), raizBackend: RAIZ, relacionesUser: REL,
  });
  assert.equal(desdeConfig.importaDb, true);
  const desdeScripts = analizarArchivo({
    codigo: "import { prisma as p } from '../../src/config/db.js';", archivo: join(RAIZ, 'scripts', 'lib', 'x.js'), raizBackend: RAIZ, relacionesUser: REL,
  });
  assert.equal(desdeScripts.importaDb, true);
  const otroDb = analizar("import { x } from '../services/db.js';");
  assert.equal(otroDb.importaDb, false, 'otro db.js no es el cliente');
});

test('(a) el import legítimo `{ prisma }` no genera hallazgos de import', () => {
  const r = analizar(`${IMPORT}export const f = () => prisma.package.findMany();`);
  assert.deepEqual(r.importsMalos, []);
  assert.equal(r.importaDb, true, 'importa, y por eso el archivo debe estar en la lista autorizada');
  assert.deepEqual(r.accesosUser, []);
});

// --- (b) .user / ['user'] / { user } sobre cualquier cliente o transacción -------------------

test('(b) `.user`, [\'user\'] y [`user`] sobre cualquier objeto fallan', () => {
  for (const codigo of [
    `${IMPORT}prisma.user.findMany();`,
    `${IMPORT}prisma['user'].findMany();`,
    `${IMPORT}prisma[\`user\`].findMany();`,
    `${IMPORT}prisma?.user?.findMany();`,
    'export const f = (cliente) => cliente.user.create({ data: {} });',
    'export const g = (cualquierCosa) => cualquierCosa["user"].findFirst();',
    `${IMPORT}const { prisma: p2 } = { prisma };\np2.user.findMany();`,
  ]) {
    assert.ok(analizar(codigo).accesosUser.length >= 1, `debe fallar: ${codigo}`);
  }
});

test('(b) desestructurar `user` de un cliente falla (`const { user } = prisma`, parámetros, anidado)', () => {
  for (const codigo of [
    `${IMPORT}const { user } = prisma;\nuser.findMany();`,
    `${IMPORT}const { user: u } = prisma;`,
    `${IMPORT}const { package: p, user } = prisma;`,
    'export const f = ({ user }) => user.findMany();',
    `${IMPORT}prisma.$transaction(async ({ user }) => user.findMany());`,
  ]) {
    assert.ok(analizar(codigo).accesosUser.length >= 1, `debe fallar: ${codigo}`);
  }
});

test('(b) transacciones y alias: `$transaction((t) => t.user…)`, `const db = prisma; db.user`', () => {
  assert.ok(analizar(`${IMPORT}prisma.$transaction(async (t) => { await t.user.update({}); });`).accesosUser.length >= 1);
  assert.ok(analizar(`${IMPORT}const db = prisma;\ndb.user.findMany();`).accesosUser.length >= 1);
  assert.ok(analizar(`${IMPORT}const a = prisma; const b = a; b.user.findMany();`).accesosUser.length >= 1);
});

test('(b) acceso computado DINÁMICO sobre un cliente (podría ser `user`) falla', () => {
  for (const codigo of [
    `${IMPORT}const m = 'us' + 'er';\nprisma[m].findMany();`,
    `${IMPORT}export const f = (n) => prisma[n].findMany();`,
    'export const g = (tx, n) => tx[n].findMany();',
    `${IMPORT}prisma.$transaction(async (t) => t[nombre].findMany());`,
  ]) {
    assert.ok(analizar(codigo).accesosUser.length >= 1, `debe fallar: ${codigo}`);
  }
});

test('(b) lo legítimo pasa: req.user, comentarios y cadenas que dicen "prisma.user"', () => {
  const r = analizar(`${IMPORT}
// prisma.user.findMany() en un comentario no cuenta
/* db['user'] tampoco */
export const f = (req) => {
  const { sub } = req.user;
  const { user } = req;
  const msg = "prisma.user.findMany()";
  return prisma.package.findMany({ where: { residenteId: req.user.sub, nota: msg }, select: { residente: { select: { nombre: true } } } });
};`);
  assert.deepEqual(r.accesosUser, []);
  assert.deepEqual(r.seleccionesConCorreo, []);
});

// --- (c) select/include de una relación a User con email o passwordHash --------------------

test('(c) `residente: true`, `usuario: true`, `user: true` en select/include fallan (traen correo y hash)', () => {
  for (const codigo of [
    `${IMPORT}prisma.comentario.findMany({ include: { residente: true } });`,
    `${IMPORT}prisma.domicilio.findMany({ select: { usuario: true } });`,
    `${IMPORT}prisma.package.findMany({ include: { user: true } });`,
    `${IMPORT}prisma.package.findMany({ include: { residente: true, domicilio: true } });`,
  ]) {
    assert.ok(analizar(codigo).seleccionesConCorreo.length >= 1, `debe fallar: ${codigo}`);
  }
});

test('(c) una relación a User sin `select` (include anidado) también trae todo y falla', () => {
  assert.ok(analizar(`${IMPORT}prisma.package.findMany({ include: { residente: { include: { domicilios: true } } } });`).seleccionesConCorreo.length >= 1);
  assert.ok(analizar(`${IMPORT}prisma.package.findMany({ select: { residente: {} } });`).seleccionesConCorreo.length >= 1);
});

test('(c) `select` con email o passwordHash dentro de la relación falla (también anidado, con constantes y spread)', () => {
  for (const codigo of [
    `${IMPORT}prisma.package.findMany({ select: { residente: { select: { nombre: true, email: true } } } });`,
    `${IMPORT}prisma.package.findMany({ include: { residente: { select: { passwordHash: true } } } });`,
    `${IMPORT}prisma.package.findMany({ select: { domicilio: { select: { usuario: { select: { email: true } } } } } });`,
    `${IMPORT}const CONTACTO = { id: true, email: true };\nprisma.package.findMany({ select: { residente: { select: CONTACTO } } });`,
    `${IMPORT}const BASE = { email: true };\nprisma.package.findMany({ select: { residente: { select: { ...BASE, nombre: true } } } });`,
    `${IMPORT}const SEL = { residente: { select: { email: true } } };\nprisma.package.findMany({ select: SEL });`,
    `${IMPORT}prisma.paqueteEvento.findMany({ include: { actor: true } });`,
  ]) {
    assert.ok(analizar(codigo).seleccionesConCorreo.length >= 1, `debe fallar: ${codigo}`);
  }
});

test('(c) lo legítimo pasa: select de columnas sin correo, `where` con `residente: { is }`, email: false', () => {
  const r = analizar(`${IMPORT}
prisma.package.findMany({
  where: { residente: { is: { nombre: { contains: 'a' } } }, OR: [{ domicilioId: null, residente: { is: { apto: { contains: '1' } } } }] },
  select: {
    id: true,
    domicilio: { select: { nombreRecibe: true, telefono: true } },
    residente: { select: { id: true, nombre: true, telefono: true, torre: true, apto: true } },
  },
});
prisma.comentario.findMany({ include: { residente: { select: { nombre: true } } } });
prisma.package.findMany({ select: { residente: { select: { nombre: true, email: false } } } });`);
  assert.deepEqual(r.seleccionesConCorreo, []);
});

test('relacionesHaciaUser lee del esquema los campos cuyo tipo es User', () => {
  const rels = relacionesHaciaUser(`
model Package {
  residente User? @relation(fields: [residenteId], references: [id])
  domicilio Domicilio? @relation(fields: [domicilioId], references: [id])
}
model PaqueteEvento {
  actor    User?    @relation(fields: [actorId], references: [id])
}
model Domicilio {
  usuario      User     @relation(fields: [usuarioId], references: [id])
}`);
  assert.deepEqual([...rels].sort(), ['actor', 'residente', 'user', 'usuario']);
});
