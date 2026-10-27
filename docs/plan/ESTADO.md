# Tablero del refactor

Los agentes actualizan su fila al terminar. Estados posibles: `pendiente`, `en curso`, `hecho`, `bloqueado (motivo)`.

## Decisiones del usuario

| Id | Estado |
|---|---|
| D1 Enlace de WhatsApp muestra el PIN sin contraseña | sí (por defecto; el usuario ordenó iniciar el 2026-10-27) |
| D2 Estado SIN_ASIGNAR y custodia de 30 días | sí (por defecto; el usuario ordenó iniciar el 2026-10-27) |
| D3 Correo automático de llegada | sí (por defecto; el usuario ordenó iniciar el 2026-10-27) |
| D4 Fotos en bucket de Railway | sí (por defecto; el usuario ordenó iniciar el 2026-10-27) |
| D5 Paleta de marca v3 | sí (por defecto; el usuario ordenó iniciar el 2026-10-27) |

## Tareas

| Id | Modelo | Estado | Commit | Nota |
|---|---|---|---|---|
| T0.1 | S | hecho | e5909be | `npm run test:all`: 119 pass, 0 fail, 0 omitidas (base propia por ejecución; hash: git log --grep T0.1). Se corrigió el helper SQL de contractConjunto (psql). |
| T0.2 | S | hecho | ce56516 | `test:all`: 123 pass, 0 fail, 0 omitidas. `AppError`/`asyncHandler`/manejador global en `backend/src/domain/errores.js`; 40 `{ error }` migrados; frontend lee `message`/`code`. |
| T0.3 | H | hecho | 46ddaec | `config/env.js`; obligatorias DATABASE_URL y JWT_SECRET (≥32 en producción). |
| T1.1 | S | hecho | 62f86a8 | 42 combinaciones probadas; TRANSICION_INVALIDA 409. Nota para T1.3: checkin/schedule/confirmDelivery quedarán restringidos. |
| T1.2 | S | hecho | 455a096 | `domain/cobro.js`; primera entrega por apartamento físico (por createdAt); precedencia cortesía > bono > tarifa. |
| T1.3 | S | hecho | 6075b49 | PaqueteEvento solo-inserción (trigger); aplicarEvento con updateMany condicional; bono atómico, sin crédito → TARIFA. |
| T1.4 | S | hecho | 41f6159 | PIN: 5 fallos → 423 por 15 min (contador fuera de la tx). Login: 10/IP/15 min → 429; trust proxy=1 en producción. |
| T2.1 | S | hecho | 98546d6 | residenteId opcional; etiquetaNombre, transportadora, metodoPago, recibidoEn; guia/fechaEntrega reutilizados; Conjunto: prefijoPais, franjasEntrega, maxFotos, custodiaMaxDias. |
| T2.2 | S | hecho | 893516b | GET /api/residentes/buscar (OPERATOR): "304", "T2 304", "2-304", nombre sin tildes; máx 5; torre se guarda "TORRE N". |
| T2.3 | S | hecho | 2f21448 | POST /packages/recepcion (con/sin residente, vincula pre-alerta por guía), PATCH /:id/asignar, ?estado=, Idempotency-Key; cobro compartido en cobro.service. **Bloqueo principal eliminado en backend.** |
| T2.4 | S | hecho | 8a584c0 | Notificador (resend/fake) con plantillas escapadas y sin "Ipanema"; correo de llegada post-commit (no en replay). El orquestador conectó el agradecimiento del lote (un correo por lote). |
| T2.5 | S | hecho | b213c19 | /entregas/verificar-pin y /confirmar: lote = apartamento, PIN_AMBIGUO, límite 10/15 min por operador, token de entrega 10 min. Propuesta futura: PIN por residente/apto (colisiones). |
| T2.6 | H | hecho | dc38a49 | Franjas, métodos de pago, prefijo y maxFotos salen de /conjunto/config; guard frontendSinFijos ampliado. Pendiente para T2.3: checkin usa `fotos.length > 3` fijo. |
| T3.1 | S | hecho | c787313 | GET /api/p/:token (HMAC, 7 días) con sesión limitada `scope:enlace` (2 h) que solo permite ver y programar; enlace en el aviso. |
| T3.2 | S | hecho | 91068de | POST /auth/enlace (200 genérico, 5/15 min) y /auth/enlace/canjear (un solo uso, atómico); PasswordResetToken.proposito RESET/ACCESO. |
| T4.1 | S | hecho | b1cecdd | `frontend/src/design/` (tokens v3, 13 componentes, useTheme día/noche, `/_ds` en dev). Variables viejas renombradas `--lg-*` hasta T4.2/T4.3. |
| T4.2 | S | hecho | daa541c | 6 pantallas del operador en `pages/operador/`; OperatorView borrado. Probado con Playwright 390 px día/noche. Toques hasta Guardado: 3 + dígitos del apto (4 con apto de 1 dígito, 6 con 3 dígitos). Bitácora con filtros no replicada (queda CSV). |
| T4.3 | S | pendiente | | |
| T4.4 | H | en curso | | |
| T4.5 | S | pendiente | | |
| T4.6 | H | pendiente | | |
| T5.1 | S | hecho | 39d9705 | AlmacenFotos (s3/fake/legado) + PaqueteFoto; sin bucket en producción sigue en legado con aviso. |
| T6.1 | S | pendiente | | |
| T7.1 | Orq. | pendiente | | |
| T8.1 | S | pendiente | | |

## Bitácora del orquestador

- 2026-10-27: investigación, diagnóstico, diseño (12 artboards) y plan listos.
- 2026-10-27: paleta v3 + modo noche grafito aprobados; arranca F0.
- 2026-10-27: T0.1 (119/119) y T0.2 (123/123) verificados por el orquestador. En paralelo: T0.3, T1.1, T1.2, T4.1.
- 2026-10-27: T0.3, T1.1 y T1.2 integradas; `test:all` 198/198. F0 cerrada. Arranca T1.3.
- 2026-10-27: T4.1 integrada, build verde.
- 2026-10-27: T1.3 integrada, `test:all` 208/208. En paralelo: T1.4 y T2.1.
- 2026-10-27: T1.4 integrada, `test:all` 229/229. F1 completa → revisión de fase en curso.
- 2026-10-27: **Revisión de fase F0/F1: PASA CON CORRECCIONES.** Sin críticos. Correcciones en curso: ráfaga de login evadía el límite (72/100 pasaban), aviso si falta NODE_ENV, contraste de bordes de controles (WCAG 1.4.11), errores 4xx de body-parser, logs sin datos personales, pruebas faltantes.
- Deuda explícita para T4.2/T4.3: `frontend/src/index.css` legado (hex y controles <48 px) se elimina al borrar OperatorView/ResidentView.
- Deuda para F8/legal: borrar una cuenta (derecho de supresión, Ley 1581) con `PaqueteEvento` exige definir anonimización vs purga.
- 2026-10-27: correcciones de la revisión F0/F1 integradas (e49253e): ráfaga de login 10/50, `--line-strong` ≥3:1, errores 4xx. `test:all` 239/239, build verde. **F0 y F1 cerradas.**
- 2026-10-27: T2.1 integrada (conflicto en DEPLOY.md resuelto conservando ambas secciones). `test:all` 255/255; `migrate diff` sin drift. En paralelo: T2.2 y T2.6.
- 2026-10-27: T2.6 integrada; build verde, pruebas sin BD 156/156.
- 2026-10-27: T2.2 integrada, `test:all` 281/281. Arranca T2.3 (recepción sin pre-alerta: el bloqueo principal).
- 2026-10-27: T2.3 integrada, `test:all` 309/309. En paralelo: T2.4, T2.5, T3.1, T5.1.
- 2026-10-27: T2.4, T2.5, T3.1 y T5.1 integradas (conflictos de integración resueltos combinando ambos lados). `test:all` 389/389, build verde, sin drift. **F2 completa.** En curso: revisión de fase F2/F3.1/F5, T3.2 y T4.2.
- Deuda detectada: `claveApartamento` no equipara "T2" con "TORRE 2" (la búsqueda sí, con `tokenTorre`): unificar para cortesía y lote.
- 2026-10-27: T3.2 integrada, `test:all` 400/400.
- **Revisión de fase F2/T3.1/T5.1: PASA CON CORRECCIONES** (sin críticos). Correcciones en curso: cortesía duplicada al asignar y en carrera; unificar "T2"/"TORRE 2"; límite de PIN por operador menos agresivo; token del enlace fuera de la ruta (fragmento #); el operador ya no ve el PIN (decisión del orquestador: el PIN solo lo ve el residente, por enlace/app/correo); límite del body vs fotos; producción detectada en Railway aunque falte NODE_ENV.
- 2026-10-27: T4.2 integrada; build verde.
- Contratos que pidió el frontend (tarea nueva **T2.7**, tras las correcciones de F2): resumen "hoy" liviano, `GET /packages/:id` para el operador, búsqueda con torre por prefijo, y bitácora filtrable.
