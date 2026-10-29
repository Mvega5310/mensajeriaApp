# Plan: el conjunto se elige en cada solicitud

Fecha: 2026-10-29 (v2, con la definición del usuario). Rama de trabajo: `refactor/mobile-first`. A `develop` solo cuando esté validado; a `main` solo por PR y con el OK explícito del usuario.

## Qué quiere el usuario

**Simpleza, facilidad y rapidez para el cliente.** La persona no "pertenece" a un conjunto: en cada solicitud elige **conjunto, torre y apartamento**. Hoy puede pedir algo para su casa y mañana para un amigo que vive en otro conjunto. **El conjunto elegido separa los datos**, y el sistema le avisa al **operador de ese conjunto**.

- **Selector "Conjunto"** en el registro y en cada solicitud (Avisar un paquete, Pedir entrega).
- **Con un solo conjunto activo, que es el caso de hoy:** el selector sale **preseleccionado y deshabilitado**.
- **Sin código de invitación** como requisito. Los enlaces viejos con `?c=` siguen funcionando: llegan con el conjunto ya elegido.
- **Sin aprobaciones previas:** nada frena al cliente.
- **El operador** no elige conjunto: opera en el suyo y ve solo lo de su conjunto.

## El modelo nuevo, en palabras simples

| Hoy (KAN-8) | Nuevo |
|---|---|
| El residente *es* de un conjunto (`User.conjuntoId`) | La **cuenta** es de la persona y sirve en cualquier conjunto |
| Torre y apartamento están en la cuenta | Torre y apartamento van en una **dirección de entrega** (`Domicilio`: conjunto + torre + apto + nombre de quien recibe + teléfono), elegida o creada en cada solicitud |
| El operador busca *residentes* del conjunto | El operador busca **direcciones de entrega** de su conjunto ("304" muestra a quienes han pedido o recibido allí) |
| "Mis paquetes" muestra los de un conjunto | "Mis paquetes" muestra **todos los de la persona**, cada uno con el nombre de su conjunto |

**El aislamiento entre conjuntos no se debilita:** `Package`, `Domicilio`, `Bono` y `Comentario` siguen llevando `conjuntoId`. La extensión de Prisma los sigue filtrando por el conjunto del contexto. Lo único que cambia es que **la cuenta de la persona deja de ser un dato de un conjunto**.

**Regla de oro: no se pide dos veces lo mismo.**

- **Una sola vez:** el conjunto, la torre, el apartamento y el teléfono se piden al registrarse, o la primera vez que se usan. Quedan guardados como dirección.
- **En cada solicitud no se pregunta nada.** La dirección guardada (la última usada) ya viene puesta y se muestra en una sola línea, por ejemplo "Ipanema · T2 · 304". No hay campos de dirección en el formulario.
- **"Cambiar" es opcional.** Es un enlace pequeño que solo se toca si la persona lo necesita (por ejemplo, para pedir para un amigo). Si lo toca, puede elegir otra dirección guardada o agregar una nueva una sola vez. Esa dirección queda guardada para la próxima.
- **0 campos y 0 toques extra** respecto al recorrido de hoy. Hay una prueba E2E que lo verifica.

## Punto de partida (igual que en la v1)

- **`main` en producción desde el 28-oct:**
  - Hay un solo conjunto, `ipanema`.
  - El *contract* está aplicado en la base, pero su carpeta `20261028165010_contract_conjunto` no está en el repo.
  - Hay un hotfix de registro sin código.
  - Hay estilos nuevos en `OperatorView.jsx` e `index.css`.
- **`refactor/mobile-first`:**
  - Va 94 commits por delante y 17 por detrás de `main`.
  - Tres de sus migraciones tienen fecha anterior al contract.
- **`hotfix/sw-recarga-primera-visita`:** listo, sin PR.

## Decisiones (ya tomadas por el usuario o con valor por defecto)

| Id | Decisión | Estado |
|---|---|---|
| C1 | El conjunto y el apartamento son **por solicitud**, no por cuenta | **Decidido por el usuario** |
| C2 | Sin aprobación del operador para pedir en cualquier conjunto | **Decidido por el usuario** (simpleza) |
| C3 | Los enlaces y QR viejos `?c=` preseleccionan el conjunto; el QR nuevo usa `?conjunto=<slug>` | Por defecto: sí |
| C4 | Los residentes actuales de Ipanema conservan su torre y apartamento como su primer `Domicilio` (migración de datos) | Por defecto: sí |
| C5 | **Riesgo a vigilar, sin frenar al cliente:** cualquiera puede crear una dirección en "T2 · 304". Cuando llega un paquete *sin* pre-alerta, el operador ve **todos los nombres** registrados en ese apartamento y elige el que dice la etiqueta. Así el PIN le llega a quien de verdad va dirigido el paquete. Con pre-alerta, el paquete se vincula por número de guía a quien lo avisó. | Por defecto: así |

## Fases

### S0 · Poner la rama al día con producción (bloqueante, sin cambios respecto a la v1)

**S0.1 · Sonnet.** Integrar `origin/main` en `refactor/mobile-first`.
- **Cómo resolver los conflictos:** se conserva la lógica del hotfix por ahora; S1 la reemplaza. Se descartan `OperatorView.jsx` e `index.css`, que ya no existen en esta rama.
- **Se acepta si:** `test:all`, el build y `e2e` quedan en verde.

**S0.2 · Sonnet.** Contract al repo.
- Agregar la carpeta `20261028165010_contract_conjunto/` **byte a byte idéntica** y verificar su SHA-256 contra DEPLOY.md.
- En `schema.prisma`, `conjuntoId` pasa a obligatorio.
- Adaptar las pruebas de backfill y contract.
- **Se acepta si:** `migrate diff` queda sin drift contra una copia del esquema de producción.

**S0.3 · Sonnet.** Las 9 migraciones del refactor pasan a llevar fecha posterior a `20261028165010`. La base de `puertaya-refactor` se recrea (solo tiene datos DEMO).
- **Se acepta si:** `migrate deploy` sobre una copia del esquema de producción aplica las 9 en orden.

**S0.4 · Orquestador.** Incluir el hotfix del service worker.

### S1 · Modelo: cuenta de la persona + dirección de entrega por conjunto

**S1.1 · Sonnet.** Esquema (*expand*: primero agrega, después migra datos).
- **Modelo nuevo `Domicilio`, con tenant** (entra en `MODELOS_CON_TENANT`). Campos: `id`, `conjuntoId`, `usuarioId` (FK a User), `torre`, `apto`, `nombreRecibe`, `telefono`, `ultimoUsoEn` y `activo`. Clave única: `[conjuntoId, usuarioId, torre, apto]`.
- **En `Package`:** se agrega `domicilioId` (FK a Domicilio). Se conserva `residenteId` como "quién lo pidió o a quién va".
- **En `User`:**
  - Para RESIDENT, `conjuntoId` pasa a significar solo "último conjunto usado". Deja de servir para aislar y se puede quedar NOT NULL, así no se toca el contract.
  - Para OPERATOR, sigue siendo **su** conjunto.
  - Los residentes salen del filtro de tenant. Para eso `User` deja `MODELOS_CON_TENANT` y las lecturas de operadores se filtran explícitamente. **El aislamiento de las lecturas de operadores se hace a mano, en un servicio único, con prueba de auditoría.**
- **Migración de datos (C4):** por cada residente actual se crea su `Domicilio` en su conjunto, con su torre y apartamento. Se enlaza cada `Package` existente con su `Domicilio`.
- Se escriben la migración aditiva, su rollback y el ensayo sobre una copia de producción.
- **Se acepta si** las pruebas contra Postgres muestran que:
  - los datos legados quedan con su `Domicilio`;
  - el aislamiento de `Package` y `Domicilio` sigue intacto;
  - `migrate diff` no tiene drift.

**S1.2 · Sonnet.** Reglas de aislamiento nuevas y documentadas en `CLAUDE.md`.
- **"Mis paquetes" de una persona:** junta los paquetes de todos los conjuntos donde tiene un `Domicilio`. Lo hace corriendo **una consulta por conjunto, dentro de `runWithTenant` de cada uno**. Así la extensión no se salta y no hace falta `GLOBAL_LOOKUP` nuevo ni SQL crudo.
- **El operador** solo lee `Domicilio` y `Package` de su conjunto, como hoy. De la persona ve solo lo que guarda el `Domicilio` (nombre de quien recibe y teléfono), nunca su correo ni sus otros conjuntos.
- **En las escrituras, el conjunto sale del slug elegido.** El backend lo valida (conjunto activo) y abre el contexto. El cliente nunca manda `conjuntoId` crudo, así que la invariante 7 se mantiene, adaptada a la lectura del slug.
- **Pruebas de invariantes nuevas:**
  - una persona con paquetes en A y en B ve los suyos en ambos;
  - el operador de A no ve nada de B, ni el `Domicilio` que esa persona tiene en B;
  - un slug inactivo o inexistente da 400.

**S1.3 · Sonnet.** API.
- `GET /api/conjuntos` (público, en `RUTAS_SIN_SESION`): devuelve `[{ slug, nombre }]` de los conjuntos activos. Nada sensible.
- `GET /api/domicilios` (persona con sesión): sus direcciones guardadas, ordenadas por último uso.
- **Registro:** pide `conjunto` (slug), torre y apartamento para crear el primer `Domicilio`. El código de invitación sigue siendo opcional, por compatibilidad. Se retira el caso especial `conjuntoUnicoActivo()`.
- **Pre-alerta:** `POST /api/packages` recibe `{ domicilioId }` o `{ conjunto, torre, apto, nombreRecibe?, telefono? }`. Si es nueva, crea o reutiliza el `Domicilio`. Corre en el contexto de ese conjunto y **avisa al operador de ese conjunto** con `avisarNuevaPrealerta`.
- **Pedir entrega** (`schedule`): el paquete ya tiene su conjunto, así que se resuelve en su contexto.
- **Enlace de WhatsApp (`/p/abrir`):** el token ya trae el conjunto, así que no cambia.
- **Recepción del operador:**
  - `GET /api/residentes/buscar` pasa a buscar en `Domicilio` y muestra todos los nombres del apartamento (C5).
  - `POST /packages/recepcion` recibe `domicilioId`. Se mantiene `residenteId` por compatibilidad.
- **Se acepta si:** hay pruebas de integración de cada ruta, incluido el escenario "ayudar a un amigo": una persona de A pide en B, el operador de B recibe el aviso y la persona ve el paquete en "Mis paquetes".

### S2 · Frontend

**S2.1 · Sonnet.** Componente `SelectorConjunto` (en `design/`).
- Es un `<select>` nativo, de 56 px, con la etiqueta "Conjunto".
- **Con 1 conjunto:** preseleccionado, `disabled`, con la ayuda "Por ahora Puertayá funciona solo en {nombre}". El valor viaja igual.
- **Con varios:** se puede elegir.
- Va en la página `/_ds` con sus 3 estados.

**S2.2 · Sonnet.** Componente `DireccionEntrega`, con dos vistas:
- **Vista corta (por defecto):** muestra la última dirección, por ejemplo "Ipanema · T2 · 304 · Ana", con un enlace **"Cambiar"**.
- **Vista abierta:** lista de direcciones guardadas, más la opción **"Otra dirección"** con el selector de conjunto, torre, apartamento, nombre de quien recibe y teléfono. Cada campo se precarga con lo del usuario.

**S2.3 · Sonnet.** Pantallas que lo usan.
- **Registro:** selector de conjunto, torre y apartamento. Con 1 conjunto el selector sale deshabilitado.
- **Avisar un paquete y Pedir entrega:** `DireccionEntrega` va arriba en vista corta, con la dirección guardada ya puesta y sin campos de dirección. **El recorrido de hoy no gana toques ni campos;** solo se toca "Cambiar" si hace falta.
- **Mis paquetes:** cada tarjeta muestra el conjunto si la persona tiene más de uno.
- **Se acepta si:** con 1 conjunto los toques son los mismos que hoy, y el E2E "ayudar a un amigo" pasa con 2 conjuntos.

**S2.4 · Haiku.** Operador.
- Recibir muestra los resultados por dirección, por ejemplo "T2 · 304 · Ana" y "T2 · 304 · Luis".
- El QR de invitación apunta a `/registro?conjunto=<slug>`.

### S3 · Pruebas y revisión

**S3.1 · Sonnet.** E2E.
- Con 1 conjunto: el recorrido de hoy sigue igual y el selector sale deshabilitado.
- Con 2 conjuntos: registro en A, aviso para un amigo en B, aviso al operador de B, recepción en B, entrega con PIN y "Mis paquetes" con los paquetes de A y de B.
- La auditoría de accesibilidad de los componentes nuevos da verde.

**S3.2 · Sonnet (revisor).** Revisión centrada en el aislamiento:
- el operador de A no puede ver nada de B por ninguna ruta;
- la lista pública no expone datos;
- las lecturas por conjunto de "Mis paquetes" no tienen fugas;
- el escenario de C5.

### S4 · Despliegue

**S4.1 · Orquestador.**
- Recrear la base de `puertaya-refactor`.
- Sembrar 2 conjuntos DEMO, probar, dejar 1 y volver a probar.
- E2E contra Railway.

**S4.2 · Orquestador.** Cuando lo pida el usuario:
1. PR a `develop`, y luego `develop → main` con su OK.
2. Ensayo de la migración de datos de S1.1 sobre una copia de producción, siguiendo el estilo del runbook de KAN-8.
3. Cargar en producción las variables obligatorias del refactor.

## Orden

```
S0.1 → S0.2 → S0.3   (S0.4 en cualquier momento)
S1.1 → S1.2 → S1.3
S2.1 ∥ S2.2 (pueden arrancar con S1.1) → S2.3 ∥ S2.4
S3.1 → S3.2 → S4.1 → (decisión del usuario) S4.2
```

## Qué no cambia para el cliente de Ipanema hoy

Ve un campo "Conjunto: Ipanema" que no se puede tocar y su dirección ya llena. Todo lo demás es igual de rápido.
