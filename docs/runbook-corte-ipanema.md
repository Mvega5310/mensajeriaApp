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

### 0.1 Copia de producción a Postgres local

1. **Túnel SSH a Railway** (ver DEPLOY.md → "Migraciones de Postgres"):
   `railway connect Postgres --tunnel-only -P 55432`.
2. **`pg_dump` de producción** por el túnel:
   ```
   pg_dump "postgresql://postgres:<pwd>@127.0.0.1:55432/railway" -Fc -f prod.dump
   ```
   - **Versión de `pg_dump`:** debe ser **≥** la del servidor Postgres de Railway.
     Verifica la del servidor con `SELECT version();` por el túnel; si tu
     `pg_dump` local es menor, usa uno igual o mayor (p. ej. el del contenedor
     `postgres:16` de Docker: `docker run --rm postgres:16 pg_dump ...`).
   - **El dump es grande:** las fotos de evidencia viven como base64 en la columna
     `Package.fotoUrl`, así que el `.dump` puede pesar cientos de MB y tardar.
     Hazlo con tiempo y espacio en disco suficiente.
3. **Postgres temporal local** (puerto 5433) y restaurar la copia:
   ```
   docker run --rm -d --name ipa-ensayo -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=railway -p 5433:5432 postgres:16
   pg_restore -d "postgresql://postgres:postgres@localhost:5433/railway" --no-owner prod.dump
   export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/railway"
   ```

### 0.2 Correr los pasos del corte contra la copia

Con `DATABASE_URL` apuntando al 5433 y el backend/front nuevos levantados
(`npm run dev` en `backend/` y `frontend/`):

- **P0 (expand):** `cd backend && npx prisma migrate deploy` (si la copia aún no
  trae la migración `add_conjunto_multitenant`).
- **P1 (crear Conjunto, sin backfill):** `npm run backfill-conjunto -- --config docs/ipanema.json`
  en **dry-run** primero; luego, para crear solo el conjunto, usar `backfill-conjunto`
  con `--apply` (si no hay NULLs aún crea el conjunto; si los hay, también backfillea
  — en el ensayo da igual, es una copia). *(Alternativa para P1 puro: crear el
  conjunto con un `--apply` cuando no existan filas legacy; en producción P1 ocurre
  antes del backfill real.)*
- **C1 (backfill #1):** `npm run backfill-conjunto -- --config docs/ipanema.json --apply`.
  Revisa el reporte: `0` NULL en las 4 tablas, conteos antes/después, y **anota el
  SQL de rollback** que imprime.
- **C3 (backfill #2):** vuelve a correr el mismo comando → debe decir
  `SIN_CAMBIOS` (`0 filas por asignar`).
- **C5 (contract):** aplica el SQL manual:
  ```
  psql "$DATABASE_URL" -f backend/prisma/manual/contract_conjunto_not_null.sql
  ```
- **Navegar con cuentas reales:** login del operador (Francisco) y de un residente
  de Ipanema; recorrer el checklist de §2.4. Confirmar que todo funciona con los
  datos reales restaurados.
- **Limpieza:** `docker rm -f ipa-ensayo` y borrar `prod.dump` (contiene datos
  personales y fotos — no dejarlo en disco).

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
  `npm run backfill-conjunto -- --config ipanema.json` → revisar host y resumen.
- **Esperado:** se crea el `Conjunto` Ipanema con su `codigoInvitacion`. Con esto
  ya se puede **reimprimir el QR/flyer** con `/registro?c=<código>`.
- **Continuar si:** el conjunto existe y el código quedó anotado.
- **Rollback:** `DELETE FROM "Conjunto" WHERE slug='ipanema'` (aún no tiene filas
  asociadas). Reportar.

> `ipanema.json`: `{ nombre, slug:"ipanema", operadorNombre, operadorWhatsapp,
> operadorDomicilio, puntoRecepcion, tarifaMano:3000, tarifaEstandar:4500,
> tarifaVolumen:7000, tarifaPesado:12000 }`. `bonosHabilitados` NO se incluye
> (siempre false).

---

## 2. Día del corte

> **Ventana:** nocturna, entre semana, **evitar fin de mes** (pico de paquetes).
> Avisar a Francisco con antelación (ver §3).

### C0 — Backup + conteos
- **Comando:** `pg_dump -Fc` por el túnel (como en el ensayo) + anotar
  `COUNT(*)` y `COUNT(*) WHERE conjuntoId IS NULL` de `User`/`Package`/`Bono`/`Comentario`.
- **Continuar si:** el dump se generó y se verificó que restaura (ya probado en el
  ensayo). **Sin backup verificado no se sigue.**

### C1 — Backfill #1
- **Comando:** `npm run backfill-conjunto -- --config ipanema.json --apply`
  (por el túnel; al ser host remoto, el script pedirá reescribir el slug `ipanema`).
- **Esperado:** reporte `APLICADO`, `0` NULL en las 4 tablas, conteos coherentes.
  **Anotar el SQL de rollback** del reporte.
- **Continuar si:** reporte `APLICADO` y verificación de `0` NULL ok.
- **Abortar/rollback:** si el script aborta (pre-chequeo) o algo no cuadra → **no
  mergear**. Rollback: ejecutar el SQL de rollback impreso (`UPDATE ... SET
  conjuntoId = NULL WHERE conjuntoId = '<Ipanema>'`). Reportar.

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
  en la ventana) **o** `SIN_CAMBIOS` si no hubo. Anotar el SQL de rollback.
- **Continuar si:** `0` NULL en las 4 tablas tras esta corrida.

### C4 — Verificación + smoke test en vivo
- **Comando:** `COUNT(*) WHERE conjuntoId IS NULL` = 0 en las 4 tablas (por el
  túnel) + el checklist §2.4 contra producción.
- **Continuar si:** `0` NULL **y** checklist completo en verde.
- **Abortar:** si queda cualquier NULL → **no aplicar el contract**; investigar de
  dónde salió (¿un escritor viejo aún activo?), reportar.

### C5 — Migración *contract*
- **Comando (por el túnel):**
  `psql "<DATABASE_URL del túnel>" -f backend/prisma/manual/contract_conjunto_not_null.sql`
- **Esperado:** se aplica sin error (el guard `DO $$` confirma 0 NULLs). Columnas
  `NOT NULL` y FKs `RESTRICT`.
- **Después:** registrar la migración en el historial para que `migrate deploy`
  futuro no intente re-aplicarla: mover/crear la carpeta en `prisma/migrations/` y
  `npx prisma migrate resolve --applied <nombre>`; en el commit de C5, cambiar
  `schema.prisma` a `conjuntoId String` (relación obligatoria).
- **Continuar si:** el contract aplicó y el smoke test sigue en verde.
- **Abortar/rollback:** `psql ... -f backend/prisma/manual/rollback_contract_conjunto.sql`
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
| C2 | deploy no sube / smoke falla | redeploy commit anterior |
| C3 | quedan NULL tras la corrida | investigar escritor viejo; no seguir a C5 |
| C4 | cualquier NULL o checklist en rojo | **no aplicar contract**; reportar |
| C5 | el contract falla (guard o FK) | rollback SQL; reportar |

En todos los casos: **detenerse y reportar**, no improvisar.
