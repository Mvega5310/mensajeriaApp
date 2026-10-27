# Diagnóstico del código: punto de partida del refactor

Fecha: 2026-10-27. Rama base: `feature/kan-8-multiconjunto`. Lectura sin cambios en el código.
Pruebas del backend: 119 en total, 52 pasan, 0 fallan, 67 omitidas (son de integración y necesitan Postgres).

## 1. Mapa

- **Backend:** Express 4, Prisma 5 (PostgreSQL), JWT y Resend. **Frontend:** Vite y React como PWA. Las pruebas usan `node --test`.
- **Modelos:** Conjunto (tenant), User (RESIDENT/OPERATOR), Package, Bono, Comentario y PasswordResetToken.
- **Estados** (strings, sin enum): `PREALERTADO → EN_RECEPCION (checkin) → PROGRAMADO (horario) → ENTREGADO (PIN)`.
- **Pantallas demasiado grandes:**
  - `OperatorView.jsx`: 866 líneas, unos 30 `useState`, 4 pestañas y 6 modales.
  - `ResidentView.jsx`: 528 líneas; el formulario de pre-alerta tiene 11 controles.

## 2. Recorrido actual

- **El operador tarda entre 10 y 16 toques por paquete.** Toca la tarjeta, luego "Recibir y Fotografiar", y entra a un modal con fotos, categoría y confirmación. Para entregar: Reparto, "Validar PIN", 4 dígitos, Confirmar y Cerrar.
- **El residente llena un formulario de 11 controles** para avisar del paquete. No recibe ningún aviso cuando el paquete llega; solo lo ve si tiene la app abierta, que consulta el servidor cada 20 s. Luego programa el horario en 4 a 6 toques.
- **CONFIRMADO: el operador no puede registrar un paquete sin pre-alerta.**
  - `POST /packages` solo lo puede usar un RESIDENT (`packages.routes.js:336`).
  - El checkin es un PATCH sobre un paquete que ya existe (`packages.controller.js:161-171`).
  - Recepción solo lista los paquetes en `PREALERTADO` (`OperatorView.jsx:172`).
- **El aviso por WhatsApp a "ya está en recepción" solo aparece antes del checkin.** Después del checkin no hay forma de avisar.

## 3. Comparación con los principios de QUIÉN?

| Principio | Estado | Evidencia |
|---|---|---|
| Una pantalla, una decisión | No | Formulario de 11 controles (`ResidentView:210-299`); el modal de checkin junta fotos, categoría y cobro (`OperatorView:695-757`) |
| Mobile-first a 390 px | Parcial | El shell y las zonas seguras están bien; pero hay unos 20 `style={{}}` inline y `<input type="date">` |
| Controles de ≥ 48 px | No | `.btn` ≈ 44 px, `.tab` ≈ 40, toggle de tema 32, quitar foto 22, lightbox 36 |
| Contraste ≥ 4,5:1 | Parcial | `--gold` sobre `--gold-bg` da **2,22:1** (PIN, "Primera vez"); `--ink-soft` sobre `--bg` da 4,34:1 |
| Un color, un significado | Parcial | `--gold` significa primera entrega, bono y PIN a la vez; las variables están en 3 bloques más `--puertaya-*` en paralelo |
| Lógica en funciones puras con pruebas | No | Tarifa, cortesía y bono viven dentro de `checkin()` mezclados con Prisma; la cortesía está implementada **3 veces** |
| Una máquina de estados | No | `schedule` fija PROGRAMADO desde cualquier estado; el checkin puede devolver un ENTREGADO a EN_RECEPCION y volver a descontar el bono; se puede entregar sin checkin |
| Servicios externos con versión fake | Parcial | Solo el correo se simula, con `console.log`; las fotos y el WhatsApp (`wa.me` con "57" fijo en el JSX) no tienen interfaz |
| Dinero en enteros | Cumple | Campos `Int` en COP; falta validar que no sean negativos |
| Configuración en la base | Parcial | Siguen fijos en código: franjas horarias, métodos de pago, pesos, "Ipanema" en los correos, prefijo 57 y el máximo de 3 fotos |
| Un formato de error único | No | `{ error }` en unos 39 sitios; no hay manejador global; un `throw` dentro de un handler async puede colgar el proceso |
| Arranca sin credenciales | Parcial | Exige Postgres; CLAUDE.md habla de SQLite y el README de Postgres |

## 4. Riesgos encontrados

- **Fotos en base64 dentro de `Package.fotoUrl`** (JSON de hasta 3 imágenes). No hay bucket.
- **El descuento del bono no es atómico.** Dos checkins al mismo tiempo pueden gastar el mismo crédito.
- **`confirm-delivery` no limita los intentos.** El PIN de 4 dígitos se puede adivinar por fuerza bruta.
- **Los correos interpolan `proveedor`, `notas` y `nombre` sin escapar el HTML.**
- **Los correos se envían sin esperar respuesta y sin reintento.** Si fallan, nadie se entera.

## 5. Qué no se puede romper

- **Las 9 invariantes del multi-conjunto en CLAUDE.md.** Todas tienen prueba.
- **Los listados nunca devuelven `fotoUrl`.**
- **El WhatsApp es manual** con enlaces `wa.me`.
- **Los bonos se activan por conjunto.**
- **El cobro es manual.**

## 6. Los 10 cambios con más impacto

1. **El operador registra el paquete sin pre-alerta:** busca la torre y el apartamento, y el checkin queda en un solo flujo.
2. **Una máquina de estados pura** con tabla de transiciones y pruebas.
3. **Avisar al residente cuando el paquete llega,** a través de una interfaz `Notificador` (correo, wa.me y fake). Escapar el HTML y quitar "Ipanema" de las plantillas.
4. **Extraer `calcularCobro` y `esPrimeraEntrega` a funciones puras** con pruebas, y descontar el bono dentro de una transacción.
5. **Un solo formato de error `{ code, message, details? }`** con manejador global.
6. **Partir las pantallas por decisión**, y `OperatorView`/`ResidentView` en componentes y hooks.
7. **Controles de 48 px, contraste corregido y un color por significado.**
8. **Una interfaz `AlmacenFotos`** con versión fake, y más adelante un bucket.
9. **Mover a `Conjunto` la configuración que sigue en el código** y validar que los montos no sean negativos.
10. **Limitar los intentos de PIN y de login, validar las variables de entorno al arrancar y añadir docker-compose,** y alinear CLAUDE.md y README.
