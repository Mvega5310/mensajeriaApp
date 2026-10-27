# Puertaya

Gestión y entrega residencial puerta a puerta para conjuntos residenciales.
Nació monoconjunto (**Conjunto Residencial Ipanema**, un solo operador) al
reestructurar un prototipo estático (ver `docs/`) tras una auditoría de
seguridad y contractual que encontró que el control de roles y el PIN de entrega
no tenían ningún respaldo del lado servidor. Con KAN-8 soporta **multi-conjunto**
(cada conjunto con sus residentes, operador y paquetes, aislados entre sí).

> **Estado del multi-conjunto:** implementado y validado en la rama
> `feature/kan-8-multiconjunto`, **no desplegado en producción**. El corte
> (backfill + fase *contract* + despliegue) es la Fase F y aún no se ejecuta; en
> producción sigue el conjunto único Ipanema hasta entonces (ver DEPLOY.md).

**En producción:**
- App: https://mensajeria-app-iota.vercel.app
- API: https://mensajeriaapp-production.up.railway.app

Ver [DEPLOY.md](DEPLOY.md) para el detalle de infraestructura (Railway,
Vercel, Resend) y cómo redesplegar o recuperar el ambiente desde cero.

## Estructura

```
puertaya-ipanema/
├── backend/     # API Express + Prisma/PostgreSQL — auth, roles y PIN reales
├── frontend/    # SPA Vite + React — consume la API, sin lógica de negocio propia
└── docs/        # Prototipo original y modelo de datos, como referencia histórica
```

## Arrancar en desarrollo

El backend usa **PostgreSQL** (el mismo motor de producción). SQLite ya no sirve
para desarrollo desde KAN-8: la lógica de aislamiento por conjunto usa consultas
propias de Postgres (p. ej. el bootstrap del tenant con `$queryRaw` e
identificadores entre comillas dobles), así que para ejercer el multi-conjunto
hay que desarrollar y probar contra Postgres. Lo más cómodo es una **instancia
temporal en Docker** (abajo). El `provider` comiteado en
`backend/prisma/schema.prisma` es siempre `"postgresql"`.

**Postgres local desechable (Docker)**
```
docker run --rm -d --name puertaya-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=puertaya -p 5433:5432 postgres:16
# en backend/.env:  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/puertaya"
```

**Backend**
```
cd backend
cp .env.example .env    # ajusta DATABASE_URL al Postgres local de arriba
npm install
npx prisma migrate deploy   # aplica las migraciones (incluye el multi-conjunto)
npm run seed                # crea un Conjunto local + su operador (idempotente)
npm run dev                 # http://localhost:4000
```

> **Variables de entorno.** El servidor valida su configuración antes de
> escuchar (`src/config/env.js`). Obligatorias: `DATABASE_URL` y `JWT_SECRET`.
> Si falta alguna, el proceso se detiene y el error lista todas las que
> faltan. Las opcionales (`CORS_ORIGIN`, `FRONTEND_URL`, `RESEND_API_KEY`, `FOTOS_S3_*`)
> dejan un aviso en el log. Todas están documentadas, con comentarios, en
> `backend/.env.example`.

> **Seed multi-conjunto (KAN-8).** `npm run seed` es **idempotente** (se puede
> correr varias veces sin duplicar):
> 1. busca o crea un `Conjunto` local (slug de `SEED_CONJUNTO_SLUG`, por defecto
>    `local`) y genera su `codigoInvitacion`;
> 2. **imprime en consola el código de invitación y el enlace de registro**
>    (`FRONTEND_URL/registro?c=<código>`) — úsalo para registrar residentes;
> 3. crea la cuenta de operador (`OPERATOR_*` del `.env`) **dentro** de ese
>    conjunto.
>
> **Dos conjuntos para probar el aislamiento.** Corre el seed dos veces con
> variables distintas para tener Alfa y Beta y comprobar que no se cruzan:
> ```
> SEED_CONJUNTO_SLUG=alfa SEED_CONJUNTO_NOMBRE="Conjunto Alfa" \
>   OPERATOR_EMAIL=opalfa@local OPERATOR_PASSWORD=Password1 npm run seed
> SEED_CONJUNTO_SLUG=beta SEED_CONJUNTO_NOMBRE="Conjunto Beta" \
>   OPERATOR_EMAIL=opbeta@local OPERATOR_PASSWORD=Password1 npm run seed
> ```
> Variables opcionales: `SEED_CONJUNTO_SLUG`, `SEED_CONJUNTO_NOMBRE`,
> `SEED_OPERADOR_WHATSAPP`, `SEED_OPERADOR_DOMICILIO`, `SEED_PUNTO_RECEPCION`.
>
> El seed usa el aislamiento real: resuelve el operador con
> `buscarUsuarioPorEmailSinTenant()` y lo crea dentro de
> `runWithTenant({ conjuntoId, role: 'OPERATOR' })`, sin pasar `conjuntoId` en
> `data`. **No usar el seed en producción** (el alta real de un conjunto es un
> procedimiento operativo — ver DEPLOY.md).

**Frontend**
```
cd frontend
npm install
npm run dev              # http://localhost:5173 (proxy a /api -> :4000)
```

**Pruebas del backend (KAN-8)**
```
cd backend
npm test                 # runner integrado de Node (node --test); NO usar
                         # 'node --test <carpeta>': no funciona en Windows.
```
Las pruebas **unitarias/estáticas** corren sin base de datos. Las de
**integración** (`*.integration.test.js`) **crean y borran datos**, así que solo
se ejecutan si `DATABASE_URL` apunta a `localhost`/`127.0.0.1`/`::1` (si no, se
omiten con un mensaje, y `npm test` a secas las omite si no hay Postgres local).

**Todas las pruebas, sin omitidas: `npm run test:all`.** Ejecuta
`backend/scripts/test-db.sh`: crea una base propia `puertaya_test_<pid>` en el
Postgres local (puerto 5432; el rol `puertaya_test` se crea solo), aplica el
esquema con `prisma migrate deploy`, exporta `DATABASE_URL`, corre `node --test`
(archivo por archivo, porque comparten esa base) y borra la base al terminar,
incluso si fallan. Requiere `psql` y Postgres encendido; como root usa
`su postgres`, o define `TEST_DB_ADMIN_URL` con un usuario administrador. La
prueba de la migración contract ejecuta el SQL real con `psql`.

Qué cubre cada archivo (en `backend/src/**/__tests__/`):

| Archivo | Tipo | Qué verifica |
|---|---|---|
| `tenantContext.test.js` | unitaria | contexto `AsyncLocalStorage`, `runWithTenant`, y la regresión del thenable perezoso (el `await` dentro de `run()`). |
| `tenantExtension.helpers.test.js` | unitaria¹ | helpers de la extensión: filtro `AND`, `where` único plano, `conjuntoId` nunca desde `data`. |
| `tenantExtension.interceptor.test.js` | unitaria¹ | lógica del interceptor por operación (lecturas/escrituras/creación/upsert, falla-cerrado, `GLOBAL_LOOKUP`). |
| `invitacion.service.test.js` | unitaria | generación y normalización del código de invitación. |
| `frontendSinFijos.test.js` | estática | falla si aparece "Ipanema" o montos de tarifa fijos en `frontend/src`. |
| `auditoriaInvariantes.test.js` | estática | un solo `PrismaClient`; `GLOBAL_LOOKUP` y consultas crudas solo en su función. |
| `tenantGuard.routes.test.js` | estructural¹ | recorre el app real: toda ruta autenticada lleva `requireAuth`+`requireTenant`; rutas públicas declaradas. |
| `tenantIsolation.integration.test.js` | integración | aislamiento CRUD entre dos conjuntos (findUnique/update/findMany, falla-cerrado). |
| `registroLogin.integration.test.js` | integración | registro por código, login en dos conjuntos, 409 email cross-conjunto. |
| `almacen.test.js` / `fotos.integration.test.js` | unitaria / integración | T5.1: decodificar y validar data-URI, selección s3/fake/legado, adaptador S3 con cliente simulado y firma local; recepción con 2 fotos → 2 `PaqueteFoto`, fotos legadas, 413, fallo del almacén sin paquete a medias, aislamiento. |
| `listadosSinFotos.integration.test.js` | integración | regresión T8.1: con una foto de 500 KB sembrada, ningún listado/lectura devuelve `fotoUrl` ni `data:image` y ninguna consulta de `Package` selecciona la columna; CSV sin inyección de fórmulas; filtros de fecha del CSV. |
| `http.integration.test.js` | integración | flujo HTTP extremo a extremo (register→login→`/packages/mine`), cross-conjunto 404, sin `fotoUrl`, 401 sin token. |
| `configConjunto.integration.test.js` | integración | `config-publica` y `/conjunto/config` por rol; tarifas distintas cobran distinto; gate de bonos. |
| `faseE.integration.test.js` | integración | aislamiento de negocio (operador del conjunto, cortesía por apto, schedule/checkin/confirm-delivery, bonos, comentarios). |
| `contratosResidente.integration.test.js` | integración | T2.8: `transportadora` en la pre-alerta, `schedule` con `modalidad` RECOGER/DOMICILIO, `motivoCobro` en `/packages/mine` y `/p/paquetes`, `GET /bonos/mine`. |
| `paquete.integration.test.js` | integración | T1.3: máquina de estados en `checkin`/`schedule`/`confirm-delivery` (409 al recibir un ENTREGADO o entregar un PREALERTADO), un `PaqueteEvento` por cambio, bono atómico (concurrencia), trigger de solo inserción y aislamiento de eventos. |
| `recepcionSinPrealerta.integration.test.js` | integración | T2.1: paquete sin residente (SIN_ASIGNAR / EN_RECEPCION directo) se crea y lista con `etiquetaNombre`, checkin/entrega lo toleran (409 o TARIFA, sin 500), aislamiento, y `GET /conjunto/config` con los defaults nuevos. |
| `recepcion.integration.test.js` | integración | T2.3: `POST /packages/recepcion` (con pre-alerta por guía / más antigua / sin pre-alerta / sin dueño), `PATCH /packages/:id/asignar`, cortesía y bono atómico, PIN entregable, `Idempotency-Key` (incl. carrera), `maxFotos` en recepción y checkin, `waUrl`, aislamiento y roles. |
| `contratosOperador.integration.test.js` | integración | T2.7: `/packages/resumen` (día de Bogotá, aislamiento, 403), `GET /packages/:id` (shape, sin pin/fotos, aviso `/p#`, 403/404), búsqueda `T2 30` por prefijo, bitácora (arreglo sin `pagina`, paginación, filtros). `fechas.test.js`: día de Bogotá y filtros de fecha. |
| `entregaLote.test.js` | unitaria | T2.5: token de entrega (firma, vencimiento, alteración) y regla de selección del lote. |
| `entregaLote.integration.test.js` | integración | T2.5: `/entregas/verificar-pin` y `/confirmar` (lote por apartamento, `PIN_AMBIGUO`, límite por operador, token ajeno/vencido, carrera sin entregas parciales, aislamiento). |
| `revisionF2.integration.test.js` | integración | Revisión F2: cortesía única (escenario lunes/martes, carrera de 5 recepciones, "T2" = "TORRE 2"), ninguna respuesta al operador lleva el PIN, bloqueo por paquete en lote, presupuesto de fotos del JSON. |
| `enlace.integration.test.js` + `domain/__tests__/enlace.test.js` | integración + pura | T3.1 (+T2.8: foto propia 200 / ajena no): token válido/vencido/alterado/basura/otro secreto/conjunto manipulado, residente borrado, sesión limitada (schedule propio sí, ajeno 404, todas las demás rutas del app real 403), URL `/p#` en el aviso. |
| `enlaceAcceso.integration.test.js` | integración | T3.2: enlace mágico (correo existente / inexistente con respuesta idéntica, canje con JWT normal, segundo canje, vencido, propósito RESET vs ACCESO en ambos sentidos, carrera de canjes, límite 5/15 min, forgot/reset intacto). |
| `avisos.integration.test.js` | integración | T2.4: correo de llegada con notificador `fake` (recepción, `asignar`, `checkin`; 0 en replay idempotente, sin correo o sin dueño; un notificador que lanza no tumba el 201). |
| `notificador/__tests__/plantillas.test.js` | unitaria | T2.4: `escaparHtml`, plantillas escapadas y sin "Ipanema", selección `fake`/`resend`, `construirEnlace`. |
| `backendSinFijos.test.js` | estática | T2.4: "Ipanema" no aparece en `backend/src` fuera de pruebas. |
| `migracionRecepcion.integration.test.js` | integración | T2.1: la migración aplica sobre datos existentes en una base desechable; el rollback aborta con mensaje si hay paquetes sin residente y, sin ellos, revierte. |

¹ Importan `@prisma/client`, así que requieren `npx prisma generate` (o
`npm install`, que lo dispara) aunque no toquen la base de datos.

Flujo: el operador inicia sesión con la cuenta creada por `npm run seed`.
Los residentes se crean ellos mismos en `/registro?c=<código>` con el código de
invitación de su conjunto (ese formulario nunca puede crear una cuenta de
operador — el rol lo fuerza el backend). Cada residente queda asociado al
conjunto de su código; los conjuntos están aislados entre sí.

## Formato de error de la API

Toda respuesta de error de la API tiene la forma `{ "code", "message", "details"? }`:

- `code`: constante estable en MAYÚSCULAS (el cliente decide por ella, nunca por el texto).
- `message`: texto en español listo para mostrar (qué pasó y qué hacer).
- `details`: opcional, datos de apoyo.

Los códigos viven en `backend/src/domain/errores.js` (`NO_AUTENTICADO`, `SESION_INVALIDA`, `CREDENCIALES_INVALIDAS`, `PROHIBIDO`, `NO_ENCONTRADO`, `DATOS_INVALIDOS`, `CONFLICTO`, `INVITACION_INVALIDA`, `ENLACE_INVALIDO`, `PIN_INCORRECTO`, `PIN_BLOQUEADO`, `DEMASIADOS_INTENTOS`, `FUNCION_DESHABILITADA`, `CARGA_DEMASIADO_GRANDE`, `TRANSICION_INVALIDA`, `ERROR_INTERNO`). En el backend se lanza `throw new AppError(code, message, status, details?)`; toda ruta async va envuelta en `asyncHandler(...)` y el manejador global de `app.js` responde. Un error no previsto devuelve `500 ERROR_INTERNO` con mensaje genérico (el detalle solo va a la consola del servidor). El frontend (`services/api.js`) lanza un `Error` con `message`, `code`, `details` y `status`.

## Funcionalidades

**Residente**
- Registro con aceptación obligatoria de Términos y Aviso de Privacidad
  (queda constancia con fecha — `termsAcceptedAt`). El selector de torre
  cubre las 6 torres del conjunto (`frontend/src/pages/Register.jsx`).
- Recuperación de contraseña por correo (enlace de un solo uso, vence en 1h).
- Acceso por enlace mágico (T3.2): el residente pide un enlace con su correo y entra sin contraseña (ver "Acceso por enlace mágico" abajo). El login con contraseña se conserva.
- Pre-alerta de paquete: categoría de peso estimada (con tarifa de
  referencia), valor declarado (tope de responsabilidad por custodia),
  franja horaria preferida, método de pago del servicio, una nota libre
  para el operador (ej. "pago con billete de $100.000, llevar vueltos"),
  y el PIN que algunas plataformas (ej. Mercado Libre) generan para su
  propio mensajero — el operador lo necesita a mano en recepción.
- Seguimiento del paquete con su PIN de entrega, y reprogramación de
  franja una vez el paquete llega. La tarjeta muestra lo esencial
  (tarifa, PIN, franja); tocarla abre un modal con el detalle completo
  (guía, PIN del proveedor, cobros, nota, fechas y las fotos de
  evidencia). Las fotos se ven en miniatura y se tocan para abrirlas en
  pantalla completa (`components/PhotoGallery.jsx`, compartido con el
  detalle del operador) — antes quedaban recortadas y chicas, sin forma
  de verlas más grande.
- El estado se refresca solo (cada 20s mientras la pestaña está visible,
  y de una vez al volver a ella) — no hay que recargar a mano para ver
  cuándo el operador confirma la entrega.
- Buzón de comentarios/inquietudes generales hacia el operador — los
  mensajes largos se acortan en la lista y se tocan para ver el texto
  completo en un modal.
- Notificación automática por correo al crear una pre-alerta, y de nuevo
  (con agradecimiento) cuando el operador confirma la entrega.
- Modo oscuro/claro (botón en pantalla, recuerda la preferencia).
- "Salir" pide confirmación antes de cerrar sesión — evita cerrarla sin
  querer cuando el dedo buscaba el botón de tema, que está justo al lado
  (aplica igual para Residente y Operador, es el mismo encabezado). Ese
  modal flota centrado en la pantalla (no anclado abajo como el resto)
  para que quede al alcance del pulgar usando el celular con una mano.
- Las pestañas (Mis Paquetes/Notificar/Comentarios en Residente; Recepción/
  Reparto/Bitácora/Buzón en Operador) quedan fijas abajo de la pantalla,
  como el tab bar de una app nativa — no se pierden al hacer scroll. Al
  cambiar de pestaña la página vuelve arriba sola, para que un salto de
  scroll (cuando la pestaña nueva tiene menos contenido que donde estabas
  desplazado) no se sienta como si la pantalla "brincara" de tamaño.
  `body` además fuerza `min-height: 100dvh`: sin eso, una pestaña corta
  (ej. Reparto vacío) no da con qué hacer scroll y en iOS Safari eso deja
  la barra de direcciones expandida, mientras que una pestaña larga sí
  la contrae — ese cambio de alto de la barra de Safari es lo que hacía
  que la barra fija de abajo pareciera moverse de una pestaña a otra.
- **Instalable como app** (PWA): en Android, Chrome ofrece "Instalar app"
  solo; en iPhone, Compartir → "Agregar a inicio". Queda con ícono propio
  y sin la barra del navegador — no es necesario pasar por App
  Store/Google Play para tenerla como app en el celular. Se actualiza
  sola: cuando hay una versión nueva desplegada, la próxima vez que se
  abre la app se recarga automáticamente para tomarla (sin pedir
  reinstalar ni tener que cerrarla dos veces).
- Identidad de marca azul/turquesa ("Puertayá"), con el kit de marca en
  `frontend/src/puertaya-brand/` (componente `Logo`, `tokens.css` con
  las variables `--puertaya-*`, y los logos en `logos/icono/` — versión
  chica para el encabezado — y `logos/lockup/` — símbolo + nombre +
  eslogan, usado en la pantalla de login/registro, tamaño mesurado a
  72px). El logo cambia de versión clara/oscura junto con el resto de
  la app (`useTheme`, compartido con `ThemeToggle`); el lockup tiene
  imagen transparente propia para cada modo (`puertaya-lockup-light.png`
  y `puertaya-lockup-dark.png`, esta última con el texto en blanco). El
  favicon, ícono de instalación y el `theme_color` del manifest de PWA
  usan el mismo set de íconos (`frontend/public/`).

**Operador**
- Alerta de primera entrega: **es por apartamento físico, no por
  cuenta** — si varias personas del mismo apto se registran con correos
  distintos, solo la primera entrega de cualquiera de ellas sale en $0;
  la cortesía no se repite por cuenta. **Regla (revisión F2): la cortesía es
  del primer paquete del apartamento que se COBRA**, no del primero que se creó.
  Un paquete es primera entrega si NINGÚN otro paquete del apto ya fue cobrado, es
  decir, está `EN_RECEPCION`, `PROGRAMADO` o `ENTREGADO` con dueño (criterio por
  estado: `recibidoEn` también se llena en `SIN_ASIGNAR`, que aún no cobra, y los
  paquetes legados no lo tienen; el estado solo avanza y cubre datos viejos sin
  eventos). Así un `SIN_ASIGNAR` del lunes que se asigna DESPUÉS de que el martes
  se llevó la cortesía paga TARIFA. `listAll()` y el CSV marcan "Primera vez" con la
  misma regla (`services/cobro.service.js#idsPrimeraEntrega`: el cobrado con
  `motivoCobro = CORTESIA` en su evento RECIBIR/ASIGNAR; en datos legados sin
  eventos, el cobrado más antiguo). **Carrera:** la decisión se serializa por
  apartamento con la tabla `CortesiaApartamento` (único `[conjuntoId, claveApto]`);
  insertar su fila (`createMany` con `skipDuplicates`, Prisma puro, sin SQL crudo)
  ES la reserva: una recepción paralela espera a la ganadora y al ver el conflicto
  cobra TARIFA; si la ganadora revierte, la reserva se libera. No requiere backfill:
  los apartamentos con paquetes ya cobrados se detectan por estado y nunca llegan a
  reservar. `torre`/`apto` se normalizan por `tokenTorre`
  (`domain/apartamento.js`): "TORRE 2", "Torre 2", "T2" y "2" son la MISMA torre; solo
  dígitos para apto — "Apto 302", "apto-302" y "302" cuentan como el
  mismo apartamento. La clave (`claveApartamento`, `services/apartamento.service.js`)
  la usan la cortesía, el lote de entrega y el listado. Si una cuenta no tiene torre o
  apto completos, no se agrupa con otras cuentas incompletas — conserva
  su propia cortesía, como antes. Recepción, Reparto, el modal de
  validar PIN y la Bitácora marcan con una franja dorada "🎁 NO cobrar"
  para que quede claro a quién sí toca cobrarle el servicio.
- Bonos prepago *(construido, en pausa)*: el operador podrá registrar
  que un residente pagó por adelantado un lote de entregas en una
  categoría de peso específica (cantidad y precio libres, el descuento
  lo decide caso a caso; el pago pasa por fuera de la app). Cada paquete
  de esa categoría descontaría 1 crédito y quedaría en $0 hasta
  agotarse; la cortesía de primera entrega siempre tiene prioridad y no
  gasta bono. Queda apagado **por conjunto**: la única fuente es
  `Conjunto.bonosHabilitados` (`false` por defecto). El backend lo lee del
  conjunto del contexto y el frontend de `GET /conjunto/config`; no hay constante
  global (la antigua `BONOS_HABILITADOS` se eliminó en KAN-8). Activarlo es
  cambiar ese campo del conjunto, sin desplegar.
- Recepción: hasta 3 fotos por paquete (comprimidas en el navegador antes
  de subir) y categoría real — la tarifa final se recalcula server-side.
  Solo muestra lo pre-alertado que falta recibir; apenas se hace el
  checkin, el paquete desaparece de ahí solo y pasa a Reparto. Al
  confirmar la entrega, desaparece de Reparto y queda solo en Bitácora
  (nunca se borra de la base de datos) — cada pestaña se despeja sola a
  medida que el paquete avanza, sin superposición entre ellas. Los
  contadores "En Recepción"/"Para Reparto" arriba salen de esas mismas
  listas filtradas, así que siempre cuadran con lo que se ve abajo.
- Ronda de reparto organizada en 2 sesiones fijas al día (9am-12m y 6pm-9pm).
- Nota del residente visible en Recepción, Reparto y al validar el PIN.
- Validación de PIN en puerta para cerrar la entrega. Al confirmar,
  aparece un botón de WhatsApp con mensaje de agradecimiento distinto al
  de recepción — no reemplaza el correo automático, es un segundo canal
  opcional para ese mismo momento.
- Bitácora: historial completo, buscable por residente/torre/apto/proveedor
  y filtrable por rango de fechas (Desde/Hasta) y por estado (Pre-alertado/
  En Recepción/Programado/Entregado) — útil cuando no se recuerda el
  nombre exacto. Exportable a CSV (sin PIN ni fotos) para llevar cuentas
  o compartir con un contador. Cada registro se toca para abrir un modal
  con el detalle completo (miniaturas que abren en pantalla completa al
  tocarlas, nota, PIN del proveedor, fechas, cobros).
- Paginación de 10 en 10 en toda lista que pueda crecer sin límite
  (Recepción, Reparto, Bitácora, Buzón del operador; Mis Paquetes y
  Comentarios del residente) — evita listas interminables a medida que
  se acumula historial.
- Recepción y Reparto: tocar el cuerpo de la tarjeta abre el mismo modal
  de detalle completo de la Bitácora (fotos, valor declarado, teléfono,
  fechas) sin perder los botones de acción rápida (Recibir, Editar,
  Validar PIN, WhatsApp), que siguen funcionando directo desde la tarjeta.
- Buzón: lee los comentarios de todos los residentes, con acceso directo a
  WhatsApp de cada uno. Los mensajes largos se acortan en la lista y se
  tocan para ver el texto completo en un modal.
- Generador de QR (código apunta a `/registro`) para distribuir e invitar
  residentes a crear su cuenta, descargable como PNG.
- Notificación automática por correo cuando entra una pre-alerta nueva.

**Backend / seguridad** (ver auditoría original para el detalle completo)
- Roles decididos server-side vía JWT — nunca por un valor que mande el
  cliente.
- PIN generado con `crypto`, nunca expuesto al operador (ni al recibir, ni al
  asignar, ni en el texto de WhatsApp, ni en listados): solo lo ve el residente en
  su enlace, su app y el correo de llegada.
- Política de contraseñas validada en servidor (no solo en el formulario).
- Correo transaccional vía Resend, con dominio propio verificado
  (`prospect01.com`) — llega a cualquier residente, no solo a la cuenta
  del operador.
- **Almacén de fotos (T5.1).** Las fotos nuevas van a un bucket compatible con S3
  (Railway Buckets) detrás de la interfaz `AlmacenFotos`
  (`backend/src/services/almacen/`: `s3`, `fake` en memoria y `bd-legado`); la base
  solo guarda filas `PaqueteFoto`. Se elige por `FOTOS_S3_ENDPOINT`,
  `FOTOS_S3_BUCKET`, `FOTOS_S3_ACCESS_KEY`, `FOTOS_S3_SECRET` (+ `FOTOS_S3_REGION`,
  `FOTOS_S3_FORCE_PATH_STYLE`); sin ellas: `fake` en desarrollo y, en producción,
  se sigue guardando en la base con un aviso en el log. Cómo crear el Bucket: ver
  DEPLOY.md. `GET /packages/:id/foto` devuelve `{ fotos: [{ url, orden }] }`
  (URLs firmadas de 10 min; las fotos antiguas de `fotoUrl` se siguen leyendo).
- Las fotos (`fotoUrl`, hasta 3 imágenes en base64 por paquete) nunca
  viajan en los listados generales (`GET /packages`, `GET /packages/mine`)
  ni en el sondeo de 20s del residente — solo se piden aparte, al abrir
  el detalle de un paquete puntual, vía `GET /packages/:id/foto`. Antes
  de este cambio, cada respuesta de listado incluía todas las fotos de
  todos los paquetes (con solo 9 paquetes con foto, el listado pesaba
  ~1.7MB), lo que sobrecargaba el servidor en producción — reinicios
  frecuentes del backend y la app "poniéndose oscura"/quedándose sin
  responder en el celular.

### Estados del paquete y bitácora de eventos (T1.3)

Todo cambio de estado pasa por `services/paquete.service.js#aplicarEvento`, que
valida la transición con la máquina pura (`domain/paquete.machine.js`; si no
aplica responde `409 TRANSICION_INVALIDA`), actualiza el paquete y escribe un
`PaqueteEvento` (`tipo`, `deEstado`, `aEstado`, `actorId`, `datos`, `creadoEn`) en
la misma transacción (`prisma.$transaction` del cliente extendido: la extensión de
tenant funciona dentro de transacciones interactivas). La pre-alerta
(`POST /packages`) registra `PREALERTAR` con `deEstado` nulo.

- `PATCH /packages/:id/checkin` = `RECIBIR` (solo desde PREALERTADO); `PATCH
  /packages/:id/schedule` = `PROGRAMAR` (desde EN_RECEPCION/PROGRAMADO);
  `POST /packages/:id/confirm-delivery` = `ENTREGAR` (desde EN_RECEPCION/PROGRAMADO).
  En la entrega la transición se valida **antes** que el PIN, así un paquete no
  entregable no gasta intentos de PIN.
- **Límite de intentos (T1.4):** el PIN de entrega admite 5 fallos por paquete
  (`Package.intentosPin`); el 5.º lo bloquea 15 min (`pinBloqueadoHasta`).
  Respuestas: PIN malo = `400 PIN_INCORRECTO` ("PIN incorrecto. Te quedan X
  intentos.", `details.intentosRestantes`); bloqueado = `423 PIN_BLOQUEADO`
  ("Demasiados intentos. Espera N minutos e inténtalo de nuevo.",
  `details.minutosRestantes`), incluso con el PIN correcto. Acertar resetea el
  contador. Lógica pura en `domain/pin.js` (`evaluarIntento`); el fallo se
  persiste fuera de la transacción de entrega con compare-and-set
  (`registrarIntentoPin` en `services/pin.service.js`) para que el rollback no lo
  borre y los fallos concurrentes cuenten todos.
- **Límite de login:** 10 fallos por IP cada 15 min => `429 DEMASIADOS_INTENTOS`
  (con `Retry-After`). Limitador en memoria (`domain/limitador.js`, interfaz
  `intentar/devolver/limpiar`, reloj inyectable), inyectable en
  `createApp({ limitadorLogin })`. `intentar(clave)` reserva el intento de forma
  síncrona antes de cualquier `await` (una ráfaga paralela no lo evade); un login
  exitoso llama `devolver(clave, reserva)`, que deshace solo su propia reserva y
  nunca reinicia el contador. Ver `trust proxy` en DEPLOY.md.
- **Bono atómico:** el descuento va en la misma transacción con
  `updateMany({ where: { cantidadUsada: { lt: cantidadTotal } } })` y se exige
  `count === 1`; dos recepciones concurrentes no gastan el mismo crédito. Si el
  crédito se agota en la carrera, el paquete se cobra como `TARIFA` (no se
  bloquea al operador) y el evento `RECIBIR` lo deja registrado en `datos`. Un
  re-checkin da 409 y no descuenta de nuevo.
- `PaqueteEvento` es **solo inserción**: un trigger Postgres rechaza `UPDATE` y
  `DELETE` (la FK a `User` es `RESTRICT`). Lleva `conjuntoId` y está en
  `MODELOS_CON_TENANT`. Las pruebas lo limpian con `test-support/purgarEventos.js`.

### Recepción sin pre-alerta: esquema (T2.1)

Base para que el operador reciba un paquete sin que el residente lo haya
pre-alertado (fase *expand*, ver DEPLOY.md):

- `Package.residenteId` es opcional. Un paquete sin residente muestra
  `etiquetaNombre` (lo que dice la etiqueta) en `GET /packages` y en el CSV;
  `residente` llega `null`, nunca tiene cortesía de primera entrega y no consume
  bono. `checkin` y `confirm-delivery` lo toleran (la entrega no envía correo).
- Campos nuevos: `etiquetaNombre`, `transportadora`, `metodoPago`
  (`EFECTIVO`|`TRANSFERENCIA`, `domain/pago.js`), `recibidoEn`. Se reutilizan
  `guia` (default "Sin Guía") y `fechaEntrega` (la fecha de entrega). `proveedor`
  (tienda/plataforma) sigue siendo obligatorio y distinto de `transportadora`.
- `Conjunto`: `prefijoPais`, `franjasEntrega`, `maxFotos`, `custodiaMaxDias`.
  `GET /conjunto/config` los devuelve (más `metodosPago`); si `franjasEntrega` es
  null se aplica el default de `domain/conjuntoConfig.js`.
  El frontend no tiene franjas, métodos de pago, prefijo ni máximo de fotos
  fijos: los lee de esa misma config (`utils/schedule.js` se borró). La prueba
  `frontendSinFijos.test.js` falla si vuelven a aparecer.

### Buscar residentes: `GET /api/residentes/buscar?q=` (T2.2)

Solo `OPERATOR` (`requireAuth` + `requireTenant` + `requireRole`). Devuelve como
máximo 5 residentes del conjunto del operador (los de otro conjunto nunca
aparecen):

```json
[{ "id": "…", "nombre": "Ana Gómez", "torre": "TORRE 2", "apto": "304",
   "etiqueta": "T2 · 304", "pendientes": 2 }]
```

- `pendientes` = paquetes del residente en `EN_RECEPCION` o `PROGRAMADO`.
  No se expone email ni teléfono.
- `q` vacío (o de más de 60 caracteres) -> 400 `DATOS_INVALIDOS`.
- Formatos de `q` (`domain/apartamento.js#interpretarBusqueda`): `304` (solo apto;
  también prefijo: `30` -> 301..309; con torre también es prefijo: `T2 30` -> 301, 304...), `T2 304`, `t2-304`, `2-304`, `2 304`,
  `2/304`, `Torre 2 apto 304`, y nombre libre (`ana`, `Ana Gó`, `gomez`).
- Orden: apto exacto primero, luego torre y apto.
- Torre guardada hoy: `"TORRE N"` (registro, en mayúsculas); se compara por
  token, así `TORRE 2`, `T2` y `2` son la misma torre. Apto: solo dígitos.
- Tildes: el nombre se compara en memoria sin tildes ni mayúsculas (sin
  `unaccent` ni SQL crudo, invariante 3) sobre una lectura acotada (solo
  `RESIDENT`, 4 columnas, tope 3000).

### Recepción sin pre-alerta, asignar e idempotencia (T2.3)

Solo `OPERATOR`. El cobro (cortesía por apartamento, bono atómico, tarifa) lo
calcula `services/cobro.service.js#resolverCobro`, **la misma función** que usa
`PATCH /packages/:id/checkin`; ambos validan fotos contra `Conjunto.maxFotos`
(ya no hay un `3` fijo). Las fotos siguen en `fotoUrl` (base64; T5.1 lo cambia) y
los listados siguen sin `fotoUrl` ni `pin`.

**`POST /api/packages/recepcion`**: cabecera opcional `Idempotency-Key`.

```json
{ "residenteId": "…|null", "etiquetaNombre": "Carlos Pérez", "categoriaPeso": "ESTANDAR",
  "guia": "AB-123", "transportadora": "Servientrega", "fotos": ["data:image/jpeg;base64,…"] }
```

- `categoriaPeso` obligatoria (`MANO|ESTANDAR|VOLUMEN|PESADO`). Sin `residenteId`,
  `etiquetaNombre` es obligatoria (400 si falta). Lógica en `domain/recepcion.js`.
- **Con `residenteId`** (debe ser `RESIDENT` del conjunto; si no, 404
  `NO_ENCONTRADO`): busca sus pre-alertas `PREALERTADO`; elige la de la misma
  `guia` (comparada sin espacios/guiones y en mayúsculas; "Sin Guía" nunca
  coincide) y, si no hay, la más antigua. La pasa a `EN_RECEPCION` con `RECIBIR`
  (conserva su PIN; rellena `transportadora`/`guia` si estaban vacías). Si no hay
  pre-alerta, crea el paquete directo en `EN_RECEPCION` (evento `RECIBIR` con
  `deEstado` null, `proveedor` = transportadora o "Sin especificar", PIN nuevo).
- **Sin `residenteId`**: crea `SIN_ASIGNAR` con `RECIBIR_SIN_DUENO`. Aún no hay
  cobro (`costoServicio = 0`; se calcula al asignar). El PIN se genera ya (columna
  obligatoria) pero **no se devuelve** (`pin: null`, `aviso: null`).
- **Idempotencia**: con `Idempotency-Key` (1-128 caracteres sin espacios) un
  reintento del mismo operador y conjunto dentro de 24 h devuelve el mismo
  paquete (mismo 201 y cabecera `Idempotent-Replayed: true`) sin crear otro ni
  gastar otro bono. La clave (`ClaveIdempotencia`, con tenant) se guarda en la
  misma transacción que el paquete; dos envíos simultáneos con la misma clave
  crean uno solo.

Respuesta `201`:

```json
{ "paquete": { "id": "…", "estado": "EN_RECEPCION", "residenteId": "…",
    "nombre": "Ana Gómez", "torre": "TORRE 2", "apto": "304", "etiquetaApto": "T2 · 304",
    "etiquetaNombre": null, "categoriaPeso": "ESTANDAR", "costo": 4500,
    "motivoCobro": "TARIFA", "guia": "AB-123", "transportadora": "Servientrega",
    "recibidoEn": "2026-10-29T15:04:05.000Z" },
  "aviso": { "texto": "Hola Ana, llegó tu paquete a portería (Paquete estándar). Tu PIN de entrega está aquí: https://app…/p#<token>",
             "waUrl": "https://wa.me/573001234567?text=Hola%20Ana%2C…" } }
```

`motivoCobro`: `TARIFA|CORTESIA|BONO` (null en `SIN_ASIGNAR`). `waUrl` es `null`
si el residente no tiene teléfono; `aviso` es `null` sin residente. El enlace lo
arma `domain/whatsapp.js#construirEnlace` con `Conjunto.prefijoPais`
(provisional: T2.4 completa los avisos). Con `FRONTEND_URL` definida, el texto
termina con el enlace firmado `…/p#<token>` (el token va en el fragmento; ver T3.1 abajo). **El operador no recibe el PIN**: ni `paquete.pin` (recepción, asignar y replay idempotente) ni el texto de WhatsApp, que dice que el PIN está en el enlace; el correo de llegada al residente sí lo incluye.

**Límite del cuerpo JSON.** 1 MB para toda la API; solo `POST /packages/recepcion` y `PATCH /packages/:id/checkin` admiten ~9,6 MB (parser montado tras `requireAuth`/`requireRole`): 4 fotos razonables x 1,5 MB x 1,37 (base64) = 8,2 MB de presupuesto + 1 MB de margen. `validarFotos` (dominio) rechaza con `413 CARGA_DEMASIADO_GRANDE` si el total de fotos excede el presupuesto, y cada foto pasa de 1,5 MB => 413 "La foto N pesa demasiado".

**`PATCH /api/packages/:id/asignar`** con `{ "residenteId": "…" }`: `ASIGNAR`
(`SIN_ASIGNAR` -> `EN_RECEPCION`), pone el residente y calcula el cobro en ese
momento. Responde `200` con el mismo `{ paquete, aviso }`. Paquete que no está
`SIN_ASIGNAR`: 409 `TRANSICION_INVALIDA` (sin gastar bono); residente de otro
conjunto o inexistente: 404.

**`GET /api/packages?estado=SIN_ASIGNAR`**: filtro opcional por estado (cualquiera
de la máquina; otro valor -> 400). Sin parámetro devuelve todos, como antes.

### Contratos de las pantallas del operador (T2.7)

Todos solo `OPERATOR`, sin PIN ni fotos en ninguna respuesta.

- **`GET /api/packages/resumen`** -> `{ "hoy": { "recibidos": 3, "entregados": 1 },
  "porEntregar": 2, "sinAsignar": 1 }`. Solo `count` (sin filas). "Hoy" = día
  calendario de `America/Bogota` (UTC-5; `domain/fechas.js`). `recibidos` =
  `recibidoEn` de hoy; `entregados` = `fechaEntrega` de hoy; `porEntregar` =
  `EN_RECEPCION` + `PROGRAMADO`. Recibir lo usa en vez de cargar `GET /packages`.
- **`GET /api/packages/:id`** -> mismo `{ paquete, aviso }` de la recepción;
  `aviso = { texto, waUrl }` con un enlace firmado NUEVO si hay residente (`null`
  si no hay dueño). Nunca PIN ni fotos (esas, `GET /packages/:id/foto`).
  Otro conjunto o inexistente: 404. Guardado lo usa al recargar.
- **Bitácora: `GET /api/packages`** acepta `estado`, `desde`, `hasta`, `q`,
  `pagina`, `porPagina`.
  - `desde`/`hasta`: `AAAA-MM-DD` (día de Bogotá; `hasta` incluye todo ese día) o
    ISO completo. Se aplican a la fecha efectiva: `recibidoEn` si el paquete ya
    llegó; si no (pre-alerta) `createdAt`. Fecha inválida -> 400.
  - `q`: apto (prefijo, `T2 30` también), nombre del residente, etiqueta o guía
    (sin distinguir mayúsculas; el nombre sí distingue tildes).
  - Compatibilidad: **sin `pagina` ni `porPagina` responde un arreglo**, como antes
    (los filtros también aplican). Con `pagina` (>= 1) y/o `porPagina` (1-100, 20
    por defecto) responde `{ items, total, pagina, porPagina }`. Valor inválido -> 400.
  - Orden: `createdAt` descendente. En la app: "Más" -> "Bitácora".

### Entrega por lote con PIN (T2.5)

Pantallas Op-Entregar / Op-Cobrar: el operador teclea el PIN, ve todo lo
pendiente del apartamento con el total, elige Efectivo/Transferencia y
"Entregar todo". Rutas nuevas, solo `OPERATOR` (`requireAuth` + `requireTenant`).
`POST /api/packages/:id/confirm-delivery` (individual) sigue igual.

**`POST /api/entregas/verificar-pin`** `{ "pin": "1234", "residenteId"?: "…", "apto"?: "T2 304" }` ->
`200 { residente: { id, nombre, etiquetaApto }, paquetes: [{ id, categoriaPeso,
transportadora, proveedor, recibidoEn, costo, motivoCobro, estado }], total,
metodosPago: ["EFECTIVO","TRANSFERENCIA"], tokenEntrega, venceEn }`.
Errores: 400 `DATOS_INVALIDOS` (PIN no es de 4 dígitos), 400 `PIN_INCORRECTO`
(ningún paquete entregable lo tiene; cuenta como fallo), 409 `PIN_AMBIGUO`
(`details.opciones: [{ residenteId, etiquetaApto }]`), 423 `PIN_BLOQUEADO`,
429 `DEMASIADOS_INTENTOS` (con `Retry-After`).

**`POST /api/entregas/confirmar`** `{ tokenEntrega, paqueteIds, metodoPago }` ->
`200 { entregados, total, metodoPago }`. Una sola transacción: `ENTREGAR` por
paquete (un `PaqueteEvento` cada uno, `datos: { metodoPago, lote }`) con
`metodoPago` y `fechaEntrega`; si uno falla todo se revierte. Errores: 400
(`metodoPago` fuera de `METODOS_PAGO`, `paqueteIds` vacío), 401 `SESION_INVALIDA`
(token alterado, malformado o vencido), 403 `PROHIBIDO` (token de otro operador
o conjunto, o `paqueteIds` fuera del token), 409 `TRANSICION_INVALIDA` (carrera
o paquete ya entregado). El `total` se calcula en el servidor, no del cliente.

Decisiones:
- **Lote = apartamento.** El PIN sigue siendo por paquete; uno que coincide con un
  paquete entregable (`EN_RECEPCION`/`PROGRAMADO`) prueba que el portador es del
  apartamento, así que el lote trae TODOS los entregables del apartamento (otros
  PIN, y también los de otros residentes del mismo apartamento; clave
  `claveApartamento`). Nunca `ENTREGADO`, `PREALERTADO` ni `SIN_ASIGNAR`.
- **Colisión de PIN** (4 dígitos = 10.000 valores): si coincide con paquetes de
  más de un apartamento, 409 `PIN_AMBIGUO` y el operador elige; se reenvía con
  `residenteId` o `apto`. A futuro conviene un PIN por residente/apartamento
  (un solo código por aviso o por apto, único dentro del conjunto); no se cambió
  aquí.
- **Intentos por operador**, no por paquete: un PIN inexistente no tiene paquete
  al que atribuirlo. `crearLimitadorMemoria` (clave `entrega:<operador>`), 20
  fallos / 10 min; el 21.º es 429 ("Muchos PIN incorrectos seguidos. Espera N minutos
  o entrega desde Pendientes."; 10 / 15 min paralizaba la portería en hora pico). Los aciertos y los 409 no gastan cupo
  (`devolver`). Memoria del proceso (una réplica), igual que el login.
- **Bloqueo por paquete** (T1.4): si algún paquete cuyo PIN coincidió tiene
  `pinBloqueadoHasta` vigente, 423 aunque el PIN sea correcto. Un acierto reinicia
  el contador de esos paquetes (`registrarIntentoPin`, igual que `/confirm-delivery`) y
  un PIN errado con `residenteId`/`apto` indicado cuenta como fallo contra los
  paquetes entregables de ese apartamento (5 fallos => 423 por paquete, T1.4). Los demás paquetes del lote no se consultan.
- **`tokenEntrega`**: `base64url(payload).base64url(HMAC-SHA256)`, vence a los 10
  min, liga operador + conjunto + residente + ids del lote. Secreto
  `ENTREGA_SECRET` (opcional; si falta, `JWT_SECRET`) con prefijo de dominio, así
  un JWT nunca vale como token de entrega. Código: `domain/tokenEntrega.js`,
  `domain/entregaLote.js`, `services/entrega.service.js`.
- **Correo de agradecimiento**: `despuesDeEntregarLote()` en
  `services/entrega.service.js` es el único punto post-commit (hoy vacío; T2.4 lo
  conecta).
### Enlace firmado del residente (T3.1, decisión D1)

El aviso de llegada de WhatsApp lleva `${FRONTEND_URL}/p#<token>` (en el **fragmento**, que el navegador no envía al servidor: no queda en los logs de Railway/Vercel): abre "Mis paquetes"
**sin contraseña** y muestra el PIN. El token vence a los **7 días**.

- **Token** (`domain/enlace.js`, puro): `v1.<payload base64url>.<firma base64url>`;
  payload `{ r: residenteId, c: conjuntoId, e: vencimiento ms }`, firma HMAC-SHA256
  con `ENLACE_SECRET` (comparación en tiempo constante; la firma se verifica antes
  de leer el contenido). Sin dependencias nuevas.
- **`POST /api/p/abrir` `{ token }`** (PÚBLICA, en `RUTAS_SIN_SESION`; el frontend lee el token de `location.hash`). `GET /api/p/:token` se **eliminó** (en vez de dejarlo en 410: una ruta pública menos, y un enlace viejo `/p/<token>` lo atiende el frontend, no esta API; el frontend debe mostrar "Abre el enlace más reciente que te enviamos."). Verifica el token,
  abre su propio contexto de tenant con el `conjuntoId` del token (`runWithTenant`,
  sin `GLOBAL_LOOKUP` ni SQL crudo: la firma garantiza que el conjunto lo emitimos
  nosotros) y comprueba que el residente exista, sea `RESIDENT` y pertenezca a ese
  conjunto. Responde `{ residente: { nombre, etiquetaApto }, conjunto: { nombre },
  paquetes: [...], franjasEntrega, metodosPago, sesion }`. Cada paquete: `id,
  estado, pin` (solo `EN_RECEPCION`/`PROGRAMADO`; `null` en `PREALERTADO`), `costo,
  motivoCobro, categoriaPeso, proveedor, transportadora, guia, recibidoEn,
  franjaHoraria, metodoPagoServicio`. Nunca devuelve email ni teléfono ni fotos.
  Errores: `400` sin token, `401 ENLACE_INVALIDO | ENLACE_VENCIDO`, `404` si el residente ya no existe.
  Cabeceras `Cache-Control: no-store` y `Referrer-Policy: no-referrer`.
- **`sesion`**: JWT firmado con `JWT_SECRET`, `scope: 'enlace'`, vence en 2 h. Solo
  sirve en `GET /api/p/paquetes` (refresca la misma vista, sin `sesion`),
  `PATCH /api/packages/:id/schedule` (pedir entrega; solo paquetes propios, 404 si
  no) y `GET /api/packages/:id/foto` (T2.8: fotos del paquete propio; el de otro
  residente da 403/404). `requireAuth` rechaza con **403** cualquier otra ruta (lista
  `RUTAS_PERMITIDAS_ENLACE` en `middleware/auth.middleware.js`, recorrida por
  `enlace.integration.test.js` sobre el app real). `requireTenant` además exige que
  el `conjuntoId` del token coincida con el del usuario en la BD.
- **Seguridad**: quien tenga el enlace ve los PIN del residente durante 7 días
  (compromiso consciente de D1: sin fricción). Mitigaciones: vence, es por residente,
  la sesión derivada es mínima y de 2 h, y rotar `ENLACE_SECRET` invalida todos los
  enlaces emitidos. `ENLACE_SECRET` es obligatoria (≥ 32 caracteres y distinta de
  `JWT_SECRET`) con `NODE_ENV=production`; en desarrollo/test se deriva de
  `JWT_SECRET` con un aviso al arrancar.
### Acceso por enlace mágico (T3.2)

Reutiliza `PasswordResetToken` con el campo `proposito` (`RESET` | `ACCESO`, por
defecto `RESET`). Cada consulta filtra por propósito: un token de un tipo nunca
sirve para el otro. Solo se guarda el **hash** (SHA-256) del token; el de reset ya
funcionaba así, no se cambió.

- `POST /api/auth/enlace` `{ email }` (pública): SIEMPRE 200 con
  `{ message: "Si el correo está registrado, te llegará un enlace para entrar. Revisa tu bandeja." }`
  exista o no la cuenta. La consulta, el token y el correo van en segundo plano
  (el tiempo de respuesta no revela la cuenta). Si existe, envía
  `${FRONTEND_URL}/acceso/<token>` (vence en 15 min, un solo uso). Límite: 5
  solicitudes por correo+IP cada 15 min (limitador en memoria); pasado el cupo
  sigue respondiendo 200 igual, pero no envía.
- `POST /api/auth/enlace/canjear` `{ token }` (pública): marca el token usado con un
  `updateMany` condicional (solo un canje gana) y devuelve lo mismo que el login:
  `{ token: <JWT normal, sin scope>, user: { id, nombre, role } }`. Token
  inválido, usado, vencido o de otro propósito: **400** `code: ENLACE_INVALIDO`,
  "El enlace ya no sirve. Pide uno nuevo." Es POST para que los escáneres de
  enlaces de los correos no lo consuman.

### Avisos por correo: Notificador (T2.4)

Los correos pasan por la interfaz `services/notificador/` (servicio externo
detrás de interfaz con `fake`). Implementaciones: `resend` (API de Resend) y
`fake` (memoria: `obtenerEnviados()` / `limpiar()`). Sin `RESEND_API_KEY`
válida (la de ejemplo `re_xxx...` cuenta como ausente) se usa `fake` y se avisa
en el log. Se inyecta con `createApp({ notificador })` y vive en
`app.locals.notificador`. `EMAIL_FROM` define el remitente (por defecto
`Puertaya <onboarding@resend.dev>`).

Métodos: `avisarLlegada({ residente, paquete, conjunto, aviso })`,
`agradecerEntrega({ residente, paquetes, conjunto })`,
`enviarEnlaceAcceso({ email, url, conjunto })`,
`confirmarPrealerta`, `avisarNuevaPrealerta`, `recuperarContrasena`.

- **Correo de llegada** (decisión D3: correo automático, WhatsApp manual): se
  envía tras confirmar la transacción en `POST /packages/recepcion`, en
  `PATCH /packages/:id/asignar` y en el `checkin` legado, solo si el residente
  tiene correo; nunca en un replay idempotente. Es fire-and-forget: un fallo
  se registra en el log (sin datos personales) y no altera la respuesta. El
  aviso de WhatsApp sigue siendo manual (`aviso.waUrl`).
- **Plantillas** (`notificador/plantillas.js`): todo valor interpolado pasa por
  `escaparHtml`; el nombre del conjunto sale de `Conjunto`, no del código;
  español, tuteo, sin emoji ni exclamaciones.
- `backendSinFijos.test.js` falla si "Ipanema" aparece en `backend/src`.
- El armado de `wa.me` del frontend (`frontend/src/utils/whatsapp.js`) lo usa el
  buzón del operador; el aviso de llegada usa `aviso.waUrl` del backend.

### Pantallas del operador (T4.2)

`OperatorView.jsx` se borró. El login del operador aterriza en `/op/recibir`
(`/` redirige según el rol). Cada pantalla vive en `frontend/src/pages/operador/`
(≤ 200 líneas) con su hook de datos en `frontend/src/hooks/operador/`:

| Ruta | Pantalla | Qué hace |
|---|---|---|
| `/op/recibir` | Recibir | Teclado + "Torre", búsqueda con debounce (`/residentes/buscar`), "No sé de quién es" (sin dueño), contador "Hoy: N · M por entregar" (`GET /packages/resumen`). |
| `/op/recibir/:residenteId` | Peso | 4 tiles con la tarifa del conjunto, foto opcional (`maxFotos`, `utils/image.js`), "+ Guía", **Guardar** (`POST /packages/recepcion` con `Idempotency-Key`). `residenteId = sin-dueno` para el flujo sin dueño. |
| `/op/guardado/:id` | Guardado | Resumen, `motivoCobro` (sello de cortesía), vista previa del aviso y **Avisar por WhatsApp** (`aviso.waUrl`). |
| `/op/entregar` | Entregar | PIN de 4 dígitos; verifica solo (`/entregas/verificar-pin`); `PIN_AMBIGUO` muestra chips de apartamento. |
| `/op/entregar/lote` | Cobrar | Lote, total, Efectivo/Transferencia (de `metodosPago`) y **Entregar todo** (`/entregas/confirmar`). El `tokenEntrega` vive solo en memoria del módulo. |
| `/op/pendientes` | Pendientes | Buscador, "Sin asignar" (Asignar → `PATCH /packages/:id/asignar`), "Por entregar" por apartamento (detalle con fotos y bonos si `bonosHabilitados`), avisos de residentes. "Más": tema, exportar CSV, buzón de comentarios, QR de invitación, salir. |

**Recibir en 4 toques (T8.1).** Cuando la búsqueda devuelve **una única** sugerencia y lo escrito
tiene ≥ 3 dígitos de apartamento (o torre + el apto exacto del residente), Recibir muestra ya el
botón principal **Guardar** con "Estándar" preseleccionado (y su tarifa) y el enlace "Cambiar
tamaño" (lleva a la pantalla de tamaño). "304" + Guardar = 4 toques. Con varias sugerencias o el
apto a medias sigue el flujo normal (dígitos → sugerencia → tamaño → Guardar). La sugerencia sigue
siendo tocable (va a la pantalla de tamaño).
Detalles: con torre el backend compara el apartamento exacto (sin prefijo);
`api()` acepta `headers` y `sinCierreDeSesion` (un 401 de `/entregas/confirmar`
puede ser del token de entrega, no de la sesión).

**Escritorio (T4.4).** A partir de 1024 px la barra inferior pasa a ser lateral fija (logo arriba; "Más" y tema abajo) y Pendientes se ve en dos columnas: lista a la izquierda y detalle del apartamento a la derecha (el mismo `DetalleCuerpo` que la hoja móvil). Las demás pantallas se centran con ancho máximo de 560 px. El detalle ofrece "Entregar con PIN" cuando hay paquetes entregables.

**Sin señal (T4.5).** Guardar nunca pierde un registro por falta de conexión:

- Al tocar **Guardar** se genera una `Idempotency-Key` (uuid) una sola vez. Si `navigator.onLine` es falso, o la petición falla por red o supera 30 s, el registro (con sus fotos en data-URI) se guarda en una cola persistente en IndexedDB (`frontend/src/offline/`) y se abre `/op/guardado/pendiente-<clave>`: resumen local, el aviso "Sin señal. Guardamos el registro y lo enviamos al volver.", "Avisaremos cuando se envíe" y **Avisar por WhatsApp** deshabilitado. Un 4xx/5xx de la API al primer intento no se encola: se muestra el mensaje del backend.
- Reenvío en orden y con la misma clave: al evento `online`, al volver la pestaña visible y cada 30 s mientras haya pendientes (backoff exponencial 30 s → 5 min). Cualquier 2xx (replay incluido, cabecera `Idempotent-Replayed: true`) saca el elemento de la cola; 5xx, 401, 408, 429 o red lo dejan en cola; los demás 4xx lo pasan a "No se pudieron enviar" con el mensaje del backend (Reintentar / Descartar). Un reintento nunca duplica el paquete ni reenvía el correo.
- Cuando se envía y la pantalla Guardado de ese registro sigue abierta, se reemplaza por la respuesta real (aviso con `waUrl`).
- Todas las pantallas del operador (`Pantalla.jsx`) muestran "N por enviar · Enviando / Sin señal" (`role="status"`); al tocarla se abre la lista de pendientes y fallidos.
- Límites de la cola: 50 registros o ~40 MB; al llenarse, Guardar muestra que hay que conectarse antes de guardar más.
- La lógica (orden, backoff, clasificación red/4xx/5xx, límites) está en `offline/colaPura.js` y se prueba con `cd frontend && node --test src/offline/colaPura.test.js`. El service worker de la PWA deja `/api/` en `NetworkOnly` (nunca sirve datos de la API desde caché).
- Límites conocidos: sin IndexedDB (p. ej. algunos modos privados) la cola vive solo en memoria y el indicador lo avisa; iOS Safari puede borrar los datos del sitio tras días sin uso, y no hay sincronización en segundo plano (solo con la app abierta). La cola no distingue sesiones: si otro operador inicia sesión en el mismo dispositivo con pendientes, estos se enviarán con su sesión.

### Pantallas del residente (T4.3)

`ResidentView.jsx` se borró. El login del residente aterriza en `/paquetes`. Pantallas en
`frontend/src/pages/residente/` (≤ 200 líneas), hooks en `frontend/src/hooks/residente/`:

| Ruta | Pantalla | Qué hace |
|---|---|---|
| `/p` | Abrir | Enlace de WhatsApp `/p#<token>`: lee el fragmento, lo borra de la barra (`history.replaceState`), `POST /api/p/abrir` y entra a Mis paquetes sin contraseña. 401 o enlace viejo `/p/<token>` → "Este enlace ya no sirve" con salida a `/acceso`. |
| `/paquetes` | Mis paquetes | Saludo, tarjetas (estado, foto si hay, monto o "Gratis", **PIN en grande**), **Pedir entrega** (o "Cambiar franja" si ya está programado), "Ver historial" y "+ Avisar" solo con sesión normal. Lee `GET /api/p/paquetes` (sirve con ambas sesiones) y se refresca cada 20 s. |
| `/paquetes/entrega` | Pedir entrega | Franjas y método de pago del conjunto como chips (`radiogroup`) y **Confirmar \<franja\>**: una llamada `PATCH /packages/:id/schedule` por paquete, con error parcial claro. **"Prefiero recogerlo en portería"** manda `{ modalidad: 'RECOGER' }`. |
| `/paquetes/avisar` | Avisar | 2 campos (transportadora en chips + guía opcional); "Agregar detalles" abre tienda, tamaño, contra entrega, valor declarado, PIN del proveedor y nota (`POST /packages`). |
| `/paquetes/historial` | Historial | Entregados con fecha, monto y fotos (`GET /packages/mine`). |
| `/paquetes/bonos` | Mis bonos | Saldo de entregas prepagas por categoría (`GET /bonos/mine`). Solo con sesión normal y si `Conjunto.bonosHabilitados`; se entra desde "Más". |
| `/paquetes/buzon` | Buzón | Comentarios al operador (`/comments`). |
| `/acceso`, `/acceso/:token` | Acceso | Pide enlace por correo (mensaje genérico tal cual) y canjea automático con `POST /auth/enlace/canjear`; "Entrar con contraseña" sigue como secundario (`/login`). |

La **sesión del enlace** (JWT de 2 h con PINes) se guarda solo en memoria y `sessionStorage`
(con `try/catch`), nunca en `localStorage` ni mezclada con el token de login; con ella solo se
llaman `GET /p/paquetes`, `PATCH /packages/:id/schedule` y `GET /packages/:id/foto`. Por eso, con el enlace no hay
historial, bonos ni "+ Avisar" (se ofrece "entra con tu correo").

**CSS legado eliminado.** `index.css` y las variables `--lg-*` ya no existen: Login, Registro,
Recuperar, Restablecer, Términos, `PasswordField` y `PhotoGallery` usan tokens y componentes del
sistema de diseño (`base.css`, `pages/auth.css`, `components/photoGallery.css`).

### Accesibilidad, textos y cola por operador (T4.6)

- **Cola por operador.** Cada registro sin enviar guarda el `operadorId` (y el nombre) de quien lo encoló. La
  `Idempotency-Key` es única por operador en el backend, así que la cola SOLO reenvía los del operador en sesión:
  si otro operador entra en el mismo dispositivo, los pendientes ajenos se muestran en la hoja "Por enviar" como
  "De otra sesión (Nombre)" con la opción de descartarlos y nunca se envían con otra sesión. Al tocar "Salir" con
  registros sin enviar se pide confirmación ("Tienes N registros sin enviar. Si sales, se enviarán cuando vuelvas
  a entrar."). Un elemento sin `operadorId` (anterior a este cambio) cuenta como de otra sesión.
- **Auditoría automática.** `frontend/e2e/a11y.audit.mjs` recorre todas las pantallas del operador y del residente
  (390x844 y 1280x800, día y noche, con `prefers-reduced-motion`) con axe-core y comprobaciones propias (controles
  de 48 px, foco visible, título de página, textos de 16 px, hojas con foco atrapado, contraste de tokens). Las
  instrucciones de uso están en la cabecera del script; requiere un backend con base desechable.
- **Títulos de página** por pantalla ("Recibir · Puertayá") desde `App.jsx`; ya no llevan nombre de conjunto.

### Listados sin fotos ni PIN desde la consulta (revisión final T8.1, A1)

Las fotos legadas (`Package.fotoUrl`, base64) pesan cientos de KB por fila. Leerlas de la base en
cada listado y descartarlas en JS repite la caída de producción, así que ninguna lectura de listado
las pide: `selectSinFoto()` (`services/paquete.service.js`) arma un `select` con todas las columnas de
`Package` salvo `fotoUrl` y `pin` (el PIN solo se incluye para el dueño o el correo de llegada). Lo usan
`listAll`, `listMine`, `exportCsv` (columnas explícitas), `verificarPinLote`, `armarRespuesta`, el correo
de llegada y las lecturas dentro de transacciones; la foto solo sale por `GET /packages/:id/foto`.
`verificarPinLote` filtra por PIN y estado **en la base** y solo carga los entregables de los
apartamentos de los paquetes que coinciden (el lote sigue siendo por apartamento).
`idsPrimeraEntrega({ residenteIds })` (cortesía "Primera vez") lee el historial solo de los
apartamentos mostrados. `GET /packages?estado=` acepta varios estados separados por coma;
Pendientes pide solo `EN_RECEPCION,PROGRAMADO,SIN_ASIGNAR,PREALERTADO`. Regresión:
`listadosSinFotos.integration.test.js` (500 KB de foto sembrada: ninguna respuesta contiene `fotoUrl`
ni `data:image`, y se espía `prisma.package.*` para exigir `select` sin `fotoUrl`).

**CSV (M1, M2).** Las celdas de texto que empiezan por `=`, `+`, `-`, `@`, tab o retorno de carro se
prefijan con `'` (Excel no las ejecuta como fórmula); los números no se tocan. `desde`/`hasta` usan
`domain/fechas.js` (día de Bogotá; `hasta` incluye todo ese día; fecha inválida → 400 `DATOS_INVALIDOS`).
**Enlace de acceso (M4).** `POST /api/auth/enlace` solo envía a cuentas RESIDENT; para un operador
responde el mismo 200 genérico sin enviar ni crear token. **Índice (M5).** `Package(conjuntoId,
residenteId, estado)` (ver DEPLOY.md).

### Pruebas E2E (T6.1)

Suite Playwright del recorrido principal en `frontend/e2e/` (`npm run e2e`, desde `frontend/`). Corre cada
escenario en dos proyectos: `movil` (390x844) y `escritorio` (1280x800). 14 escenarios x 2 = 28 pruebas, ~40 s.

**Escenarios** (`e2e/recorrido.spec.mjs`, cada uno con residente y apartamento propios; día por defecto, "noche"
en recibir con residente y en la entrega por lote): registro con código de invitación (y código inválido);
recibir con residente (aviso con `waUrl`, sin PIN, toques <= 3 + dígitos del apto; el recorrido corto "apto + Guardar" de T8.1 son 4 toques con 3 dígitos); recibir sin dueño y asignar;
pre-alerta del residente que se vincula por la guía (un solo paquete); cortesía en el primer paquete y tarifa en el
segundo; residente por enlace `/p#token` (PIN visible, el hash desaparece, Pedir entrega -> franja -> "Programado")
y "Prefiero recogerlo en portería"; entrega por lote (PIN -> Transferencia -> Entregar todo -> historial del
residente); 5 PIN incorrectos -> 423 visible; PIN ambiguo -> chips de apartamento; acceso por enlace mágico y token
reutilizado; enlace de WhatsApp alterado; sin señal (`setOffline`) con un solo paquete al volver. Todas las pantallas
visitadas comprueban que no hay scroll horizontal (`sinScrollHorizontal`).

**Local** (por defecto). Requiere Postgres encendido (`pg_ctlcluster 16 main start`) y el rol `puertaya_test` (el
mismo de `backend/scripts/test-db.sh`; si no existe se crea con `TEST_DB_ADMIN_URL` o `su postgres`), `npm ci` en
`backend/` y `frontend/` y un Chromium de Playwright (si el del paquete no está, se usa `PW_CHROMIUM_PATH` o
`/opt/pw-browsers/chromium`; nunca se ejecuta `playwright install`). `e2e/entorno.mjs` (globalSetup/teardown):
crea una base `puertaya_e2e_*`, `prisma migrate deploy`, `npm run seed` (conjunto `e2e`, operador
`operador@e2e.test`), arranca el backend (`NODE_ENV=development`, correo y almacén de fotos `fake`) y `vite` en
puertos libres (`VITE_PROXY_TARGET` apunta el proxy `/api`), y al terminar mata ambos por PID y borra la base.
`E2E_WORKERS` cambia el paralelismo (2 por defecto).

**Datos que solo llegan por correo.** No se monta ninguna ruta de prueba en el backend (cero superficie nueva en
producción): el escenario del enlace mágico pide el enlace por la pantalla y luego inserta en la base de prueba un
`PasswordResetToken` `ACCESO` con un token conocido (el backend solo guarda el hash); el PIN ambiguo se fuerza con
un `UPDATE` de los PIN en la misma base.

**Contra Railway** (o cualquier despliegue): con `E2E_BASE_URL` y `E2E_API_URL` definidas NO se levanta nada local.
Variables necesarias: `E2E_OPERADOR_EMAIL`, `E2E_OPERADOR_PASSWORD` y `E2E_CODIGO_INVITACION` (código del conjunto
de pruebas; los escenarios crean residentes `res-*@e2e.test` en él, conviene un conjunto de pruebas). Los dos
escenarios que necesitan la base (enlace mágico y PIN ambiguo) se omiten con su razón.

```bash
cd frontend
E2E_BASE_URL=https://web-production-2b5d05.up.railway.app \
E2E_API_URL=https://api-production-df00.up.railway.app \
E2E_OPERADOR_EMAIL=... E2E_OPERADOR_PASSWORD=... E2E_CODIGO_INVITACION=... npm run e2e
```

**Accesibilidad.** `npm run e2e:a11y` levanta el mismo entorno y corre `e2e/a11y.audit.mjs` (sin duplicarla) contra
él; en modo remoto la corre contra esas URLs. Es lenta (55 pantallas x 5 variantes) y por eso no es parte de `npm run e2e`.

## Pendiente

- **WhatsApp automático**: decisión consciente de no implementarlo por
  ahora (requiere WhatsApp Business API de pago, ej. Twilio). El botón
  manual de WhatsApp del operador sigue funcionando.
- **Fotos en almacenamiento de objetos**: hoy viven comprimidas como
  base64 en una columna de Postgres — funciona, pero no escala igual de
  bien que un bucket dedicado si el volumen crece mucho.
- **Multi-conjunto**: implementado (KAN-8) — modelo `Conjunto` (tenant) y
  aislamiento estructural por `conjuntoId` vía extensión de Prisma. Validado en
  la rama `feature/kan-8-multiconjunto`; **falta el corte a producción** (Fase F:
  backfill de Ipanema + fase *contract* + despliegue, ver DEPLOY.md).
- **App Store / Google Play**: la PWA (arriba) cubre "instalable" hoy. Para
  estar en las tiendas de verdad, el paso siguiente es envolver este mismo
  código con Capacitor — no es una reescritura, pero suma cuenta de Apple
  Developer (USD 99/año) y de Google Play (USD 25 única vez).


## Contratos del residente (T2.8)

- `POST /api/packages` acepta `transportadora` (texto, máx. 60) y ya no exige `proveedor` si viene
  `transportadora` (proveedor = "Sin especificar"). Sin ninguno de los dos: 400.
- `PATCH /api/packages/:id/schedule` acepta `modalidad`: `DOMICILIO` (defecto; `franjaHoraria` +
  `metodoPagoServicio` como siempre) o `RECOGER` ("prefiero recogerlo en portería": limpia franja y
  pago). Se guarda en `Package.modalidadEntrega` (nullable) y **aplica PROGRAMAR** en ambos casos:
  una sola máquina de estados, la bitácora registra `datos.modalidad` y el operador lo ve en
  Programados con `modalidadEntrega` en `GET /api/packages` (la UI del operador lo muestra cuando
  T4.5 lo recoja). Otro valor: 400.
- `GET /api/packages/mine` y `GET /api/p/paquetes` devuelven `motivoCobro` (del último evento
  RECIBIR/ASIGNAR; `null` en pre-alertas) y `modalidadEntrega` (en `/p/paquetes`, y en `/mine` como
  campo del paquete). Los listados siguen sin `fotoUrl`.
- `GET /api/bonos/mine` (RESIDENT, ya existía): bonos propios; el saldo es `cantidadTotal -
  cantidadUsada` por `categoriaPeso`. El frontend solo ofrece "Mis bonos" si `GET /conjunto/config`
  trae `bonosHabilitados`.
