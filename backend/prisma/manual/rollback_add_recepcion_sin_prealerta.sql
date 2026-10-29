-- ROLLBACK de la migración 20261029100200_add_recepcion_sin_prealerta (T2.1).
--
-- Deshace la fase EXPAND de la recepción sin pre-alerta:
--   * Package.residenteId vuelve a NOT NULL.
--   * Se quitan Package.{etiquetaNombre, transportadora, metodoPago, recibidoEn}
--     y el índice [conjuntoId, guia].
--   * Se quitan Conjunto.{prefijoPais, franjasEntrega, maxFotos, custodiaMaxDias}.
-- PIERDE los datos de esas columnas (los paquetes y su estado no se tocan).
--
-- GUARD: si existe algún Package con residenteId NULL (un SIN_ASIGNAR recibido
-- sin dueño), volver a NOT NULL es imposible sin inventar un dueño. El script
-- ABORTA con un mensaje claro y NO cambia nada. Asigna o borra esos paquetes
-- primero (PATCH /packages/:id/asignar, o a mano) y reintenta.
--
-- También borra la fila de `_prisma_migrations` para que `migrate deploy` no crea
-- que sigue aplicada. El código anterior a T2.1 ignora las columnas nuevas, pero
-- NO tolera residenteId NULL: desplegarlo encima solo tras este rollback.

BEGIN;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM "Package" WHERE "residenteId" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'ROLLBACK abortado: % paquete(s) tienen residenteId NULL (SIN_ASIGNAR sin dueño). Asígnalos o bórralos antes de revertir; no se cambió nada.', n;
  END IF;
END $$;

ALTER TABLE "Package" ALTER COLUMN "residenteId" SET NOT NULL;

DROP INDEX IF EXISTS "Package_conjuntoId_guia_idx";
ALTER TABLE "Package"
  DROP COLUMN IF EXISTS "etiquetaNombre",
  DROP COLUMN IF EXISTS "transportadora",
  DROP COLUMN IF EXISTS "metodoPago",
  DROP COLUMN IF EXISTS "recibidoEn";

ALTER TABLE "Conjunto"
  DROP COLUMN IF EXISTS "prefijoPais",
  DROP COLUMN IF EXISTS "franjasEntrega",
  DROP COLUMN IF EXISTS "maxFotos",
  DROP COLUMN IF EXISTS "custodiaMaxDias";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029100200_add_recepcion_sin_prealerta';

COMMIT;
