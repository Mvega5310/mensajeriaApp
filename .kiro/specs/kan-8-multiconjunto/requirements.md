# KAN-8 — Soporte multi-conjunto (multitenant) para Puertayá — Requisitos

> **Alcance de este documento:** historias de usuario y criterios de aceptación (formato EARS)
> para el diseño del soporte multi-conjunto. **Solo diseño.** No incluye implementación, `tasks.md`,
> cambios de código ni ejecución de migraciones.

## Glosario y contexto compartido

- **Conjunto** = *tenant*. Un conjunto residencial (p. ej. Ipanema) con sus residentes, su operador
  y sus paquetes, aislado de los demás. Es la nueva entidad raíz del modelo multitenant.
- **`conjuntoId`** = columna de tenant que se agregará a las tablas propias de un conjunto.
- **Operador (`OPERATOR`)** y **Residente (`RESIDENT`)** son los dos roles existentes (JWT). No se
  crean roles nuevos en esta spec.
- **Código de invitación** = identificador del conjunto embebido en el enlace/QR de registro que el
  operador reparte físicamente; fija el `conjuntoId` del residente nuevo al registrarse.
- **Aislamiento estructural** = el sistema hace *imposible por construcción* que una consulta cruce
  datos entre conjuntos, en lugar de depender de que cada consulta recuerde filtrar manualmente.

### Supuestos declarados (a validar contra el repo antes de `design.md`)

Estos supuestos surgen del código incrustado en el prompt; se listan para trazabilidad, no reabren
ninguna decisión ya tomada:

1. Todo `Package` pertenece a un `User` vía `residenteId`; por tanto el conjunto de un paquete puede
   derivarse del conjunto de su residente. (Se evaluará en diseño si conviene columna directa igualmente.)
2. `Bono` y `Comentario` cuelgan de `User` vía `residenteId`; su conjunto es heredable por esa relación.
3. Hoy existe exactamente un `OPERATOR` en producción (Ipanema). El backfill asume un único conjunto
   inicial.
4. El registro (`register` en `auth.controller.js`) hoy no tiene noción de conjunto.

---

## Requisito 1 — Aislamiento estructural de datos entre conjuntos

**Historia de usuario:** Como operador de un conjunto, quiero que mis residentes, paquetes, bonos y
comentarios sean visibles y modificables únicamente dentro de mi conjunto, para que ningún dato mío se
mezcle con el de otro conjunto ni sea accesible por otro operador, incluso si en el futuro se agrega una
consulta nueva que olvide filtrar por conjunto.

### Criterios de aceptación (EARS)

1. **WHEN** un operador autenticado realiza cualquier operación de lectura sobre residentes, paquetes,
   bonos o comentarios, **THE SYSTEM SHALL** devolver exclusivamente registros cuyo `conjuntoId`
   coincida con el conjunto del operador autenticado.
2. **WHEN** un operador autenticado crea o modifica un residente, paquete, bono o comentario, **THE
   SYSTEM SHALL** asignar/preservar el `conjuntoId` del conjunto del operador y **SHALL** rechazar
   cualquier intento de escribir un `conjuntoId` distinto.
3. **THE SYSTEM SHALL** derivar el conjunto activo del token JWT del usuario autenticado y no de ningún
   parámetro de la petición controlable por el cliente (query string, body o header arbitrario).
4. **WHERE** una consulta a la base de datos sobre una tabla con `conjuntoId` no especifica
   explícitamente el conjunto, **THE SYSTEM SHALL** aplicar automáticamente el filtro por el conjunto
   activo, de modo que el olvido del filtro no pueda producir fuga de datos entre conjuntos.
5. **IF** una petición autenticada no tiene un conjunto activo resoluble (contexto de tenant ausente),
   **THEN THE SYSTEM SHALL** rechazar la operación sobre datos con `conjuntoId` en lugar de operar sobre
   todos los conjuntos.
6. **WHEN** `createPrealert` necesita notificar al operador tras un prealerta, **THE SYSTEM SHALL**
   seleccionar el operador **del conjunto del residente**, y no el primer `OPERATOR` de toda la tabla.
7. **WHEN** `checkin` (en `packages.controller.js`) consulta residentes para calcular la clave de
   apartamento (`apartamento.service.js`) mediante `prisma.user.findMany({ where: { role: 'RESIDENT' } })`,
   **THE SYSTEM SHALL** restringir esa búsqueda a los residentes del conjunto activo, de modo que la
   cortesía de primera entrega no pueda cruzarse entre apartamentos de conjuntos distintos que compartan
   la misma torre/apto. El mecanismo de aislamiento estructural **SHALL** cubrir esta consulta sin
   requerir que el llamador recuerde añadir el filtro manualmente.
8. **WHEN** se ejecuta `listAll` (listado de paquetes), `exportCsv` (exportación), `listForResident`
   o `create` de bonos, o `listAll` de comentarios, **THE SYSTEM SHALL** limitar los resultados y las
   escrituras al conjunto activo.
9. **THE SYSTEM SHALL** preservar el patrón vigente de exclusión de fotos: **WHEN** se responde
   `GET /packages` o `GET /packages/mine`, **THE SYSTEM SHALL NOT** incluir el campo `fotoUrl`,
   independientemente del conjunto.
10. **WHILE** un residente (`RESIDENT`) consulta sus propios datos (p. ej. `/packages/mine`), **THE
    SYSTEM SHALL** limitar los resultados a los paquetes de ese residente dentro de su propio conjunto.

---

## Requisito 2 — Configuración por conjunto

**Historia de usuario:** Como operador de un conjunto, quiero que las tarifas, mis datos de contacto y
domicilio, el nombre del conjunto y el punto de recepción provengan de la configuración de mi conjunto
y no de valores fijos en el código, para que cada conjunto opere con sus propios datos sin recompilar la
app.

### Criterios de aceptación (EARS)

1. **THE SYSTEM SHALL** almacenar por cada conjunto: nombre/identidad, tarifas por categoría de peso
   (`MANO`, `ESTANDAR`, `VOLUMEN`, `PESADO`), número de WhatsApp del operador, datos de
   contacto/domicilio del operador y punto de recepción.
2. **WHEN** el backend calcule el costo de un servicio por categoría de peso, **THE SYSTEM SHALL** usar
   las tarifas del conjunto activo en lugar de la constante global `TARIFAS`.
3. **WHERE** un conjunto no tenga configurada una tarifa para una categoría, **THE SYSTEM SHALL** usar
   un valor por defecto definido (equivalente a los valores actuales de `TARIFAS`) de forma explícita y
   documentada.
4. **WHEN** el frontend muestre el nombre del conjunto, el domicilio/contacto del operador o el enlace
   de WhatsApp, **THE SYSTEM SHALL** obtener esos datos de la configuración del conjunto vía API y no de
   texto fijo en el código (p. ej. `Terms.jsx`).
5. **THE SYSTEM SHALL** mantener el contacto de WhatsApp como enlace manual `wa.me` con mensaje
   precargado, tomando el número desde la configuración del conjunto, sin integrar Twilio ni WhatsApp
   Business API.
6. **THE SYSTEM SHALL** exponer una bandera `BONOS_HABILITADOS` por conjunto, y **WHEN** se cree un
   conjunto nuevo, **THE SYSTEM SHALL** dejar esa bandera en `false` por defecto.
7. **THE SYSTEM SHALL NOT** asumir ni preparar ninguna pasarela de pagos ni cobro automático como parte
   de la configuración por conjunto.

---

## Requisito 3 — Registro de residentes con conjunto asignado por enlace/QR

**Historia de usuario:** Como operador, quiero repartir un enlace/QR de invitación que embeba el
identificador de mi conjunto, para que cualquier residente que se registre a través de él quede asociado
automáticamente a mi conjunto sin que yo tenga que darlo de alta manualmente ni que él elija el conjunto
de una lista.

### Criterios de aceptación (EARS)

1. **THE SYSTEM SHALL** asociar cada conjunto a un código de invitación estable y opaco (no adivinable
   ni secuencial) embebible en un enlace/QR de registro.
2. **WHEN** un residente accede al flujo de registro a través de un enlace con código de invitación
   válido y vigente, **THE SYSTEM SHALL** fijar el `conjuntoId` del nuevo usuario al conjunto de ese
   código.
3. **IF** el código de invitación es inexistente, malformado o está vencido/revocado, **THEN THE SYSTEM
   SHALL** rechazar el registro con un mensaje claro y **SHALL NOT** crear el usuario ni asignarlo a un
   conjunto por defecto.
4. **IF** un intento de registro no incluye ningún código de invitación, **THEN THE SYSTEM SHALL**
   rechazar la creación del usuario en lugar de asignarlo a un conjunto arbitrario.
5. **THE SYSTEM SHALL** conservar el mecanismo de autenticación existente (email + contraseña + JWT) sin
   introducir un sistema de login nuevo; el código de invitación **SHALL** usarse solo para resolver el
   conjunto en el registro, no para autenticar.
6. **WHEN** un usuario ya autenticado obtiene un JWT, **THE SYSTEM SHALL** incluir en él (o permitir
   resolver a partir de él) el `conjuntoId` del usuario, para alimentar el aislamiento del Requisito 1.
7. **WHERE** un código de invitación pueda revocarse o regenerarse, **THE SYSTEM SHALL** invalidar el
   código anterior sin afectar a los residentes ya registrados con él.

---

## Requisito 4 — Migración/backfill de los datos reales de Ipanema

**Historia de usuario:** Como responsable del sistema, quiero un plan de migración que introduzca la
multitenencia sobre los datos de producción existentes de Ipanema de forma segura y reversible, para no
perder ni corromper datos reales y poder volver atrás si algo falla.

### Criterios de aceptación (EARS)

1. **THE SYSTEM SHALL** definir un plan que cree el conjunto "Ipanema" con su configuración inicial
   (tarifas actuales de `TARIFAS`, WhatsApp/domicilio hoy en `Terms.jsx`, `BONOS_HABILITADOS = false`)
   y genere su código de invitación.
2. **THE SYSTEM SHALL** asignar el `conjuntoId` de Ipanema a todos los `User` y `Package` existentes
   (y a `Bono`/`Comentario` según lo que defina el diseño), sin dejar registros con `conjuntoId` nulo
   una vez completado el backfill.
3. **THE SYSTEM SHALL** especificar el orden de pasos (agregar columnas nullable → crear conjunto →
   backfill → volver `conjuntoId` obligatorio) de modo que en ningún paso intermedio queden datos
   huérfanos o inconsistentes.
4. **THE SYSTEM SHALL** definir un punto de reversión explícito para cada paso, de forma que la
   migración pueda deshacerse dejando la base de datos en su estado previo.
5. **THE SYSTEM SHALL** anotar que la migración real de esquema se ejecutará por túnel SSH de Railway
   contra el Postgres de producción, sin detallar ese procedimiento en esta spec.
6. **THE SYSTEM SHALL NOT** ejecutar la migración como parte de esta spec; el entregable es únicamente
   el plan de diseño.
7. **WHEN** el backfill finalice, **THE SYSTEM SHALL** dejar el sistema en un estado donde el
   aislamiento del Requisito 1 aplique sin excepciones sobre los datos migrados.

---

> **Nota sobre identificación de residentes (fuera de alcance).** Se evaluó un requisito de unicidad de
> residentes entre conjuntos y se descartó: `User.email` se mantiene `@unique` **global** sin cambios;
> `torre`/`apto` nunca tuvieron `@unique` en el esquema, así que no hay unicidad que redefinir; y no
> existe caso de negocio que justifique que un mismo correo tenga cuentas en más de un conjunto. Abrir
> esa posibilidad implicaría rediseñar el login, lo que violaría la restricción de no introducir un
> sistema de auth nuevo en esta spec. Si esa necesidad aparece en el futuro, será una spec aparte.

---

## Trazabilidad con el objetivo KAN-8

| Punto del objetivo | Requisito(s) |
|---|---|
| 1. Modelo de datos (`Conjunto`, `conjuntoId`) | R1 (y base de R2/R3/R4) |
| 2. Aislamiento estructural + bug `createPrealert` | R1 |
| 3. Registro con conjunto por enlace/QR | R3 |
| 4. Configuración por conjunto | R2 |
| 5. Migración/backfill Ipanema | R4 |

---

> **Punto de detención.** Según el orden de entregables de la spec, me detengo aquí y espero tu
> aprobación de `requirements.md` antes de redactar `design.md`. No generaré `tasks.md` en esta pasada.
