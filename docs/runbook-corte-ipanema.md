# Runbook — Corte a producción del multi-conjunto (Ipanema) · KAN-8 Fase F

> **Estado:** NO ejecutado. Este runbook se **ensaya** contra una copia antes de
> cualquier ejecución real, y la ejecución real requiere aprobación explícita del
> usuario, paso por paso. El orden y su justificación están en
> [`DEPLOY.md` → "Corte a producción del multi-conjunto"](../DEPLOY.md).

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

1. **Túnel SSH a Railway** (ver DEPLOY.md → "Migraciones de Postgres"):
   `railway connect Postgres --tunnel-only -P 55432`.
2. **Verificar versiones** antes del dump:
   ```powershell
   # Versión del servidor de Railway (por el túnel) — hoy 18.6:
   & "$PG18\psql.exe" "postgresql://postgres:<pwd>@127.0.0.1:55432/railway" -c "SELECT version();"
   # Versión del pg_dump portable — debe ser >= la del servidor:
   & "$PG18\pg_dump.exe" --version
   ```
   Si el `pg_dump` es **menor** que el servidor, detente: el dump falla. No uses
   el `pg_dump` del PostgreSQL 16 instalado (ni un `pg_dump` a secas del `PATH`).
3. **`pg_dump` de producción** por el túnel (formato custom):
   ```powershell
   & "$PG18\pg_dump.exe" "postgresql://postgres:<pwd>@127.0.0.1:55432/railway" -Fc -f C:\puertaya-privado\prod.dump
   ```
   - **El dump es grande:** las fotos de evidencia viven como base64 en
     `Package.fotoUrl`, así que el `.dump` puede pesar cientos de MB y tardar
     varios minutos. Ten espacio en disco y paciencia.
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
  copia, que ya tiene miles de filas NULL de la restauración, es el comportamiento
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
- **Navegar con cuentas reales:** login del operador (Francisco) y de un residente
  de Ipanema; recorrer el checklist de §2.4. Confirmar que todo funciona con los
  datos reales restaurados.
- **Limpieza:** parar y borrar la instancia temporal y el dump (ver §0.1 paso 6:
  `& "$PG18\pg_ctl.exe" -D $DATA stop`, borrar `$DATA` y
  `C:\puertaya-privado\prod.dump` — contienen datos personales y fotos, no
  dejarlos en disco).

Criterio para pasar del ensayo a la ejecución real: **todos** los pasos anteriores
completan sin sorpresas y el checklist de smoke pasa contra la copia.

---

## 1. Preparación (días antes del corte)

### P0 — Migración *expand* en producción
- **Comando:** se aplica por el túnel SSH (ver DEPLOY.md). Es aditiva.
- **Esperado:** la migración `add_conjunto_multitenant` queda aplicada; el código
  viejo sigue funcionando (ignora las columnas nuevas).
- **Continuar si:** `prisma migrate status` dice que no hay migraciones pendientes.
- **Abortar/rollback:** la expand es inocua; si algo raro, revertir es opcional
  (las columnas nullable no molestan al código viejo). Detenerse y reportar.

### P1 — Crear el Conjunto Ipanema (sin backfill)
- **Comando (por el túnel, dry-run primero):**
  `npm run backfill-conjunto -- --config C:\puertaya-privado\ipanema.local.json --solo-conjunto`,
  luego `--apply --solo-conjunto`. Revisar host y resumen.
- **Esperado:** se crea el `Conjunto` Ipanema con su `codigoInvitacion`, **sin
  tocar ninguna fila**. Con esto ya se puede **reimprimir el QR/flyer** con
  `/registro?c=<código>`.
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

> **Ventana:** nocturna, entre semana, **evitar fin de mes** (pico de paquetes).
> Avisar a Francisco con antelación (ver §3).

### C0 — Backup + conteos
- **Comando:** `& "$PG18\pg_dump.exe" ... -Fc -f C:\puertaya-privado\prod.dump`
  por el túnel (como en el ensayo, §0.1: **el `pg_dump` 18**, no el del PostgreSQL 16 instalado) + anotar
  `COUNT(*)` y `COUNT(*) WHERE conjuntoId IS NULL` de `User`/`Package`/`Bono`/`Comentario`.
- **Continuar si:** el dump se generó y se verificó que restaura (ya probado en el
  ensayo). **Sin backup verificado no se sigue.**

### C1 — Backfill #1
- **Comando:** `npm run backfill-conjunto -- --config C:\puertaya-privado\ipanema.local.json --apply`
  (por el túnel; al ser host remoto, el script pedirá reescribir el slug `ipanema`).
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
- **Comando:** mismo que C1 (`--apply`). Es idempotente.
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
- **Comando (por el túnel):**
  `& "$PG18\psql.exe" "<DATABASE_URL del túnel>" -v ON_ERROR_STOP=1 -f backend/prisma/manual/contract_conjunto_not_null.sql`
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
- **Abortar/rollback:** `& "$PG18\psql.exe" ... -v ON_ERROR_STOP=1 -f backend/prisma/manual/rollback_contract_conjunto.sql`
  (vuelve a nullable + FK SET NULL, sin pérdida de datos). Reportar.

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
- **Ventana:** nocturna, entre semana, evitar fin de mes.
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

En todos los casos: **detenerse y reportar**, no improvisar.
