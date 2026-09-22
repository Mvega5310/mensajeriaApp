# KAN-8 — Soporte multi-conjunto (multitenant) para Puertayá — Plan de tareas

> **Origen:** implementa `requirements.md` y `design.md` de esta spec. Cada tarea referencia los
> requisitos (`Rx.y`) y las secciones de diseño (`§x`) que la sustentan.
>
> **Restricciones duras que aplican a TODAS las tareas** (de §8.1 del diseño):
> - `GET /packages` y `GET /packages/mine` **nunca** incluyen `fotoUrl`.
> - `bonosHabilitados` en `false` por defecto para cualquier conjunto nuevo; `BONOS_HABILITADOS` sigue
>   apagado.
> - WhatsApp sigue siendo manual (`wa.me`); no Twilio ni WhatsApp Business API.
> - Sin pasarela de pagos.
> - **Un único `PrismaClient` extendido**; prohibido un segundo cliente sin la extensión de tenant.
> - Código de prueba, si se genera, va a `develop`; **nunca** a `main`.
> - La migración real de esquema se aplica por túnel SSH de Railway contra Postgres de producción; las
>   tareas de migración aquí solo preparan/definen, no ejecutan contra producción sin aprobación.

---

## Fase A — Modelo de datos (esquema Prisma)

- [x] **A1. Crear el modelo `Conjunto`.** _(commit `cf5772c`)_
  - Añadir el modelo `Conjunto` con: `id`, `nombre`, `slug @unique`, `codigoInvitacion @unique`,
    `invitacionActiva`, `operadorNombre`, `operadorWhatsapp`, `operadorDomicilio`, `puntoRecepcion`,
    `tarifaMano/Estandar/Volumen/Pesado` (con `@default` = 3000/4500/7000/12000), `bonosHabilitados`
    (`@default(false)`), `createdAt`, `updatedAt`, y relaciones inversas.
  - _Requisitos:_ R2.1, R2.3, R2.6 · _Diseño:_ §1.1

- [x] **A2. Añadir `conjuntoId` (nullable) y relaciones a los modelos con tenant.** _(commit `4ccf27f`)_
  - Agregar `conjuntoId String?` + relación a `Conjunto` en `User`, `Package`, `Bono`, `Comentario`
    (nullable en esta fase para permitir el backfill; se endurece en Fase F).
  - **No** tocar `PasswordResetToken` (fuera del tenant).
  - Confirmar que `User.email` permanece `@unique` **global** (sin cambios).
  - _Requisitos:_ R1.1 · _Diseño:_ §1.2, §1.3, §1.4, Nota R5

- [x] **A3. Añadir índices de tenant.** _(commit `4ccf27f`; ajuste de redundantes en commit aparte)_
  - `User`: `@@index([conjuntoId, role])`. `Package`: `@@index([conjuntoId, estado])`.
    `Bono` y `Comentario`: `@@index([conjuntoId])`.
  - **No** se agregan `@@index([conjuntoId])` sueltos en `User`/`Package`: serían redundantes porque
    Postgres usa la primera columna del índice compuesto para las consultas que filtran solo por
    `conjuntoId`. `Bono`/`Comentario` sí llevan el índice simple porque no tienen compuesto.
  - _Diseño:_ §1.2, §1.3

- [ ] **A4. Generar la migración Prisma "expand" (nullable). — PENDIENTE (la genera el equipo con la CLI real).**
  - **NO escribir el `migration.sql` a mano.** El SQL que genera Prisma tiene detalles no replicables a
    ciegas (nombres de constraints/índices, traducción de tipos); una divergencia desincroniza el
    checksum del historial de migraciones justo al aplicarlo contra producción.
  - **Procedimiento:** en local, con la CLI real de Prisma contra un **Postgres desechable**, ejecutar
    `npx prisma migrate dev --name add_conjunto_multitenant` (o equivalente) a partir del `schema.prisma`
    ya actualizado en A1–A3. Esto crea `prisma/migrations/<timestamp>_add_conjunto_multitenant/migration.sql`.
  - Revisar que el SQL añade: tabla `Conjunto`, columnas `conjuntoId` **nullable** + FKs en las 4 tablas,
    e índices de A3. **No** aplicar contra producción todavía (eso es Fase F, por túnel SSH de Railway).
  - Commitear la migración generada en `feature/kan-8-multiconjunto`.
  - _Nota de entorno:_ la CLI de Prisma no se pudo instalar en el sandbox de esta sesión (descarga de
    engines bloqueada por la red restringida); por eso A4 se delega al entorno local.
  - _Requisitos:_ R4.3 · _Diseño:_ §5.2 (Fase 1)

---

## Fase B — Contexto de tenant y extensión de Prisma (núcleo del aislamiento)

- [x] **B1. Implementar `tenantContext.js` (AsyncLocalStorage con `scope`).** _(commit `4981a51`)_
  - Exponer un `AsyncLocalStorage` cuyo valor es unión discriminada:
    `{ scope: 'TENANT', conjuntoId, role }` | `{ scope: 'GLOBAL_LOOKUP' }`.
  - Utilidades para leer el contexto y para ejecutar `run(...)`.
  - _Implementado:_ `src/config/tenantContext.js` (`getContext`, `runWithTenant`; sin helper para
    `GLOBAL_LOOKUP` a propósito). _Diseño:_ §2.3 (componente 1)

- [x] **B2. Definir la lista única de modelos con tenant.** _(commit `a995a18`)_
  - Una constante central `MODELOS_CON_TENANT = ['user','package','bono','comentario']` (contrato de
    §1.5) + helper `esModeloConTenant()`. `Conjunto` y `PasswordResetToken` excluidos.
  - _Implementado:_ `src/config/tenantModels.js`. _Diseño:_ §1.5, §2.3

- [ ] **B3. Implementar la extensión de Prisma (`$extends` con `query`).**
  - Para los modelos de `MODELOS_CON_TENANT`:
    - **Lecturas por filtro** (`findMany`, `findFirst`, `count`, `aggregate`, `groupBy`): inyectar
      `AND: [ argsWhere, { conjuntoId: activo } ]`.
    - **`findUnique`/`findUniqueOrThrow`**: **reescribir a `findFirst`/`findFirstOrThrow`** con el filtro
      de tenant, preservando `select`/`include`.
    - **Creación** (`create`, `createMany`): fijar `data.conjuntoId` **desde el contexto**; ignorar/
      rechazar cualquier `conjuntoId` provisto por el llamador.
    - **`update`/`updateMany`/`delete`/`deleteMany`/`upsert`**: inyectar `where { conjuntoId }` y forzar
      `conjuntoId` en el create/update del upsert.
  - **Regla de `scope`:** `TENANT` → filtra; `GLOBAL_LOOKUP` → exime solo esa operación; **contexto
    ausente → lanza (falla cerrado)**.
  - **Un único cliente extendido**; exportarlo como el `prisma` que usa toda la app.
  - _Implementado:_ `src/config/tenantExtension.js` (lógica en `aplicarAislamiento()`), aplicado en
    `src/config/db.js` sobre el único `PrismaClient`. _Requisitos:_ R1.1–R1.5 · _Diseño:_ §2.3, §2.3.1

- [x] **B4. Implementar el middleware de tenant (Express).** _(commit `42a8135`)_
  - Tras el middleware de auth JWT: resolver `conjuntoId` **cargando el `User` por `sub` contra la BD,
    SIEMPRE** (nunca desde un claim del token, que no existe); abrir
    `run({ scope: 'TENANT', conjuntoId, role }, ...)`.
  - Si el `User` no existe o su `conjuntoId` es `null`/no resoluble → `401` y **no** continuar
    (falla cerrado).
  - Nunca tomar el conjunto de query/body/headers ni de ningún claim del cliente.
  - _Implementado:_ `src/middleware/tenant.middleware.js` (`requireTenant`).
  - **Bootstrap del tenant (aprobado en revisión, pto 4):** la lectura de `User.conjuntoId` por `sub`
    vive en `resolverConjuntoIdPorUsuario()` (`config/tenantBootstrap.js`) usando `prisma.$queryRaw`
    parametrizado por `id`: no usa `GLOBAL_LOOKUP` ni un segundo cliente; `$queryRaw` no atraviesa la
    capa de modelos, así que no dispara el falla-cerrado. Documentado en design.md §2.3 (bootstrap) y
    §3.6.2; invariante de consultas crudas en el checklist.
  - _Requisitos:_ R1.3, R1.5, R3.6 · _Diseño:_ §2.3 (componente 2), §3.6

- [x] **B5. Implementar `buscarUsuarioPorEmailSinTenant()` — ÚNICO punto de entrada de `GLOBAL_LOOKUP`.** _(commit `398de13`)_
  - Encapsulada en `src/controllers/auth.controller.js`; envuelve `prisma.user.findUnique({where:{email}})`
    en `tenantStore.run({ scope: SCOPE.GLOBAL_LOOKUP }, ...)`.
  - **Invariante verificada por auditoría:** la única línea *ejecutable* que abre `GLOBAL_LOOKUP` es
    `auth.controller.js` (las demás coincidencias de grep son comentarios). El **cableado de `login()`
    para usarla es C3** (aquí solo se agrega la función).
  - _Requisitos:_ R1.3 · _Diseño:_ §2.3.1, §8.1

- [x] **B6. Pruebas del mecanismo de aislamiento.** _(commit `1301ff7`; a esta rama feature, nunca `main`)_
  - Cubre: modelos sin tenant pasan sin contexto; contexto ausente lanza (falla cerrado); `GLOBAL_LOOKUP`
    exime; inyección de filtro en lecturas; reescritura `findUnique→findFirst`; `create` fuerza
    `conjuntoId` y rechaza uno distinto; `update`/`deleteMany`/`upsert` filtran; operación no soportada
    lanza; y las pruebas de contexto (anidamiento, propagación, rechazo de `conjuntoId` vacío).
  - Runner `node:test` (sin dependencias nuevas), `npm test` = `node --test`.
  - **VERIFICADO en el sandbox:** los 6 tests de `tenantContext.test.js` PASAN.
  - **PENDIENTE DE PRUEBA LOCAL:** `tenantExtension.helpers.test.js` y `tenantExtension.interceptor.test.js`
    importan `@prisma/client` (requieren `prisma generate`); sintaxis verificada, ejecución delegada al
    entorno local.
  - _Requisitos:_ R1.1–R1.5 · _Diseño:_ §2.3, §2.3.1

---

## Fase C — Registro y login con conjunto

- [x] **C1. Código de invitación por conjunto.** _(commit `4ca914d`, en la revisión de Fase B)_
  - `services/invitacion.service.js` → `generarCodigoInvitacion()` opaco (`crypto.randomBytes`, base32
    sin ambiguos, prefijo por slug); persistido en `Conjunto`. `invitacionActiva` permite revocar sin
    afectar a residentes ya registrados. Lo usan el seed y `register` (valida por `codigoInvitacion`).
  - _Requisitos:_ R3.1, R3.7 · _Diseño:_ §3.1, §3.2

- [x] **C2. `register()` en `auth.controller.js`.** _(commit `a79d3e8`)_
  - Valida `codigoInvitacion` (Conjunto exento) + `invitacionActiva`; ausente/inexistente/inactivo →
    `400` y no crea; email existente → `409` (incl. carrera P2002); crea el `User` dentro de
    `runWithTenant({ conjuntoId, role: 'RESIDENT' })` **sin** `conjuntoId` en `data`; conserva
    normalización torre/apto y validaciones existentes.
  - _Nota:_ el diseño mencionaba `410` para inactivo; se unificó en `400` ("inválido o vencido") para no
    distinguir estados de invitación ante el cliente. _Requisitos:_ R3.1–R3.5 · _Diseño:_ §3.4, §6.6

- [x] **C3. `login()` en `auth.controller.js`.** _(commit `9d9c49b`)_
  - Usa `buscarUsuarioPorEmailSinTenant()`; verifica contraseña; emite JWT (sin claim de conjunto). No
    abre `GLOBAL_LOOKUP` directamente. _Requisitos:_ R3.6 · _Diseño:_ §2.3.1, §6.6

- [x] **C4. JWT SIN claim de conjunto.** _(cubierto por C3; sin cambios respecto a B)_
  - El payload lleva `sub` y `role`, **no** `conjuntoId`; el conjunto se resuelve por `sub` en el
    middleware. _Requisitos:_ R3.6 · _Diseño:_ §3.6

- [x] **C-guard. Montar `requireTenant` en rutas autenticadas + prueba estructural.** _(commit `01a3315`; revisión C pt 2)_
  - `requireTenant` tras `requireAuth` en packages/bonos/comments (`router.use`) y en `/me`. Prueba
    `routes/__tests__/tenantGuard.routes.test.js` recorre cada router y falla si una ruta con
    `requireAuth` no lleva `requireTenant` después; rutas pre-tenant de auth como excepción explícita.
  - _Requisitos:_ R1.3, R1.5

- [x] **C5. Frontend — flujo de registro por enlace/QR.** _(commit `b1a9178`; rev C pt 1)_
  - `Register.jsx` lee `?c=` (`useSearchParams`) y lo envía como `codigoInvitacion`. Si no hay `c`,
    muestra el campo "Código de invitación" (trim, acepta mayús/minús) con nota de que lo entrega el
    operador — esto cubre los flyers KAN-3 sin `?c=`. Ante error, muestra el mensaje y conserva el resto
    del formulario. Sin código/conjunto por defecto (ni env ni fijo).
  - **Normalización del código (rev C5 pt1, commit `331480b`):** `normalizarCodigoInvitacion()` en
    `invitacion.service.js` (quita espacios; minúsculas antes del último guion, mayúsculas después; sin
    guion → todo mayúsculas). `register()` la aplica antes de buscar el `Conjunto`. Confirmado que
    `generarCodigoInvitacion()` ya produce esa forma canónica. 8/8 pruebas unitarias (autónomas) pasan.
  - **Corregir `?c=` inválido (rev C5 pt2, commit `fca51ec`):** si un `?c=` de la URL falla, se muestra el
    campo precargado con ese valor para corregirlo, conservando el resto del formulario.
  - ⚠️ **Verificación en navegador PENDIENTE (local):** los 3 caminos (con `?c=` válido / sin código a
    mano / código inválido) + el de corrección de `?c=` inválido. No ejecutable en el sandbox (sin
    navegador; `npm install` del frontend se cuelga por la red). Patrón idéntico a `ResetPassword.jsx`.
  - _Requisitos:_ R3.2, R3.3, R3.4 · _Diseño:_ §3.3, §6.8

- [x] **C-http. Prueba HTTP de extremo a extremo + separación de `app.js`.** _(commit anterior; rev C pt 2)_
  - `src/app.js` (`createApp`) separado de `index.js` (solo `listen`). Prueba `http.integration.test.js`
    con `app.listen(0)` + `fetch` nativo (sin deps nuevas), misma guarda de localhost: register→login→
    `/packages/mine`; operador de A no ve paquetes de B por `/packages` ni `/packages/:id/foto` (404);
    `/packages` nunca expone `fotoUrl`; sin token → 401.

---

## Fase D — Configuración por conjunto

- [ ] **D1. `services/tariff.service.js` — tarifas desde el conjunto.**
  - Reemplazar la constante fija como fuente de verdad por una función que devuelve las tarifas del
    `Conjunto` activo; conservar los valores actuales solo como defaults documentados.
  - _Requisitos:_ R2.2, R2.3 · _Diseño:_ §4.2, §6.7

- [ ] **D2. Endpoint `GET /conjuntos/:slug/config-publica` (nuevo).**
  - Devolver solo campos presentacionales (`nombre`, `operadorNombre`, `operadorWhatsapp`,
    `operadorDomicilio`, `puntoRecepcion`). No exponer tarifas/flags innecesarios.
  - _Requisitos:_ R2.4 · _Diseño:_ §4.3, §6.9

- [ ] **D3. Frontend — `Terms.jsx` y enlace WhatsApp desde config.**
  - Renderizar domicilio/contacto desde la config del conjunto (no texto fijo); construir `wa.me` con
    `operadorWhatsapp` del conjunto (manual, sin Twilio/API).
  - _Requisitos:_ R2.4, R2.5 · _Diseño:_ §4.3, §6.8

- [ ] **D4. Gate de bonos por conjunto.**
  - Respetar `bonosHabilitados` del `Conjunto` activo (por defecto `false`).
  - _Requisitos:_ R2.6 · _Diseño:_ §4.2, §6.4

---

## Fase E — Ajuste de controladores existentes al aislamiento

> La mayoría queda cubierta automáticamente por la extensión (Fase B); estas tareas verifican que corren
> dentro del contexto de tenant y preservan patrones (fotos, gates).

- [ ] **E1. `packages.controller.js` — `createPrealert`.**
  - Verificar que la selección del operador se resuelve en el conjunto activo (operador **del conjunto
    del residente**), no el primero de la tabla.
  - _Requisitos:_ R1.6 · _Diseño:_ §2.4, §6.2

- [ ] **E2. `packages.controller.js` — `checkin` + `apartamento.service.js`.**
  - Verificar que el barrido de residentes (`findMany role:RESIDENT`) queda acotado al conjunto activo;
    la cortesía de primera entrega no cruza conjuntos con misma torre/apto.
  - _Requisitos:_ R1.7 · _Diseño:_ §2.4, §6.2, §6.3

- [ ] **E3. `packages.controller.js` — `listAll`, `exportCsv`, `getFoto`, `schedule`.**
  - Filtrado por conjunto automático. **`listAll` y `/packages/mine`: el `select` NO incluye `fotoUrl`.**
    `getFoto`/`schedule` (findUnique por `id`) cubiertos por reescritura a `findFirst`.
  - _Requisitos:_ R1.8, R1.9, R1.10 · _Diseño:_ §2.3.1, §2.5, §6.2

- [ ] **E4. `bonos.controller.js` — `listForResident`, `create`.**
  - Filtrado/escritura por conjunto; respetar `bonosHabilitados`.
  - _Requisitos:_ R1.8, R2.6 · _Diseño:_ §6.4

- [ ] **E5. `comments.controller.js` — `listAll` y creación.**
  - Filtrado/escritura por conjunto.
  - _Requisitos:_ R1.8 · _Diseño:_ §6.5

---

## Fase F — Migración/backfill de Ipanema (definición; ejecución bajo aprobación)

- [ ] **F1. Preparación (backup y conteos).**
  - Definir/scriptar backup lógico y verificación de restauración; contar `User/Package/Bono/Comentario`
    y confirmar operador único de Ipanema.
  - _Requisitos:_ R4.4 · _Diseño:_ §5.2 (Fase 0)

- [ ] **F2. Script de backfill transaccional (idempotente).**
  - Crear `Conjunto` "Ipanema" con su config (tarifas actuales, WhatsApp/domicilio de `Terms.jsx`,
    `bonosHabilitados=false`) y `codigoInvitacion`; `UPDATE ... SET conjuntoId=IPANEMA_ID WHERE NULL` en
    las 4 tablas; verificación de `COUNT(NULL)=0` y de totales; `ROLLBACK` si no cuadra.
  - _Requisitos:_ R4.1, R4.2, R4.3 · _Diseño:_ §5.2 (Fase 2)

- [ ] **F3. Migración "contract" (endurecer).**
  - Migración que vuelve `conjuntoId` `NOT NULL` + FK en las 4 tablas; índices definitivos. Con su
    reversión inversa documentada.
  - _Requisitos:_ R4.3, R4.4 · _Diseño:_ §5.2 (Fase 3)

- [ ] **F4. Documentar puntos de reversión y procedimiento SSH Railway.**
  - Redactar la reversión por fase y anotar que la aplicación real va por túnel SSH de Railway contra
    Postgres de producción (no ejecutar sin aprobación).
  - _Requisitos:_ R4.4, R4.5, R4.6 · _Diseño:_ §5.2, §5.4

- [ ] **F5. Activación del aislamiento (deploy) tras backfill.**
  - **Mecanismo de activación = orden de despliegue, NO un flag en tiempo de ejecución.** El código de
    Fases B/C/E (middleware + extensión + falla-cerrado) **no se mergea a `main` ni se despliega a
    producción hasta que F2/F3 estén ejecutados y verificados** (`conjuntoId` NOT NULL en las 4 tablas,
    `COUNT(NULL)=0`). No existe ningún interruptor de runtime que decida si el falla-cerrado aplica.
  - **Prohibido explícitamente** cualquier flag/env var tipo `TENANT_ISOLATION_ENABLED`,
    `AISLAMIENTO_ON`, etc.: reintroduciría el mismo "olvido silencioso" que el diseño combate (si queda
    mal configurado, el aislamiento se apaga sin error). El aislamiento está siempre activo en el código
    que llega a producción; su "activación" es simplemente que ese código se despliega **después** del
    backfill.
  - Secuencia de corte: (1) F1 backup → (2) migración expand ya aplicada (Fase A/F, `conjuntoId`
    nullable) → (3) F2 backfill verificado → (4) F3 contract (NOT NULL + FK) verificado → (5) **recién
    entonces** deploy del código B/C/E. Si (3) o (4) fallan, no se avanza al deploy.
  - _Requisitos:_ R4.7 · _Diseño:_ §5.2 (Fase 4)

- [ ] **F6. Manejo de sesiones/JWT abiertas en el corte a producción.**
  - **Contexto:** `JWT_EXPIRES_IN` = hasta 8h. En el corte, Francisco porta un token emitido antes del
    despliegue.
  - **Sin acción especial requerida.** Como el middleware (B4) resuelve el conjunto **siempre** por `sub`
    contra la BD y **nunca** dependió de un claim de conjunto, el token pre-corte funciona igual: se carga
    el `User` por `sub`, se obtiene su `conjuntoId` ya backfilleado (F2/F3 corren antes de F5) y opera con
    normalidad. **No se fuerza re-login.**
  - **Falla cerrado:** si el `User` por `sub` no existe o su `conjuntoId` es `null`/no resoluble → `401`.
    No debe ocurrir para usuarios legítimos tras F3.
  - **Fallback opcional (no necesario para la corrección):** si por otro motivo se quisiera invalidar
    sesiones pre-corte, rotar el secreto de firma del JWT y **avisar a Francisco de re-iniciar sesión tras
    el deploy** (credenciales sin cambios). No es un flag de runtime.
  - **Verificación:** tras el corte, una request con token pre-corte resuelve el conjunto correcto por
    `sub`; ninguna request opera sin tenant.
  - _Requisitos:_ R1.3, R1.5, R3.6, R4.7 · _Diseño:_ §2.3 (componente 2), §3.6, §3.6.1, §5.2 (Fase 4)

---

## Fase G — Documentación

- [ ] **G1. Actualizar `README.md`/`DEPLOY.md`.**
  - Documentar: modelo `Conjunto`, mecanismo de aislamiento (middleware + extensión + `scope`),
    invariante de `GLOBAL_LOOKUP` / `buscarUsuarioPorEmailSinTenant()`, código de invitación, config por
    conjunto, y procedimiento de migración por túnel SSH de Railway.
  - _Diseño:_ §8, §8.1

---

## Checklist de invariantes a verificar antes de dar por cerrada la implementación

- [ ] `AsyncLocalStorage.run({ scope: 'GLOBAL_LOOKUP' }` aparece **exactamente una vez** (en
  `buscarUsuarioPorEmailSinTenant`). _(§2.3.1, §8.1)_
- [ ] No existe un segundo `PrismaClient` sin la extensión de tenant. _(§6.1)_
- [ ] **`$queryRaw`, `$executeRaw`, `$queryRawUnsafe` y `$executeRawUnsafe` aparecen SOLO en
  `resolverConjuntoIdPorUsuario()`** (`config/tenantBootstrap.js`). Cualquier otra consulta cruda se
  saltaría la extensión y sería una vía sin aislamiento. _(§2.3 bootstrap, §8.1)_
- [ ] **Operaciones con `WhereUniqueInput`** (`findUnique`/`update`/`delete`/`upsert`) combinan el
  conjunto en el **primer nivel** del `where` (`{ ...where, conjuntoId }`), **nunca** con `AND`; el `AND`
  es solo para `WhereInput`. _(§2.3.1)_
- [ ] **No se reescribe `findUnique` a `findFirst`** (Prisma 5 admite campos no únicos en el `where`
  único). _(§2.3.1)_
- [ ] `fotoUrl` ausente en `GET /packages` y `GET /packages/mine`. _(§2.5)_
- [ ] `bonosHabilitados=false` por defecto en conjuntos nuevos. _(§4)_
- [ ] WhatsApp solo `wa.me` manual; sin Twilio/API. _(§4.3)_
- [ ] Sin pasarela de pagos. _(§4.4)_
- [ ] Ninguna tabla con tenant queda con `conjuntoId` nulo tras el backfill. _(R4.2)_
- [ ] **No existe ningún flag/env var de runtime que active/desactive el aislamiento ni el falla-cerrado.**
  La activación es exclusivamente orden de despliegue (código B/C/E se despliega tras F2/F3 verificados).
  _(§5.2 Fase 4, F5)_
- [ ] **El JWT NO contiene claim de conjunto; el middleware resuelve `conjuntoId` SIEMPRE por `sub`
  contra la BD.** No hay camino que confíe en un claim del token. _(§3.6, B4, C4)_
- [ ] **La resolución por `sub` falla cerrado:** si el `User` no existe o su `conjuntoId` no es resoluble
  → `401`, nunca opera sin tenant. _(§3.6, F6)_
- [ ] **Sesiones abiertas en el corte:** los tokens pre-corte funcionan sin acción especial (se resuelven
  por `sub`); no se fuerza re-login. Fallback opcional documentado (rotar secreto + aviso a Francisco), no
  requerido para la corrección. Ninguna request pre-corte opera sin tenant. _(§3.6.1, F6)_
- [ ] Ninguna rama tocada salvo `develop` para pruebas; nunca `main`.
