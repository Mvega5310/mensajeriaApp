# Puertaya

App de recepción/custodia/entrega de paquetes para conjuntos residenciales.
Repo: `Mvega5310/mensajeriaApp`. Nació monoconjunto (Ipanema, operado por
Francisco Caro Yances) y ahora soporta **multi-conjunto**: cada conjunto tiene
su operador, sus direcciones de entrega y sus paquetes, aislados entre sí (KAN-8; la cuenta
del residente es de la persona y sirve en cualquier conjunto, ver invariantes 10 y 11).

> **Estado del multi-conjunto (KAN-8):** **desplegado en producción desde el
> 28-oct-2026** (corte Fase F ejecutado; detalle en DEPLOY.md y en
> `docs/runbook-corte-ipanema.md` §6). Producción tiene **un solo conjunto,
> `ipanema`**, con `bonosHabilitados=false`. El *contract* (`conjuntoId` NOT NULL)
> está aplicado y registrado en la base de producción; **en la rama
> `refactor/mobile-first` su carpeta (`20261028165010_contract_conjunto`) ya está
> en el repo** (paso 4 hecho allí, S0.2) y en `main` sigue pendiente hasta que el
> refactor llegue a producción (ver DEPLOY.md → "Pendiente"). Mientras
> exista un único conjunto, el registro funciona sin código de invitación
> (hotfix `20a46b4`).

La rama de trabajo es `develop`, no `main` (ver regla de ramas abajo, es la más
importante de este archivo).

> **Refactor mobile-first (rama `refactor/mobile-first`, sale de KAN-8):** se
> ejecuta según [docs/plan/PLAN.md](docs/plan/PLAN.md) y su tablero
> [docs/plan/ESTADO.md](docs/plan/ESTADO.md). Diseño en `docs/design/canvas/`.
> Recorrido fijo: LLEGA → REGISTRO (operador, 4 toques) → AVISO → ENTREGA CON
> PIN; la pre-alerta del residente es opcional. Se despliega en el Railway
> propio (`puertaya-refactor`), nunca en producción sin orden explícita.

**Para features, funcionalidades y cómo levantar el proyecto en local:
lee [README.md](README.md).** Para infraestructura, despliegue y cómo
migrar la base de datos de producción: lee [DEPLOY.md](DEPLOY.md). Este
archivo no repite ese contenido — son las convenciones de trabajo que
no están ahí.

**En producción:**
- App: https://mensajeria-app-iota.vercel.app
- API: https://mensajeriaapp-production.up.railway.app

## Regla de ramas: todo el trabajo va a `develop`; a `main` solo por pull request

`main` es lo que Railway y Vercel despliegan a producción automáticamente
en cada cambio que entra — y la app ya está en uso real con el conjunto,
así que cada cambio en `main` toca el sistema en uso. Desde ahora:

- **Todo commit va a `develop`** (`git checkout develop` si no estás ahí).
  `git push origin develop` es seguro: Railway solo despliega desde
  `main`, así que no dispara nada en producción (Vercel puede crear un
  *preview* aparte de esa rama, pero no toca la URL real).
- **`main` está protegida en GitHub y solo se llega por pull request.** Nunca
  `git push origin main`. Para pasar algo a producción se abre un PR hacia `main`
  (`gh pr create --base main`, p. ej. `develop → main` o `fix/... → main`), y se
  fusiona con `gh pr merge` **solo con el OK explícito del usuario** para ese PR.
  Abrir el PR tampoco es por iniciativa propia: solo cuando el usuario pide pasar
  algo a producción (ej. "ya podemos pasar esto a producción"). Si no lo dice, el
  trabajo se queda en `develop` aunque esté terminado y probado. Fusionar el PR
  redespliega Railway y Vercel igual que antes un push.
- **Si un push o merge a `main` falla por la protección, no se esquiva**: nada de
  `--force` ni de saltarse la regla; se le reporta al usuario qué pasó (él es
  administrador y decide si la omite en una emergencia).
- Esto **no** aplica a operaciones directas sobre la base de datos de
  producción (como una limpieza de datos) cuando el usuario las pide
  explícitamente — esas son independientes de qué rama esté commiteada.

**Cambios grandes o de varios pasos → rama de tarea aparte.** Para una spec (con
requisitos/diseño), una migración de esquema, o cualquier trabajo que tome más de
un par de commits, se abre una rama de tarea desde `develop`
(`feature/<nombre>`), se trabaja ahí con **un commit por paso**, y solo se
integra a `develop` cuando está **validado en local**. Los cambios pequeños y ya
probados siguen yendo directo a `develop`, como siempre. Referencia: KAN-8 se
trabajó así en `feature/kan-8-multiconjunto` (borrada tras fusionarse).

## Regla de oro: documentación al día

Cada cambio funcional se documenta en el mismo commit que lo implementa
(README.md y/o DEPLOY.md), no después. Es una instrucción explícita del
usuario, no opcional.

## Estructura

```
backend/     # Express + Prisma — PostgreSQL en producción y en local (SQLite ya no sirve desde KAN-8)
frontend/    # Vite + React (PWA) — sin lógica de negocio propia, todo vía la API
docs/        # Prototipo original, flyer de campaña, logo — referencia histórica
```

## Flujo de trabajo esperado en cada cambio

1. **Probar en local con Postgres** antes de tocar producción (SQLite ya no sirve: la extensión de tenant usa SQL propio de Postgres):
   - Pruebas: `cd backend && npm run test:all` — crea una base propia `puertaya_test_<pid>`, aplica `prisma migrate deploy`, corre TODAS las pruebas (integración incluida, 0 omitidas) y la borra al terminar. Requiere Postgres local encendido (`pg_ctlcluster 16 main start`). `npm test` a secas omite las de integración.
   - Para levantar la app a mano: `backend/.env` a partir de `.env.example` con un `DATABASE_URL` de Postgres local (gitignorado), `npx prisma migrate deploy && npm run seed`. El `provider` de `schema.prisma` es siempre `"postgresql"`.
   - Si el cambio toca UI: levantar `npm run dev` en `backend/` y `frontend/`, y verificar en un navegador real — no solo `npm run build`. Playwright con Chromium ya está cacheado en esta máquina (`C:\Users\ACER\AppData\Local\ms-playwright\`); solo falta `npm install playwright@1.61.1` en el scratchpad de la sesión si no está.
   - Limpiar al terminar: matar `nodemon`/`vite`, borrar `backend/.env` y la base de desarrollo que hayas creado.
2. **Si el cambio requiere migración de esquema**, aplicarla contra Postgres de producción vía túnel SSH de Railway — `railway run` NO funciona para esto (ver DEPLOY.md, sección "Migraciones de Postgres"). Nunca commitear migraciones generadas contra una base que no sea Postgres.
3. **Commit + push a `develop`** (push directo, como siempre; ver "Regla de ramas" arriba — nunca directo a `main`). Nunca force-push, nunca amend de un commit ya publicado — siempre un commit nuevo.
4. Solo cuando el usuario pida explícitamente pasar algo a producción: **abrir un pull request hacia `main`** (`gh pr create --base main --head develop`, o desde una rama `fix/...`) y **esperar su OK explícito** antes de `gh pr merge`. Nunca `git push origin main`. Tras el merge, **verificar en vivo**: sondear el bundle/API de producción hasta confirmar que el deploy nuevo está activo (los hashes de archivo cambian con cada build), no asumir que terminó por el solo hecho de haber fusionado. Requiere el GitHub CLI (`gh`) instalado y autenticado.
5. **Actualizar README.md/DEPLOY.md** en el mismo commit (ver regla de oro arriba), sea en `develop` o en la rama del PR a `main`.

## Cosas ya decididas — no las reabras sin que el usuario lo pida

- **WhatsApp es manual, no automático**: enlaces `wa.me` con mensaje precargado que el operador confirma a mano. Se descartó Twilio/WhatsApp Business API explícitamente por costo.
- **Bonos prepago**: la funcionalidad está construida pero **apagada por conjunto**. La única fuente es `Conjunto.bonosHabilitados` (`false` por defecto para todo conjunto nuevo). **Ya NO existe** la constante `BONOS_HABILITADOS` (se eliminó de `backend/src/config/features.js` y `frontend/src/utils/features.js`, ambos archivos borrados en KAN-8): backend lee del conjunto del contexto, frontend de `GET /conjunto/config`.
- **Tarifas por conjunto**: las tarifas por categoría de peso salen del `Conjunto` (`tarifaMano/Estandar/Volumen/Pesado`), no de una constante fija. Backend: `costoPara()` las lee del conjunto del contexto (nunca del cliente). Frontend: `utils/tiers.js` solo tiene etiquetas; los montos vienen de `GET /conjunto/config`. No hay montos fijos en el cliente.
- **Fotos fuera de los listados**: `GET /packages` y `GET /packages/mine` NUNCA deben incluir `fotoUrl` (pueden pesar cientos de KB en base64 cada una) — se piden aparte vía `GET /packages/:id/foto`, solo al abrir el detalle de un paquete puntual. Esto fue la causa real de una caída seria en producción (ver historial de commits) — no revertir este patrón.
- **Sin pasarela de pagos real**: todo el cobro es manual/efectivo/transferencia, coordinado por fuera de la app.
- **La app ya no es exclusiva de Ipanema**: no incrustar el nombre "Ipanema", el operador, su domicilio, WhatsApp ni tarifas en el código. Todo eso es configuración por conjunto (ver reglas del multi-conjunto abajo).
- **Registro sin código ni slug con un solo conjunto activo** (hotfix `20a46b4`, generalizado en S1.3): sin `conjunto` (slug) ni código, `register` y `config-publica` usan el único conjunto activo; con varios, 400 `CONJUNTO_REQUERIDO`. El código de invitación es opcional. Existe porque los QR/folletos repartidos apuntan sin `?c=`; el QR nuevo usa `?conjunto=<slug>`.

## Reglas del multi-conjunto (no negociables)

El aislamiento entre conjuntos es **estructural**: lo garantiza una extensión de
Prisma que filtra por `conjuntoId` a partir de un contexto por-request
(`AsyncLocalStorage`), no cada consulta a mano. Las siguientes invariantes lo
sostienen. Cada una tiene una prueba automatizada; si tu cambio rompe una,
**arréglalo, no relajes la prueba**.

1. **Un solo `PrismaClient`.** Todo pasa por el cliente extendido de
   `config/db.js`. Un segundo cliente sin extender sería una vía sin aislamiento,
   invisible y silenciosa. — *Prueba:* `auditoriaInvariantes.test.js` (E7.3).
2. **`GLOBAL_LOOKUP` solo en `buscarUsuarioPorEmailSinTenant()`.** Es la única
   exención al filtro (login/forgot: lookup por email sin sesión). Concentrarla
   en un punto la hace auditable de un vistazo. — *Prueba:* `auditoriaInvariantes.test.js` (E7.1).
3. **Consultas crudas solo en `resolverConjuntoIdPorUsuario()`.**
   `$queryRaw`/`$executeRaw`/`*Unsafe` saltan la extensión por completo; fuera de
   ese bootstrap serían una fuga. — *Prueba:* `auditoriaInvariantes.test.js` (E7.2).
4. **El `await` va DENTRO de `run()`, y lo garantizan los helpers.** Las
   `PrismaPromise` son perezosas: devolver la promesa sin `await` cierra el
   contexto antes de que la query corra y la extensión lanzaría (falla cerrado).
   Por eso `runWithTenant`/`buscarUsuarioPorEmailSinTenant` hacen `run(ctx, async
   () => await fn())`. No repliques el patrón a mano en cada call site. — *Prueba:*
   `tenantContext.test.js` (regresión con thenable perezoso).
5. **Toda ruta autenticada lleva `requireAuth` y luego `requireTenant`.** Sin el
   segundo, el handler corre sin contexto y la extensión lanza. — *Prueba:*
   `tenantGuard.routes.test.js` (E6, recorre el app real).
6. **Una ruta pública nueva exige agregarla a la lista de E6, justificándolo.**
   `tenantGuard.routes.test.js` falla si aparece una ruta sin `requireAuth` que no
   esté en `RUTAS_SIN_SESION`. Agregarla es una decisión consciente (¿de verdad
   debe ser accesible sin sesión?), no un descuido.
7. **Nunca se pasa `conjuntoId` en `data`.** El conjunto de toda escritura sale
   del contexto; un `conjuntoId` en `data` se rechaza. El llamador jamás decide el
   tenant. — *Prueba:* `tenantExtension.helpers.test.js` / `*.interceptor.test.js`.
8. **Modelos sin tenant: `Conjunto`, `PasswordResetToken`, `User` y `UsuarioConjunto`
   (y solo esos).** El resto (`Package`, `Domicilio`, `Bono`, `Comentario`,
   `PaqueteEvento`, `ClaveIdempotencia`, `PaqueteFoto`, `CortesiaApartamento`) lleva
   `conjuntoId` y está en `MODELOS_CON_TENANT` (`config/tenantModels.js`). Un modelo
   nuevo entra ahí a propósito, o queda fuera del aislamiento. — *Prueba:* cubierto
   por las de la extensión y por `auditoriaInvariantes.test.js` (E7.6: todo modelo con
   `conjuntoId` está en la lista salvo `User`/`UsuarioConjunto`).
9. **Nada de datos, montos ni nombres de conjunto fijos en el frontend.** Ni
   "Ipanema", ni tarifas, ni domicilio/WhatsApp del operador: todo viene de
   `GET /conjunto/config` (con sesión) o `GET /conjuntos/config-publica?c=`
   (registro/Términos sin sesión). — *Prueba:* `frontendSinFijos.test.js`.
10. **`User` solo se toca desde `services/usuario.service.js`.** (PLAN-conjunto S1.1)
    La cuenta del RESIDENT es **de la persona y sirve en cualquier conjunto**, así que
    `User` salió de `MODELOS_CON_TENANT` y la extensión ya no la filtra. Se eligió un
    servicio único (y no una regla especial en la extensión) porque el contexto de un
    residente es "el conjunto de la solicitud" —ya no coincide con `User.conjuntoId`— y su
    aislamiento correcto es por **id de la sesión**, no por conjunto. Reglas: el OPERATOR
    siempre se filtra por el conjunto del contexto (`operadorDelConjuntoActual`); un
    RESIDENT solo lee su propia cuenta, por el `sub` de la sesión; **un operador nunca lee
    cuentas de residentes** (de la persona solo ve su `Domicilio`). Nada de `prisma.user.*`
    fuera de ese servicio y de `buscarUsuarioPorEmailSinTenant` (login/forgot); no agregues
    funciones genéricas con `where` libre. `User.conjuntoId` sigue NOT NULL: para un OPERATOR
    es SU conjunto; para un RESIDENT es solo el "último conjunto usado" (abre el contexto de
    sus requests por defecto; S1.3 lo resuelve por solicitud, ver 12) y **no aísla nada**. —
    *Prueba:* `auditoriaInvariantes.test.js` (E7.4, analizada con `acorn`, no con regex: falla
    si se accede a `User` desde cualquier cliente o transacción —con alias de import,
    `x['user']`, `const { user } = x`— fuera de esos sitios; si `config/db.js` se importa en un
    archivo fuera de la lista `IMPORTAN_DB` o con alias/re-export/`import()`; o si un
    `select`/`include` trae `email`/`passwordHash` de una relación a `User` fuera de
    `usuario.service.js`). `auditoriaAst.test.js` prueba la propia auditoría con fixtures.
11. **Dirección de entrega (`Domicilio`) y "Mis paquetes" multi-conjunto.** (S1.1/S1.2)
    El conjunto, la torre, el apto, quién recibe y el teléfono viven en `Domicilio`, una por
    persona y conjunto (`@@unique [conjuntoId, usuarioId, torre, apto]`), con tenant: el
    operador de un conjunto lee solo los `Domicilio`/`Package` del suyo y, de la persona,
    únicamente lo que hay en el `Domicilio` (nombre de quien recibe, teléfono, torre, apto;
    nunca correo ni otros conjuntos). **Forma canónica:** `torre = tokenTorre(torre) ?? ''`,
    `apto` = solo dígitos (`''` si falta), sin NULL (`canonicalizarDireccion` en
    `services/domicilio.service.js`; la migración aplica la misma regla en SQL). La
    **cortesía y el lote de entrega siguen siendo por apartamento físico del conjunto**, no
    por persona (`claveApartamento` sin cambios; se agrupa por los `Domicilio` del mismo
    torre/apto). Un paquete o una recepción se dirige a un `Domicilio` (`domicilioId`;
    `residenteId` se conserva por compatibilidad y resuelve el domicilio más reciente de esa
    persona *en este conjunto*): un domicilio o una persona de otro conjunto "no existe"
    (404), que es lo que hoy sustituye al filtro de tenant sobre `User`. **"Mis paquetes"**
    junta los de la persona en todos sus conjuntos corriendo **una consulta por conjunto
    DENTRO de `runWithTenant` de ese conjunto** (`porCadaConjuntoDePersona`), sin
    `GLOBAL_LOOKUP` nuevo ni SQL crudo. "En qué conjuntos tiene domicilio" sale de la tabla
    índice `UsuarioConjunto` (solo `usuarioId` + `conjuntoId`, sin datos personales), que
    **únicamente** lee/escribe `services/domicilio.service.js` y siempre por el id de la
    sesión (se escribe antes de crear el `Domicilio`: un índice de más es inofensivo).
    — *Pruebas:* `domicilio.integration.test.js` (persona con paquetes en A y B ve todos;
    el operador de A no ve nada de B por búsqueda, listados, `/packages/:id`, entrega por PIN
    ni CSV; el `Domicilio` de B no le aparece; un RESIDENT no lee otra cuenta),
    `migracionDomicilio.integration.test.js`, `auditoriaInvariantes.test.js` (E7.5).
    **Revisión S3.2 (domicilio impostor y spam):** la búsqueda del operador filtra EN LA BASE
    (`Domicilio.nombreBusqueda`, sin tildes) y cada fila trae un discriminador (4 últimos dígitos del
    teléfono, antigüedad, entregas) y `posibleDuplicado`; el operador puede desactivar una dirección
    (`PATCH /domicilios/:id/desactivar`, `DomicilioEvento`): inactiva no se busca, no recibe paquetes
    y no se reactiva sola. Tope de 10 domicilios activos por persona y conjunto
    (`LIMITE_DIRECCIONES`) y 20 altas/hora por cuenta. El lote que mezcla personas del mismo
    apartamento marca `variasPersonas` y solo preselecciona al dueño del PIN. *Prueba:*
    `revisionS32.integration.test.js`.

9. **Nada de datos, montos ni nombres de conjunto fijos en el frontend.** Ni
   "Ipanema", ni tarifas, ni domicilio/WhatsApp del operador: todo viene de
   `GET /conjunto/config` (con sesión) o `GET /conjuntos/config-publica?c=`
   (registro/Términos sin sesión). — *Prueba:* `frontendSinFijos.test.js`.

12. **El conjunto de un residente se elige POR SOLICITUD (S1.3), por slug o por recurso, nunca
    por un id del cliente.** `requireTenant` abre el contexto base (`User.conjuntoId`; en la sesión
    de enlace, el `conjuntoId` firmado en el token, válido si la persona tiene domicilio ahí
    según el índice `UsuarioConjunto`, ya no se compara con `User.conjuntoId`). Después, y solo
    para RESIDENT con sesión normal: `conjuntoDelPaquete` (schedule, foto) busca el paquete
    DEL residente (por `residenteId`) en sus conjuntos del índice y abre el contexto del conjunto
    del paquete; `conjuntoDeSolicitud` acepta `?conjunto=<slug>` (o `conjunto` en el cuerpo de
    `POST /comments`): conjunto ACTIVO (`invitacionActiva`) donde la persona tiene domicilio, si
    no 400 `CONJUNTO_INVALIDO` / 404. Las escrituras que crean (pre-alerta, `POST /domicilios`,
    registro) resuelven el conjunto en su controlador desde el slug validado
    (`conjuntoActivoPorSlug`) o desde la dirección elegida, y abren `runWithTenant` ahí. Cada uso
    de una dirección llama `marcarUltimoConjunto`. Sin `GLOBAL_LOOKUP` nuevo ni SQL crudo. Las
    rutas públicas nuevas (`GET /conjuntos`: solo `{slug,nombre}`, límite por IP) están en E6.
    El registro y `config-publica` ya no tienen el caso especial `conjuntoUnicoActivo()`:
    `resolverConjuntoPublico` (código opcional, slug, o el único conjunto activo; varios sin nada
    → 400 `CONJUNTO_REQUERIDO`). — *Pruebas:* `conjuntoPorSolicitud.integration.test.js`,
    `auditoriaInvariantes.test.js` (E7.7: `runWithTenant` solo en los sitios autorizados y
    ningún `conjuntoId` leído de `req.body/query/params/headers`), `tenantGuard.routes.test.js`.

**Regla de proceso.** Cualquier cambio que toque la extensión de tenant, el
contexto (`AsyncLocalStorage`/helpers) o los flujos sin sesión
(register/login/forgot/reset, seed, bootstrap) **requiere pruebas de integración
contra Postgres real** (`*.integration.test.js`), no solo pruebas con fakes. En
KAN-8, las pruebas con fakes NO detectaron dos errores reales: el `AND` en un
`WhereUniqueInput` y la `PrismaPromise` perezosa que cerraba el contexto. Las dos
las cazó la integración contra Postgres.

## Limitación conocida de este entorno

No hay forma de reproducir aquí comportamientos específicos de iOS
Safari (barra de direcciones dinámica, controles `<input type="date">`
nativos, `env(safe-area-inset-*)`) — Chromium headless los ignora o los
simula distinto. Cuando un bug reportado suene a esto, aplicar el
arreglo estándar conocido, ser explícito con el usuario sobre esa
limitación, y pedirle que confirme en su iPhone real.
