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
| T0.2 | S | hecho | (ver log) | `test:all`: 123 pass, 0 fail, 0 omitidas. `AppError`/`asyncHandler`/manejador global en `backend/src/domain/errores.js`; 40 `{ error }` migrados; frontend lee `message`/`code`. |
| T0.3 | H | pendiente | | |
| T1.1 | S | pendiente | | |
| T1.2 | S | pendiente | | |
| T1.3 | S | pendiente | | |
| T1.4 | S | pendiente | | |
| T2.1 | S | pendiente | | |
| T2.2 | S | pendiente | | |
| T2.3 | S | pendiente | | |
| T2.4 | S | pendiente | | |
| T2.5 | S | pendiente | | |
| T2.6 | H | pendiente | | |
| T3.1 | S | pendiente | | |
| T3.2 | S | pendiente | | |
| T4.1 | S | pendiente | | |
| T4.2 | S | pendiente | | |
| T4.3 | S | pendiente | | |
| T4.4 | H | pendiente | | |
| T4.5 | S | pendiente | | |
| T4.6 | H | pendiente | | |
| T5.1 | S | pendiente | | |
| T6.1 | S | pendiente | | |
| T7.1 | Orq. | pendiente | | |
| T8.1 | S | pendiente | | |

## Bitácora del orquestador

- 2026-10-27: investigación, diagnóstico, diseño (12 artboards) y plan listos.
- 2026-10-27: paleta v3 + modo noche grafito aprobados; arranca F0.
