# Plan: elegir el conjunto con un selector

Fecha: 2026-10-29. Rama de trabajo: `refactor/mobile-first`. A `develop` solo cuando esté validado; a `main` solo por PR y con el OK explícito del usuario (regla de `CLAUDE.md` en `main`).

## Objetivo

Simplificar cómo una persona queda en su conjunto. **El código de invitación deja de ser la puerta de entrada.** En su lugar hay un **selector "Conjunto"**:

- **Al registrarse**, el residente elige su conjunto de una lista.
- **Al hacer una solicitud** (avisar un paquete o pedir una entrega), el selector se muestra con su conjunto actual. Si se mudó, puede cambiarlo.
- **Con un solo conjunto activo**, que es el caso de hoy (Ipanema), el selector aparece **preseleccionado y deshabilitado**: se ve, pero no se puede tocar.
- **El operador no elige conjunto:** siempre opera en el suyo.

## Punto de partida (qué hay hoy)

- **`main` (producción, desde el 28-oct):**
  - Multi-conjunto desplegado (KAN-8), con un solo conjunto, `ipanema`.
  - El *contract* (`conjuntoId` NOT NULL) está **aplicado en la base**, pero su carpeta `20261028165010_contract_conjunto` **todavía no está en el repo** (paso 4 pendiente; SHA-256 en DEPLOY.md).
  - Hotfix `20a46b4`: mientras exista un único conjunto activo, el registro funciona sin código (`conjuntoUnicoActivo()`, `config-publica` sin `?c=`).
  - Ajustes de estilo del operador y de la barra superior en `OperatorView.jsx` e `index.css`.
- **`refactor/mobile-first`:**
  - Salió de `kan-8` **antes** del corte. Va 94 commits por delante y 17 por detrás de `main`.
  - Tiene 9 migraciones nuevas. **Tres llevan fecha anterior al contract de producción:** `20261027120000`, `20261027130000` y `20261028120000`.
  - `OperatorView.jsx` e `index.css` ya no existen en esta rama: los reemplazan las pantallas nuevas.
- **`hotfix/sw-recarga-primera-visita`:** listo, sin PR todavía.

## Decisiones que necesito del usuario

El valor por defecto aplica si el usuario no dice nada.

| Id | Decisión | Recomendación |
|---|---|---|
| C1 | **Qué significa "cambiar al hacer una solicitud".** (a) El selector en Avisar y Pedir entrega cambia el conjunto **del residente**, es decir, una mudanza: sus solicitudes desde ese momento van al conjunto nuevo. (b) Cada solicitud lleva su propio conjunto y el residente puede tener paquetes en varios a la vez. | **(a) Mudanza.** (b) rompe el modelo, en el que un residente pertenece a un conjunto, y obliga a rehacer el aislamiento. |
| C2 | **¿Mudarse o registrarse en otro conjunto requiere aprobación** del operador de ese conjunto? | **Sí, cuando haya 2 o más conjuntos:** la persona queda "pendiente" hasta que el operador la acepte. Sin código de invitación, nada impide que alguien se inscriba en un conjunto ajeno. Con 1 solo conjunto no aplica. |
| C3 | **El código de invitación y los QR viejos `?c=`.** | Siguen funcionando: si el enlace trae `?c=` o `?conjunto=`, el selector llega con ese conjunto ya elegido. El QR nuevo del operador usa `?conjunto=<slug>`. |
| C4 | **¿Qué pasa con los paquetes pendientes al mudarse?** | Se quedan en el conjunto anterior, con su operador, y el residente los sigue viendo en "Mis paquetes". Lo nuevo va al conjunto nuevo. |

## Fases

### S0 · Poner la rama al día con producción (bloqueante)

**S0.1 · Sonnet.** Integrar `origin/main` en `refactor/mobile-first`.
- **Conflictos esperados:** `Register.jsx`, `auth.controller.js#register`, `conjunto.controller.js`, `conjunto.service.js`, `services/conjunto.js`, `Terms.jsx` y `App.jsx`.
- **Cómo resolverlos:** se conserva la lógica del hotfix (conjunto único). Los cambios de `OperatorView.jsx` e `index.css` se descartan porque esos archivos ya no existen; se revisa si algún ajuste visual aplica a las pantallas nuevas.
- **Se acepta si:** `test:all`, el build y `npm run e2e` quedan en verde.

**S0.2 · Sonnet.** Contract al repo (paso 4 pendiente de producción).
- Agregar la carpeta `20261028165010_contract_conjunto/`, **byte a byte idéntica**, y verificar su SHA-256 contra DEPLOY.md.
- En `schema.prisma`, `conjuntoId` pasa a obligatorio en `User`, `Package`, `Bono` y `Comentario`.
- Adaptar o retirar las pruebas de backfill y contract que insertan `conjuntoId` NULL.
- **Se acepta si:** `migrate diff` queda sin drift contra una copia del esquema de producción.

**S0.3 · Sonnet.** Reordenar las migraciones del refactor.
- Las 9 migraciones pasan a llevar fecha posterior a `20261028165010`. Las de producción no se tocan.
- La base del entorno Railway `puertaya-refactor` se **recrea**: tiene las migraciones con los nombres viejos y solo contiene datos DEMO.
- **Se acepta si:** `prisma migrate deploy` sobre una copia del esquema de producción aplica las 9 en orden y sin errores, y el rollback de cada una sigue funcionando.

**S0.4 · Orquestador.** Integrar `hotfix/sw-recarga-primera-visita` en la rama del refactor, si no entró antes a `main`.

### S1 · Backend del selector

**S1.1 · Sonnet.** Lista pública de conjuntos.
- `GET /api/conjuntos` (público, en `RUTAS_SIN_SESION` con justificación) devuelve `[{ slug, nombre, ciudad? }]` de los conjuntos con la invitación activa.
- Nunca devuelve tarifas, código, datos del operador ni IDs internos.
- Lleva caché corta y límite de peticiones.
- **Se acepta si** las pruebas cubren: 0, 1 y N conjuntos; un conjunto inactivo queda fuera; la respuesta no trae ningún campo sensible.

**S1.2 · Sonnet.** Registro por conjunto elegido.
- `POST /api/auth/register` acepta `conjunto` (slug).
- El backend resuelve el slug a su id y crea al usuario con `runWithTenant`. El cliente nunca manda `conjuntoId` (invariante 7 intacta).
- `codigoInvitacion` sigue aceptándose, para compatibilidad con los QR viejos.
- Se **retira el caso especial `conjuntoUnicoActivo()`**: con un conjunto, el frontend manda su slug igual que con varios.
- Si hay 2 o más conjuntos y C2 = sí: el residente nuevo queda `estado: PENDIENTE_APROBACION` y no puede entrar hasta que lo apruebe el operador. Mensaje: "Tu cuenta está esperando que el operador de X la apruebe."
- **Se acepta si** las pruebas cubren: slug válido, slug inexistente (400), conjunto inactivo (400), y el código viejo sigue funcionando.

**S1.3 · Sonnet.** Mudanza de conjunto (C1 = a).
- `POST /api/residente/mudanza { conjunto, torre, apto }` (solo RESIDENT con sesión normal; la sesión del enlace de WhatsApp no puede).
- Cambia `User.conjuntoId` en una operación **única y auditada**: evento `MUDANZA` en una bitácora nueva, de solo inserción y sin tenant (como `Conjunto`), con conjunto de origen y de destino.
- Es la **única excepción documentada** a "el tenant no lo decide el cliente". Va concentrada en un servicio y cubierta por una prueba de auditoría, como `GLOBAL_LOOKUP`.
- Si hay varios conjuntos y C2 = sí, la mudanza queda pendiente hasta que el operador destino la apruebe.
- Los paquetes abiertos se quedan en el conjunto anterior (C4). "Mis paquetes" los muestra con el nombre de su conjunto.
- **Se acepta si** las pruebas cubren:
  - el aislamiento sigue intacto: el operador anterior deja de ver al residente en la búsqueda y el operador nuevo lo ve;
  - no se puede mudar a un conjunto inactivo;
  - no se puede pasar un `conjuntoId` crudo;
  - la sesión de enlace recibe 403.
- Se actualiza `CLAUDE.md` con la invariante nueva.

**S1.4 · Haiku.** `GET /api/conjunto/config` y `/api/p/abrir` devuelven `conjunto: { slug, nombre }` para que el selector muestre el actual.

### S2 · Frontend

**S2.1 · Sonnet.** Componente `SelectorConjunto` en `frontend/src/design/`.
- Es un `<select>` nativo accesible, de 56 px, con etiqueta "Conjunto".
- **Con 1 conjunto:** preseleccionado, `disabled`, y con la ayuda "Por ahora Puertayá funciona solo en {nombre}." El valor se envía igual, porque los campos `disabled` no viajan en un formulario.
- **Con varios:** se puede elegir, y la opción vacía dice "Elige tu conjunto".
- Usa los tokens del diseño, sin hex. Contraste y foco correctos.
- **Se acepta si** se muestra en la página `/_ds` en sus 3 estados: 1 conjunto, varios, y cargando o con error.

**S2.2 · Sonnet.** Registro.
- `Register.jsx` reemplaza el campo "Código de invitación" por `SelectorConjunto`, cargado desde `GET /api/conjuntos`.
- Si el enlace trae `?conjunto=` o `?c=`, llega preseleccionado.
- El texto "Te estás registrando en X" se mantiene.
- **Se acepta si:** con 1 conjunto el selector sale deshabilitado y el registro funciona; con 2, hay que elegir.

**S2.3 · Sonnet.** Solicitudes del residente.
- En **Avisar** y **Pedir entrega** se muestra `SelectorConjunto` con el conjunto actual.
- Con 1 conjunto sale deshabilitado y no cambia nada del recorrido: los toques siguen siendo los mismos.
- Con varios, al cambiarlo se abre una hoja de confirmación: "¿Te mudaste a {nuevo}? Tus paquetes pendientes en {anterior} siguen allí." Luego pide torre y apartamento y hace la mudanza (S1.3). Después se envía la solicitud.
- **Se acepta si:** el E2E cubre la mudanza con 2 conjuntos y el recorrido sin cambios con 1.

**S2.4 · Haiku.** Operador.
- El QR y el enlace de "Invitar residentes" apuntan a `/registro?conjunto=<slug>`.
- Si C2 = sí, aparece la sección **"Por aprobar"** en Pendientes, con los botones Aprobar y Rechazar.

### S3 · Pruebas y verificación

**S3.1 · Sonnet.** E2E.
- Escenarios nuevos con 1 y con 2 conjuntos: registro, solicitud y mudanza; y aprobación, si aplica C2.
- Integrar la auditoría de accesibilidad para el selector.
- **Se acepta si:** local y Railway en verde.

**S3.2 · Sonnet (revisor).** Revisión de la fase:
- aislamiento: la mudanza no filtra datos entre conjuntos;
- que la lista pública no exponga nada sensible;
- invariantes de `CLAUDE.md`.

### S4 · Despliegue

**S4.1 · Orquestador.**
- Recrear la base del entorno `puertaya-refactor` (por S0.3).
- Desplegar la rama, sembrar 2 conjuntos DEMO para probar el caso de varios, y luego dejar 1 para probar el caso de hoy.
- E2E contra Railway.

**S4.2 · Orquestador.** Cuando el usuario lo pida: PR `refactor/mobile-first → develop`, y después `develop → main` con su OK explícito. Antes, se cargan en producción las variables obligatorias del refactor (`ENLACE_SECRET`, `NODE_ENV`, `FOTOS_S3_*`).

## Orden y paralelismo

```
S0.1 → S0.2 → S0.3   (S0.4 en cualquier momento)
S1.1 ∥ S1.4 → S1.2 → S1.3
S2.1 (puede arrancar con S1.1) → S2.2 ∥ S2.3 ∥ S2.4
S3.1 → S3.2 → S4.1 → (decisión del usuario) S4.2
```

## Riesgos

- **Sin código de invitación, cualquiera puede registrarse en cualquier conjunto que aparezca en la lista.** Con 1 conjunto es lo mismo que pasa hoy con el hotfix. Con varios, se mitiga con C2.
- **Que la mudanza cambie `conjuntoId` es delicado** frente al aislamiento. Por eso es un solo servicio, auditado y con su prueba, igual que las otras excepciones.
- **Reordenar las migraciones** obliga a recrear la base del entorno de prueba. En producción no hay riesgo: allí nunca se aplicaron.
