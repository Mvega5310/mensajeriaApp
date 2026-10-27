# Cierre del refactor mobile-first (T8.1)

Revisor: agente final, sin haber implementado nada. Rama `refactor/mobile-first`, HEAD `3522af8`, contra `8c88ed0` (punta de `feature/kan-8-multiconjunto`). Diff revisado: 231 archivos, +15.102 / -2.519 líneas (85 commits). Fecha: 2026-10-27.

**Veredicto: LISTO CON CORRECCIONES** para integrar a `develop`. No es seguro llevarlo a `main` sin cerrar el hallazgo A1 (rendimiento con datos legados) y sin la lista de variables de la sección "Camino a producción".

## Resumen

Para el usuario, sin tecnicismos:

1. El recorrido completo funciona: el operador registra un paquete (con o sin pre-alerta, con o sin dueño conocido), el residente recibe el aviso, abre su enlace sin contraseña, ve su PIN, pide la entrega, y el operador entrega con el PIN y cobra por lote.
2. Se probó de verdad: 444 pruebas del servidor en verde (0 omitidas, con Postgres real), compilación del frontend en verde y 28 de 28 recorridos de punta a punta (celular y escritorio).
3. Seguridad: el operador nunca ve el PIN; el enlace del WhatsApp lleva una clave firmada que no queda en los registros del servidor; no se encontró ninguna falla grave de seguridad ni de aislamiento entre conjuntos.
4. El riesgo más serio no es de seguridad sino de **rendimiento con datos viejos**: varias pantallas leen de la base todo el historial de paquetes, incluidas las fotos antiguas guardadas dentro de la base. Con los datos reales de Ipanema eso puede repetir la caída que ya ocurrió una vez. Es una corrección pequeña y se debe hacer antes de producción.
5. La meta de "4 toques" se cumple solo si el apartamento es de 1 o 2 dígitos. Con 3 dígitos son 5 toques. Hay dos ajustes baratos para llegar a 4.
6. Para producción hay variables nuevas **obligatorias** (si faltan, el servidor no arranca) y un hosting de frontend distinto al que se probó (Vercel vs. Railway).
7. Recomendación de orden: primero el corte de multi-conjunto de KAN-8 (ya ensayado en papel), después este refactor, en dos despliegues separados, no juntos.
8. Pendientes legales y de producto: borrado de cuentas (Ley 1581), correo real (falta la clave de Resend), pantalla de bonos del operador y pruebas en iPhone.
9. Todo se puede deshacer: las migraciones nuevas solo agregan tablas y columnas, y cada una tiene su script de reversa.
10. Lo que sigue es decisión suya: integrar a `develop` (sí, con las correcciones) y fijar la fecha del corte.

## Hallazgos de la revisión final

Estado de verificación: **V** = verificado (ejecutado o leído en el código con el escenario reproducible), **S** = sospecha (razonado, sin reproducir).

### Crítico

Ninguno.

### Alto

**A1 (V, por lectura; magnitud sin medir). Lecturas completas de `Package` con las fotos antiguas en base64.**
- Dónde: `backend/src/controllers/packages.controller.js:189` (`listAll`, `include` sin `select`), `:408` (`exportCsv`), `:102` (`listMine`, quita `fotoUrl` en JS después de leerla), `backend/src/services/entrega.service.js:44` (`verificarPinLote`, se ejecuta en CADA intento de PIN), `recepcion.service.js` (`armarRespuesta`/`avisarLlegadaDe`, `include`).
- Escenario: el operador abre Pendientes. `frontend/src/hooks/operador/usePaquetes.js:21` pide `GET /packages` sin `?estado=` ni paginación y filtra en el navegador. El servidor lee TODA la historia, con `fotoUrl` (cientos de KB por fila en datos legados; el runbook habla de "cientos de MB"), las descarta en JS, y además `idsPrimeraEntrega()` (`cobro.service.js:127`) recorre todos los paquetes cobrados y todos los eventos. El patrón "las fotos no viajan por la red" se respeta, pero el costo de leerlas de la base sigue ahí. Es la misma familia de la caída de producción que cita `CLAUDE.md`.
- Corrección: en esas consultas usar `select` explícito (o `omit` de Prisma, que en 5.20 es vista previa) sin `fotoUrl` ni `pin`; que Pendientes pida solo estados abiertos (`?estado=` acepta uno; añadir lista o un `GET /packages/pendientes`); limitar `idsPrimeraEntrega` a los apartamentos de la página; medir con la copia de producción en el ensayo del runbook. Agregar una prueba que falle si una consulta de listado trae `fotoUrl`.

**A2 (V). El arranque en producción fallará si faltan variables nuevas.** `backend/src/config/env.js:31-54`: con `NODE_ENV=production` es obligatoria `ENLACE_SECRET` (≥32, distinta de `JWT_SECRET`); `JWT_SECRET` debe tener ≥32; en Railway sin `NODE_ENV` el proceso termina. Producción hoy no tiene `ENLACE_SECRET` (DEPLOY.md solo la documenta en la guía). Efecto: como `npm start` ejecuta `prisma migrate deploy && node src/index.js`, las migraciones se aplican y el servidor nuevo no levanta; Railway conserva el despliegue anterior (compatible, las migraciones son aditivas), pero el despliegue "falla". Corrección: cargar las variables ANTES del merge (ver paso 7 del camino a producción).

### Medio

**M1 (V). Inyección de fórmulas en el CSV.** `packages.controller.js:383` `csvEscape` solo cita comas y comillas. Un residente que se registra con nombre `=HYPERLINK(...)` o escribe notas con `=`/`+`/`-`/`@` al inicio ejecuta la fórmula cuando el operador/contador abre el CSV en Excel. Corrección: prefijar con `'` toda celda de texto que empiece por `= + - @` o tabulador.

**M2 (V). Filtros de fecha del CSV.** `packages.controller.js:402-403`: `new Date(desde)` inválido produce `Invalid Date` y Prisma responde 500; `hasta` usa `T23:59:59` sin zona (hora del servidor, no Bogotá) y trunca el último segundo. Corrección: reusar `parsearFiltroFecha` de la bitácora (ya maneja Bogotá y errores 400).

**M3 (S, de diseño). Verificación de PIN sin apartamento es un oráculo por conjunto.** `entrega.service.js:44-52` y `domain/entregaLote.js`: PIN de 4 dígitos buscado entre TODOS los paquetes entregables; el límite real es 20 fallos/10 min por operador y vive en memoria (`limitador.js`: se reinicia con cada despliegue y no se comparte entre réplicas). Con 100 paquetes activos, 1 de cada 100 intentos acierta a algún apartamento. Requiere cuenta de operador comprometida, por eso es medio. Corrección: exigir el apartamento (o el aviso del residente) antes de comparar el PIN, y mover los limitadores a la base cuando haya más de una réplica. Ver también deuda D2.

**M4 (S). Enlace de acceso por correo para cualquier rol.** `auth.controller.js` `solicitarEnlace` envía el enlace también a cuentas OPERATOR; canjearlo da una sesión completa de 8 h. Es equivalente al "olvidé mi contraseña", pero con menos fricción. Además el límite (5 por correo+IP) permite spam distribuido a un correo ajeno. Corrección: restringir a RESIDENT o sesión de 1 h para operador; limitar también por correo solo.

**M5 (V). Falta índice por `residenteId`.** `schema.prisma` (Package solo indexa `[conjuntoId,estado]` y `[conjuntoId,guia]`). `listMine`, `/api/p/paquetes` (sondeo cada 20 s por residente con la pestaña visible, `useMisPaquetes.js:5`) y `schedule` filtran por `residenteId`. Corrección: `@@index([conjuntoId, residenteId])` en una migración aditiva.

**M6 (V). T7.1 sin cerrar.** `DEPLOY.md` no tiene la sección "Entorno refactor" que pide el criterio de aceptación (solo hay secciones por migración), y el E2E contra la URL de Railway figura como "en curso" en `ESTADO.md`.

**M7 (S). Auditoría de accesibilidad no reproducida.** `npm run e2e:a11y`: en mi primera ejecución falló con `browserContext.newPage: Target page, context or browser has been closed` (`a11y.audit.mjs:509`), la segunda superó 380 s y la corté. Había otra sesión usando Playwright al mismo tiempo en la máquina, así que puede ser interferencia, pero la cifra "0 críticas en 55 pantallas" de T4.6 queda sin confirmar por mí.

### Bajo

- **B1 (V).** `frontend/src/utils/whatsapp.js:5` arma `wa.me/<prefijo><teléfono>` sin limpiar el teléfono (el backend `domain/whatsapp.js` sí lo limpia y quita ceros); el backend no valida el teléfono al registrar (solo `required`). Se usa en `BuzonVista.jsx:20`. Un teléfono con `?`/`#` altera el enlace de WhatsApp (sin ejecución de código). Corrección: reusar la misma limpieza.
- **B2 (V).** Código sin uso: `frontend/src/puertaya-brand/tokens.css` (no se importa; solo `design/tokens.css`), y los endpoints `PATCH /packages/:id/checkin` y `POST /packages/:id/confirm-delivery` que el frontend nuevo ya no llama (siguen cubiertos por pruebas). Decidir: borrar o declarar "API legada".
- **B3 (V, preexistente).** `forgotPassword` hace el trabajo en la petición (se distingue "existe/no existe" por tiempo) mientras `solicitarEnlace` lo hace en segundo plano; y sin `FRONTEND_URL` el correo sale con `undefined/restablecer`. El arranque ya avisa; en producción debería ser obligatoria.
- **B4 (S).** Fotos: el tipo se valida por el encabezado `data:image/...`, sin comprobar los bytes (`dataUri.js`). Riesgo bajo (el bucket sirve con `Content-Type` fijo y no es nuestro origen).
- **B5 (V).** Sin cabeceras de seguridad en la API ni en `vercel.json` (CSP, `Referrer-Policy`). El token del enlace va en el fragmento `#`, que el navegador no envía; aun así conviene `Referrer-Policy: no-referrer` en Vercel. Las fuentes cargan desde Google (privacidad y falla sin red).
- **B6 (V).** La PWA precachea 1,9 MB (logos PNG de 280-380 KB, `vite build`). Pasarlos a WebP/SVG.
- **B7 (V).** Las migraciones del refactor llevan sellos hasta `20261102…`; una migración creada con fecha real anterior chocará con `migrate dev` (no con `migrate deploy`). Renombrar antes de integrar o crear las nuevas con fecha posterior.

### Revisado sin hallazgos

- Sesión de enlace: lista cerrada de 3 rutas (`auth.middleware.js:9-14`), `scope` verificado, `conjuntoId` del token contrastado con la base (`tenant.middleware.js`), 2 h, en `sessionStorage` y memoria, nunca `localStorage`, ni mezclada con el token de login (`sesionEnlace.js`). Token de 7 días firmado con HMAC en tiempo constante, versión, vencimiento (`domain/enlace.js`). `POST /api/p/abrir` con `no-store` y `no-referrer`.
- Enlace mágico (F3.2): canje atómico con `updateMany` condicional, solo hash en la base, 15 min, un solo uso, propósito separado del reset, respuesta idéntica exista o no la cuenta, canje por POST (los escáneres de correo no lo consumen).
- PIN: no viaja al operador (listados, recepción, asignar, lote, CSV, replay); `getById` no lo incluye. El PIN del proveedor (`pinProveedor`) es otro dato y sí lo ve.
- Frontend: cero `dangerouslySetInnerHTML`/`innerHTML`/`eval`; los únicos `href` dinámicos son `wa.me` (https fijo) y rutas internas; los correos escapan HTML (prueba existente). Cola sin señal: `Idempotency-Key`, separada por operador, la API nunca se cachea en el service worker.
- Multi-conjunto: tablas nuevas con `conjuntoId` y en `MODELOS_CON_TENANT`; rutas públicas nuevas declaradas con justificación; las 9 invariantes siguen cubiertas por sus pruebas.

### Ejecuciones de esta revisión

| Comando | Resultado |
|---|---|
| `cd backend && npm run test:all` | 444 de 444 pasan, 0 omitidas, 33,6 s |
| `cd frontend && npm run build` | Verde (JS 309 kB / 99 kB gzip; precache 1,9 MB) |
| `cd frontend && npm run e2e` | 28 de 28 pasan (14 escenarios x móvil/escritorio), 36 s; base y procesos propios limpiados |
| `cd frontend && npm run e2e:a11y` | No concluyente (ver M7) |

## Cumplimiento del plan

| Tarjeta | Estado | Evidencia / brecha |
|---|---|---|
| T0.1 test:all | Cumple | 444/444, 0 omitidas, base propia por ejecución |
| T0.2 error único | Cumple | `domain/errores.js`; sin `{ error:` en `src` |
| T0.3 entorno | Cumple | `config/env.js` con pruebas |
| T1.1 máquina | Cumple | pares estado x evento probados |
| T1.2 cobro | Cumple | `domain/cobro.js`, una sola implementación |
| T1.3 eventos | Cumple | `PaqueteEvento` con trigger de solo inserción; bono atómico |
| T1.4 límite PIN | Cumple | 5 fallos, 423, 15 min; login 10/IP |
| T2.1 esquema | Cumple | migración + reversa manual; ver "no aditivo" en el camino a producción |
| T2.2 buscar | Cumple | formatos de apto y nombre; máx. 5 |
| T2.3 recepción | Cumple | 3 caminos, PIN al recibir, idempotencia |
| T2.4 avisos | Parcial | plantillas, escape y wa.me listos; correo real nunca probado (sin `RESEND_API_KEY`) |
| T2.5 lote | Cumple | `PIN_AMBIGUO`, token de 10 min; ver M3 |
| T2.6 config | Cumple | `frontendSinFijos` ampliado |
| T2.7 resumen/bitácora | Parcial | backend completo; la bitácora filtrable del operador no tiene pantalla con filtros en la app (queda CSV) según nota de T4.2; `GET /packages` sin paginar en Pendientes (A1) |
| T2.8 contratos residente | Cumple | fotos por enlace, RECOGER, transportadora, motivo, bonos del residente |
| T3.1 enlace firmado | Cumple | token en fragmento + POST; sesión limitada de 3 rutas |
| T3.2 enlace mágico | Cumple | atómico, un uso, 15 min (plan decía `GET /auth/enlace/:token`; se cambió a POST con razón válida) |
| T4.1 diseño | Cumple | 13 componentes, tokens v3, `/_ds` solo en dev; un `tokens.css` huérfano (B2) |
| T4.2 operador | Parcial | 6 pantallas y OperatorView borrado; meta de 4 toques solo con apto de 1-2 dígitos (ver abajo) |
| T4.3 residente | Parcial | rutas y sin contraseña: sí. Plan: "2 toques" del WhatsApp a pedir entrega; real: 3 |
| T4.4 escritorio | Cumple | dos columnas >=1024 px, sin scroll horizontal (cubierto por E2E) |
| T4.5 sin señal | Cumple | E2E: un solo paquete tras corte y reintento |
| T4.6 accesibilidad | Parcial | axe 0 serias/críticas según ESTADO; no pude reproducirlo (M7) |
| T5.1 fotos | Cumple | S3/legado/fake; probado contra bucket real en Railway; sin bucket en producción cae a legado con aviso |
| T6.1 E2E | Cumple | 28/28 local; la ejecución contra Railway sigue pendiente |
| T7.1 Railway | Parcial | proyecto desplegado y humo OK; falta sección "Entorno refactor" en DEPLOY.md y E2E remoto (M6) |
| T8.1 cierre | Este documento | README/DEPLOY al día salvo lo de M6 |

**Meta de "4 toques" (Recibir hasta Guardado).** Hoy: dígitos del apto + elegir al residente + (tamaño) + Guardar. `useGuardarPaquete.js:11` ya deja "Estándar" preseleccionado, así que el mínimo real para un paquete estándar es **2 + dígitos** (1 dígito: 3; 3 dígitos: 5), no 3 + dígitos como dice la nota de T4.2 (la prueba E2E toca el tamaño aunque no haga falta). Cómo acercarla, de menor a mayor esfuerzo:
1. Al haber una sola sugerencia y el apto escrito con >=3 dígitos, avanzar solo a la pantalla de tamaño (nombre del residente visible y botón Volver): ahorra 1 toque. Con 3 dígitos queda en 4.
2. Mostrar "Guardar" ya en la pantalla de búsqueda cuando hay una sola sugerencia (guardar estándar directo, con "Cambiar tamaño" secundario): 3 dígitos + Guardar = 4 sin cambiar de pantalla.
3. Atajos: apartamentos frecuentes del día en chips (los que tienen pre-alerta abierta) para 1 toque + Guardar.
Recomendación: 1 y 2 valen la pena (cambios de frontend de medio día); 3 queda para después de medir con el operador real.

## Deudas priorizadas

| P | Deuda | Detalle y acción |
|---|---|---|
| P0 | A1 rendimiento con datos legados | Ver hallazgo; bloquea producción |
| P0 | Variables y servicios de producción | `ENLACE_SECRET`, `NODE_ENV`, bucket, `FRONTEND_URL`, Resend (A2) |
| P1 | Ley 1581: supresión de cuenta | Borrar un usuario choca con `PaqueteEvento.actorId` (RESTRICT y trigger de solo inserción). Definir: anonimizar nombre/correo/teléfono del usuario y de `etiquetaNombre`/`datos` de eventos, o purga controlada con la bandera `puertaya.purga_eventos`. También `PaqueteFoto` en el bucket. Política de retención (`custodiaMaxDias` 30 días ya existe, pero ningún proceso aplica ese tope) |
| P1 | PIN por residente vs colisiones | PIN de 4 dígitos por paquete: con muchos paquetes activos habrá `PIN_AMBIGUO` frecuente y el oráculo de M3. Propuesta: un PIN por apartamento (o por residente) estable, o 6 dígitos |
| P1 | Limitadores en memoria | Login, enlace y PIN se reinician con cada despliegue y no se comparten entre réplicas. Aceptable con una réplica; pasar a tabla/Redis antes de escalar |
| P1 | Correo real sin probar | Sin `RESEND_API_KEY` todo es simulado; el remitente sigue siendo de Ipanema (`EMAIL_FROM`). Probar llegada, enlace de acceso y agradecimiento con un buzón real |
| P1 | iOS Safari no probado | Teclado numérico, barra de direcciones, `safe-area`, `<input capture>` de cámara, PWA instalada; probar en iPhone real (limitación documentada en `CLAUDE.md`) |
| P2 | Bonos | Existen apagados por conjunto; el residente tiene "Mis bonos", el operador solo una vista básica en "Pendientes"; no hay pantalla para venderlos/recargar con el diseño nuevo. Decidir si se enciende para Ipanema |
| P2 | Bitácora filtrable en la app | Solo CSV (T4.2); el backend ya filtra y pagina |
| P2 | Fotos legadas en base64 | Migrar a bucket con un script (lee `fotoUrl`, sube, escribe `PaqueteFoto`, vacía la columna). Quita la raíz de A1 |
| P2 | Enlace de 7 días no revocable | Solo cambiar `ENLACE_SECRET` los invalida todos. Opción: versión por residente |
| P2 | Dormant: `checkin`/`confirm-delivery` | Rutas de la UI vieja (B2) |
| P3 | Hardening | B1, B3-B7, M4, cabeceras de seguridad, `helmet` |
| P3 | `claveApartamento` y datos viejos | Torres "T2" vs "TORRE 2" ya se igualan en búsqueda, cortesía y lote; falta normalizar los datos guardados en una sola forma |

## Camino a producción

### Relación con el corte de KAN-8 y orden recomendado

El refactor sale de `feature/kan-8-multiconjunto` y asume que TODA fila tiene `conjuntoId` (la extensión de tenant falla cerrada). El runbook de Ipanema (`docs/runbook-corte-ipanema.md`: P0 expand, P1 conjunto, C0 respaldo, C1 backfill, C2 merge a `main`, C3 backfill, C4 verificación, C5 contract manual) ya está pensado y ensayable. Recomendación: **dos despliegues separados, primero KAN-8 y después el refactor**, con al menos unos días de operación estable entre ambos:
- Un solo corte mezcla dos riesgos (datos multi-conjunto y UI/flujo nuevos) y dificulta saber qué causó un problema.
- El refactor cambia el comportamiento que ven operador y residentes (pantallas, PIN solo al residente, cobro por lote); conviene que se estrene sin la ansiedad de la migración de datos.
- Excepción razonable: si el corte de KAN-8 se va a hacer de todos modos en los próximos días, el refactor puede ir justo después en la misma semana. Lo que NO se debe hacer es mergear el refactor a `main` antes de C5 del runbook sin haberlo ensayado: `npm start` aplica por sí solo todas las migraciones de `prisma/migrations/` en el arranque (DEPLOY.md, sección del corte).

### Pasos

1. **Integrar a `develop`** (decisión suya): corregir antes A1 (obligatorio), M1 y M2 (rápidos), y la sección "Entorno refactor" de DEPLOY.md. Rehacer `test:all`, `build` y `e2e` tras las correcciones. Resolver B7 si quiere (renombrar las migraciones con fecha coherente antes de que existan en producción).
2. **Ensayo con copia de producción** (parte 0 del runbook): restaurar el `pg_dump`, aplicar las migraciones del refactor, y medir con datos reales `GET /packages`, la verificación de PIN y el CSV (tiempo y memoria); recorrer el checklist con cuentas reales de Ipanema. Es la única forma de ver los riesgos de datos legados (abajo).
3. **Hacer el corte de KAN-8** siguiendo el runbook tal cual (P0, P1, C0 a C5). No mezclarlo con el refactor.
4. **Preparar variables en Railway (servicio `mensajeriaApp`), sin desplegar aún:**
   - `NODE_ENV=production` (obligatoria en Railway; también activa `trust proxy` y los almacenes reales).
   - `ENLACE_SECRET` (>=32 caracteres, distinta de `JWT_SECRET`; `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - Revisar que `JWT_SECRET` actual tenga >=32 y no sea el valor de ejemplo.
   - `FRONTEND_URL` y `CORS_ORIGIN` = URL de Vercel (hoy `https://mensajeria-app-iota.vercel.app`).
   - Fotos nuevas: crear el bucket y cargar `FOTOS_S3_ENDPOINT`, `FOTOS_S3_BUCKET`, `FOTOS_S3_ACCESS_KEY`, `FOTOS_S3_SECRET`, `FOTOS_S3_REGION`, `FOTOS_S3_FORCE_PATH_STYLE` (si falta TODO el grupo, sigue en modo legado con aviso; si queda a medias, el servidor no arranca).
   - Correo: `RESEND_API_KEY` y `EMAIL_FROM` ya existen; confirmar que el remitente no diga "Ipanema" si habrá más conjuntos.
   - NO configurar el comando de pre-despliegue con `npm run seed` (en el entorno de pruebas se usa para el conjunto DEMO; en producción no debe correr).
5. **Migraciones nuevas que se aplican solas al arrancar el backend** (en este orden; todas aditivas salvo la marcada):

   | # | Migración | Naturaleza | Reversa (`backend/prisma/manual/`) |
   |---|---|---|---|
   | 1 | `20261027120000_add_paquete_evento` | Tabla nueva + trigger solo inserción | `rollback_add_paquete_evento.sql` |
   | 2 | `20261027130000_add_pin_intentos` | 2 columnas con valor por defecto | `rollback_add_pin_intentos.sql` |
   | 3 | `20261028120000_add_recepcion_sin_prealerta` | Columnas nuevas en `Conjunto`/`Package` + índice; **`Package.residenteId` pasa a admitir NULL** (relaja una restricción; el código viejo no se rompe) | `rollback_add_recepcion_sin_prealerta.sql` (falla si ya hay paquetes SIN_ASIGNAR: asignarlos o borrarlos antes) |
   | 4 | `20261029120000_add_clave_idempotencia` | Tabla nueva | `rollback_add_clave_idempotencia.sql` |
   | 5 | `20261030120000_add_paquete_foto` | Tabla nueva | `rollback_add_paquete_foto.sql` |
   | 6 | `20261031120000_add_proposito_token` | Enum + columna con valor por defecto `RESET` | `rollback_add_proposito_token.sql` |
   | 7 | `20261101120000_add_cortesia_apartamento` | Tabla nueva (FK diferible a mano) | `rollback_add_cortesia_apartamento.sql` |
   | 8 | `20261102120000_add_modalidad_entrega` | 1 columna nullable | `rollback_add_modalidad_entrega.sql` |

   Respaldo (`pg_dump -Fc` por el túnel) justo antes. Las tablas nuevas con `conjuntoId NOT NULL` nacen vacías, por eso no chocan con el contract. Orden de despliegue: backend primero, frontend después (el frontend nuevo depende de la API nueva; el frontend viejo contra la API nueva pierde, por ejemplo, la vista de fotos porque cambió el formato de `GET /packages/:id/foto`; la ventana debe ser corta y nocturna).
6. **Cambio de hosting del frontend.** Producción usa Vercel (proyecto `mensajeria-app`, raíz `frontend`, `VITE_API_URL` apuntando al backend, reescritura a `index.html` en `vercel.json` ya existe). El refactor se probó con web y API en dominios distintos de Railway, lo que sí ejercita CORS entre orígenes, pero no Vercel. Antes del corte: desplegar la rama en un *preview* de Vercel apuntando a un backend de pruebas y repetir el E2E remoto (`E2E_BASE_URL`/`E2E_API_URL`); revisar que `/p` y `/acceso/<token>` funcionen al recargar (la reescritura lo resuelve), que el service worker no sirva el `index.html` viejo (`autoUpdate`) y agregar `Referrer-Policy: no-referrer` (B5). Los QR e impresos con `/registro?c=<código>` siguen válidos.
7. **Merge y despliegue** (solo con su orden explícita): merge `develop` a `main`; esperar el despliegue de Railway y verificar `/health`; luego el de Vercel (los nombres de los archivos del bundle cambian en cada build: sondear hasta ver el nuevo).
8. **Datos legados — qué esperar:**
   - Paquetes viejos sin eventos: no tienen `PaqueteEvento`. La cortesía los cuenta por estado (`ESTADOS_COBRADOS`), no por evento, así que un apartamento que ya tuvo entrega NO recibe una segunda cortesía; el motivo de cobro de un paquete viejo se ve vacío en la bitácora. Verificar en el ensayo con 3 apartamentos conocidos.
   - Paquetes viejos sin `recibidoEn`: la UI cae a `fechaIngreso`/`createdAt` (`DetalleSheet`, `Pendientes`, `BitacoraVista`); en el resumen "hoy recibidos" los viejos no cuentan.
   - Fotos base64: se siguen leyendo (modo legado) pero pesan (A1); no se migran solas.
   - Torres "T2" vs "TORRE 2": la búsqueda, la cortesía y el lote ya las igualan; los datos no se tocan.
   - Pre-alertas abiertas (PREALERTADO): al recibir con la misma guía o, si no, la más antigua del residente, se vinculan solas; una pre-alerta de hace semanas podría vincularse a un paquete que no es suyo. Antes del corte, pedir a Francisco que cierre o confirme las pre-alertas abiertas.
   - Operador existente: el PIN ya no se le muestra; avisarle del cambio de forma de trabajar (el residente lo ve en su enlace, app o correo).

## Verificación y reversa

### Verificación en vivo (después del despliegue)

1. `GET /health` en la API; el bundle de Vercel con hash nuevo.
2. Inicio de sesión del operador real (Francisco): `Recibir` carga el contador de hoy; abrir `Pendientes` y medir el tiempo de la primera carga (si pasa de 2-3 s, revisar A1 antes de seguir).
3. Con un residente de prueba real: recibir un paquete con foto (debe quedar en el bucket: abrir el detalle y ver la foto), confirmar que el operador NO ve el PIN, que sale el enlace de WhatsApp con `/p#...` y que el residente lo abre sin contraseña, ve el PIN y pide la entrega (y "Recoger en portería").
4. Entrega por lote con el PIN (efectivo y transferencia); revisar la bitácora/CSV y que llegue el correo de agradecimiento si hay Resend.
5. Apartamento con historial: confirmar que NO recibe una segunda cortesía.
6. Un paquete "sin dueño" y su asignación; modo avión en el celular del operador (cola sin señal) y reenvío.
7. `Enlace de acceso por correo` con una cuenta de prueba; confirmar que el segundo canje del mismo enlace falla.
8. Logs de Railway: sin errores 500 ni avisos de `NODE_ENV`/`ENLACE_SECRET`; memoria estable durante 30 minutos de uso.
9. Probar en un iPhone real (limitación conocida): instalación PWA, cámara, teclado y barra de direcciones.

### Plan de reversa

1. **Código:** redeploy del commit anterior en Railway y en Vercel (el estado de KAN-8 ya corregido). Las columnas y tablas nuevas son inocuas para el código anterior (solo `residenteId` nullable, que el código anterior nunca deja vacío).
2. **Datos:** no es necesario revertir migraciones para volver atrás. Si se quisiera hacerlo, aplicar los `rollback_*.sql` en orden inverso (8 a 1) por el túnel SSH, empezando por confirmar que no hay paquetes SIN_ASIGNAR (reversa de la 3) y sabiendo que borrar `PaqueteEvento` (reversa de la 1) elimina la bitácora generada desde el despliegue. Restaurar el `pg_dump` solo como último recurso (se pierden las operaciones posteriores al respaldo).
3. **Fotos:** las ya subidas al bucket quedan huérfanas tras una reversa (no estorban); las del modo legado siguen en la base.
4. **Enlaces enviados por WhatsApp:** dejan de funcionar al volver al código anterior (la ruta cambió); avisar al operador para que pida a los residentes usar la app con su clave.
5. **Criterio para revertir:** 500 repetidos en recepción o entrega, `Pendientes` que no carga, o el operador sin poder entregar durante más de 10 minutos en horario pico.
