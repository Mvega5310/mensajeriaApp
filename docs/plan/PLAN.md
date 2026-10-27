# Plan del refactor mobile-first: autogestionable

Rama: `refactor/mobile-first`, que parte de `feature/kan-8-multiconjunto`. Se despliega en el Railway propio (proyecto `puertaya-refactor`) y **nunca toca `main` ni producción** sin una orden explícita del usuario.

**Fuentes que todo agente lee antes de empezar:**

| Fuente | Ruta |
|---|---|
| Convenciones e invariantes | `CLAUDE.md` |
| Estudio de mercado | `docs/research/mercado.md` |
| Diagnóstico del código actual | `docs/research/diagnostico.md` |
| Diseño (sistema de diseño en `Main`) | `docs/design/canvas/*.dc.html` |
| Diseño en vivo | https://claude.ai/artifact/FEAew3KLhCQDNQdLbmkrgz |
| Tablero de avance | `docs/plan/ESTADO.md` |

## Recorrido principal (no se discute)

**LLEGA → REGISTRO (operador, 4 toques) → AVISO (WhatsApp manual + correo automático) → ENTREGA CON PIN → ENTREGADO**

La pre-alerta del residente es **opcional**. El operador registra cualquier paquete, aunque nadie lo haya avisado.

## Cómo se ejecuta solo (protocolo)

1. **Orquestador** (sesión principal, Opus):
   - Lee `ESTADO.md` y toma las tareas `pendiente` cuyas dependencias estén en `hecho`.
   - Las tareas sin dependencias entre sí se lanzan **en paralelo**, cada una en su propio worktree (`isolation: "worktree"`). Al terminar se integran a la rama.
   - Cada tarea se lanza con el modelo de su tarjeta: **S** = Sonnet (el más capaz, por defecto) y **H** = Haiku (tareas mecánicas).
2. **Agente ejecutor.** Recibe la tarjeta completa y:
   - lee `CLAUDE.md`, la tarjeta y los artboards que la tarjeta cite;
   - implementa con TDD cuando hay lógica;
   - corre la verificación de la tarjeta;
   - hace **un commit por tarea**, con el mensaje `refactor(T<id>): <qué>` y el trailer de coautoría;
   - actualiza su fila en `ESTADO.md` y devuelve un resumen: qué hizo, qué verificó y qué queda pendiente.
3. **Puerta de fase.** Al cerrar cada fase:
   - un agente revisor (S), que no implementó la fase, revisa el diff de la fase contra los criterios de aceptación y las 9 invariantes;
   - el orquestador corrige o reabre las tareas que fallen;
   - la fase pasa solo con `backend npm test` en verde (integración contra Postgres incluida) y con `frontend npm run build` en verde.
4. **Cuándo se detiene y pregunta al usuario. Solo en estos casos:**
   - una decisión de la lista D, si aún no está tomada;
   - cualquier cosa que toque `main`, `develop` o producción;
   - un costo nuevo;
   - una tarea que falla 2 veces después de corregirla.

   Todo lo demás lo decide el orquestador y lo anota en `ESTADO.md`.
5. **Postgres local para pruebas.** Postgres 16 está instalado. Cada proceso de prueba usa **su propia base**, `puertaya_test_<pid>`. Compartirla hizo que unas pruebas borraran los datos de otras.

## Reglas fijas para todas las tareas

- **Las 9 invariantes del multi-conjunto** (`CLAUDE.md`) se respetan. Si una prueba falla, se arregla el código, nunca la prueba.
- **Modelos nuevos:**
  - todo modelo con datos de un conjunto va en `MODELOS_CON_TENANT`;
  - toda ruta pública nueva va en `RUTAS_SIN_SESION`, con su justificación.
- **Lógica de negocio:** en `backend/src/domain/`, como funciones puras sin Prisma y con pruebas unitarias.
- **Estados:** solo cambian con `transicionar()`, y el cambio escribe su evento en `PaqueteEvento` dentro de la misma transacción.
- **Errores:** `{ code, message, details? }`, donde `message` va listo para mostrar en español.
- **Servicios externos** (correo, archivos, WhatsApp): detrás de una interfaz con implementación `fake`. Sin credencial se usa `fake` y se escribe un aviso en el log.
- **Dinero:** en enteros (COP). Los montos y las configuraciones salen del `Conjunto`.
- **Frontend:**
  - solo tokens de `tokens.css`, sin hex sueltos;
  - un botón principal por pantalla;
  - controles de 48 px o más;
  - contraste de 4,5:1 o más;
  - 390 px sin scroll horizontal;
  - textos según `docs/design/brief-claude-design.md` § Textos.
- **Documentación:** README y DEPLOY se actualizan en el mismo commit que el cambio funcional.

## Decisiones que el usuario debe confirmar

El valor por defecto aplica si el usuario no dice nada.

| Id | Decisión | Por defecto |
|---|---|---|
| D1 | El enlace de WhatsApp abre "Mis paquetes" sin contraseña y muestra el PIN. El token está firmado y vence en 7 días | Sí |
| D2 | Estado `SIN_ASIGNAR` para paquetes sin destinatario claro. Custodia máxima de 30 días | Sí |
| D3 | Correo automático de llegada (Resend, gratis). El WhatsApp sigue siendo manual con wa.me | Sí |
| D4 | Fotos nuevas en un bucket de Railway; las de la base de datos se siguen leyendo | Sí |
| D5 | Paleta de marca v3 (ver `docs/research/colores.md`): crema claro, marino, azul de marca para la acción, naranja para la cortesía. Día por defecto, noche opcional | Sí |

---

## Fases y tarjetas

Formato de cada tarjeta: **Id · Modelo · Depende de**, seguido de qué hacer, los archivos y cómo se acepta.

### F0 · Base para trabajar seguro

**T0.1 · S · —** Postgres local de pruebas.
- **Qué hacer:**
  - Crear `backend/scripts/test-db.sh`: crea y destruye `puertaya_test_<pid>`, corre `prisma migrate deploy` y exporta `DATABASE_URL`.
  - Agregar el script `npm run test:all`, que corre todas las pruebas con su propia base.
  - Alinear `CLAUDE.md` y `README` (Postgres local, no SQLite).
  - Corregir la mención a `BONOS_HABILITADOS`, que ya no existe.
- **Se acepta si:** `npm run test:all` termina con **0 pruebas omitidas** y 0 fallidas.

**T0.2 · S · T0.1** Formato único de error.
- **Qué hacer:**
  - Crear `AppError(code, message, status, details)`, `asyncHandler` y un manejador global en `app.js`.
  - Migrar los ~39 `{ error }`.
  - En `frontend/src/services/api.js`, leer `message` y `code`.
  - Los códigos viven en `backend/src/domain/errores.js`.
- **Se acepta si:**
  - una prueba demuestra que un `throw` dentro de un handler async responde `{code,message}` con su status y no tumba el proceso;
  - `grep "{ error:"` devuelve 0 resultados en `src`.

**T0.3 · H · T0.2** Validar las variables de entorno al arrancar.
- **Qué hacer:** crear `config/env.js`. Si falta `JWT_SECRET` o `DATABASE_URL`, el proceso termina con un mensaje claro. Actualizar `.env.example`.
- **Se acepta si:** una prueba lo cubre.

### F1 · Reglas del negocio puras

**T1.1 · S · T0.2** Máquina de estados.
- **Qué hacer:** crear `domain/paquete.machine.js`.
  - Estados: `SIN_ASIGNAR`, `PREALERTADO`, `EN_RECEPCION`, `PROGRAMADO`, `ENTREGADO`.
  - Eventos y transiciones permitidas:

    | Evento | Desde | Hacia |
    |---|---|---|
    | `RECIBIR_SIN_DUENO` | ∅ | `SIN_ASIGNAR` |
    | `PREALERTAR` | ∅ | `PREALERTADO` |
    | `RECIBIR` | ∅ o `PREALERTADO` | `EN_RECEPCION` |
    | `ASIGNAR` | `SIN_ASIGNAR` | `EN_RECEPCION` |
    | `PROGRAMAR` | `EN_RECEPCION` o `PROGRAMADO` | `PROGRAMADO` |
    | `DESPROGRAMAR` | `PROGRAMADO` | `EN_RECEPCION` |
    | `ENTREGAR` | `EN_RECEPCION` o `PROGRAMADO` | `ENTREGADO` |

  - Cualquier otra combinación lanza `AppError('TRANSICION_INVALIDA')`.
- **Se acepta si:** hay una prueba por cada par (estado, evento), las válidas y las inválidas.

**T1.2 · S · T0.2** Cobro.
- **Qué hacer:**
  - Crear `domain/cobro.js` con `esPrimeraEntrega(entregasPreviasDelApto)` y `calcularCobro({ tarifas, categoria, esPrimeraEntrega, bonosHabilitados, creditosBono })`, que devuelve `{ monto, motivo: 'TARIFA'|'CORTESIA'|'BONO', consumeBono }`.
  - Reemplazar las **3** implementaciones de la cortesía (`checkin`, `listAll`, `exportCsv`).
- **Se acepta si:**
  - las pruebas unitarias cubren los cuatro casos: cortesía, bono, tarifa y categoría inválida;
  - el comportamiento del conjunto Ipanema es idéntico, comprobado con las pruebas existentes de `faseE`.

**T1.3 · S · T1.1, T1.2** Aplicar las reglas puras en los controladores.
- **Qué hacer:**
  - Crear el modelo `PaqueteEvento` (`paqueteId`, `tipo`, `deEstado`, `aEstado`, `actorId`, `datos` en JSON, `creadoEn`): solo inserción y con tenant.
  - Crear `services/paquete.service.js#aplicarEvento(tx, paquete, evento, datos)`, que valida la transición, actualiza el paquete y escribe el evento.
  - `checkin`, `schedule` y `confirmDelivery` lo usan.
  - El descuento del bono se hace en la misma `$transaction`, con un decremento condicional (`creditos > 0`).
- **Se acepta si** hay pruebas de integración que muestren que:
  - no se puede volver a recibir un paquete ENTREGADO;
  - no se puede entregar sin ingreso a portería;
  - dos ingresos simultáneos no gastan el mismo crédito;
  - cada cambio de estado deja un evento.

**T1.4 · S · T1.3** Límite de intentos del PIN.
- **Qué hacer:** agregar a `Package` los campos `intentosPin` y `pinBloqueadoHasta`. Tras 5 fallos, bloquear 15 minutos con el error `PIN_BLOQUEADO`, que dice cuántos minutos faltan. Agregar también un límite en el login: 10 intentos por IP cada 15 minutos.
- **Se acepta si:** hay pruebas de integración.

### F2 · Recibir sin pre-alerta (el bloqueo principal)

**T2.1 · S · T1.3** Esquema (fase *expand*: solo agrega, no rompe).
- **Qué hacer:**
  - En `Package`: `residenteId` pasa a ser opcional; agregar `etiquetaNombre?`, `guia?`, `transportadora?`, `metodoPago?` (`EFECTIVO`|`TRANSFERENCIA`), `recibidoEn?` y `entregadoEn?`.
  - En `Conjunto`: agregar `prefijoPais` (por defecto `"57"`), `franjasEntrega` (JSON), `maxFotos` (por defecto 3) y `custodiaMaxDias` (por defecto 30).
  - Escribir la migración a mano y su rollback.
- **Se acepta si:** las pruebas de aislamiento siguen en verde y hay una migración con su rollback probada contra Postgres.

**T2.2 · S · T2.1** Buscar residentes.
- **Qué hacer:** crear `GET /residentes/buscar?q=` (solo OPERATOR). Busca por clave de apartamento (`"304"`, `"T2 304"`, `"2-304"`) o por nombre, y devuelve como máximo 5 resultados: `{ id, apto, torre, nombre, pendientes }`.
- **Se acepta si:** las pruebas cubren los formatos de apartamento y el aislamiento por conjunto.

**T2.3 · S · T2.2** Recepción.
- **Qué hacer:**
  - Crear `POST /packages/recepcion` (OPERATOR) con `{ residenteId | null, etiquetaNombre?, categoriaPeso, guia?, transportadora?, fotos? }`.
    - Si hay residente, busca su pre-alerta abierta: primero por `guia`, si no la más antigua. La vincula y la pasa a EN_RECEPCION; si no hay, crea el paquete directamente en EN_RECEPCION.
    - Si no hay residente, crea el paquete en SIN_ASIGNAR.
    - Responde `{ paquete, aviso: { waUrl, texto } }`.
  - Crear `PATCH /packages/:id/asignar`.
- **Se acepta si:**
  - hay pruebas de integración de los 3 caminos;
  - el PIN se genera al recibir;
  - el cobro sale de `calcularCobro`.

**T2.4 · S · T2.3** Avisos.
- **Qué hacer:**
  - Crear la interfaz `Notificador` (`avisarLlegada`, `agradecerEntrega`, `enviarEnlaceAcceso`) con dos implementaciones: `resend` y `fake`. El `fake` guarda los mensajes en memoria para las pruebas.
  - Crear `domain/whatsapp.js#construirEnlace({ prefijoPais, telefono, texto })`. Sale del JSX: el backend arma el enlace.
  - Escapar el HTML de los correos y quitar "Ipanema" de las plantillas.
  - Enviar el correo de llegada al recibir el paquete.
- **Se acepta si:**
  - las pruebas verifican que el correo se envía, que el HTML está escapado (`<script>` en `notas` sale escapado) y el formato del enlace wa.me;
  - `frontendSinFijos` se extiende al backend para detectar "Ipanema".

**T2.5 · S · T1.4, T2.3** Entrega por lote.
- **Qué hacer:**
  - Crear `POST /entregas/verificar-pin` con `{ pin }`. Devuelve los paquetes pendientes del apartamento dueño de ese PIN, aplicando el límite de intentos.
  - Crear `POST /entregas/confirmar` con `{ paqueteIds, metodoPago }`, que entrega todos los paquetes en una sola transacción.
- **Se acepta si:** hay pruebas de integración; un PIN de otro conjunto nunca resuelve.

**T2.6 · H · T2.1** Configuración que falta en el conjunto.
- **Qué hacer:** `GET /conjunto/config` expone `franjasEntrega`, `metodosPago`, `prefijoPais` y `maxFotos`. Borrar las constantes de `utils/schedule.js` y `utils/tiers.js` que tengan montos o reglas.
- **Se acepta si:** `frontendSinFijos` pasa.

### F3 · Acceso del residente sin fricción

**T3.1 · S · T2.3** Enlace firmado.
- **Qué hacer:**
  - Crear `domain/enlace.js`: `firmar({ residenteId, conjuntoId, exp })` y `verificar(token)`, con HMAC usando `ENLACE_SECRET`.
  - Crear `GET /p/:token`, que es una ruta pública y va en `RUTAS_SIN_SESION` con su justificación. Devuelve "Mis paquetes" del residente y una sesión limitada para "Pedir entrega".
  - El enlace va en el texto del aviso de WhatsApp. Depende de D1.
- **Se acepta si:** hay pruebas de token vencido, token alterado, token de otro conjunto y que la sesión limitada no sirve para ninguna otra ruta.

**T3.2 · S · T3.1** Enlace mágico por correo.
- **Qué hacer:**
  - Crear `POST /auth/enlace` con `{ email }`. Responde siempre 200 y no revela si la cuenta existe.
  - Crear `GET /auth/enlace/:token`, de un solo uso y que vence en 15 minutos (reutiliza el modelo de `PasswordResetToken`).
  - El login con contraseña se conserva.
- **Se acepta si:** hay pruebas de integración de los flujos sin sesión contra Postgres.

### F4 · Frontend según el diseño

**T4.1 · S · T0.2** Sistema de diseño en código.
- **Qué hacer:**
  - Crear `frontend/src/design/tokens.css`, copiando los tokens v3 de `Main.dc.html` (ver `docs/research/colores.md`), temas `.pt` y `.pt.noche`.
  - Crear los componentes en `src/design/`: `Button` (con variantes `primario`, `secundario` y `whatsapp`), `Keypad`, `PinInput`, `PackageLabel`, `Stamp`, `Badge`, `BottomNav`, `Toast`, `Sheet`, `TopBar` y `Field`.
  - Cargar las fuentes Archivo, Atkinson Hyperlegible Next e IBM Plex Mono.
  - `useTheme` pasa a manejar día y noche. Se borra `ThemeToggle`.
- **Se acepta si:**
  - existe la página `/_ds` (solo en desarrollo) que muestra todos los componentes;
  - no hay hex fuera de `tokens.css`;
  - todos los controles miden 48 px o más;
  - todas las animaciones tienen su versión `prefers-reduced-motion`.

**T4.2 · S · T4.1, T2.3, T2.5** Operador.
- **Qué hacer:**
  - Crear las rutas `/op/recibir` (Op-Recibir), `/op/recibir/:residenteId` (Op-Peso), `/op/guardado/:id` (Op-Guardado), `/op/entregar` (Op-Entregar), `/op/entregar/lote` (Op-Cobrar) y `/op/pendientes` (Op-Pendientes, con la sección "Sin asignar").
  - Borrar `OperatorView.jsx`. Cada pantalla queda en su archivo de 200 líneas o menos, con su hook de datos aparte.
- **Se acepta si:**
  - recibir un paquete toma **4 toques** desde Recibir hasta Guardado (prueba E2E en F6);
  - las pantallas se ven fieles al artboard, en día y en noche.

**T4.3 · S · T4.1, T3.1, T3.2** Residente.
- **Qué hacer:**
  - Crear las rutas `/p/:token` y `/paquetes` (Res-MisPaquetes), `/paquetes/entrega` (Res-PedirEntrega), `/paquetes/avisar` (Res-Avisar) y `/acceso` (Res-Acceso).
  - Borrar `ResidentView.jsx`.
  - El formulario de aviso tiene 2 campos; el resto queda dentro de "Agregar detalles".
- **Se acepta si:**
  - desde el enlace de WhatsApp hasta pedir la entrega hay 2 toques;
  - no se pide contraseña.

**T4.4 · H · T4.2** Escritorio.
- **Qué hacer:** a 1024 px o más, `Pendientes` se muestra en dos columnas (lista y detalle) y la barra inferior pasa a ser lateral (artboard Escritorio). Es el mismo código.
- **Se acepta si:** captura a 1280 px y a 390 px sin scroll horizontal.

**T4.5 · S · T4.2** Sin señal.
- **Qué hacer:**
  - Las recepciones se encolan en IndexedDB si no hay red y se reenvían al volver la conexión.
  - Mostrar el toast "Sin señal. Guardamos el registro y lo enviamos al volver."
  - Para evitar duplicados, cada recepción lleva una `Idempotency-Key` y el backend la respeta.
- **Se acepta si:** una prueba E2E con red cortada demuestra que el paquete aparece una sola vez.

**T4.6 · H · T4.2, T4.3** Auditoría de accesibilidad y textos.
- **Qué hacer:** revisar contraste (axe-core en Playwright), tamaños, foco, `aria` y microcopy (botones con verbo y tres palabras como máximo, sin emoji, errores que dicen qué pasó y qué hacer).
- **Se acepta si:** axe reporta 0 problemas serios o críticos en las pantallas del recorrido.

### F5 · Fotos fuera de la base de datos

**T5.1 · S · T2.3** Almacén de fotos.
- **Qué hacer:**
  - Crear la interfaz `AlmacenFotos` (`guardar`, `urlFirmada`, `borrar`) con tres implementaciones: `s3` (bucket de Railway, compatible con S3), `bd-legado` (lectura de `fotoUrl` en base64) y `fake`.
  - Crear el modelo `PaqueteFoto` (`paqueteId`, `clave`, `orden`), con tenant.
  - Las fotos nuevas van al bucket.
  - `GET /packages/:id/foto` devuelve URLs firmadas y sigue leyendo las fotos antiguas.
  - Los listados siguen sin incluir fotos.
- **Se acepta si:** hay pruebas con `fake`, y la integración con `s3` solo se prueba cuando hay credenciales.

### F6 · Pruebas de punta a punta

**T6.1 · S · T4.2–T4.5** Playwright.
- **Qué hacer:** crear `frontend/e2e/` con semilla DEMO y probar a 390 px y a 1280 px:
  - recibir con residente;
  - recibir sin dueño y luego asignar;
  - aviso (que se arme bien el enlace wa.me);
  - entrega por lote con PIN;
  - PIN bloqueado;
  - el residente entra por el enlace y pide la entrega;
  - la pre-alerta se vincula sola.
- **Se acepta si:** todo queda en verde y existe el script `npm run e2e`.

### F7 · Despliegue en el Railway propio

**T7.1 · Orquestador · F0–F6** Proyecto `puertaya-refactor`.
- **Qué hacer:** con Railway MCP, en el workspace "Erick Nieto's Projects":
  - crear los servicios Postgres, Bucket, `api` (raíz `backend`, rama `refactor/mobile-first`, `prisma migrate deploy` y semilla DEMO en el pre-deploy) y `web` (raíz `frontend`, build estático con `VITE_API_URL`);
  - configurar las variables `JWT_SECRET`, `ENLACE_SECRET`, `RESEND_API_KEY` (opcional, sin ella se usa `fake`) y las del bucket;
  - **seguir este orden:** primero la base de datos, después `api` y después `web`.
- **Se acepta si:**
  - el recorrido E2E pasa contra la URL de Railway;
  - DEPLOY.md tiene una sección "Entorno refactor";
  - no hay ningún secreto en el repo.

### F8 · Cierre

**T8.1 · S · T7.1** Revisión final.
- **Qué hacer:**
  - Code review completo del diff entre `kan-8` y `refactor`.
  - Actualizar README y DEPLOY.
  - Escribir la lista de pasos para llevar esto a `develop` y luego a `main`, incluido el corte de Ipanema (que ya está en `docs/runbook-corte-ipanema.md`).
- **Se acepta si:** el informe queda en `docs/plan/CIERRE.md`. **El merge lo decide el usuario.**

## Paralelismo previsto

```
F0: T0.1 → T0.2 → T0.3
F1: T1.1 ∥ T1.2 → T1.3 → T1.4                 (T4.1 puede arrancar en paralelo desde T0.2)
F2: T2.1 → T2.2 → T2.3 → (T2.4 ∥ T2.5 ∥ T5.1); T2.6 ∥ T2.2
F3: T3.1 → T3.2
F4: T4.2 ∥ T4.3 → T4.4 ∥ T4.5 → T4.6
F6 → F7 → F8
```
