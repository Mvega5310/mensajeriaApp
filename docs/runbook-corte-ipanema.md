# Runbook — Corte a producción del multi-conjunto (Ipanema) · KAN-8 Fase F

> **Estado: EJECUTADO en producción el 28-oct-2026** (P0 → C5 pasos 1–3), tras
> ensayarlo ese mismo día contra una copia real (§0.3). Resultados y desviaciones
> del corte real en **§6**. **Paso 4 de C5** (carpeta de migración al repo): hecho en la
> rama `refactor/mobile-first` (S0.2, SHA-256 verificado), aún no en `main`. Cualquier ejecución futura de este runbook sigue requiriendo
> aprobación explícita del usuario, paso por paso. El orden y su justificación
> están en [`DEPLOY.md` → "Corte a producción del multi-conjunto"](../DEPLOY.md).

Regla que atraviesa todo el runbook: **no improvisar.** Ante cualquier resultado
inesperado (un conteo que no cuadra, un error de un script, un smoke test que
falla) → **detenerse y reportar**, no "arreglar sobre la marcha". Cada paso tiene
un criterio explícito de *continuar/abortar* y su rollback.

Resumen del orden (detalle y porqué en DEPLOY.md):

```
P0 expand (días antes) → P1 crear Conjunto sin backfill (días antes)
C0 backup → C1 backfill#1 → C2 merge a main (deploy, columnas aún NULLABLE)
→ C3 backfill#2 → C4 verificación + smoke → C5 contract (NOT NULL + FK RESTRICT)
```

---

## 0. Ensayo (OBLIGATORIO antes de cualquier ejecución real)

El ensayo corre P0, P1, C1, C3 y C5 completos contra una **copia** de producción,
con el código nuevo levantado, y navegando con cuentas reales de Ipanema.

### 0.1 Copia de producción a Postgres 18 local (sin Docker, binarios portables, `initdb`/`pg_ctl`)

> **El servidor de producción (Railway) es PostgreSQL 18.6** (verificado con
> `SELECT version();` por el túnel). El cliente PostgreSQL 16 instalado en esta
> máquina **no sirve**: `pg_dump` se niega a copiar un servidor de versión mayor
> que la suya ("server version mismatch"). Por eso se usan los **binarios
> portables 18** — el `.zip` de EDB ("PostgreSQL Binaries" para Windows),
> descomprimido en `C:\pg18` — **sin instalar nada**: no crean servicio ni tocan
> el registro, y **el servicio del 5432 (PostgreSQL 16) no se toca.**
>
> La instancia temporal del ensayo se crea con el `initdb` **18** (misma versión
> mayor que producción), en el puerto **5433**, con autenticación `trust` (solo
> local, efímera). Este entorno no tiene Docker. Comandos en **PowerShell**.
>
> El dump y la config real son datos personales: van en una carpeta **fuera del
> repo**, `C:\puertaya-privado` (`prod.dump` y `ipanema.local.json`), nunca dentro
> de OneDrive/el repo.

Al inicio de la sesión, define la ruta de los binarios 18 (si los descomprimiste
en otra carpeta, ajusta solo esta línea):
```powershell
$PG18 = "C:\pg18\pgsql\bin"
& "$PG18\postgres.exe" --version   # debe decir 18.x
New-Item -ItemType Directory -Force C:\puertaya-privado | Out-Null
```

#### Antes de abrir el túnel (vale para el ensayo y para P0, C0, C1, C3 y C5)

En el primer intento del ensayo se perdió tiempo por tener la CLI enlazada a
**otro proyecto** de la misma cuenta. Siempre, antes de abrir el túnel:

1. **Confirmar el proyecto:** `railway status` debe mostrar el proyecto
   **`astonishing-truth`**, ambiente **`production`**, con los servicios
   **`mensajeriaApp`** (backend, `https://mensajeriaapp-production.up.railway.app`)
   y **`Postgres`** (volumen `postgres-volume`). Si muestra otra cosa:
   `railway link` y elegir ese proyecto. El enlace se guarda **por carpeta**:
   corre `railway status`/`connect` desde la misma carpeta donde hiciste el `link`.
2. **`mensajeriaApp` en *Sleeping* es normal:** el servicio se duerme sin tráfico
   y la primera petición lo despierta (arranque lento, unos segundos). No es un
   fallo ni afecta al túnel de `Postgres`.
3. **Síntoma de proyecto equivocado o servicio caído:** el túnel abre el puerto
   local, pero `psql` responde "el servidor ha cerrado la conexión
   inesperadamente" y la terminal del túnel imprime
   `channel 1: open failed: connect failed`. Primero revisa `railway status`;
   luego actualiza la CLI: `railway upgrade` (si falla con
   "Failed to execute npm", usa `npm install -g @railway/cli`). Versión verificada
   en el ensayo: **v5.71.0**.
4. **Abrir el túnel:** `railway connect Postgres --tunnel-only -P 55432` (ver
   DEPLOY.md → "Migraciones de Postgres"). Deja esa terminal abierta.
5. **La contraseña de la base nunca se pega en chats, tickets ni archivos**
   (tampoco en una `DATABASE_URL` escrita en un archivo). El túnel la muestra:
   cópiala directo a la variable de la sesión y límpiala al terminar:
   ```powershell
   $env:PGPASSWORD = "<la que muestra el túnel>"   # solo en esta terminal
   # ... comandos psql / pg_dump con -h 127.0.0.1 -p 55432 -U postgres -d railway ...
   Remove-Item Env:PGPASSWORD                    # al terminar
   ```
   Para los CLI de Node (`backfill-conjunto`, `prisma`), arma la URL en memoria:
   `$env:DATABASE_URL = "postgresql://postgres:$($env:PGPASSWORD)@127.0.0.1:55432/railway"`,
   y bórrala igual (`Remove-Item Env:DATABASE_URL`).

Notas de PowerShell 5.1 que afectan a estos comandos: §5.

1. **Túnel SSH a Railway:** según "Antes de abrir el túnel", arriba.
2. **Verificar versiones** antes del dump (con `$env:PGPASSWORD` ya cargada):
   ```powershell
   # Versión del servidor de Railway (por el túnel) — hoy 18.6:
   & "$PG18\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d railway -c "SELECT version();"
   # Versión del pg_dump portable — debe ser >= la del servidor:
   & "$PG18\pg_dump.exe" --version
   ```
   Si el `pg_dump` es **menor** que el servidor, detente: el dump falla. No uses
   el `pg_dump` del PostgreSQL 16 instalado (ni un `pg_dump` a secas del `PATH`).
3. **`pg_dump` de producción** por el túnel (formato custom):
   ```powershell
   & "$PG18\pg_dump.exe" -h 127.0.0.1 -p 55432 -U postgres -d railway -Fc -f C:\puertaya-privado\prod.dump
   & "$PG18\pg_restore.exe" --list C:\puertaya-privado\prod.dump | Out-Null; $LASTEXITCODE   # 0 = no truncado
   ```
   - **El tamaño depende de las fotos:** las fotos de evidencia viven como base64
     en `Package.fotoUrl`. El dump del 28-oct-2026 pesó ~12 KB porque aún no había
     paquetes (§0.3), pero con operación real puede pesar cientos de MB y tardar
     varios minutos.
4. **Instancia temporal local 18** (puerto 5433) con `initdb`/`pg_ctl`:
   ```powershell
   $DATA = "$env:TEMP\ipa-ensayo-pgdata"
   & "$PG18\initdb.exe" -D $DATA -U postgres --auth=trust -E UTF8
   # arrancar en el 5433 (el 5432 del sistema queda intacto):
   & "$PG18\pg_ctl.exe" -D $DATA -o "-p 5433" -l "$env:TEMP\ipa-ensayo.log" start
   & "$PG18\createdb.exe" -h 127.0.0.1 -p 5433 -U postgres railway
   ```
   En una consola normal `pg_ctl start` vuelve enseguida. Si la herramienta desde
   la que lo lanzas se queda esperando (captura la salida del proceso hijo),
   lánzalo con `Start-Process` (sin `-Wait`) y verifica aparte que el puerto 5433
   escucha y que el log dice "listo para aceptar conexiones".
5. **Restaurar la copia** y apuntar `DATABASE_URL` al 5433:
   ```powershell
   & "$PG18\pg_restore.exe" -h 127.0.0.1 -p 5433 -U postgres -d railway --no-owner C:\puertaya-privado\prod.dump
   $env:DATABASE_URL = "postgresql://postgres@127.0.0.1:5433/railway"
   ```
6. **Al terminar el ensayo** (limpieza en §0.2): parar y borrar la instancia
   temporal y **borrar el dump**:
   ```powershell
   & "$PG18\pg_ctl.exe" -D $DATA stop
   Remove-Item -Recurse -Force $DATA
   Remove-Item C:\puertaya-privado\prod.dump   # datos personales y fotos: no dejarlo en disco
   ```
   `ipanema.local.json` se conserva en `C:\puertaya-privado` para el corte real.

### 0.2 Correr los pasos del corte contra la copia

Con `DATABASE_URL` apuntando al 5433 y el backend/front nuevos levantados
(`npm run dev` en `backend/` y `frontend/`):

- **P0 (expand):** `cd backend && npx prisma migrate deploy` (si la copia aún no
  trae la migración `add_conjunto_multitenant`).
- **P1 (crear Conjunto, sin backfill):**
  `npm run backfill-conjunto -- --config C:\puertaya-privado\ipanema.local.json --solo-conjunto` en
  **dry-run** primero, luego con `--apply --solo-conjunto`. El flag `--solo-conjunto`
  crea el `Conjunto` y su `codigoInvitacion` **sin tocar ninguna fila** (sobre la
  copia, cuyas filas llegan todas en NULL de la restauración, es el comportamiento
  correcto: ninguna se asigna todavía).
- **C1 (backfill #1):** `npm run backfill-conjunto -- --config C:\puertaya-privado\ipanema.local.json --apply`.
  Revisa el reporte: `0` NULL en las 4 tablas, conteos antes/después, y **anota el
  SQL de rollback** que imprime.
- **C3 (backfill #2):** vuelve a correr el mismo comando → debe decir
  `SIN_CAMBIOS` (`0 filas por asignar`).
- **C5 (contract):** aplica el SQL manual con el `psql` 18:
  ```powershell
  & "$PG18\psql.exe" "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/prisma/manual/contract_conjunto_not_null.sql
  ```
  `-v ON_ERROR_STOP=1` hace que `psql` se detenga en el primer error: si el guard
  aborta, sale limpio con el mensaje `CONTRACT abortado` (y código ≠ 0), sin las
  ~12 líneas de "current transaction is aborted" de las sentencias siguientes.
  El script es una sola transacción, así que no aplica nada a medias en ningún caso.
- **Ensayar el registro de la migración** (C5, pasos 2–3) y su reversa (C5,
  "Abortar/rollback"): carpeta local `prisma/migrations/<timestamp>_contract_conjunto/`,
  `migrate resolve --applied` contra la copia, `migrate deploy` → "No pending
  migrations". **Borrar la carpeta al terminar** (en el ensayo no se commitea).
- **Navegar con cuentas reales:** login del operador (Francisco) y de un residente
  de Ipanema; recorrer el checklist de §2.4. Confirmar que todo funciona con los
  datos reales restaurados. Como las contraseñas reales no se conocen, **en la
  copia** (nunca en producción) se pone un hash bcrypt de una contraseña de
  ensayo al operador y a uno o dos residentes. El `backend/.env` del ensayo **no
  lleva `RESEND_API_KEY`**: la copia tiene correos reales de residentes y sin esa
  clave el backend solo registra "Correo no enviado" (ese log contiene correos:
  bórralo al terminar).
- **Limpieza:** parar y borrar la instancia temporal y el dump (ver §0.1 paso 6:
  `& "$PG18\pg_ctl.exe" -D $DATA stop`, borrar `$DATA` y
  `C:\puertaya-privado\prod.dump` — contienen datos personales y fotos, no
  dejarlos en disco).

Criterio para pasar del ensayo a la ejecución real: **todos** los pasos anteriores
completan sin sorpresas y el checklist de smoke pasa contra la copia.

### 0.3 Resultado del ensayo del 28-oct-2026 (dato puntual, no regla)

Ensayo completo sobre una copia del dump de producción de ese día, restaurada en
PostgreSQL 18.6 local. Todo pasó sin incidencias: P0 → P1 → C1 → C3 → smoke test
→ aislamiento con un segundo conjunto de prueba → C5 → registro de la migración
→ rollback del contract.

- **Volumen de producción ese día:** 4 usuarios (1 `OPERATOR`, 3 `RESIDENT`),
  0 paquetes, 0 bonos, 0 comentarios. 5 migraciones aplicadas (faltaba
  `add_conjunto_multitenant`, es decir, P0 aún no se había hecho). Sin huérfanos
  ni duplicados.
- **Tiempos medidos** (en el servidor, PostgreSQL 18.6):

  | Paso | Tiempo |
  |---|---|
  | C1, transacción completa | ≈ 62 ms (lock ≈ 49 ms) |
  | C3 (no-op, igual toma el lock) | ≈ 18 ms |
  | C5 contract | ≈ 0,35 s |
  | Rollback del contract | ≈ 0,27 s |

**Consecuencia para el plan.** Con ese volumen el corte entero es cuestión de
minutos y **no hace falta ventana nocturna**. El `LOCK TABLE` y el backfill #2 (C3)
se mantienen igual por seguridad: siguen siendo correctos si el volumen crece.
Pero **cuanto más tarde se haga el corte, más datos habrá y más riesgo**.
**Recomendación:** hacer el corte **antes de que Ipanema empiece a operar con
paquetes reales**.

---

## 1. Preparación (días antes del corte)

### P0 — Migración *expand* en producción
- **Túnel:** antes, `railway status` → proyecto `astonishing-truth` (§0.1, "Antes
  de abrir el túnel").
- **Comando:** `npx prisma migrate deploy` por el túnel SSH (ver DEPLOY.md). Es aditiva.
- **Esperado:** la migración `add_conjunto_multitenant` queda aplicada; el código
  viejo sigue funcionando (ignora las columnas nuevas).
- **Continuar si:** `prisma migrate status` dice que no hay migraciones pendientes.
- **Abortar/rollback:** la expand es inocua; si algo raro, revertir es opcional
  (las columnas nullable no molestan al código viejo). Detenerse y reportar.

### P1 — Crear el Conjunto Ipanema (sin backfill)
- **Comando (por el túnel — `railway status` primero, §0.1 — y dry-run primero):**
  `npm run backfill-conjunto -- --config C:\puertaya-privado\ipanema.local.json --solo-conjunto`,
  luego `--apply --solo-conjunto`. Revisar host y resumen.
- **Esperado:** se crea el `Conjunto` Ipanema con su `codigoInvitacion`, **sin
  tocar ninguna fila**. Con esto ya se puede **reimprimir el QR/flyer** con
  `/registro?c=<código>`. El enlace que imprime el CLI usa `FRONTEND_URL` y, si no
  está definida, `http://localhost:5173`; la URL real es
  `https://mensajeria-app-iota.vercel.app/registro?c=<código>`.
- **Continuar si:** el conjunto existe y el código quedó anotado.
- **Rollback:** `DELETE FROM "Conjunto" WHERE slug='ipanema'` (aún no tiene filas
  asociadas). Reportar.

> **Archivo de config (datos reales → NO versionar).** El repo es público. Copia
> `docs/ipanema.example.json` (valores ficticios, versionado) a `ipanema.local.json`
> (ignorado por git: patrón `*.local.json` en `.gitignore`) o a una ruta fuera del
> repo — la ruta recomendada es `C:\puertaya-privado\ipanema.local.json` (la misma
> carpeta del dump, ver §0.1) —, y pon ahí los datos reales del operador. El CLI avisa si el `--config` está
> dentro del repo y no ignorado. Campos: `{ nombre, slug:"ipanema", operadorNombre,
> operadorWhatsapp, operadorDomicilio, puntoRecepcion, tarifaMano:3000,
> tarifaEstandar:4500, tarifaVolumen:7000, tarifaPesado:12000 }`. `bonosHabilitados`
> NO se incluye (siempre false).

---

## 2. Día del corte

> **Ventana:** con el volumen medido en el ensayo (§0.3) el corte dura minutos y
> puede hacerse **en horario normal, entre semana**, avisando a Francisco con
> antelación (ver §3). Lo que importa es hacerlo **pronto**, antes de que Ipanema
> opere con paquetes reales. Si cuando llegue el día ya hay operación real, vuelve
> a la ventana de bajo tráfico y evita el fin de mes (pico de paquetes).

### Checklist previo (antes de C0)
- [ ] **Rotar la contraseña de la base de producción** si se expuso, y confirmar
      que el backend `mensajeriaApp` se reconecta con la nueva (procedimiento en
      DEPLOY.md → "Rotar la contraseña de Postgres"; la del 28-oct-2026 se hizo
      tras el corte, ver §6).
- [ ] **Avisar a Francisco** (fecha, hora y qué cambia; ver §3).
- [ ] **Tras P1:** reimprimir el QR/flyer con `/registro?c=<código>` y dejar el
      código visible en recepción. Los QR viejos apuntan a la raíz sin `?c=` y,
      tras el corte, dejarán de permitir el registro sin código.
- [ ] **Antes del lanzamiento:** revisión legal del texto de Términos (en especial
      la versión genérica).
- [ ] Carpeta local para el dump de C0 que **NO esté sincronizada con OneDrive**
      (p. ej. `C:\puertaya-privado`).
- [ ] `railway status` → `astonishing-truth` antes de abrir el túnel (§0.1).

### C0 — Backup + conteos
- **Túnel:** `railway status` → `astonishing-truth` antes de abrirlo (§0.1).
  Contraseña solo en `$env:PGPASSWORD`.
- **Comando:** `& "$PG18\pg_dump.exe" -h 127.0.0.1 -p 55432 -U postgres -d railway -Fc -f C:\puertaya-privado\prod.dump`
  por el túnel (como en el ensayo, §0.1: **el `pg_dump` 18**, no el del PostgreSQL 16 instalado) + anotar
  `COUNT(*)` y `COUNT(*) WHERE conjuntoId IS NULL` de `User`/`Package`/`Bono`/`Comentario`.
- **Continuar si:** el dump se generó y se verificó que restaura (ya probado en el
  ensayo). **Sin backup verificado no se sigue.**

### C1 — Backfill #1
- **Comando:** `npm run backfill-conjunto -- --config C:\puertaya-privado\ipanema.local.json --apply`
  (por el túnel ya verificado en C0 con `railway status`). **Ojo:** por el túnel
  el host de `DATABASE_URL` es `127.0.0.1`, así que el CLI lo trata como local y
  **no pide reescribir el slug** (esa protección solo actúa con un host remoto).
  En el corte, **la compuerta es el OK humano** antes de cada `--apply`.
- **Esperado:** reporte `APLICADO`, `0` NULL en las 4 tablas, conteos coherentes.
  **Anotar el SQL de rollback** del reporte.
- **Continuar si:** reporte `APLICADO` y verificación de `0` NULL ok.
- **Abortar/rollback:** si el script aborta (pre-chequeo) o algo no cuadra → **no
  mergear**. Rollback: ejecutar el SQL de rollback impreso (`UPDATE ... SET
  conjuntoId = NULL WHERE conjuntoId = '<Ipanema>'`). Reportar.
- **Si aborta con "No se obtuvo el lock en …"** (`lock_timeout`, por defecto 10s;
  configurable con `BACKFILL_LOCK_TIMEOUT`): no se escribió nada. Buscar la
  transacción larga o colgada por el túnel:
  ```sql
  SELECT pid, state, xact_start, query FROM pg_stat_activity WHERE state <> 'idle' ORDER BY xact_start;
  ```
  Esperar a que termine (o decidir explícitamente si se cancela) y reintentar: el
  backfill es idempotente.

  > **⚠️ Alcance del SQL de rollback.** Deja en NULL **TODAS** las filas del
  > conjunto. Entre C1 y C2 (antes del deploy) eso es exactamente lo asignado por
  > el backfill. Pero **después de C2** el código nuevo ya creó filas con el
  > `conjuntoId` puesto; ejecutar este rollback entonces también las dejaría en
  > NULL. Úsalo sin reservas para **deshacer C1 antes del deploy** o como
  > **reversión total**; **después de C2 con tráfico real, no lo ejecutes sin
  > decidirlo explícitamente** (podrías "desasignar" datos recién creados).

### C2 — Merge a `main` (deploy del código con aislamiento)
- **Comando:** merge de `feature/kan-8-multiconjunto` a `main` y push. Railway
  (backend) y Vercel (frontend) despliegan. **Orden: backend primero** (ver matriz
  de compatibilidad en DEPLOY.md).
- **Importante:** el *contract* NO está en `prisma/migrations/`, así que el
  `migrate deploy` del arranque **no** cambia las columnas (siguen NULLABLE). ✔
- **Esperado:** backend nuevo arriba (sondear el API hasta ver el build nuevo),
  luego frontend nuevo.
- **Continuar si:** ambos deploys activos y el smoke test (§2.4) pasa.
- **Abortar/rollback:** redeploy del commit anterior en Railway/Vercel. La columna
  nullable sobrante es inocua para el código viejo. Reportar.

### C3 — Backfill #2 (recoge lo escrito entre C1 y el fin del deploy)
- **Comando:** mismo que C1 (`--apply`). Es idempotente. Si el túnel se cerró
  durante C2, al reabrirlo vuelve a confirmar `railway status` (§0.1).
- **Esperado:** `APLICADO` con unas pocas filas (lo que el código viejo escribió
  en la ventana) **o** `SIN_CAMBIOS` si no hubo. `SIN_CAMBIOS` se decide tras
  tomar el lock, es decir, tras esperar a los escritores en curso. Anotar el SQL
  de rollback.
- **Continuar si:** `0` NULL en las 4 tablas tras esta corrida.
- **Si aborta por `lock_timeout`:** igual que en C1 (consulta a
  `pg_stat_activity` y reintento).

### C4 — Verificación + smoke test en vivo
- **Comando:** `COUNT(*) WHERE conjuntoId IS NULL` = 0 en las 4 tablas (por el
  túnel) + el checklist §2.4 contra producción.
- **Continuar si:** `0` NULL **y** checklist completo en verde.
- **Abortar:** si queda cualquier NULL → **no aplicar el contract**; investigar de
  dónde salió (¿un escritor viejo aún activo?), reportar.

### C5 — Migración *contract*
- **Comando (por el túnel — `railway status` → `astonishing-truth`, §0.1 — con
  `$env:PGPASSWORD` cargada):**
  `& "$PG18\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d railway -v ON_ERROR_STOP=1 -f backend/prisma/manual/contract_conjunto_not_null.sql`
  (`ON_ERROR_STOP`: ver §0.2, el guard aborta limpio y con código de salida ≠ 0).
- **Esperado:** se aplica sin error (el guard `DO $$` confirma 0 NULLs). Columnas
  `NOT NULL` y FKs `RESTRICT`.
- **Después — orden EXACTO del registro (no invertir):**
  1. **Aplicar el SQL manual** (el paso anterior) contra producción por el túnel.
  2. **Crear la carpeta de migración LOCALMENTE** `prisma/migrations/<timestamp>_contract_conjunto/`
     con un `migration.sql` **idéntico** al SQL aplicado a mano en el paso 1.
     `prisma migrate resolve --applied`
     **necesita que esa carpeta exista en el disco** desde donde se corre el
     comando — aunque todavía NO esté commiteada/subida: Prisma lee el nombre de
     migración del árbol local, no del repo remoto.
  3. **`npx prisma migrate resolve --applied <timestamp>_contract_conjunto`**
     contra producción (por el túnel), para marcar esa migración como ya aplicada
     en el historial `_prisma_migrations`.
  4. **Solo entonces** `commit` + `push` con esa carpeta `prisma/migrations/<...>/`
     y `schema.prisma` en `conjuntoId String` (relación obligatoria).

  > **Por qué este orden:** si la carpeta llega a `main` **antes** del `resolve`,
  > el `prisma migrate deploy` del arranque de Railway intentaría **aplicarla** (y
  > fallaría o la aplicaría dos veces). El `migration.sql` de esa carpeta debe ser
  > **idéntico** al SQL aplicado a mano en el paso 1, para que `resolve` sea
  > coherente con lo que realmente está en la base.
- **Continuar si:** el contract aplicó y el smoke test sigue en verde.
- **Abortar/rollback.** Depende de si el registro (`resolve --applied`, paso 3 de
  arriba) ya se hizo:
  - **Si el `resolve` todavía NO se hizo:** basta con el SQL de rollback (vuelve a
    nullable + FK `SET NULL`, sin pérdida de datos). Si ya habías creado la carpeta
    local del paso 2, bórrala.
    ```powershell
    & "$PG18\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d railway -v ON_ERROR_STOP=1 -f backend/prisma/manual/rollback_contract_conjunto.sql
    ```
  - **Si el `resolve --applied` YA se hizo (es el estado real desde el 28-oct-2026,
    migración `20261028165010_contract_conjunto`):** el SQL solo no basta.
    `_prisma_migrations` seguiría marcando la migración como aplicada mientras el
    esquema vuelve a ser nullable: un `migrate deploy` (corre en el `start` de
    Railway) **asumiría el contract aplicado**. Y si se quita esa marca con la
    carpeta en `main`, el siguiente arranque **lo volvería a aplicar**.
    **Versión final, con la carpeta fuera del repo (estado actual):**
    1. **SQL de rollback** (el comando de arriba, con `ON_ERROR_STOP`): esquema a
       nullable / `SET NULL`.
    2. **Quitar la marca de `_prisma_migrations`**, por el túnel y con un archivo
       `.sql` (§5):
       ```sql
       DELETE FROM _prisma_migrations WHERE migration_name = '20261028165010_contract_conjunto';
       ```
       ⚠️ **`npx prisma migrate resolve --rolled-back <nombre>` NO sirve aquí:** solo
       acepta migraciones en estado *fallido* y con una aplicada responde
       `Error: P3012 … cannot be rolled back because it is not in a failed state`
       (verificado en PostgreSQL 18.6 con Prisma 5.22).
    3. **Verificar:** `npx prisma migrate status` → "Database schema is up to date!",
       y `SELECT table_name, is_nullable FROM information_schema.columns WHERE column_name = 'conjuntoId';`
       → `YES` en las 4 tablas.

    **Si la carpeta ya hubiera vuelto al repo (paso 4 hecho):** entre el paso 1 y el
    2, un commit que **quite** esa carpeta y devuelva `schema.prisma` a
    `conjuntoId String?`, push y esperar el deploy, **antes** del `DELETE`. Mientras
    la marca siga como aplicada, ese deploy no hace nada (verificado: "No pending
    migrations"). Al revés se abre una ventana en la que **cualquier arranque del
    backend** (deploy, reinicio y, previsiblemente, el despertar de *Sleeping*)
    vuelve a aplicar el contract.

    Con la fila borrada y la carpeta fuera, el estado equivale a "contract nunca
    aplicado". Un reintento posterior repite C5 desde el principio.
  - En cualquiera de los dos casos: **reportar**.

### Checklist de cierre (después de C4 y de C5)
- [ ] Smoke test §2.4 en verde tras C5.
- [ ] **Borrar los dumps y archivos de ensayo con datos personales** (el `prod.dump`
      de C0 y los del ensayo, logs del backend del ensayo, SQL de rollback
      guardados) una vez confirmado C5. El dump de C0 es la red de seguridad hasta
      entonces: no lo borres antes.
- [ ] `ipanema.local.json` **fuera del repo** (y fuera de carpetas sincronizadas).
- [ ] Túnel cerrado, `Remove-Item Env:PGPASSWORD` y `Remove-Item Env:DATABASE_URL`.

### 2.4 Checklist de verificación en vivo (tras C2 y tras C4)
Con una cuenta real de Ipanema (operador y residente):
- [ ] Login del **residente** funciona (sesión previa al corte sigue válida — JWT por `sub`).
- [ ] Login del **operador** (Francisco) funciona.
- [ ] Listado de paquetes del operador muestra los paquetes de Ipanema (y solo esos).
- [ ] Recepción de un **paquete de prueba** (checkin) con su tarifa.
- [ ] **Foto de evidencia** se guarda y se ve en el detalle.
- [ ] `GET /api/conjunto/config` devuelve nombre/tarifas/bonos de Ipanema (y
      `codigoInvitacion` solo para el operador).
- [ ] **Registro con código** (`/registro?c=<código Ipanema>`) crea un residente
      en Ipanema.
- [ ] **Registro sin código** muestra el error claro (no crea nada).
- [ ] Borrar el paquete/residente de prueba al terminar.

---

## 3. Comunicación
- **Aviso previo a Francisco:** fecha/hora de la ventana, que durante unos minutos
  el **registro de nuevos residentes** puede quedar en pausa (matriz de
  compatibilidad), y que su sesión seguirá activa. Darle el **nuevo enlace/QR**
  (`/registro?c=<código>`) para reimprimir.
- **Ventana:** horario normal entre semana, avisando a Francisco, mientras el
  volumen siga siendo el del ensayo (§0.3). Con operación real ya en marcha:
  ventana de bajo tráfico y evitar fin de mes.
- **Durante el corte:** un solo operador del corte ejecuta; cualquier desvío se
  reporta antes de continuar (regla de no improvisar).

---

## 4. Qué hacer si algo falla (resumen)
| Paso | Señal de fallo | Acción |
|---|---|---|
| P0 | `migrate status` con pendientes/errores | detener, reportar |
| P1 | el script no crea el conjunto | revisar config/host, reportar |
| C1 | reporte no `APLICADO` o NULL != 0 | **no mergear**; rollback SQL impreso |
| C1/C3 | "No se obtuvo el lock en …" | nada escrito; revisar `pg_stat_activity` (consulta en C1) y reintentar |
| C2 | deploy no sube / smoke falla | redeploy commit anterior |
| C3 | quedan NULL tras la corrida | investigar escritor viejo; no seguir a C5 |
| C4 | cualquier NULL o checklist en rojo | **no aplicar contract**; reportar |
| C5 | el contract falla (guard o FK) | rollback SQL; reportar |
| C5 | hay que revertir **tras** `resolve --applied` | rollback SQL → (solo si la carpeta está en el repo: quitarla de `main`, commit + deploy) → `DELETE` de la fila en `_prisma_migrations` (**no** `resolve --rolled-back`: P3012) → `migrate status` + `is_nullable` (C5, "Abortar/rollback") |
| Túnel | `channel 1: open failed` / "el servidor ha cerrado la conexión" | `railway status` (¿`astonishing-truth`?), `railway link`, actualizar CLI (§0.1) |

En todos los casos: **detenerse y reportar**, no improvisar.

---

## 5. Notas de PowerShell 5.1 (Windows)

Problemas reales del ensayo; ninguno es un fallo de la app.

- **No pases SQL por tubería a `prisma db execute --stdin`.** PowerShell 5.1
  antepone un BOM invisible y Postgres responde `syntax error at or near "SELECT"`
  (el BOM va pegado delante de `SELECT`). Usa un archivo `.sql` sin BOM con
  `--file`. Para crearlo desde PowerShell: `Set-Content -Encoding ascii` (si el
  SQL solo tiene caracteres ASCII; `-Encoding UTF8` en 5.1 **sí** escribe BOM).
  Con tildes o eñes: `[IO.File]::WriteAllText($ruta, $texto)`, que escribe UTF-8
  sin BOM.
- **`psql -c "..."` con comillas dobles internas** (`"User"`, `"Conjunto"`) falla
  en 5.1, porque PowerShell las quita al pasar el argumento. Usa siempre
  `-f archivo.sql`.
- **`ipanema.local.json` en UTF-8 sin BOM** (el valor por defecto de VS Code; el
  Bloc de notas a veces añade BOM). El CLI lo lee con `JSON.parse`, que falla con
  BOM. Ojo: `Get-Content <ruta> | ConvertFrom-Json` valida la sintaxis del JSON
  pero **tolera el BOM**, así que no lo detecta. Para comprobar el BOM:
  ```powershell
  $b = [IO.File]::ReadAllBytes("C:\puertaya-privado\ipanema.local.json")[0..2]; ($b -join ',') -eq '239,187,191'   # True = tiene BOM
  ```
- **`npm run alta-conjunto` es interactivo:** funciona en la terminal del usuario,
  pero **no acepta respuestas por tubería** ni con `< archivo`, porque `readline`
  pierde líneas y el script se corta en la segunda pregunta.
- **`pg_ctl start`** puede bloquear herramientas que capturan la salida: lánzalo
  con `Start-Process` sin `-Wait` (§0.1, paso 4).

---

## 6. Ejecución real del 28-oct-2026

Corte ejecutado en producción, un paso a la vez y con OK explícito del usuario en
cada compuerta. Sin incidencias en los datos.

| Paso | Resultado real |
|---|---|
| Paso 0 | `astonishing-truth` confirmado; producción con 4 usuarios (1 `OPERATOR`, 3 `RESIDENT`), 0 paquetes/bonos/comentarios, 5 migraciones. |
| C0 | Dump `-Fc` verificado con `pg_restore --list` (28 entradas, sin errores). |
| P0 | `migrate deploy` aplicó solo `add_conjunto_multitenant`: **16,8 s**. El backend viejo siguió respondiendo. |
| P1 | `ipanema` creado (`bonosHabilitados=false`, tarifas 3000/4500/7000/12000), sin tocar filas. |
| C1 | 4 usuarios asignados, 0 NULL. CLI completa ≈ 11 s. |
| C2 | Fast-forward de `main`; ventana con frontend nuevo y backend viejo ≈ 45 s (Vercel terminó antes que Railway). |
| C3 | "0 filas por asignar". |
| C4 | Registro sin código / con código inválido → 400; smoke manual del usuario aprobado. |
| C5 (1–3) | Contract: **2,86 s**; NOT NULL ×4 y FK `RESTRICT`; `resolve --applied 20261028165010_contract_conjunto`, `migrate status` "up to date". |
| C5 (4) | **Hecho en la rama `refactor/mobile-first`** (carpeta idéntica, SHA-256 verificado); pendiente en `main` hasta que el refactor llegue a producción. |

**Desviaciones respecto a este runbook:**
- **El CLI no pidió reescribir el slug** en C1/C3: por el túnel el host es
  `127.0.0.1` y la protección solo actúa con hosts remotos. La compuerta real es
  el OK humano antes de cada `--apply` (corregido en C1).
- **El enlace que imprime el CLI usa `localhost:5173`** si `FRONTEND_URL` no está
  definida. La URL real para el QR es
  `https://mensajeria-app-iota.vercel.app/registro?c=<código>` (anotado en P1).
- **La carpeta para `resolve` se creó fuera del repo**, en una copia del árbol de
  Prisma (`schema.prisma` + `migrations/`), con `--schema` apuntando a ella, en vez
  de `backend/prisma/migrations/` (C5 paso 2). Por eso el repo no cambió y el
  paso 4 quedó pendiente en `main` (hecho después en `refactor/mobile-first`); la carpeta debe volver byte a byte idéntica (SHA-256 en
  DEPLOY.md).
- **La transacción de C1 no se midió en el servidor** (habría requerido activar
  `log_statement` en producción). La CLI completa tardó ≈ 11 s; en el ensayo, la
  transacción fue ≈ 62 ms.
- **Volumen real:** el que preveía §0.3 (4 usuarios, 0 paquetes), así que el corte
  se hizo en horario normal.

**Después del corte, el mismo día:**
- **Hotfix `20a46b4`:** registro sin código mientras exista un solo conjunto (los
  QR/folletos repartidos apuntan sin `?c=`). Antes de crear un segundo conjunto,
  reimprimir los QR con `?c=<código>` (ver README y DEPLOY.md).
- **Rotación de la contraseña de Postgres** con "Regenerar contraseña" en Railway
  (procedimiento en DEPLOY.md → "Rotar la contraseña de Postgres"). Verificada:
  backend sin errores de autenticación y túnel nuevo funcionando.
