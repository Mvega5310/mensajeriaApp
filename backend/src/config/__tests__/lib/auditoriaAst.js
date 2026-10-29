// Analizador ESTÁTICO de las auditorías de invariantes (revisión S3.2, hallazgo E7.4), hecho con
// un parser real (`acorn`, devDependency) en vez de expresiones regulares: un regex sobre líneas
// se evade con un alias (`import { prisma as db }`), con `db['user']`, con
// `const { user } = prisma`, con un `$transaction((t) => t.user...)`, con un
// `include: { residente: true }` que arrastra el correo y el hash, etc. Aquí se mira el ÁRBOL, así
// que los comentarios y las cadenas no cuentan y los alias, la desestructuración y el acceso
// computado sí.
//
// No es un archivo de prueba (no termina en .test.js): lo importan auditoriaInvariantes.test.js y
// auditoriaAst.test.js (que demuestra, con fixtures, que cada evasión conocida FALLA).
//
// Cada análisis devuelve una lista de hallazgos { linea, regla, detalle }.

import { parse } from 'acorn';
import { resolve, dirname, join } from 'node:path';

/** Nombres que suelen llevar un cliente de Prisma (parámetros de transacción, etc.). */
const NOMBRE_DE_CLIENTE = /^(prisma|tx|trx|cliente|client|db|conn|orm)$/i;
/** Columnas de User que un operador jamás debe recibir. */
const COLUMNAS_PROHIBIDAS = new Set(['email', 'passwordHash']);

export function parsear(codigo) {
  return parse(codigo, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
}

function hijos(nodo) {
  const out = [];
  for (const k of Object.keys(nodo)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = nodo[k];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') out.push(x); } else if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

/** Recorre el árbol; `fn(nodo, padre)`. */
export function recorrer(nodo, fn, padre = null) {
  fn(nodo, padre);
  for (const h of hijos(nodo)) recorrer(h, fn, nodo);
}

const linea = (n) => n.loc.start.line;
const nombreClave = (p) => {
  const k = p.key;
  if (!k) return null;
  if (!p.computed && k.type === 'Identifier') return k.name;
  if (k.type === 'Literal' && typeof k.value === 'string') return k.value;
  if (k.type === 'TemplateLiteral' && k.expressions.length === 0) return k.quasis[0].value.cooked;
  return null;
};
/** Nombre estático de la propiedad de un MemberExpression (`.x`, `['x']`, `[`x`]`), o null si es dinámico. */
function nombrePropiedad(m) {
  const p = m.property;
  if (!m.computed && p.type === 'Identifier') return p.name;
  if (p.type === 'Literal' && typeof p.value === 'string') return p.value;
  if (p.type === 'TemplateLiteral' && p.expressions.length === 0) return p.quasis[0].value.cooked;
  return null;
}

// ---------------------------------------------------------------------------------------------
// 1. Quién importa el cliente de config/db.js, y con qué identificadores
// ---------------------------------------------------------------------------------------------

/** ¿`fuente` (ruta de import) resuelve a backend/src/config/db.js desde `archivo`? */
export function apuntaADb(fuente, archivo, raizBackend) {
  if (typeof fuente !== 'string' || !fuente.startsWith('.')) return false;
  const destino = resolve(dirname(archivo), fuente).replace(/\.js$/, '');
  return destino === join(raizBackend, 'src', 'config', 'db');
}

/**
 * Importaciones del cliente de db.js.
 * @returns {{ importa: boolean, identificadores: Set<string>, hallazgos: Array }} `importa`: el archivo
 *   trae el cliente de alguna forma (import estático, dinámico, require, re-export). `hallazgos`: las
 *   formas que NUNCA se permiten (alias, re-export, import dinámico/require, namespace).
 */
export function importacionesDeDb(ast, archivo, raizBackend) {
  const identificadores = new Set();
  const hallazgos = [];
  let importa = false;
  const malo = (n, detalle) => hallazgos.push({ linea: linea(n), regla: 'import-db', detalle });
  recorrer(ast, (n) => {
    if (n.type === 'ImportDeclaration' && apuntaADb(n.source.value, archivo, raizBackend)) {
      importa = true;
      for (const s of n.specifiers) {
        identificadores.add(s.local.name);
        if (s.type === 'ImportNamespaceSpecifier') malo(n, `import * as ${s.local.name} del cliente: importa solo \`{ prisma }\``);
        else if (s.type === 'ImportDefaultSpecifier') malo(n, `import por defecto (${s.local.name}) del cliente: importa solo \`{ prisma }\``);
        else if (s.imported.name !== 'prisma') malo(n, `importa \`${s.imported.name}\` de db.js (solo se permite \`prisma\`)`);
        else if (s.local.name !== 'prisma') malo(n, `alias del cliente (\`prisma as ${s.local.name}\`): evade la auditoría de User`);
      }
    }
    if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source && apuntaADb(n.source.value, archivo, raizBackend)) {
      importa = true;
      malo(n, 're-exporta el cliente de db.js: cada archivo debe importarlo directo');
    }
    if (n.type === 'ImportExpression' && n.source.type === 'Literal' && apuntaADb(n.source.value, archivo, raizBackend)) {
      importa = true;
      malo(n, 'import() dinámico del cliente de db.js');
    }
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require'
      && n.arguments[0]?.type === 'Literal' && apuntaADb(n.arguments[0].value, archivo, raizBackend)) {
      importa = true;
      malo(n, 'require() del cliente de db.js');
    }
  });
  return { importa, identificadores, hallazgos };
}

// ---------------------------------------------------------------------------------------------
// 2. Acceso al modelo `User` desde cualquier cliente o transacción
// ---------------------------------------------------------------------------------------------

/** Identificadores que (transitivamente) llevan el cliente: los importados de db.js, sus alias y los parámetros de `$transaction`. */
function clientesRastreados(ast, base) {
  const t = new Set(base);
  const esCliente = (n) => (n.type === 'Identifier' && (t.has(n.name) || NOMBRE_DE_CLIENTE.test(n.name)))
    || (n.type === 'MemberExpression' && n.object.type === 'Identifier' && t.has(n.object.name) && nombrePropiedad(n) === 'prisma');
  // Varias pasadas: el alias de un alias.
  for (let i = 0; i < 3; i += 1) {
    recorrer(ast, (n) => {
      if (n.type === 'VariableDeclarator' && n.init && esCliente(n.init)) {
        if (n.id.type === 'Identifier') t.add(n.id.name);
        if (n.id.type === 'ObjectPattern') for (const p of n.id.properties) if (p.value?.type === 'Identifier') t.add(p.value.name);
      }
      if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && esCliente(n.right)) t.add(n.left.name);
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && nombrePropiedad(n.callee) === '$transaction' && esCliente(n.callee.object)) {
        const f = n.arguments[0];
        if ((f?.type === 'ArrowFunctionExpression' || f?.type === 'FunctionExpression') && f.params[0]?.type === 'Identifier') t.add(f.params[0].name);
      }
    });
  }
  return t;
}

/**
 * Accesos a `User`: `x.user`, `x['user']`, `x[`user`]`, `const { user } = x`, `({ user }) =>` y
 * el acceso computado dinámico (`prisma[nombre]`) sobre un cliente. Se ignora `req.user` (el
 * payload del JWT) y la desestructuración de `req`.
 */
export function accesosAUser(ast, identificadoresDb = new Set()) {
  const clientes = clientesRastreados(ast, identificadoresDb);
  const hallazgos = [];
  const esReq = (o) => (o.type === 'Identifier' && /^(req|request)$/.test(o.name))
    || (o.type === 'MemberExpression' && /^(req|request)$/.test(nombrePropiedad(o) ?? ''));
  const malo = (n, detalle) => hallazgos.push({ linea: linea(n), regla: 'acceso-user', detalle });
  recorrer(ast, (n, padre) => {
    if (n.type === 'MemberExpression') {
      const nombre = nombrePropiedad(n);
      if (nombre === 'user' && !esReq(n.object)) malo(n, 'acceso a `.user` fuera de usuario.service.js');
      if (nombre === null && n.computed) {
        const o = n.object;
        const cliente = (o.type === 'Identifier' && (clientes.has(o.name) || NOMBRE_DE_CLIENTE.test(o.name)))
          || (o.type === 'MemberExpression' && nombrePropiedad(o) === 'prisma');
        if (cliente) malo(n, 'acceso computado dinámico sobre un cliente de Prisma (podría ser `user`)');
      }
    }
    if (n.type === 'ObjectPattern') {
      const dueno = padre?.type === 'VariableDeclarator' ? padre.init : padre?.type === 'AssignmentExpression' ? padre.right : null;
      for (const p of n.properties) {
        if (p.type === 'Property' && nombreClave(p) === 'user' && !(dueno && esReq(dueno))) {
          malo(p, 'desestructura `user` de un cliente (`const { user } = prisma`)');
        }
      }
    }
  });
  return hallazgos;
}

// ---------------------------------------------------------------------------------------------
// 3. `select`/`include` que arrastran el correo o el hash de la cuenta
// ---------------------------------------------------------------------------------------------

/**
 * Relaciones hacia `User` con `select`/`include`: una relación a User con `true` (o con un objeto sin
 * `select`) trae TODAS sus columnas, y con `select: { email | passwordHash }` las trae a propósito.
 * Solo usuario.service.js puede hacerlo (el operador nunca lee cuentas de residentes).
 * @param {Set<string>} relacionesUser nombres de campos del esquema cuyo tipo es User (más `user`).
 */
export function seleccionesConCorreo(ast, relacionesUser) {
  const rel = new Set([...relacionesUser, 'user', 'usuario', 'residente']);
  const hallazgos = [];
  const declarados = new Map(); // const X = {...}  (a nivel de archivo o de función)
  recorrer(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'ObjectExpression') declarados.set(n.id.name, n.init);
  });
  const objeto = (v) => (v?.type === 'Identifier' ? declarados.get(v.name) ?? null : v?.type === 'ObjectExpression' ? v : null);
  const claves = (obj) => {
    const out = [];
    for (const p of obj.properties) {
      if (p.type === 'SpreadElement') { const o = objeto(p.argument); if (o) out.push(...claves(o)); } else out.push(p);
    }
    return out;
  };
  const visto = new Set();
  const malo = (n, detalle) => {
    const k = `${linea(n)}:${detalle}`;
    if (!visto.has(k)) { visto.add(k); hallazgos.push({ linea: linea(n), regla: 'select-correo', detalle }); }
  };
  // `select`/`include` de una relación a User: revisa qué columnas trae.
  const revisarRelacion = (p) => {
    const nombre = nombreClave(p);
    const v = p.value;
    if (v.type === 'Literal' && v.value === true) return malo(p, `\`${nombre}: true\` trae toda la cuenta (correo y hash incluidos)`);
    const o = objeto(v);
    if (!o) return undefined;
    const props = claves(o);
    const sel = props.find((x) => x.type === 'Property' && nombreClave(x) === 'select');
    if (!sel) return malo(p, `\`${nombre}\` sin \`select\` trae toda la cuenta (correo y hash incluidos)`);
    const so = objeto(sel.value);
    if (so) {
      for (const c of claves(so)) {
        const k = c.type === 'Property' ? nombreClave(c) : null;
        if (k && COLUMNAS_PROHIBIDAS.has(k) && !(c.value.type === 'Literal' && c.value.value === false)) malo(c, `\`${nombre}\` selecciona \`${k}\``);
      }
    }
    return undefined;
  };
  const revisarSelect = (obj) => {
    for (const p of claves(obj)) {
      if (p.type === 'Property' && rel.has(nombreClave(p) ?? '')) revisarRelacion(p);
    }
  };
  recorrer(ast, (n) => {
    if (n.type === 'Property' && ['select', 'include'].includes(nombreClave(n))) {
      const o = objeto(n.value);
      if (o) revisarSelect(o);
    }
  });
  return hallazgos;
}

/** Nombres de campos del esquema Prisma cuyo tipo es `User` (`residente`, `usuario`, `actor`, `operador`…). */
export function relacionesHaciaUser(esquema) {
  const out = new Set(['user']);
  for (const m of esquema.matchAll(/^\s+(\w+)\s+User(\?|\[\])?\s+@relation/gm)) out.add(m[1]);
  return out;
}

/** Análisis completo de un archivo. */
export function analizarArchivo({ codigo, archivo, raizBackend, relacionesUser }) {
  const ast = parsear(codigo);
  const imp = importacionesDeDb(ast, archivo, raizBackend);
  return {
    importaDb: imp.importa,
    importsMalos: imp.hallazgos,
    accesosUser: accesosAUser(ast, imp.identificadores),
    seleccionesConCorreo: seleccionesConCorreo(ast, relacionesUser),
  };
}
