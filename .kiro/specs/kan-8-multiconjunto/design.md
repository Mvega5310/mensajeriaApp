# KAN-8 — Soporte multi-conjunto (multitenant) para Puertayá — Diseño

> **Alcance:** solo diseño. No hay implementación, `tasks.md`, cambios de código ni ejecución de
> migraciones. Este documento traza las decisiones para el futuro commit de implementación; cuando se
> implemente, las decisiones relevantes deberán reflejarse en `README.md`/`DEPLOY.md`.
>
> **Enfoque ya decidido (no se reabre):** una sola base de datos compartida con una columna de tenant
> (`conjuntoId`) en cada tabla propia de un conjunto. Descartado: base por conjunto o schema de Postgres
> por conjunto.

---

## 0. Resumen ejecutivo

El diseño introduce una entidad raíz `Conjunto` (tenant) y una columna `conjuntoId` en las tablas que
son propias de un conjunto (`User` y `Package`; `Bono` y `Comentario` la heredan lógicamente vía
`User`, ver §1.3). El aislamiento entre conjuntos se logra de forma **estructural** combinando:

1. Un **middleware de tenant** que fija el conjunto activo a partir del JWT del usuario autenticado.
2. Una **extensión de Prisma** (`$extends` con `query`) que **inyecta automáticamente el filtro
   `conjuntoId`** en toda lectura/escritura de los modelos con tenant, usando el conjunto activo de un
   contexto por-petición (`AsyncLocalStorage`).

Con esto, una consulta nueva que "olvide" filtrar por conjunto queda igualmente filtrada por
construcción; y las tres consultas problemáticas hoy conocidas (`createPrealert`, el bloque
`listAll`/`exportCsv`/bonos/comentarios, y `checkin`) dejan de poder cruzar datos entre conjuntos.

---

## 1. Modelo de datos propuesto (diff sobre el esquema actual)

### 1.1. Nueva entidad `Conjunto`

```prisma
model Conjunto {
  id            String   @id @default(cuid())

  // Identidad
  nombre        String                          // "Conjunto Residencial Ipanema"
  slug          String   @unique                // "ipanema" (legible, para URLs/soporte)

  // Código de invitación (ver §3)
  codigoInvitacion String @unique               // opaco, no secuencial (ver §3.1)
  invitacionActiva Boolean @default(true)       // permite revocar/regenerar sin borrar histórico

  // Configuración de contacto/identidad del operador (hoy en Terms.jsx)
  operadorNombre    String                      // "Francisco Caro Yances"
  operadorWhatsapp  String                      // E.164 sin '+', p. ej. "573001112233" (para wa.me)
  operadorDomicilio String                      // domicilio/dirección legal mostrado en Términos
  puntoRecepcion    String                      // punto físico de recepción de paquetes

  // Configuración de tarifas por categoría de peso (hoy en services/tariff.service.js)
  tarifaMano     Int  @default(3000)            // MANO
  tarifaEstandar Int  @default(4500)            // ESTANDAR
  tarifaVolumen  Int  @default(7000)            // VOLUMEN
  tarifaPesado   Int  @default(12000)           // PESADO

  // Flags por conjunto
  bonosHabilitados Boolean @default(false)      // BONOS_HABILITADOS — false por defecto (restricción)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relaciones inversas
  usuarios  User[]
  paquetes  Package[]
}
```

**Notas de diseño:**

- Las tarifas se modelan como cuatro columnas `Int` (no una tabla `Tarifa` aparte) porque el conjunto de
  categorías es fijo y pequeño (`MANO`/`ESTANDAR`/`VOLUMEN`/`PESADO`) y así el `default(...)` de Prisma
  garantiza el requisito R2.3 (fallback = valores actuales de `TARIFAS`) sin lógica extra. Si en el
  futuro las categorías dejaran de ser fijas, se migraría a una tabla hija; no es necesario hoy.
- `operadorWhatsapp` se guarda en formato apto para `wa.me` (dígitos, sin `+`), preservando la
  restricción de WhatsApp manual: el frontend arma `https://wa.me/<operadorWhatsapp>?text=<mensaje>`.
- `slug` es para humanos/URLs; `codigoInvitacion` es el token opaco para registro (§3). Se separan a
  propósito: el slug puede ser público y legible, el código de invitación debe ser no adivinable.

### 1.2. `conjuntoId` en `User` y `Package` (diff)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique                 // SE MANTIENE @unique GLOBAL (ver requirements, nota R5)
  passwordHash String
  role         String
  nombre       String
  telefono     String
  torre        String?
  apto         String?
  termsAcceptedAt DateTime
  createdAt    DateTime @default(now())

  // NUEVO
  conjunto     Conjunto @relation(fields: [conjuntoId], references: [id])
  conjuntoId   String

  packages     Package[]
  resetTokens  PasswordResetToken[]
  comentarios  Comentario[]
  bonos        Bono[]

  // NUEVO — índice de tenant. Solo el compuesto: Postgres usa su primera columna
  // (conjuntoId) para las consultas que filtran solo por conjuntoId, así que un
  // @@index([conjuntoId]) suelto sería redundante. Acelera además
  // findMany({where:{conjuntoId, role}}) (checkin, createPrealert).
  @@index([conjuntoId, role])
}

model Package {
  id          String @id @default(cuid())
  residente   User   @relation(fields: [residenteId], references: [id])
  residenteId String

  // NUEVO
  conjunto    Conjunto @relation(fields: [conjuntoId], references: [id])
  conjuntoId  String

  proveedor                String
  guia                     String  @default("Sin Guía")
  pinProveedor             String?
  categoriaPeso            String  @default("ESTANDAR")
  costoServicio            Int     @default(4500)
  fotoUrl                  String?
  esContraEntregaProveedor Boolean @default(false)
  valorProductoProveedor   Int     @default(0)
  valorDeclarado           Int     @default(0)
  estado               String @default("PREALERTADO")
  franjaHoraria        String?
  metodoPagoServicio   String?
  notas                String?
  pin                  String
  fechaIngreso         DateTime      @default(now())
  fechaEntrega         DateTime?
  bono                 Bono?         @relation(fields: [bonoId], references: [id])
  bonoId               String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // NUEVO — índice de tenant. Solo el compuesto (mismo criterio que User): su
  // primera columna cubre el filtro solo por conjuntoId, así que no se agrega un
  // @@index([conjuntoId]) suelto. Acelera los listados por estado del conjunto.
  @@index([conjuntoId, estado])
}
```

`email` permanece `@unique` **global**, sin cambios, conforme a la nota de identificación de residentes
acordada en `requirements.md`.

### 1.3. ¿`Bono` y `Comentario` necesitan `conjuntoId` directo?

**Decisión: sí, se agrega `conjuntoId` directo también a `Bono` y `Comentario`** (denormalizado),
aunque su conjunto sea derivable vía `residenteId → User.conjuntoId`.

**Justificación:**

- El mecanismo de aislamiento estructural (§2) inyecta `where: { conjuntoId }` a nivel de modelo. Para
  que ese mecanismo cubra `Bono` y `Comentario` de forma uniforme y barata (sin un `join`/subconsulta
  a `User` en cada query), lo más simple y robusto es que esos modelos tengan la columna directa.
- Evita que la extensión de Prisma tenga que tratar unos modelos "con columna" y otros "vía relación",
  lo que sería justo el tipo de caso especial propenso a olvidos que la spec quiere eliminar.
- El costo es una columna redundante mantenida en la creación (el `conjuntoId` se toma **siempre** del
  contexto de tenant, igual que en `User`/`Package`), aceptable dado el volumen (cientos de apartamentos,
  pocos conjuntos). La consistencia se protege porque la escritura del `conjuntoId` la fija la extensión
  desde el contexto, **nunca** desde un valor del llamador, sin excepción de ruta (§2.3).

```prisma
model Bono {
  id            String   @id @default(cuid())
  residente     User     @relation(fields: [residenteId], references: [id])
  residenteId   String
  conjunto      Conjunto @relation(fields: [conjuntoId], references: [id])   // NUEVO
  conjuntoId    String                                                       // NUEVO
  categoriaPeso String
  cantidadTotal Int
  cantidadUsada Int      @default(0)
  precioPagado  Int
  createdAt     DateTime @default(now())
  paquetes      Package[]

  @@index([conjuntoId])                                                      // NUEVO
}

model Comentario {
  id          String   @id @default(cuid())
  residente   User     @relation(fields: [residenteId], references: [id])
  residenteId String
  conjunto    Conjunto @relation(fields: [conjuntoId], references: [id])     // NUEVO
  conjuntoId  String                                                         // NUEVO
  mensaje     String
  createdAt   DateTime @default(now())

  @@index([conjuntoId])                                                      // NUEVO
}
```

> Requiere agregar las relaciones inversas `bonos Bono[]` y `comentarios Comentario[]` en `Conjunto` si
> se desea navegación desde el conjunto (opcional; no imprescindible para el aislamiento).

### 1.4. `PasswordResetToken` — sin `conjuntoId`

No lleva `conjuntoId`: cuelga de `User` (`userId`) y se busca siempre por token/usuario concretos, nunca
por barrido global entre residentes. Su conjunto es irrelevante para el aislamiento porque el token ya es
un secreto de un usuario específico. Se deja fuera del alcance de la extensión de tenant.

### 1.5. Modelos con tenant vs. sin tenant (contrato para la extensión)

| Modelo | ¿`conjuntoId`? | ¿Cubierto por la extensión de tenant? |
|---|---|---|
| `Conjunto` | — (es el tenant) | No (es la tabla raíz; se accede por `id`/`slug`/`codigoInvitacion`) |
| `User` | Sí (directo) | Sí |
| `Package` | Sí (directo) | Sí |
| `Bono` | Sí (directo, §1.3) | Sí |
| `Comentario` | Sí (directo, §1.3) | Sí |
| `PasswordResetToken` | No (§1.4) | No |

Esta tabla es el **contrato explícito** que consume la extensión: la lista de modelos "con tenant" vive
en un solo lugar del código (una constante), de modo que agregar un modelo nuevo obliga a decidir
conscientemente si entra o no en el aislamiento.

---

## 2. Mecanismo de aislamiento estructural elegido

### 2.1. Objetivo

Que sea **imposible por construcción** que una consulta a un modelo con tenant devuelva o escriba datos
de un conjunto distinto al activo, aun si el desarrollador olvida el `where: { conjuntoId }`. No basta
con filtrar en cada controlador (eso es "discrecional" y ya falló: `createPrealert`, `checkin`, etc.).

### 2.2. Alternativas evaluadas

| Alternativa | Cómo aísla | Por qué se descarta / se elige |
|---|---|---|
| **A. Filtrado manual en cada query** (statu quo) | El dev escribe `where:{conjuntoId}` en cada consulta | ❌ Discrecional. Es exactamente lo que la spec prohíbe: un olvido cruza datos. Es la causa raíz de los bugs actuales. |
| **B. Row-Level Security (RLS) de Postgres** | La BD filtra por una variable de sesión (`SET app.conjunto_id`) | Aísla de forma muy fuerte y a nivel de motor. Pero: Prisma no gestiona `SET` de sesión de forma nativa y confiable sobre su pool; requiere `SET` por transacción y control fino del pooling; añade complejidad operativa (políticas SQL fuera del esquema Prisma) desproporcionada para el volumen actual. Se documenta como opción futura si crece el número de conjuntos/superficie de riesgo. |
| **C. Prisma Client Extension (`$extends` con `query`) + contexto por petición** | Un interceptor a nivel de cliente inyecta `where:{conjuntoId}` y fuerza `conjuntoId` en escrituras, leyendo el conjunto activo de un `AsyncLocalStorage` fijado por middleware | ✅ **Elegida.** Usa exactamente lo que ya usamos (Prisma + Express + JWT). El filtro es automático y central; el olvido en un controlador queda cubierto. No requiere SQL fuera de Prisma. |
| **D. Múltiples PrismaClient (uno "scoped" por conjunto)** | Se instancia/parametriza un cliente por request | Prisma no soporta bien un cliente parametrizado por tenant sobre BD compartida sin duplicar pools; peor rendimiento y más estado. Innecesario frente a C. |

**Elección: C (extensión de Prisma + middleware de tenant), con RLS (B) anotado como refuerzo futuro
opcional.** C cumple el requisito estructural con la pila actual; RLS quedaría como "defensa en
profundidad" si algún día se justifica.

### 2.3. Diseño de C

**Componentes:**

1. **Contexto de tenant por petición — `AsyncLocalStorage`.**
   Un módulo `tenantContext.js` expone un `AsyncLocalStorage` cuyo valor es una unión discriminada por
   un campo `scope`:
   - **`{ scope: 'TENANT', conjuntoId: string, role: string }`** — el caso normal: hay un conjunto
     activo y la extensión filtra/fuerza por él.
   - **`{ scope: 'GLOBAL_LOOKUP' }`** — un contexto especial, **explícito y nombrado**, para las
     lecturas pre-tenant de autenticación (ver §2.3.1). No lleva `conjuntoId`.

   Todo el manejo de una request autenticada corre dentro de
   `als.run({ scope: 'TENANT', conjuntoId, role }, next)`, de modo que cualquier código (controladores,
   servicios) puede leer el conjunto activo sin pasarlo por parámetro.

   **Regla de la extensión respecto al scope (crítica):**
   - `scope === 'TENANT'` → filtra/fuerza por `conjuntoId` (comportamiento normal).
   - `scope === 'GLOBAL_LOOKUP'` → la extensión **no** inyecta filtro **solo** para esa operación; es una
     exención documentada y visible en el call site.
   - **Contexto ausente** (sin `als.run`) → **lanza (falla cerrado)**. La ausencia de contexto **nunca**
     se interpreta como permiso para leer sin filtro; solo un `scope: 'GLOBAL_LOOKUP'` explícito exime.

   **Regla del `await` DENTRO de `run()` (crítica).** Las consultas de Prisma son `PrismaPromise`
   **perezosas**: la query se ejecuta en su `.then()`, no cuando se crea el objeto. Por eso el callback
   de `als.run(...)` **debe** hacer el `await` de la consulta **dentro** del `run` (los helpers lo
   encapsulan como `run(ctx, async () => await fn())`). Si el callback devolviera la `PrismaPromise` sin
   `await`, `run()` terminaría y el `AsyncLocalStorage` **cerraría el contexto antes** de que la query se
   ejecute; al resolverse fuera, la extensión no vería contexto y **lanzaría** (falla cerrado). Esta regla
   vive en los helpers (`runWithTenant`, `buscarUsuarioPorEmailSinTenant`), **no** en cada call site, para
   que ningún llamador tenga que recordarla. Una prueba de regresión con un *thenable perezoso* la cubre
   sin necesidad de Postgres.

2. **Middleware de tenant (Express) — se ejecuta después del middleware de auth JWT.**
   - Lee el `sub` (subject) del JWT ya verificado.
   - Resuelve `conjuntoId` **cargando el `User` por `sub` contra la BD, SIEMPRE** (ver §3.6). El JWT
     **no** trae claim de conjunto; `User.conjuntoId` es la única fuente de verdad. **Nunca** se toma de
     query/body/headers ni de ningún claim del token (R1.3).
   - Si no hay `conjuntoId` resoluble para una ruta que toca datos con tenant → responde `401/403` y
     **no** continúa (R1.5). No existe "modo sin tenant" para esas rutas.
   - Abre el `AsyncLocalStorage` con `{ conjuntoId, role }` para el resto de la cadena.

3. **Extensión de Prisma — `prisma.$extends({ query: { ... } })`.**
   Se aplica a los modelos de la lista "con tenant" (§1.5). Para cada operación:
   - **Operaciones con `WhereInput`** (`findMany`, `findFirst`, `findFirstOrThrow`, `count`, `aggregate`,
     `groupBy`, `updateMany`, `deleteMany`): inyecta `where: { AND: [ argsWhere, { conjuntoId: activo } ] }`.
     Si no hay conjunto activo, **lanza error** (falla cerrado, nunca abre a todos los conjuntos).
   - **Operaciones con `WhereUniqueInput`** (`findUnique`, `findUniqueOrThrow`, `update`, `delete`,
     `upsert`): el `conjuntoId` se combina en el **primer nivel** del `where` (`{ ...where, conjuntoId }`),
     **no** con `AND` — ver §2.3.1. Si el `where` ya trae un `conjuntoId` distinto del contexto, **lanza**.
   - **Escrituras de creación** (`create`, `createMany`): fuerza `data.conjuntoId = activo`, tomándolo
     **exclusivamente del contexto** (`AsyncLocalStorage`). Si no hay contexto activo → **lanza error**
     (falla cerrado); nunca acepta un `conjuntoId` provisto por el llamador como sustituto del contexto.
     Si además el llamador pasó un `conjuntoId` en `data`, la extensión lo **rechaza** (nunca lo usa para
     decidir el tenant): el valor del llamador jamás puede fijar ni suplir el tenant, en ninguna ruta
     (R1.2). En `update`/`updateMany`/`upsert` se fuerza igualmente el `conjuntoId` en `data`/`create`/
     `update`.

**Bootstrap del tenant con `$queryRaw` (consultas crudas — invariante).** El propio middleware necesita
leer `User.conjuntoId` por `sub` para *abrir* el contexto, pero `User` está bajo la extensión, que exige
contexto que aún no existe (problema huevo-y-gallina). Se resuelve con una consulta **cruda**
parametrizada — `prisma.$queryRaw(Prisma.sql\`SELECT "conjuntoId" FROM "User" WHERE "id" = ${id}\`)` —
encapsulada en la función `resolverConjuntoIdPorUsuario()` (módulo `config/tenantBootstrap.js`). Las
consultas crudas **no** atraviesan la capa de modelos de la extensión, así que no disparan el
falla-cerrado; siguen usando el **único** cliente extendido (no un segundo cliente); y leen una sola
columna por PK con parámetro ligado (sin inyección).

> **INVARIANTE (checklist §8.1):** `$queryRaw`, `$executeRaw`, `$queryRawUnsafe` y `$executeRawUnsafe`
> aparecen **solo** dentro de `resolverConjuntoIdPorUsuario()`. Cualquier otra consulta cruda sería una
> vía **sin aislamiento** y está prohibida. Es auditable por búsqueda de texto.

#### 2.3.1. `findUnique({ where: { id } })`: filtro en el primer nivel, sin reescritura

**Problema.** El patrón más usado en el código es `findUnique({ where: { id } })` (en `getFoto`,
`schedule`, `checkin` —dos veces—, y varios puntos de `auth.controller.js` / `bonos.controller.js`). Hay
que añadirle el filtro de conjunto sin romper la firma de Prisma.

**Premisa corregida (revisión de Fase B).** Una versión anterior de este diseño afirmaba que Prisma "no
permite añadir `conjuntoId` al `where` de un `findUnique`" y proponía **reescribir `findUnique` →
`findFirst`**. Eso era **incorrecto**: desde **Prisma 5.0**, un `WhereUniqueInput` admite campos **no
únicos** en el mismo nivel, siempre que también esté presente al menos un identificador único. Por tanto
`findUnique({ where: { id, conjuntoId } })` es válido y devuelve `null` si el conjunto no coincide, **sin
reescribir la operación**. La reescritura a `findFirst` se **eliminó**.

**Regla implementada.** La extensión combina el conjunto según el tipo de `where`:

- **`WhereUniqueInput`** (`findUnique`, `findUniqueOrThrow`, `update`, `delete`, `upsert`): el
  `conjuntoId` va en el **primer nivel**, con *spread* — `{ ...where, conjuntoId }`. **Nunca** con `AND`:
  Prisma exige que el campo único esté en el primer nivel del `WhereUniqueInput`, así que un `AND` aquí
  provocaría un error de validación (esto era el bug de `package.update({ where: { id } })` de
  `checkin`/`schedule` y de `bono.update`).
- **`WhereInput`** (`findMany`, `findFirst`, `count`, `aggregate`, `groupBy`, `updateMany`, `deleteMany`):
  el conjunto va con **`AND`** — `{ AND: [ argsWhere, { conjuntoId } ] }` — para no pisar las condiciones
  del llamador.

En ambos casos, si el `where` del llamador ya trae un `conjuntoId` **distinto** del contexto, la extensión
**lanza** (el llamador nunca decide el tenant). Si no hay contexto, **lanza** (falla cerrado).

**Efecto en las funciones reales citadas:** `getFoto`, `schedule`, `checkin` (las dos lecturas por `id`)
y los `findUnique` por `id` de `auth.controller.js` / `bonos.controller.js` quedan **cubiertos
automáticamente y sin cambiar su código**: solo devuelven/actualizan el registro si pertenece al conjunto
activo; si el `id` es de otro conjunto, obtienen `null` (o el `update` no encuentra la fila y Prisma lanza
`P2025`), sin fuga entre conjuntos. Solo hace falta que la llamada corra dentro del contexto de tenant (lo
garantiza el middleware, §2.3).

> **Nota `findUnique` por otras claves únicas (p. ej. `email`).** Con contexto de tenant, un
> `findUnique({ where: { email } })` sobre `User` pasa a `{ where: { email, conjuntoId: activo } }`; como
> `email` es `@unique` **global**, dentro de una request autenticada solo encuentra al usuario si está en
> el conjunto activo — coherente con el aislamiento. La búsqueda de `Conjunto` por `codigoInvitacion`
> **no** se ve afectada porque `Conjunto` no es modelo con tenant (§2.3, exención estructural). Los
> lookups por `email` **sin** sesión (login, forgotPassword) usan `GLOBAL_LOOKUP` — ver §3.6.
>
> **Caso límite del login (`findUnique({ where: { email } })` sin conjunto activo).** El `login` busca al
> usuario por email **antes** de que exista JWT y, por tanto, sin un conjunto activo — igual que el
> registro busca el `Conjunto`. Si la reescritura exigiera `conjuntoId` aquí, el login **lanzaría** y
> quedaría roto. El login es una ruta **pre-tenant que descubre el tenant a partir de la credencial**:
> 1. resuelve el usuario por `email`,
> 2. verifica la contraseña,
> 3. emite el JWT con el `conjuntoId` **del usuario encontrado** (§3.6).
>
> **Cómo se exime el paso 1 — con un scope explícito dentro del ÚNICO cliente extendido, no con un
> segundo cliente.** `login` envuelve exclusivamente esa consulta en
> `AsyncLocalStorage.run({ scope: 'GLOBAL_LOOKUP' }, () => prisma.user.findUnique({ where: { email } }))`.
> La extensión reconoce `GLOBAL_LOOKUP` como **exención documentada y puntual** y no inyecta filtro para
> esa lectura. Fuera de ese `run`, todo sigue igual: sin contexto → falla cerrado.
>
> **Por qué un scope y NO un segundo `PrismaClient` sin extensión.** Un cliente base no extendido sería un
> objeto peligroso latente: cualquier código futuro que lo importe por error **pierde el aislamiento por
> completo y en silencio**, sin ningún error — lo contrario del falla-cerrado. El scope, en cambio:
> - mantiene **un solo cliente** (el extendido), imposible de eludir por un import equivocado;
> - hace la exención **visible y deliberada en cada call site** (`{ scope: 'GLOBAL_LOOKUP' }`), no una
>   propiedad invisible de un objeto;
> - conserva el falla-cerrado como estado por defecto: **la ausencia de contexto nunca se interpreta como
>   permiso**; solo el scope explícito exime, y solo para la consulta que envuelve.
>
> El uso de `GLOBAL_LOOKUP` queda restringido por convención/documentación a las lecturas pre-tenant de
> autenticación (`login` por email). Toda aparición de `GLOBAL_LOOKUP` es fácilmente auditable por
> búsqueda de texto, precisamente por ser explícita.
>
> **Punto de entrada único (invariante de implementación).** La apertura del scope `GLOBAL_LOOKUP` vive
> en **una sola función con nombre propio** —p. ej. `buscarUsuarioPorEmailSinTenant(email)`—, que es la
> **única** en todo el código autorizada a invocar `AsyncLocalStorage.run({ scope: 'GLOBAL_LOOKUP' }, ...)`.
> `login()` (y cualquier otro flujo pre-tenant legítimo) **debe** llamar a esa función; **ninguna** otra
> parte del código puede abrir el scope directamente. Así, auditar el aislamiento se reduce a comprobar
> que `AsyncLocalStorage.run({ scope: 'GLOBAL_LOOKUP' }` aparece **exactamente una vez** en el repositorio
> (dentro de esa función). Esta restricción **debe reflejarse como criterio explícito en la tarea de
> `tasks.md`** que implemente el scope en `login()`.
>
> *(La resolución de `Conjunto` por `codigoInvitacion` en `register` no necesita `GLOBAL_LOOKUP`: está
> exenta estructuralmente por no ser modelo con tenant, §2.3.)*

**Falla cerrado:** si el contexto de tenant está ausente cuando se toca un modelo con tenant, la
extensión **lanza**; nunca degrada a "sin filtro". Esto convierte cualquier olvido en un error visible
en desarrollo/pruebas, no en una fuga silenciosa.

**El modelo `Conjunto` queda exento del fallo cerrado, y NO por una excepción especial.** La razón es
estructural, no una lista blanca en el middleware: la extensión solo interviene los modelos de la lista
"con tenant" (§1.5), y `Conjunto` **no está en ella porque no tiene columna `conjuntoId` propia** (es la
tabla raíz del tenant, no una tabla perteneciente a un tenant). Por tanto, cualquier consulta a
`Conjunto` —incluida la búsqueda por `codigoInvitacion` en `register()`— **ni pasa por el interceptor ni
requiere contexto de tenant**, y no dispara el fallo cerrado. Esto es lo que permite que el registro
funcione **antes** de que exista contexto de tenant (usuario anónimo). Consecuencia de diseño: la
constante que enumera los modelos con tenant **no debe incluir `Conjunto`**; hacerlo sería el error que
rompería el registro, por lo que se documenta aquí como invariante.

> **Sobre `PasswordResetToken`:** también está fuera de la extensión (§1.4), pero por un motivo distinto
> —lleva sus propios secretos por usuario y se accede por token/`userId`, no por barrido—, no por ser
> tabla raíz. La exención de `Conjunto` es específicamente la de "tabla sin `conjuntoId`".

### 2.4. Cómo esto corrige los tres bugs conocidos (R1.6, R1.7, R1.8)

- **`createPrealert`** — hoy `prisma.user.findFirst({ where: { role: 'OPERATOR' } })` devuelve el
  primer operador de **toda** la tabla. Con la extensión, esa misma consulta se resuelve como
  `findFirst({ where: { role: 'OPERATOR', conjuntoId: <activo> } })` automáticamente → notifica al
  operador **del conjunto del residente**. (El "conjunto activo" en un prealerta creado por un residente
  es el del propio residente autenticado.)
- **`checkin` → `apartamento.service.js`** — hoy `prisma.user.findMany({ where: { role: 'RESIDENT' } })`
  barre todos los residentes de todos los conjuntos; con torre/apto no únicos entre conjuntos, la clave
  de apartamento podía colisionar. Con la extensión, la búsqueda queda acotada a
  `{ role: 'RESIDENT', conjuntoId: <activo> }` sin que `checkin` ni el servicio tengan que recordar el
  filtro → la cortesía de primera entrega no se cruza entre conjuntos.
- **`listAll` / `exportCsv` / bonos / comentarios** — todas sus lecturas/escrituras quedan filtradas por
  el conjunto activo del operador automáticamente.

### 2.5. Preservación del patrón de fotos (R1.9)

La exclusión de `fotoUrl` en `GET /packages` y `GET /packages/mine` es **ortogonal** al aislamiento: la
extensión de tenant solo añade el filtro `conjuntoId`, no altera la proyección (`select`). El patrón
actual (usar `select` sin `fotoUrl`, o borrar el campo en el serializador de esos dos endpoints) **se
mantiene tal cual**. En el diseño se deja explícito: al tocar `listAll`/`mine` para el tenant, **no** se
debe añadir `fotoUrl` al `select`; el resto de endpoints que ya devuelven `fotoUrl` (p. ej. detalle
individual) no cambian su comportamiento respecto a fotos.

---

## 3. Diseño del código de invitación por conjunto

### 3.1. Formato del código

- **Token opaco, no secuencial, no adivinable.** Se genera con aleatoriedad criptográfica
  (`crypto.randomBytes`) y se codifica en base32/base62 sin caracteres ambiguos, longitud ~10–12
  caracteres (p. ej. `ipa-K7Q2M9XR4T`). Se guarda en `Conjunto.codigoInvitacion` (`@unique`).
- Se acompaña de `slug` legible para URLs de soporte, pero **el slug no sirve para registrar**: registrar
  requiere el `codigoInvitacion` opaco. Así, conocer el nombre del conjunto no permite auto-inscribirse.

### 3.2. Dónde se genera

- Al **crear un conjunto** (incluida la creación de Ipanema en el backfill, §5): el backend genera el
  `codigoInvitacion` y lo persiste. No se genera en el cliente.
- **Revocación/regeneración** (R3.7): se puede poner `invitacionActiva = false` y/o generar un
  `codigoInvitacion` nuevo. Los residentes ya registrados **no se ven afectados** (su `conjuntoId` ya
  está fijado; el código solo se usa en el momento del registro).

### 3.3. Formato del enlace/QR

- Ruta de registro con el código embebido. Dos formas equivalentes, se elige **query param** por
  simplicidad de enrutado en la PWA:
  - `https://<frontend>/registro?c=<codigoInvitacion>`
  - (Alternativa de ruta: `/registro/<codigoInvitacion>` — equivalente; se documenta pero se prefiere la
    query.)
- El QR que reparte el operador codifica esa URL completa.

### 3.4. Validación en el flujo de registro

**Frontend:** al abrir `/registro?c=...`, guarda el código y lo envía en el body de `register`. Si no hay
código, muestra estado de "enlace de invitación requerido" y no permite continuar (refuerzo UX; la
autoridad es el backend).

**Backend — `register()` en `auth.controller.js`:**

1. Extrae `codigoInvitacion` del body.
2. **IF** ausente → `400` "Se requiere un enlace de invitación válido"; **no** crea usuario (R3.4).
3. Busca `Conjunto` por `codigoInvitacion`.
   - **IF** no existe o `invitacionActiva === false` → `400/410` "Enlace de invitación inválido o
     vencido"; **no** crea usuario (R3.3).
4. **IF** válido → **abre el contexto de tenant** con el conjunto recién validado y crea el `User`
   **dentro** de ese contexto:
   ```
   AsyncLocalStorage.run({ conjuntoId: conjunto.id, role: 'RESIDENT' }, async () => {
     await prisma.user.create({ data: { ...datosDelResidente, role: 'RESIDENT' } });
     // NO se pasa conjuntoId en data: lo inyecta la extensión desde el contexto.
   });
   ```
   El `create` del `User` **depende del contexto igual que cualquier otra escritura**: no recibe
   `conjuntoId` en `data`; la extensión lo toma del `AsyncLocalStorage` que `register` acaba de abrir. Así
   `register` no es una excepción a la regla de escritura — es simplemente el punto donde el contexto se
   establece a partir del código validado en lugar de a partir del JWT.

> **Nota importante sobre `register` y la extensión:** el registro es un caso especial solo en **cómo se
> origina el tenant**: ocurre **sin** JWT (usuario anónimo), así que el `conjuntoId` no puede venir del
> token. Pero la escritura del `User` **no** es una excepción: el conjunto se resuelve de forma
> **controlada** (validando un `codigoInvitacion` opaco contra la BD, no un `conjuntoId` arbitrario del
> cliente) y luego se **inyecta en el contexto** mediante `AsyncLocalStorage.run(...)`. A partir de ahí,
> el `create` del `User` obtiene su `conjuntoId` del contexto exactamente igual que cualquier escritura
> autenticada. `register` **establece** el tenant (abriendo el contexto), no lo asume ni lo pasa por
> `data`.
>
> **Confirmación explícita (fallo cerrado):** hay dos operaciones distintas y ninguna abre una puerta
> trasera:
> 1. La consulta `findUnique/findFirst` que busca el `Conjunto` por `codigoInvitacion` corre **antes** de
>    abrir el contexto y **queda exenta del fallo cerrado** — pero por razón **estructural, no por una
>    excepción del middleware**: `Conjunto` no lleva `conjuntoId` propio, así que no está en la lista de
>    modelos interceptados (§1.5, §2.3) y la extensión ni siquiera la mira.
> 2. El `create` del `User` **sí** es un modelo con tenant y **sí** está sujeto al fallo cerrado: por eso
>    `register` **debe** ejecutarlo dentro de `AsyncLocalStorage.run(...)`. Si por error lo ejecutara sin
>    contexto, la extensión **lanzaría** (no crearía el usuario sin tenant). La extensión **nunca** acepta
>    un `conjuntoId` explícito en `data` como sustituto del contexto —en `register` ni en ninguna otra
>    ruta—, de modo que no existe forma de saltarse el contexto pasando el valor a mano.
>
> No hace falta ninguna lista blanca de rutas ni desactivar la extensión para `register`.

### 3.5. Qué pasa con códigos inválidos/vencidos (resumen)

| Situación | Respuesta | Efecto |
|---|---|---|
| Sin código | `400` | No se crea usuario |
| Código inexistente/malformado | `400` | No se crea usuario |
| Código de conjunto con `invitacionActiva=false` | `410` (o `400`) | No se crea usuario |
| Código válido y activo | `201` | Usuario creado con `conjuntoId` del conjunto |

### 3.6. Resolución del conjunto activo: SIEMPRE por `sub` contra la BD

- **El middleware de tenant resuelve el `conjuntoId` activo cargando el `User` por `sub` (el subject del
  JWT) contra la BD en cada request — SIEMPRE, sin excepción, independientemente de si el token trae o no
  algún claim de conjunto.** No hay dos caminos ("confiar en el claim si está / caer a BD si falta"): hay
  **un solo camino**, la BD.
- **El JWT NO incluye `conjuntoId` como claim.** El token lleva `sub` y `role`; el conjunto **no** se
  firma. Motivo: un `conjuntoId` firmado sería un dato cacheado con TTL de hasta 8h (`JWT_EXPIRES_IN`)
  que podría **divergir silenciosamente** de `User.conjuntoId` si algún día se reasigna un usuario de
  conjunto — y encima en una decisión de autorización. Al leer siempre de la BD, `User.conjuntoId` es la
  **única fuente de verdad** y no puede quedar obsoleto respecto a un claim.
- **Falla cerrado:** si el `User` cargado por `sub` no existe o su `conjuntoId` es `null`/no resoluble, el
  middleware **rechaza** la petición (`401`), nunca opera sin tenant. (Tras el backfill —§5.2, Fase 4—
  todo `User` legítimo tiene `conjuntoId` NOT NULL, así que esto solo dispara ante datos inconsistentes o
  usuarios inexistentes.)
- **Costo:** una lectura de `User` por PK por request autenticada. Es aceptable para el volumen actual
  (un operador, cientos de residentes, pocos conjuntos) y puede cachearse por-request si hiciera falta;
  no se optimiza prematuramente. El beneficio (imposibilidad de divergencia claim↔BD) supera el costo.

> **Nota sobre `login`/`register` y el JWT:** siguen emitiendo el token normalmente, pero **sin** el claim
> de conjunto. El `conjuntoId` se descubre en el momento del login (para nada más que registrar la
> sesión) y en cada request posterior se relee de la BD por `sub`. Quitar el claim evita la pregunta
> futura "¿por qué existe este claim si nadie lo lee para autorizar?".

### 3.6.1. Corte a producción y JWT de 8h ya emitidos

- `JWT_EXPIRES_IN` permite sesiones de hasta ~8h. En el instante del corte, el operador con sesión activa
  (Francisco) porta un token emitido antes del despliegue.
- **Como el middleware SIEMPRE resuelve el conjunto por `sub` contra la BD (§3.6) y nunca dependió de un
  claim de conjunto, ese token pre-corte funciona sin cambios:** el middleware lo carga por `sub`,
  encuentra su `conjuntoId` ya backfilleado (F2/F3 corren antes del deploy) y opera con normalidad. **No
  se fuerza re-login y no se requiere acción del operador.** El hecho de que el token viejo no tuviera
  claim de conjunto es irrelevante, porque el nuevo tampoco lo tiene ni lo usa.
- **Fallback (solo si se decidiera invalidar sesiones pre-corte por otro motivo):** rotar el secreto de
  firma del JWT (o usar `tokenVersion`/`notBefore`) justo antes del deploy y **avisar a Francisco de que
  debe volver a iniciar sesión inmediatamente después del despliegue** (sus credenciales no cambian). Es
  un paso operativo explícito, no un flag de runtime. Con el diseño de §3.6 este fallback **no es
  necesario** para la corrección; se documenta solo como opción operativa.
- **La activación del aislamiento es orden de despliegue, no un flag:** el código con falla-cerrado no
  llega a producción hasta que el backfill está verificado (§5.2, Fase 4); no existe interruptor de
  ejecución que active/desactive el aislamiento, para no reintroducir un "olvido silencioso".

### 3.6.2. Flujos SIN sesión y cómo resuelve cada uno el conjunto

Todo endpoint que toca un modelo con tenant **antes** de que exista un JWT válido es un "flujo sin
sesión": no puede depender del middleware de tenant. Estos son todos, y cómo resuelve cada uno el
conjunto sin abrir agujeros en el aislamiento:

| Flujo | Toca modelo con tenant | Cómo resuelve el conjunto |
|---|---|---|
| **`register`** | `User.create` | Valida el `codigoInvitacion` → resuelve `Conjunto` (modelo **sin** tenant, exento) → abre `runWithTenant({ conjuntoId })` y crea el `User` dentro. El conjunto viene del código, no de `data`. (§3.4) |
| **`login`** | `User.findUnique({ email })` | Lookup pre-tenant vía **`buscarUsuarioPorEmailSinTenant()`** (único punto que abre `GLOBAL_LOOKUP`). Tras verificar contraseña, emite el JWT (§3.6). |
| **`forgotPassword`** | `User.findUnique({ email })` | Igual que login: **`buscarUsuarioPorEmailSinTenant()`**. Los `PasswordResetToken` que crea/consulta son de un modelo **sin** tenant (no requieren contexto). |
| **`resetPassword`** | `User.update` | El `PasswordResetToken.findFirst` (sin tenant) resuelve el `record`; luego **`resolverConjuntoIdPorUsuario(record.userId)`** (bootstrap `$queryRaw`) da el conjunto y el `user.update` corre dentro de `runWithTenant`. Si no hay conjunto resoluble → **400**. |

Notas transversales:
- **`GLOBAL_LOOKUP`** se abre **solo** dentro de `buscarUsuarioPorEmailSinTenant()` (login y
  forgotPassword la invocan; nadie más abre el scope). Invariante §2.3.1.
- **`resolverConjuntoIdPorUsuario()`** (bootstrap `$queryRaw`) la usan el **middleware de tenant** y
  **resetPassword**. Invariante de consultas crudas: §2.3 (bootstrap).
- **`Conjunto`** (resolución por `codigoInvitacion` en register) queda exento por ser tabla raíz sin
  `conjuntoId`, no por un scope especial.
- **`prisma/seed.js`** (creación de la cuenta de operador) es también un flujo sin sesión que toca
  `User` sin contexto. **Corregido** (revisión de Fase B): crea/reutiliza un `Conjunto` local por slug,
  genera su `codigoInvitacion`, resuelve el operador con `buscarUsuarioPorEmailSinTenant()` y lo crea
  dentro de `runWithTenant({ conjuntoId, role: 'OPERATOR' })`. Es idempotente.

---

## 4. Configuración por conjunto: dónde vive y cómo se consume

### 4.1. Dónde vive

Toda la configuración vive en columnas de `Conjunto` (§1.1): identidad (`nombre`, `slug`), tarifas
(`tarifaMano/Estandar/Volumen/Pesado`), contacto del operador (`operadorNombre`, `operadorWhatsapp`,
`operadorDomicilio`, `puntoRecepcion`) y flags (`bonosHabilitados`).

### 4.2. Cómo la consume el backend

- **Tarifas.** `services/tariff.service.js` deja de exportar una constante fija como fuente de verdad.
  En su lugar expone una función que recibe el conjunto activo y devuelve el mapa de tarifas
  `{ MANO, ESTANDAR, VOLUMEN, PESADO }` desde las columnas del `Conjunto`. La constante `TARIFAS` actual
  se conserva únicamente como **valores por defecto** documentados (R2.3), que además coinciden con los
  `@default(...)` del esquema. El cálculo de `costoServicio` usa las tarifas del conjunto del residente.
- **Flag de bonos.** `bonosHabilitados` se lee del `Conjunto` activo. Reemplaza el uso global de
  `BONOS_HABILITADOS` para las decisiones por-conjunto; por defecto `false` para conjuntos nuevos
  (R2.6). (Si existe además una env var global, se documenta que el flag por conjunto es el que manda a
  nivel de negocio; la env var puede quedar como interruptor maestro.)
- **Contacto/identidad.** Los controladores que hoy dependían de datos fijos de Ipanema los toman del
  `Conjunto` activo.

### 4.3. Cómo la consume el frontend

- Se expone un endpoint público de solo lectura para la configuración **presentacional** de un conjunto,
  resuelto por `slug` o por el código de invitación durante el registro, p. ej.:
  `GET /conjuntos/:slug/config-publica` → `{ nombre, operadorNombre, operadorWhatsapp,
  operadorDomicilio, puntoRecepcion }`.
  - Devuelve **solo** campos presentacionales; **no** expone tarifas internas sensibles ni flags si no
    son necesarios para la vista (principio de mínima exposición).
- **`Terms.jsx`** deja de tener el domicilio y el WhatsApp escritos en el JSX; los renderiza desde esta
  config (obtenida del conjunto correspondiente).
- **WhatsApp (restricción dura).** El frontend construye el enlace manual
  `https://wa.me/<operadorWhatsapp>?text=<mensaje precargado>` usando `operadorWhatsapp` del conjunto.
  **No** se integra Twilio ni WhatsApp Business API.
- Para un usuario autenticado, la config de su propio conjunto puede venir incluida en el bootstrap de la
  sesión (p. ej. un `GET /me` que ya devuelva su conjunto), evitando una llamada extra.

### 4.4. Restricciones preservadas

- Sin pasarela de pagos: la config no incluye credenciales de cobro ni prepara integración de pago
  (R2.7).
- `bonosHabilitados = false` por defecto (R2.6).
- WhatsApp manual `wa.me` (R2.5).

---

## 5. Plan de migración / backfill de Ipanema

> **No se ejecuta en esta spec.** La migración real de esquema se aplicará por **túnel SSH de Railway**
> contra el Postgres de producción (procedimiento operativo no detallado aquí, solo anotado). El plan es
> por fases para que ningún paso intermedio deje datos huérfanos y cada paso tenga reversión.

### 5.1. Principio: columnas nullable → backfill → obligatorio

No se puede agregar `conjuntoId` como `NOT NULL` de golpe sobre tablas con datos existentes. Se hace en
tres fases (migración expand → backfill de datos → migración contract).

### 5.2. Pasos

**Fase 0 — Preparación (reversión: no aplica, solo lectura).**
- Respaldo lógico de la BD de producción (dump) antes de tocar nada. Verificar restauración del dump en
  un entorno de prueba.
- Confirmar que hoy existe exactamente un `OPERATOR` (Ipanema) y contar `User`/`Package`/`Bono`/
  `Comentario` para validar el backfill después.

**Fase 1 — Migración "expand" (agregar estructura nullable).**
1. Crear tabla `Conjunto`.
2. Agregar `conjuntoId` **nullable** a `User`, `Package`, `Bono`, `Comentario` (sin `NOT NULL`, sin FK
   obligatoria todavía o con FK que admita null).
3. Crear los índices de tenant (compuestos en `User`/`Package`; simples en `Bono`/`Comentario`) — pueden crearse en esta fase o tras el
   backfill; crearlos después del backfill masivo suele ser más rápido.
- **Punto de reversión F1:** revertir la migración (drop de columnas nullable y de la tabla `Conjunto`).
  Como las columnas son nullable y aún nadie las usa, el drop es seguro y deja el esquema idéntico al
  previo.

**Fase 2 — Backfill de datos (transaccional).**
Ejecutar dentro de **una transacción** (o un script idempotente que pueda reintentarse):
1. `INSERT` del conjunto "Ipanema" con:
   - `nombre = "Conjunto Residencial Ipanema"`, `slug = "ipanema"`.
   - `codigoInvitacion` generado (opaco), `invitacionActiva = true`.
   - `operadorNombre = "Francisco Caro Yances"`, `operadorWhatsapp`, `operadorDomicilio`,
     `puntoRecepcion` = los valores hoy fijos en `Terms.jsx`.
   - `tarifaMano=3000`, `tarifaEstandar=4500`, `tarifaVolumen=7000`, `tarifaPesado=12000` (los actuales
     de `TARIFAS`).
   - `bonosHabilitados = false`.
   - Guardar el `id` resultante como `IPANEMA_ID`.
2. `UPDATE User   SET conjuntoId = IPANEMA_ID WHERE conjuntoId IS NULL;`
3. `UPDATE Package SET conjuntoId = IPANEMA_ID WHERE conjuntoId IS NULL;`
4. `UPDATE Bono    SET conjuntoId = IPANEMA_ID WHERE conjuntoId IS NULL;`
5. `UPDATE Comentario SET conjuntoId = IPANEMA_ID WHERE conjuntoId IS NULL;`
6. **Verificación dentro de la transacción:** `COUNT(*) WHERE conjuntoId IS NULL` debe ser `0` en las
   cuatro tablas; los conteos totales deben coincidir con los de Fase 0. Si algo no cuadra → `ROLLBACK`.
- **Punto de reversión F2:** si la verificación falla, `ROLLBACK` de la transacción (los `UPDATE` y el
  `INSERT` del conjunto se deshacen). Si se detecta después de commitear, se puede volver a poner
  `conjuntoId = NULL` (la estructura sigue siendo nullable en esta fase) y borrar el conjunto Ipanema.
  Por eso la fase "contract" (NOT NULL) va **separada y después** de verificar.

**Fase 3 — Migración "contract" (endurecer restricciones).**
1. Alterar `conjuntoId` a **`NOT NULL`** en `User`, `Package`, `Bono`, `Comentario`.
2. Asegurar la **FK** `conjuntoId → Conjunto.id` en las cuatro tablas.
3. Crear los índices definitivos si no se crearon antes.
- **Punto de reversión F3:** volver `conjuntoId` a nullable / soltar la FK (migración inversa). Como los
  datos ya están backfilleados y verificados, esta reversión es de bajo riesgo.

**Fase 4 — Activación del aislamiento en la app.**
- Desplegar el middleware de tenant + extensión de Prisma. Solo tiene sentido una vez que **todos** los
  registros tienen `conjuntoId` (fin de Fase 3), para que "falla cerrado" no rompa datos legítimos
  (R4.7).
- **La activación es orden de despliegue, NO un flag de runtime.** El código con falla-cerrado no se
  mergea a `main` ni se despliega hasta que el backfill (Fase 2) y el contract (Fase 3) están verificados.
  No se introduce ninguna env var/flag tipo "aislamiento on/off": un interruptor así reintroduciría el
  "olvido silencioso" (quedaría apagado sin error). El aislamiento está siempre activo en el código que
  llega a producción.
- **JWT de 8h ya emitidos (Francisco):** en el corte, el operador con sesión activa porta un token sin
  `conjuntoId`; la salvaguarda del middleware (§3.6) lo resuelve por `sub` contra la BD ya backfilleada
  (sesión sigue válida). Si en su lugar se opta por invalidar sesiones, se rota el secreto de firma y se
  avisa al operador de que re-inicie sesión tras el deploy (§3.6.1). En ambos casos, una request pre-corte
  nunca opera sin tenant.

### 5.3. Orden y seguridad (resumen)

```
Backup → Expand(nullable) → Backfill(txn + verificación) → Contract(NOT NULL + FK) → Deploy aislamiento
   │            │                     │                              │                       │
 revert      drop cols            ROLLBACK txn                 revert to nullable        rollback deploy
```

Ningún paso intermedio deja datos huérfanos: entre Expand y Contract, `conjuntoId` es nullable y la app
vieja sigue funcionando; el aislamiento se enciende solo al final.

### 5.4. Anotación operativa

> La migración de esquema (Fases 1 y 3) se aplica con las herramientas de migración de Prisma ejecutadas
> **a través del túnel SSH de Railway** contra Postgres de producción. El detalle del procedimiento SSH
> se documentará en `DEPLOY.md` en el commit de implementación; no forma parte de esta spec.

---

## 6. Funciones / endpoints existentes que cambian

> Solo se listan los cambios; **no** se escribe código. La mayoría de los filtros de conjunto los aporta
> automáticamente la extensión de Prisma (§2), por lo que muchos controladores **no** necesitan añadir
> `where:{conjuntoId}` a mano — el cambio principal es garantizar que corren dentro del contexto de
> tenant y, en casos puntuales, resolver el conjunto correcto explícitamente.

### 6.1. Middleware / infraestructura (nuevo)

- **`tenantContext.js` (nuevo):** `AsyncLocalStorage` del conjunto activo.
- **Middleware de tenant (nuevo):** tras el auth JWT, fija `{ conjuntoId, role }` en el contexto o
  rechaza si no hay tenant resoluble (R1.3, R1.5).
- **Extensión de Prisma (nuevo):** inyecta el filtro y fuerza `conjuntoId` en escrituras para los modelos
  con tenant (§1.5); **reescribe `findUnique`/`findUniqueOrThrow` a `findFirst`** con el filtro de tenant
  (§2.3.1); reconoce el contexto discriminado por `scope` (`TENANT` filtra; `GLOBAL_LOOKUP` exime esa
  operación; contexto ausente → falla cerrado). **Un único cliente extendido; no existe un segundo
  cliente sin extensión.**
- **Scope `GLOBAL_LOOKUP` (nuevo, uso restringido):** exención explícita y puntual dentro del **mismo**
  cliente extendido, para las lecturas pre-tenant de autenticación (`login` por `email`). Se aplica
  envolviendo solo esa consulta en `AsyncLocalStorage.run({ scope: 'GLOBAL_LOOKUP' }, ...)`. Prohibido en
  controladores de negocio; auditable por búsqueda de texto. La resolución de `Conjunto` por
  `codigoInvitacion` en `register` **no** lo usa (exención estructural, §2.3).

### 6.2. `packages.controller.js`

- **`createPrealert`** — el `prisma.user.findFirst({ where: { role: 'OPERATOR' } })` pasa a resolverse
  dentro del conjunto activo (el del residente autenticado), corrigiendo la notificación al operador
  equivocado. Con la extensión, la corrección es automática; se verifica que la ejecución ocurre dentro
  del contexto de tenant. (R1.6)
- **`checkin`** — la búsqueda de residentes para la clave de apartamento
  (`prisma.user.findMany({ where: { role: 'RESIDENT' } })`, vía `apartamento.service.js`) queda acotada
  al conjunto activo automáticamente. Se verifica que `checkin` corre dentro del contexto de tenant.
  (R1.7)
- **`listAll`** — su lectura de paquetes queda filtrada por conjunto automáticamente. **Cambio explícito
  a preservar:** el `select` **no** debe incluir `fotoUrl` (patrón vigente de `GET /packages`). (R1.8,
  R1.9)
- **`exportCsv`** — igual que `listAll`: filtrado por conjunto automático; la exportación solo incluye
  paquetes del conjunto activo. (R1.8)
- **Cálculo de `costoServicio`** — pasa a usar las tarifas del `Conjunto` activo en lugar de la constante
  `TARIFAS` (§4.2).
- **`GET /packages/mine`** (handler correspondiente) — sigue devolviendo solo los paquetes del residente
  autenticado, ahora también acotado a su conjunto; **no** incluye `fotoUrl`. (R1.9, R1.10)

### 6.3. `apartamento.service.js`

- La función que calcula la clave de apartamento recibe/consulta residentes **del conjunto activo**. No
  necesita cambiar su firma si lee del contexto de tenant vía la extensión; se documenta que su consulta
  de residentes debe estar cubierta por el aislamiento. (R1.7)

### 6.4. `bonos.controller.js`

- **`listForResident`** — filtrado por conjunto automático; sigue devolviendo los bonos del residente
  indicado, ahora garantizado dentro del conjunto activo.
- **`create`** — la escritura fuerza `conjuntoId = activo` (extensión); además se respeta
  `bonosHabilitados` del `Conjunto` (por defecto `false`), preservando el gate de bonos. (R1.8, R2.6)

### 6.5. `comments.controller.js`

- **`listAll`** — pasa a devolver solo los comentarios del conjunto activo (filtrado automático). (R1.8)
- (Creación de comentarios) — la escritura fuerza `conjuntoId = activo`.

### 6.6. `auth.controller.js`

- **`register`** — acepta y valida `codigoInvitacion`; **abre el contexto de tenant** con
  `AsyncLocalStorage.run({ conjuntoId: conjunto.id, role: 'RESIDENT' }, ...)` y crea el `User` **dentro**
  de ese contexto (sin pasar `conjuntoId` en `data`); rechaza si el código falta/es inválido/está vencido.
  Es una ruta "pre-tenant" que **establece** el tenant a partir del código validado (§3.4). La búsqueda
  del `Conjunto` por `codigoInvitacion` no requiere contexto (exención estructural, §2.3). (R3.1–R3.5)
- **`login`** — es una ruta **pre-tenant que descubre el tenant a partir de la credencial**. Su
  `findUnique({ where: { email } })` se ejecuta con el **único cliente extendido**, envuelta en
  `AsyncLocalStorage.run({ scope: 'GLOBAL_LOOKUP' }, ...)` — exención explícita y puntual, no ausencia de
  contexto (§2.3.1). Esa apertura de scope vive en la **única función autorizada**
  `buscarUsuarioPorEmailSinTenant(email)` (§2.3.1, invariante de punto de entrada único); `login()` la
  invoca en lugar de abrir el scope por su cuenta. Tras verificar la contraseña, emite el JWT con el
  `conjuntoId` del usuario. (R3.6)
- **Emisión de JWT (login y registro)** — el token incluye `conjuntoId` (§3.6). (R3.6)

### 6.7. `services/tariff.service.js`

- Deja de ser la fuente de verdad fija. Expone una función que devuelve las tarifas del `Conjunto`
  activo; conserva los valores actuales solo como defaults documentados (coinciden con los
  `@default(...)` del esquema). (R2.2, R2.3)

### 6.8. Frontend

- **`Terms.jsx`** — deja de tener domicilio y WhatsApp fijos; los renderiza desde la config del conjunto
  (`GET /conjuntos/:slug/config-publica` o el bootstrap de sesión). (R2.4)
- **Flujo de registro** — lee `?c=<codigoInvitacion>` de la URL y lo envía a `register`; muestra estado
  de error si falta o es inválido. (R3.2–R3.4)
- **Construcción del enlace de WhatsApp** — usa `operadorWhatsapp` del conjunto para el `wa.me` manual.
  (R2.5)

### 6.9. Endpoint nuevo (config pública)

- **`GET /conjuntos/:slug/config-publica` (nuevo)** — devuelve solo campos presentacionales del conjunto
  para el frontend (§4.3). No expone datos internos innecesarios.

---

## 7. Trazabilidad requisitos → diseño

| Requisito | Cubierto en |
|---|---|
| R1 (aislamiento estructural, incl. `createPrealert`/`checkin`/`listAll`/`exportCsv`/bonos/comentarios, fotos) | §2 completo, §6.2–§6.5 |
| R2 (configuración por conjunto: tarifas, contacto, bonos, WhatsApp, sin pagos) | §1.1, §4, §6.7, §6.8 |
| R3 (registro con código de invitación; conjunto resuelto por `sub` contra BD, sin claim en JWT) | §3, §3.6, §6.6 |
| R4 (migración/backfill Ipanema, reversible, túnel SSH) | §5 |
| Nota R5 (email `@unique` global sin cambios) | §1.2 |

---

## 8. Notas para el commit de implementación (recordatorio)

- Reflejar en `README.md`/`DEPLOY.md`: nuevo modelo `Conjunto`, mecanismo de aislamiento (middleware +
  extensión Prisma), formato/uso del código de invitación, y el procedimiento de migración por túnel SSH
  de Railway.
- Si en el futuro crece el número de conjuntos o la superficie de riesgo, evaluar RLS de Postgres (§2.2,
  opción B) como defensa en profundidad adicional a la extensión de Prisma.
- El código de prueba, si se genera, va a `develop`; **nunca** a `main`. Esta spec no toca ninguna rama.

### 8.1. Restricciones que `tasks.md` DEBE recoger cuando se genere

> Este documento es solo diseño; **no** se genera `tasks.md` en esta pasada. Cuando se genere, las
> siguientes restricciones de diseño deben quedar como criterios explícitos de las tareas
> correspondientes:
>
> - **Scope `GLOBAL_LOOKUP` con punto de entrada único.** La tarea que implemente el scope en `login()`
>   debe especificar que la apertura de `AsyncLocalStorage.run({ scope: 'GLOBAL_LOOKUP' }, ...)` vive en
>   **una única función con nombre propio** (`buscarUsuarioPorEmailSinTenant()`), que es la **única** de
>   todo el código autorizada a abrir ese scope. Ninguna otra parte del código puede invocar ese `run`
>   directamente; todo pasa por esa función. Criterio de verificación: `GLOBAL_LOOKUP` aparece
>   exactamente una vez en el repositorio (dentro de esa función). (§2.3.1)
> - **Un único cliente Prisma extendido.** No debe existir un segundo `PrismaClient` sin la extensión de
>   tenant. (§2.3.1, §6.1)
> - **Consultas crudas contenidas.** `$queryRaw`, `$executeRaw`, `$queryRawUnsafe` y `$executeRawUnsafe`
>   aparecen **solo** en `resolverConjuntoIdPorUsuario()` (`config/tenantBootstrap.js`); cualquier otra se
>   salta la extensión y sería una vía sin aislamiento. (§2.3 bootstrap)
> - **`WhereUniqueInput` sin `AND`.** El conjunto se combina en el primer nivel del `where` único
>   (`{ ...where, conjuntoId }`); el `AND` es solo para `WhereInput`. No se reescribe `findUnique` a
>   `findFirst`. (§2.3.1)
> - **`fotoUrl`** sigue excluido de `GET /packages` y `GET /packages/mine`. (§2.5)
> - **`BONOS_HABILITADOS`/`bonosHabilitados`** en `false` por defecto para conjuntos nuevos. (§4)
> - **WhatsApp manual `wa.me`**, sin Twilio/WhatsApp Business API. (§4.3)
> - **Sin pasarela de pagos.** (§4.4)
