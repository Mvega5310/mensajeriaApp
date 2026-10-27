import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { tenantStore, SCOPE, runWithTenant } from '../config/tenantContext.js';
import { resolverConjuntoIdPorUsuario } from '../config/tenantBootstrap.js';
import { normalizarCodigoInvitacion } from '../services/invitacion.service.js';
import { PASSWORD_POLICY, PASSWORD_POLICY_MSG } from '../services/password.service.js';
import { enSegundoPlano } from '../services/avisos.service.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { normalizarTorre, normalizarApto } from '../services/apartamento.service.js';

// ÚNICO punto del código autorizado a abrir el scope GLOBAL_LOOKUP
// (invariante design.md §2.3.1). Resuelve un usuario por email SIN filtro de
// tenant, para las lecturas pre-tenant de autenticación (login), donde todavía
// no hay conjunto activo.
//
// REGLA: `tenantStore.run({ scope: SCOPE.GLOBAL_LOOKUP }, ...)` debe aparecer
// EXACTAMENTE UNA VEZ en todo el repositorio, y es aquí. Ninguna otra función
// puede abrir este scope; todo lookup pre-tenant por email pasa por aquí.
export function buscarUsuarioPorEmailSinTenant(email) {
  // El await va DENTRO del run(): PrismaPromise es perezosa y, sin await aquí,
  // el scope GLOBAL_LOOKUP se cerraría antes de que la query corra (mismo motivo
  // que runWithTenant, design.md §2.3).
  return tenantStore.run({ scope: SCOPE.GLOBAL_LOOKUP }, async () =>
    await prisma.user.findUnique({ where: { email } })
  );
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const RESET_COOLDOWN_MS = 60 * 1000; // evita reenvíos en cadena al mismo correo
const ENLACE_TTL_MS = 15 * 60 * 1000; // enlace de acceso (T3.2): 15 min, un solo uso

// PASSWORD_POLICY vive ahora en services/password.service.js (fuente única
// compartida con el script de alta de conjunto).

// El registro público solo crea cuentas RESIDENT — el rol nunca sale del
// body de la petición. La cuenta de operador se crea aparte (ver
// prisma/seed.js), para que nadie pueda auto-asignarse ese rol.
export async function register(req, res) {
  const { email, password, nombre, telefono, torre, apto, acceptedTerms, codigoInvitacion } = req.body;
  if (!email || !password || !nombre || !telefono) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Faltan datos obligatorios. Completa correo, contraseña, nombre y teléfono.', 400);
  }
  if (!PASSWORD_POLICY.test(password)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, PASSWORD_POLICY_MSG, 400);
  }
  // No basta con que el checkbox exista en el formulario: si alguien pega
  // directo contra la API sin aceptar, no hay cuenta. La fecha exacta
  // queda en termsAcceptedAt como constancia de la aceptación.
  if (acceptedTerms !== true) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Para crear tu cuenta, acepta los Términos y el Aviso de Privacidad.', 400);
  }

  // Flujo pre-tenant (design.md §3.4, §3.6.2): el registro ESTABLECE el tenant a
  // partir del código de invitación, no lo asume.
  // 1) Validar el código. Conjunto es un modelo SIN tenant, así que esta
  //    lectura está exenta del filtro y no requiere contexto.
  // El campo `code` estable permite que el frontend detecte este caso sin
  // depender del texto del mensaje (revisión C5).
  if (!codigoInvitacion) {
    throw new AppError(CODIGOS.INVITACION_INVALIDA, 'Necesitas el enlace de invitación de tu conjunto para registrarte. Pídelo a la administración.', 400);
  }
  // Normaliza caja y espacios para que un código tecleado a mano coincida con
  // la forma canónica persistida (revisión C5).
  const codigoNormalizado = normalizarCodigoInvitacion(codigoInvitacion);
  const conjunto = await prisma.conjunto.findUnique({ where: { codigoInvitacion: codigoNormalizado } });
  if (!conjunto || !conjunto.invitacionActiva) {
    throw new AppError(CODIGOS.INVITACION_INVALIDA, 'El enlace de invitación no es válido o ya venció. Pide uno nuevo a la administración.', 400);
  }

  // 2) ¿Correo ya registrado? email es @unique GLOBAL; el lookup sin sesión
  //    pasa por el único punto autorizado a resolver por email sin contexto.
  const existing = await buscarUsuarioPorEmailSinTenant(email);
  if (existing) throw new AppError(CODIGOS.CONFLICTO, 'Ese correo ya tiene una cuenta. Inicia sesión o usa otro correo.', 409);

  const passwordHash = await bcrypt.hash(password, 10);

  // 3) Crear el usuario DENTRO del contexto del conjunto validado. La extensión
  //    fija conjuntoId desde el contexto; NO se pasa conjuntoId en data. El rol
  //    es SIEMPRE RESIDENT (nunca sale del body).
  try {
    const user = await runWithTenant({ conjuntoId: conjunto.id, role: 'RESIDENT' }, () =>
      prisma.user.create({
        data: {
          email, passwordHash, role: 'RESIDENT', nombre, telefono,
          // Normalizado server-side (no basta con que el frontend ya mande
          // el valor "limpio" — cualquiera puede pegar directo contra la
          // API): así la cortesía de primera entrega por apartamento (ver
          // packages.controller.js) puede agrupar cuentas distintas del
          // mismo apto sin que la inconsistencia de escritura lo impida.
          torre: normalizarTorre(torre),
          apto: normalizarApto(apto),
          termsAcceptedAt: new Date(),
        },
      })
    );
    return res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    // Carrera entre dos registros simultáneos con el mismo email: el @unique
    // global dispara P2002. Respondemos 409 en vez de 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(CODIGOS.CONFLICTO, 'Ese correo ya tiene una cuenta. Inicia sesión o usa otro correo.', 409);
    }
    throw err;
  }
}

export async function login(req, res) {
  const { email, password } = req.body;
  // Límite por IP (T1.4): 10 intentos fallidos cada 15 min. El intento se
  // RESERVA de forma síncrona, antes de cualquier await (BD o bcrypt): si no,
  // una ráfaga paralela pasaría toda la consulta antes de que se registre un
  // solo fallo. Un acierto devuelve únicamente su propia reserva (no reinicia
  // el contador: quien tenga cuenta propia no puede blanquear sus fallos).
  const limitador = req.app.locals.limitadorLogin;
  const intento = limitador.intentar(req.ip);
  if (!intento.permitido) {
    const minutos = intento.minutosRestantes;
    res.set('Retry-After', String(intento.segundosRestantes));
    throw new AppError(
      CODIGOS.DEMASIADOS_INTENTOS,
      `Demasiados intentos. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.`,
      429,
      { minutosRestantes: minutos },
    );
  }
  // Flujo sin sesión: el conjunto se descubre a partir de la credencial. El
  // lookup por email pasa por el único punto autorizado a resolver sin contexto
  // (design.md §3.6.2). El JWT NO lleva claim de conjunto: el conjunto se
  // resuelve por `sub` en cada request (§3.6).
  const user = await buscarUsuarioPorEmailSinTenant(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(CODIGOS.CREDENCIALES_INVALIDAS, 'Correo o contraseña incorrectos. Revísalos e intenta de nuevo.', 401);
  }

  limitador.devolver(req.ip, intento.reserva);

  res.json(sesionDe(user));
}

// Sesión normal (la misma del login con contraseña): JWT { sub, role } SIN
// `scope`. Lo comparten login y el canje del enlace de acceso (T3.2).
function sesionDe(user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  return { token, user: { id: user.id, nombre: user.nombre, role: user.role } };
}

// Respuesta idéntica exista o no la cuenta — si dijera "correo no
// encontrado" cualquiera podría usar este endpoint para averiguar qué
// vecinos están registrados en la app.
const GENERIC_RESET_RESPONSE = { message: 'Si el correo existe, enviamos un enlace para restablecer la contraseña.' };

export async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Escribe tu correo para enviarte el enlace.', 400);

  // Flujo sin sesión: el usuario aún no está autenticado, así que no hay
  // contexto de tenant. La búsqueda por email pasa por la única función
  // autorizada a abrir GLOBAL_LOOKUP (design.md §2.3.1, §3.6).
  const user = await buscarUsuarioPorEmailSinTenant(email);
  if (!user) return res.json(GENERIC_RESET_RESPONSE);

  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, proposito: 'RESET', createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
  });
  if (recent) return res.json(GENERIC_RESET_RESPONSE);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  const resetUrl = `${process.env.FRONTEND_URL}/restablecer?token=${rawToken}`;
  // Conjunto es un modelo sin tenant: se lee directo (solo para el nombre en el correo).
  const conjunto = user.conjuntoId
    ? await prisma.conjunto.findUnique({ where: { id: user.conjuntoId } })
    : null;
  enSegundoPlano('recuperacion', () => req.app.locals.notificador.recuperarContrasena({
    email: user.email, url: resetUrl, conjunto,
  }));

  res.json(GENERIC_RESET_RESPONSE);
}

export async function resetPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password) throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Faltan datos para restablecer la contraseña. Abre de nuevo el enlace del correo.', 400);
  if (!PASSWORD_POLICY.test(password)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, PASSWORD_POLICY_MSG, 400);
  }

  // PasswordResetToken es un modelo SIN tenant: este findFirst no requiere
  // contexto y pasa tal cual por la extensión.
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  // `proposito: 'RESET'`: un token de enlace de acceso no sirve para cambiar la contraseña.
  const record = await prisma.passwordResetToken.findFirst({ where: { tokenHash, proposito: 'RESET' } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError(CODIGOS.ENLACE_INVALIDO, 'El enlace no es válido o ya venció. Pide uno nuevo desde "Olvidé mi contraseña".', 400);
  }

  // Flujo sin sesión: no hay JWT, así que resolvemos el conjunto del dueño del
  // token por su id (bootstrap del tenant) y ejecutamos la actualización de
  // User dentro de ese contexto. user.update es un modelo con tenant y sin
  // contexto la extensión lanzaría (falla cerrado).
  const conjuntoId = await resolverConjuntoIdPorUsuario(record.userId);
  if (!conjuntoId) {
    throw new AppError(CODIGOS.ENLACE_INVALIDO, 'El enlace no es válido o ya venció. Pide uno nuevo desde "Olvidé mi contraseña".', 400);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await runWithTenant({ conjuntoId, role: 'RESIDENT' }, () =>
    prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      // invalida también cualquier otro enlace pendiente de esta cuenta
      // (PasswordResetToken es sin tenant; el deleteMany pasa sin filtrar).
      prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
    ])
  );

  res.json({ message: 'Contraseña actualizada' });
}

// --- Enlace de acceso por correo (T3.2) ---
// Respuesta idéntica exista o no la cuenta, se haya enviado o no (límite).
const GENERIC_ENLACE_RESPONSE = { message: 'Si el correo está registrado, te llegará un enlace para entrar. Revisa tu bandeja.' };
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function solicitarEnlace(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  // Límite por correo+IP, reservado de forma síncrona antes de cualquier await.
  // Excedido (o correo vacío): misma respuesta 200, simplemente no se envía.
  const intento = email
    ? req.app.locals.limitadorEnlace.intentar(`${email.toLowerCase()}|${req.ip}`)
    : { permitido: false };
  if (intento.permitido) {
    // Todo el trabajo que distingue "existe" de "no existe" (consulta, token,
    // correo) va en segundo plano: el tiempo de respuesta no revela la cuenta.
    enSegundoPlano('enlaceAcceso', async () => {
      const user = await buscarUsuarioPorEmailSinTenant(email);
      if (!user) return;
      const rawToken = crypto.randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(rawToken), proposito: 'ACCESO', expiresAt: new Date(Date.now() + ENLACE_TTL_MS) },
      });
      const base = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
      // Conjunto es un modelo sin tenant (mismo patrón que forgotPassword).
      const conjunto = user.conjuntoId
        ? await prisma.conjunto.findUnique({ where: { id: user.conjuntoId } })
        : null;
      await req.app.locals.notificador.enviarEnlaceAcceso({ email: user.email, url: `${base}/acceso/${rawToken}`, conjunto });
    });
  }
  res.json(GENERIC_ENLACE_RESPONSE);
}

export async function canjearEnlace(req, res) {
  const token = req.body?.token;
  const invalido = () => new AppError(CODIGOS.ENLACE_INVALIDO, 'El enlace ya no sirve. Pide uno nuevo.', 400);
  if (typeof token !== 'string' || !token) throw invalido();

  const tokenHash = hashToken(token);
  // Canje atómico: solo un `updateMany` condicional gana (count === 1); dos
  // canjes simultáneos del mismo token no pueden ser ambos válidos.
  const ahora = new Date();
  const { count } = await prisma.passwordResetToken.updateMany({
    where: { tokenHash, proposito: 'ACCESO', usedAt: null, expiresAt: { gt: ahora } },
    data: { usedAt: ahora },
  });
  if (count !== 1) throw invalido();

  const record = await prisma.passwordResetToken.findFirst({ where: { tokenHash, proposito: 'ACCESO' } });
  // El usuario se lee por id dentro de su propio conjunto (bootstrap del tenant).
  const conjuntoId = record ? await resolverConjuntoIdPorUsuario(record.userId) : null;
  const user = conjuntoId
    ? await runWithTenant({ conjuntoId, role: 'RESIDENT' }, () => prisma.user.findUnique({ where: { id: record.userId } }))
    : null;
  if (!user) throw invalido();

  res.json(sesionDe(user));
}

export async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos tu usuario. Inicia sesión de nuevo.', 404);
  const { passwordHash, ...profile } = user;
  res.json(profile);
}
