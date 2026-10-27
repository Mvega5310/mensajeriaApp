# Desplegar Puertaya — Railway (backend + Postgres) + Vercel (frontend) + Resend (correo)

## Estado actual del despliegue

| Pieza | Dónde | Detalle |
|---|---|---|
| Backend + API | Railway, proyecto **astonishing-truth**, servicio **mensajeriaApp** | https://mensajeriaapp-production.up.railway.app |
| Base de datos | Railway, mismo proyecto, servicio **Postgres** | Acceso solo interno/por túnel SSH — nunca se expuso públicamente |
| Frontend | Vercel, proyecto **mensajeria-app** | https://mensajeria-app-iota.vercel.app |
| Correo transaccional | Resend, dominio verificado **prospect01.com** (DNS en Cloudflare) | `EMAIL_FROM="Puertaya Ipanema <notificaciones@prospect01.com>"` |
| Repo | GitHub | https://github.com/Mvega5310/mensajeriaApp |

Esta guía sirve para reproducir el despliegue desde cero (por si hay que
recrear el ambiente) y como referencia de cómo está armado hoy.

## Requisitos

Cuenta de GitHub, Railway, Vercel, y Resend (con un dominio propio para que
el correo le llegue a cualquier residente, no solo a la cuenta del operador).
Ninguna la puedo crear por ti — son pasos en su dashboard/CLI.

## 0. Repo en GitHub

```
git add .
git commit -m "..."
git push
```

## 1. Backend + Postgres en Railway

1. **New Project → Deploy from GitHub repo** → selecciona el repo.
2. En el servicio creado, **Settings → Root Directory** → `backend`
   (el repo tiene `backend/` y `frontend/` en la misma raíz).
3. En el mismo proyecto: **New → Database → PostgreSQL**.
4. En el servicio del backend, pestaña **Variables**, agrega:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia al otro servicio) |
   | `JWT_SECRET` | valor largo y aleatorio — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `ENLACE_SECRET` | **obligatoria en producción** (≥ 32 caracteres, distinta de `JWT_SECRET`): firma los enlaces de "Mis paquetes" del aviso de WhatsApp (T3.1). Mismo comando que `JWT_SECRET`. Cambiarla invalida todos los enlaces ya enviados |
   | `JWT_EXPIRES_IN` | `8h` |
   | `CORS_ORIGIN` | URL del frontend en Vercel (paso 3 más abajo la actualiza) |
   | `FRONTEND_URL` | igual a `CORS_ORIGIN` — se usa para armar los enlaces de los correos |
   | `RESEND_API_KEY` | API key de Resend |
   | `EMAIL_FROM` | `Puertaya Ipanema <remitente@tudominio>` — requiere dominio verificado (ver sección 2) |
   | `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, `OPERATOR_NOMBRE`, `OPERATOR_TELEFONO` | credenciales reales de la única cuenta de operador |

   `PORT` no se configura — Railway inyecta el suyo y `src/index.js` lo usa automático.

   **Validación al arrancar (T0.3).** El backend revisa sus variables antes de
   escuchar (`src/config/env.js`). Si falta una obligatoria (`DATABASE_URL`,
   `JWT_SECRET`; con `NODE_ENV=production` también `ENLACE_SECRET`), si `JWT_SECRET` tiene menos de 32 caracteres con
   `NODE_ENV=production`, o si `PORT` o `DATABASE_URL` son inválidos, el
   proceso **no arranca**: el log lista todos los problemas a la vez. Las
   opcionales ausentes (`CORS_ORIGIN`, `FRONTEND_URL`, `RESEND_API_KEY`, `FOTOS_S3_*`) no
   detienen el arranque; el log muestra un `AVISO:` por cada una. Si el deploy
   falla justo después de cambiar variables, lo primero es leer ese mensaje en
   Railway → Deployments → Logs.

   **En Railway, `NODE_ENV` es obligatoria:** si existe `RAILWAY_ENVIRONMENT` (o
   `RAILWAY_ENVIRONMENT_NAME`) y falta `NODE_ENV`, el arranque falla con "Define
   NODE_ENV=production en Railway…" (así nunca se activa por error el almacén de
   fotos `fake` ni el notificador `fake` en un despliegue real).

   La exigencia de 32 caracteres en `JWT_SECRET` solo se aplica si
   `NODE_ENV=production`. Añade esa variable en el servicio del backend
   (no la asumas: sin ella el servidor trata el entorno como desarrollo).

5. Deploy. Railway corre `npm install` → `postinstall` (`prisma generate`) → `npm start` (`prisma migrate deploy && node src/index.js`).

### Migraciones de Postgres — cómo se aplican de verdad

`railway run npx prisma migrate dev` **no funciona**: `railway run` solo
inyecta variables de entorno, no crea un túnel de red, y `DATABASE_URL`
apunta al hostname interno (`postgres.railway.internal`) que solo es
alcanzable *desde dentro* de Railway. El método que sí funciona es abrir un
túnel SSH real:

```
npm install -g @railway/cli
railway login
railway link                       # selecciona el proyecto/ambiente (no hace falta escoger servicio)
railway connect Postgres --tunnel-only -P 55432
```
Esto deja un túnel local escuchando en `127.0.0.1:55432` y muestra la
contraseña de la base. En otra terminal, con el schema en
`provider = "postgresql"`:
```
cd backend
$env:DATABASE_URL = "postgresql://postgres:<password>@127.0.0.1:55432/railway"   # PowerShell
npx prisma migrate dev --name <nombre_descriptivo>
```
Esto genera el archivo de migración, lo aplica contra la Postgres real de
Railway, y queda listo para comitear:
```
git add backend/prisma/migrations
git commit -m "Migración: <descripción>"
git push
```
Cada deploy futuro aplica migraciones pendientes solo, vía `prisma migrate
deploy` dentro del script `start` — el túnel manual solo hace falta para
generar migraciones *nuevas*, no para que el backend funcione día a día.

Si es la primera vez (base vacía), la migración inicial se genera igual con
este método — no hay atajo por `railway run`.

**Requiere una llave SSH local.** Si `railway connect` dice "No SSH keys
found", primero:
```
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519" -N '""'
railway ssh keys add
```

6. Crea la cuenta de operador en la base real (una sola vez, por el mismo túnel):
   ```
   node prisma/seed.js
   ```
   (con `DATABASE_URL` apuntando al túnel y `OPERATOR_*` en el entorno o en `.env`).
   > **Tras el corte multi-conjunto (KAN-8), esto cambia:** `prisma/seed.js` deja
   > de usarse en producción. El alta de un conjunto y su operador pasa a ser el
   > procedimiento operativo por conjunto (ver "Procedimientos operativos por
   > conjunto" más abajo; el script de alta se construye en la Fase F).
7. **Settings → Networking → Generate Domain** para obtener la URL pública del backend.

### Migración `add_paquete_evento` (T1.3, refactor mobile-first)

Crea la tabla `PaqueteEvento` (bitácora de cambios de estado, con `conjuntoId`) y
un **trigger Postgres** que rechaza `UPDATE` y `DELETE` sobre ella. Es **aditiva**:
el código anterior ignora la tabla, así que se aplica con el flujo normal
(`prisma migrate deploy` en el `start`, o por túnel SSH como arriba). Escrita y
probada contra Postgres (no SQLite).

- **Rollback:** `backend/prisma/manual/rollback_add_paquete_evento.sql` (quita
  trigger, función y tabla, y la fila de `_prisma_migrations`). Pierde la bitácora
  de eventos; los paquetes no se tocan.
- **Purga excepcional** (limpieza de pruebas o depuración legal explícita): dentro
  de una transacción, `SELECT set_config('puertaya.purga_eventos','on',true);` y
  luego el `DELETE`. `UPDATE` sigue prohibido incluso con la bandera. La app nunca
  lo usa.
- Si más adelante se borran usuarios, recordar que `PaqueteEvento.actorId` es FK
  `RESTRICT` (no `SET NULL`, que haría un `UPDATE` bloqueado por el trigger).

### Migración `add_pin_intentos` (T1.4, refactor mobile-first)

Agrega `Package.intentosPin` (entero, default 0) y `Package.pinBloqueadoHasta`
(timestamp, nulo). **Aditiva**: el código anterior ignora las columnas, se aplica
con `prisma migrate deploy` normal. Verificada con `prisma migrate diff` contra
Postgres (sin diferencias con `schema.prisma`).

- **Rollback:** `backend/prisma/manual/rollback_add_pin_intentos.sql` (quita las
  dos columnas y la fila de `_prisma_migrations`; pierde contadores y bloqueos).
- **Proxy:** el límite de login cuenta por `req.ip`. En producción
  (`NODE_ENV=production`) la app fija `trust proxy = 1` (un solo salto: el proxy
  de Railway), de modo que la IP es la que Railway añade y un `X-Forwarded-For`
  del cliente no la falsifica. Si hubiera otro proxy delante (CDN), ajustar con
  la variable opcional `TRUST_PROXY` (número de saltos, o `false`). **Define
  `NODE_ENV=production` en Railway:** sin ella no se confía en el proxy y todos
  los usuarios comparten IP para el límite de login (el arranque lo avisa en el log).
- El limitador de login vive en memoria del proceso: se reinicia con cada
  despliegue y no se comparte entre réplicas (cambiable por Redis luego).

### Migración `add_recepcion_sin_prealerta` (T2.1, refactor mobile-first)

Fase *expand* para la recepción sin pre-alerta. **Solo agrega** (generada con
`prisma migrate diff` contra Postgres, revisada a mano):

- `Package.residenteId` pasa a **opcional** (`DROP NOT NULL`; la FK sigue `RESTRICT`).
- `Package`: `etiquetaNombre`, `transportadora`, `metodoPago` (`EFECTIVO`|`TRANSFERENCIA`,
  validado en `domain/pago.js`, sin enum de BD), `recibidoEn`, e índice `[conjuntoId, guia]`.
  `guia` y `fechaEntrega` ya existían y se **reutilizan** (no se duplican).
- `Conjunto`: `prefijoPais` (`'57'`), `franjasEntrega` (JSON; si es null el código usa
  el default de `domain/conjuntoConfig.js`), `maxFotos` (3), `custodiaMaxDias` (30).

El código anterior ignora las columnas nuevas y funciona mientras no existan
paquetes sin residente, así que se aplica con el flujo normal (`migrate deploy`).

- **Rollback:** `backend/prisma/manual/rollback_add_recepcion_sin_prealerta.sql`
  (con `psql`). Vuelve `residenteId` a `NOT NULL` y quita las columnas/índice nuevos
  (pierde sus datos). **Guard:** si existe algún `Package` con `residenteId` NULL
  aborta con `ROLLBACK abortado: N paquete(s) tienen residenteId NULL...` y no cambia
  nada; asigna o borra esos paquetes y reintenta. Probado en
  `scripts/__tests__/migracionRecepcion.integration.test.js`.

### Migración `add_clave_idempotencia` (T2.3, refactor mobile-first)

Crea la tabla `ClaveIdempotencia` (`clave`, `operadorId`, `paqueteId`, `creadoEn`,
con `conjuntoId`; única por `[conjuntoId, operadorId, clave]`) que usa
`POST /packages/recepcion` para no duplicar paquetes al reintentar. **Aditiva**:
el código anterior ignora la tabla, se aplica con `prisma migrate deploy` normal.
Generada con `prisma migrate diff` contra Postgres (sin diferencias con
`schema.prisma`). Las FK a `User` y `Package` son `ON DELETE CASCADE` (la clave es
un dato desechable de 24 h; no bloquea borrar paquetes ni usuarios).

- **Rollback:** `backend/prisma/manual/rollback_add_clave_idempotencia.sql` (con
  `psql`; quita la tabla y la fila de `_prisma_migrations`; solo pierde claves de
  reintento). Probado: rollback y re-aplicación con `migrate deploy`.
- Las claves vencidas se liberan al reusarse; no hay tarea de limpieza (la tabla
  crece una fila por recepción con clave).

### Almacén de fotos y migración `add_paquete_foto` (T5.1, refactor mobile-first)

Las fotos nuevas ya no van a la base (base64 en `Package.fotoUrl`) sino a un
**Bucket de Railway** (compatible con S3). La base solo guarda la referencia en la
tabla `PaqueteFoto` (`paqueteId`, `clave`, `tipo`, `orden`, con `conjuntoId`).
Las fotos antiguas siguen en `fotoUrl` y `GET /packages/:id/foto` las sigue leyendo
(devuelve `{ fotos: [{ url, orden }] }`: URLs firmadas que expiran en 10 min para
las nuevas, la imagen tal cual para las antiguas).

**Crear el Bucket:** en el proyecto de Railway, *+ New → Bucket* (o el MCP
`create-bucket`). En el servicio del backend define estas variables a partir de las
credenciales del bucket (pestaña *Credentials*; puedes referenciarlas con
`${{Bucket.VARIABLE}}`):

| Variable | Valor |
|---|---|
| `FOTOS_S3_ENDPOINT` | endpoint S3 del bucket (p. ej. `https://t3.storageapi.dev`) |
| `FOTOS_S3_BUCKET` | nombre del bucket |
| `FOTOS_S3_ACCESS_KEY` | access key id |
| `FOTOS_S3_SECRET` | secret access key |
| `FOTOS_S3_REGION` | opcional; por defecto `auto` (usa la que muestre Railway) |
| `FOTOS_S3_FORCE_PATH_STYLE` | opcional; por defecto `true` (déjalo así en Railway) |

Las cuatro primeras van juntas o ninguna (a medias, el servidor no arranca y lo
dice). **Sin ellas en producción** el backend NO se rompe: sigue guardando las
fotos como base64 en la base (modo legado) y deja un `AVISO: ATENCIÓN ...` en el
log de arranque. En desarrollo/pruebas usa un almacén en memoria (`fake`) con aviso.
Cada foto se valida al recibirla: JPG/PNG/WebP, máx. 1,5 MB decodificada (413 si
se pasa). Si la transacción de recepción falla tras subir, se intenta borrar lo
subido (mejor esfuerzo, queda en el log).

- Migración **aditiva** (`20261030120000_add_paquete_foto`), `prisma migrate deploy`
  normal; generada con `prisma migrate diff` contra Postgres. El código anterior
  ignora la tabla.
- **Rollback:** `backend/prisma/manual/rollback_add_paquete_foto.sql` (con `psql`).
  Ojo: las fotos nuevas solo se enlazan a su paquete por esta tabla; al borrarla
  quedan huérfanas en el bucket.

### Migración `add_proposito_token` (T3.2, enlace mágico)

Añade el enum `PropositoToken` (`RESET` | `ACCESO`) y la columna
`PasswordResetToken.proposito` (default `RESET`, así los tokens de reset ya
emitidos siguen valiendo).

- Migración **aditiva** (`20261031120000_add_proposito_token`), `prisma migrate
  deploy` normal; verificada con `prisma migrate diff` (sin drift). El código
  anterior ignora la columna.
- **Rollback:** `backend/prisma/manual/rollback_add_proposito_token.sql` (con
  `psql`). Borra antes los tokens de acceso pendientes (sin la columna no se
  distinguirían de los de reset).
- Usa `FRONTEND_URL` para armar `/acceso/<token>`. Sin variables nuevas.

### Migración `add_cortesia_apartamento` (revisión F2)

Crea la tabla `CortesiaApartamento` (`conjuntoId`, `claveApto`, `paqueteId`; único
`[conjuntoId, claveApto]` y único `paqueteId`): insertar su fila es la reserva de la
cortesía de primera entrega del apartamento, y serializa recepciones paralelas.

- Migración **aditiva** (`20261101120000_add_cortesia_apartamento`), `prisma migrate
  deploy` normal; verificada con `prisma migrate diff` (sin drift). La FK a `Package`
  es `DEFERRABLE INITIALLY DEFERRED` (editada a mano en el SQL: la reserva se inserta
  antes que el paquete nuevo, dentro de la misma transacción).
- **Sin backfill necesario:** los apartamentos con paquetes ya cobrados se detectan
  por estado (`EN_RECEPCION`/`PROGRAMADO`/`ENTREGADO`) y no llegan a reservar.
- **Rollback:** `backend/prisma/manual/rollback_add_cortesia_apartamento.sql` (con
  `psql`). Solo borra la reserva; el cobro real vive en `Package`/`PaqueteEvento`.
- La clave de apartamento ahora normaliza la torre ("T2" = "TORRE 2"); no hay claves
  persistidas anteriores, así que no requiere migración de datos.
- Variable obligatoria nueva en Railway: `NODE_ENV=production`.

### Corte a producción del multi-conjunto (KAN-8) — orden obligatorio

> **Estado:** el multi-conjunto está implementado y validado en la rama
> `feature/kan-8-multiconjunto`, **NO desplegado**. Esta sección fija el ORDEN del
> corte. El procedimiento ejecutable paso a paso está en
> [`docs/runbook-corte-ipanema.md`](docs/runbook-corte-ipanema.md); se ensaya
> contra una copia antes de tocar producción. **No ejecutar nada de esto todavía.**

#### Por qué cambió el orden (ventana de fallo del orden ingenuo)

El orden ingenuo "backfill → *contract* (`NOT NULL`) → deploy del código" tiene una
ventana en la que **la app queda rota**: en cuanto `conjuntoId` es `NOT NULL`, el
código **viejo** (que aún no conoce el tenant) sigue intentando `INSERT` de
`User`/`Package`/`Bono`/`Comentario` **sin** `conjuntoId`, y Postgres los rechaza
(`null value ... violates not-null constraint`). Nadie podría registrarse ni
recibir paquetes hasta que termine el deploy del código nuevo.

Peor aún en este stack: **el `start` de Railway corre `prisma migrate deploy`
automáticamente** (ver `backend/package.json`). Si la migración *contract*
estuviera en `prisma/migrations/` al mergear a `main`, se aplicaría **dentro del
mismo arranque** que el código nuevo — no hay un "entre contract y deploy"
controlable, y además la ventana de rechazo ocurre durante el propio boot.

**Regla que resuelve la ventana:** el código con aislamiento se despliega
**mientras las columnas siguen NULLABLE**. La extensión de tenant ya pone
`conjuntoId` en cada escritura nueva (desde el contexto), así que tras el deploy
**ningún escritor produce NULL**. Solo entonces se endurece a `NOT NULL`. Por eso
el *contract* se aplica **manualmente al final (C5)** y **no vive en
`prisma/migrations/`** durante el merge (si no, `migrate deploy` lo adelantaría).

#### Orden del corte

| # | Paso | Cuándo | Reversible con |
|---|------|--------|----------------|
| **P0** | Aplicar migración *expand* (`add_conjunto_multitenant`) en producción. Es **aditiva** (columnas nullable + tabla `Conjunto`); el código viejo la ignora. | Días antes | Inocua (no hace falta revertir) |
| **P1** | Crear el `Conjunto` Ipanema **sin backfill** (`backfill-conjunto` reutiliza el conjunto si ya existe). Deja listo el `codigoInvitacion` para reimprimir el QR. | Días antes | `DELETE` del conjunto (aún sin filas asociadas) |
| **C0** | Backup: `pg_dump` + conteos de las 4 tablas. | Día del corte | n/a |
| **C1** | **Backfill #1** (transaccional, verificado): `UPDATE ... SET conjuntoId = <Ipanema> WHERE conjuntoId IS NULL`. | Día del corte | `UPDATE ... SET conjuntoId = NULL` (el script imprime este SQL) |
| **C2** | **Merge a `main`** → Railway y Vercel despliegan el código con aislamiento. **Columnas siguen NULLABLE.** | Día del corte | Redeploy del commit anterior (la columna extra es inocua para el código viejo) |
| **C3** | **Backfill #2** (idempotente): recoge lo que el código viejo escribió entre C1 y el fin del deploy de C2. | Tras C2 | Igual que C1 |
| **C4** | Verificación: `0` NULL en las 4 tablas + smoke test en vivo (checklist del runbook). | Tras C3 | n/a |
| **C5** | **Migración *contract*** (manual, por túnel SSH): `NOT NULL` en las 4 columnas + FKs `SET NULL → RESTRICT`. Solo ahora, porque ya ningún escritor produce NULL. | Tras C4 | SQL de rollback del contract (ver abajo) |

Notas:
- **`SET NULL → RESTRICT`** (C5): con `SET NULL`, borrar un `Conjunto` dejaría
  usuarios/paquetes huérfanos (sin conjunto) — justo lo que el aislamiento no debe
  permitir. `RESTRICT` impide borrar un conjunto que aún tiene datos.
- **El *contract* no está en `prisma/migrations/`** hasta después de C5. Vive como
  script en `backend/prisma/manual/` (ver §"Migración contract"). Tras aplicarlo en
  C5, se registra en `migrations/` en un commit posterior y se marca como aplicado
  con `npx prisma migrate resolve --applied <nombre>`, para que los `migrate deploy`
  futuros no intenten re-aplicarlo.
- La activación del aislamiento es **orden de despliegue, no un flag**: no hay
  interruptor de runtime que lo prenda/apague.

#### Matriz de compatibilidad durante C2 (versiones mezcladas)

Railway (backend) y Vercel (frontend) despliegan por separado, así que durante C2
conviven versiones. **Orden de deploy más seguro: backend primero, frontend
después** (el frontend nuevo depende de endpoints del backend nuevo; al revés no).

| Combinación | Registro `?c=` | Registro sin `?c=` | `/api/auth/me`, config | Veredicto |
|---|---|---|---|---|
| **Frontend viejo + backend nuevo** (ventana normal, backend desplegó primero) | El form viejo no manda `codigoInvitacion` → `register` responde `400 INVITACION_INVALIDA`. Los **QR viejos de KAN-3 apuntan a la raíz sin `?c=`**, así que un residente nuevo no podría registrarse hasta que el frontend nuevo esté arriba. **Mitigación:** ventana corta y nocturna; avisar que el registro se habilita al terminar. | Igual: `400`. | `me` funciona (no cambió su forma). El frontend viejo no llama a `/conjunto/config`; las tarifas/WhatsApp que muestra son las que ya tenía hardcodeadas — cosméticamente viejas, sin romper. | Degradado pero **seguro**: operación de paquetes intacta; solo el registro nuevo queda en pausa breve. |
| **Frontend nuevo + backend viejo** (NO debe ocurrir si se despliega backend primero) | El backend viejo ignora `codigoInvitacion` y crea el `User` sin tenant (columna nullable). `/conjunto/config` **no existe** → el frontend nuevo falla al cargar tarifas/bonos. | — | `/conjunto/config` da 404. | **Evitar**: por eso backend primero. |
| **Ambos nuevos** (fin de C2) | Flujo completo con código. | Muestra el campo de código. | Todo desde config. | Correcto. |

**JWT existentes siguen válidos.** El token lleva `sub` y `role`, **no** un claim
de conjunto; el middleware resuelve el `conjuntoId` por `sub` contra la BD en cada
request (§diseño §3.6). Tras C1, los `User` de Ipanema ya tienen `conjuntoId`, así
que una sesión abierta de antes del corte sigue funcionando sin re-login. (Si por
cualquier motivo un `User` quedara sin `conjuntoId`, el middleware **falla cerrado**
con 401 — nunca opera sin tenant.)

### Procedimientos operativos por conjunto

> El multi-conjunto aún no está en producción; estos procedimientos aplican una
> vez ejecutado el corte anterior.

**Alta de un conjunto nuevo.** Se hace con el script interactivo
`npm run alta-conjunto` (en `backend/`). Da de alta el `Conjunto` (identidad,
tarifas, contacto del operador, `bonosHabilitados` siempre `false`), genera su
`codigoInvitacion` y crea la cuenta de operador dentro del contexto de ese
conjunto. Sirve tanto para el alta de Ipanema (Fase F) como para cualquier
conjunto futuro. **`prisma/seed.js` NO se usa en producción** — es solo para
desarrollo local.

El script apunta a la base de `DATABASE_URL`. Para producción, se corre por el
**túnel SSH de Railway** (ver "Migraciones de Postgres" arriba: dejar el túnel en
`127.0.0.1:55432` y exportar `DATABASE_URL` a ese túnel).

Flujo recomendado:

1. **Ensayo primero (`--dry-run`):** `npm run alta-conjunto -- --dry-run`. Hace
   todas las preguntas y muestra el resumen final, pero **no escribe nada**.
   Úsalo para revisar los datos (y ver a qué host apunta) antes de cualquier
   ejecución real.
2. **Alta real:** `npm run alta-conjunto`. Antes de escribir, el script:
   - imprime el **host** de `DATABASE_URL` (sin la contraseña) y **advierte en
     mayúsculas** si no es `localhost`/`127.0.0.1` (es decir, si va a tocar una
     base remota);
   - muestra un **resumen completo** de lo que va a crear (incluida la contraseña
     en claro si fue generada) y pide confirmar;
   - pide **reescribir el slug exacto** como segunda confirmación.
   Solo entonces crea el conjunto. Al final imprime el **código de invitación** y
   el **enlace de registro** (`/registro?c=<código>`), y la contraseña temporal si
   se generó (anótala: no se vuelve a mostrar).
3. **Idempotencia estricta:** si ya existe un conjunto con ese slug, el script
   informa `YA EXISTÍA` y **no crea ni modifica nada** (ni el operador). Para
   cambiar datos de un conjunto existente, edítalos directamente; el alta no
   reescribe.

`bonosHabilitados` no se pregunta: queda `false` siempre (los bonos se activan
por una acción deliberada aparte, nunca en el alta).

**Desactivar un código de invitación.** Para cerrar temporalmente el registro de
un conjunto, poner `invitacionActiva = false` en su fila de `Conjunto` (por el
túnel SSH, `UPDATE "Conjunto" SET "invitacionActiva" = false WHERE "slug" =
'<slug>';`). Los residentes ya registrados **no** se ven afectados (su
`conjuntoId` ya está fijado); solo se bloquean registros nuevos con ese código.

**Rotar un código de invitación filtrado.** Generar un `codigoInvitacion` nuevo
para el conjunto y actualizarlo en su fila. **Advertencia:** los QR y enlaces
impresos con el código anterior **dejan de funcionar** — hay que reimprimir la
cartelera/flyers con el enlace nuevo (`/registro?c=<código nuevo>`). Los
residentes ya registrados no se ven afectados. Regenerar el código no borra
histórico ni cambia a quién pertenecen los datos.

## 2. Correo transaccional: Resend + dominio propio

Sin esto, Resend solo entrega correos a la dirección con la que se creó la
cuenta — ningún residente real recibe nada (ni confirmaciones, ni
recuperación de contraseña).

1. Compra un dominio (cualquier registrador; en este proyecto se usó
   Cloudflare Registrar por el precio y porque el DNS queda en el mismo panel).
2. En Resend: **Domains → Add Domain** (o vía API,
   `POST https://api.resend.com/domains` con `{"name": "tudominio.com"}`) —
   devuelve 3 registros DNS (1 TXT DKIM, 1 MX, 1 TXT SPF).
3. Agrega esos 3 registros exactos en el DNS del dominio (en Cloudflare:
   dominio → **DNS → Records → Add record**). TTL en Auto, sin proxy naranja.
4. Verifica: `POST https://api.resend.com/domains/{id}/verify` (o el botón
   "Verify" en el dashboard). La propagación puede tardar unos minutos.
5. Actualiza `EMAIL_FROM` en Railway a una dirección de ese dominio, ej.
   `Puertaya Ipanema <notificaciones@tudominio.com>` — dispara un redeploy
   automático del backend.

## 3. Frontend en Vercel

1. **Add New → Project** → importa el mismo repo de GitHub.
2. **Root Directory** → `frontend`. Framework preset: Vite (Vercel lo detecta solo).
3. Variable de entorno: `VITE_API_URL` = `https://<tu-backend>.up.railway.app/api`
4. Deploy.

**`frontend/vercel.json` es obligatorio.** Sin el rewrite SPA que trae ese
archivo, cualquier ruta que no sea `/` (ej. `/login`, `/registro`) da 404 al
entrar directo o recargar — Vercel busca un archivo físico en esa ruta y no
lo encuentra. El archivo ya está en el repo; si se recrea el proyecto en
Vercel, confirma que sigue ahí.

## 4. Cerrar el círculo: CORS

Vuelve a Railway → variables del backend → actualiza `CORS_ORIGIN` y
`FRONTEND_URL` con la URL real de Vercel (sin slash final) → redeploy automático.

## 5. Verificación final

1. Abre la URL de Vercel → `/registro` → crea un residente real.
2. Revisa que llegue el correo de confirmación (requiere dominio verificado, sección 2).
3. Cierra sesión, entra con `OPERATOR_EMAIL` / `OPERATOR_PASSWORD`.
4. Recibe el paquete (con foto — se comprime sola en el navegador, ver
   nota abajo), prográmalo desde el residente, valida el PIN en la puerta.

Si algo no conecta, lo primero a revisar es `CORS_ORIGIN` en Railway y
`VITE_API_URL` en Vercel — son los dos puntos donde un typo rompe todo.

## Notas de problemas ya resueltos (por si vuelven a aparecer)

- **413 al confirmar recepción**: una foto de cámara real sin comprimir
  supera el límite del body JSON. El frontend ya comprime a JPEG (~1280px,
  calidad 0.7) antes de enviar (`frontend/src/utils/image.js`); el backend
  además el JSON general es de 1 MB y solo recepción/checkin admiten ~9,6 MB (presupuesto calculado en `domain/recepcion.js`).
- **`prisma migrate dev` con EPERM en Windows**: si nodemon tiene el backend
  corriendo en paralelo, el motor de Prisma no puede reescribir su `.dll`.
  Cierra el proceso de `npm run dev` antes de migrar, o vuelve a correr
  `npx prisma generate` después.
- **nodemon reiniciando solo en cada escritura de SQLite**: `backend/nodemon.json`
  ya limita el watch a `src/` — si se edita ese archivo y empieza a
  reiniciarse con cada cambio en `prisma/*.db`, revisar que siga así.

## Pendiente

- WhatsApp automático (Twilio u otro proveedor) — decisión consciente de
  dejarlo fuera por el costo; el botón manual de WhatsApp sigue funcionando.
- Mover fotos de custodia a almacenamiento de objetos en vez de base64 en Postgres.
- Soporte multi-conjunto: **implementado y validado** en la rama
  `feature/kan-8-multiconjunto` (KAN-8). Pendiente en producción: ejecutar el
  corte (backfill + fase *contract* + despliegue del código con aislamiento) —
  ver "Corte a producción del multi-conjunto" arriba.
