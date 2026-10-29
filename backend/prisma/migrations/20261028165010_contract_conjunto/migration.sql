-- Migración CONTRACT del multi-conjunto (KAN-8, Fase F — paso C5).
--
-- NO vive en prisma/migrations/ a propósito: el `start` de Railway corre
-- `prisma migrate deploy` en el arranque, y si estuviera en migrations/ se
-- aplicaría durante el deploy del código (C2), ADELANTANDO el NOT NULL antes de
-- que el backfill #2 (C3) y la verificación (C4) terminen. Se aplica a MANO por
-- el túnel SSH en C5, y SOLO después se registra en migrations/ marcándola como
-- aplicada: `npx prisma migrate resolve --applied <nombre>` (ver DEPLOY.md).
--
-- Precondición (C4 ya verificado): 0 filas con conjuntoId NULL en las 4 tablas.
-- Este script vuelve a comprobarlo y ABORTA si queda alguna (no deja a medias).
--
-- Cero DROP TABLE/COLUMN. Solo: SET NOT NULL x4 + recrear las FK como RESTRICT.

BEGIN;

-- Guarda: si queda cualquier NULL, lanza y revierte todo (no aplica a medias).
DO $$
DECLARE
  faltan integer;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM "User"       WHERE "conjuntoId" IS NULL)
  + (SELECT COUNT(*) FROM "Package"    WHERE "conjuntoId" IS NULL)
  + (SELECT COUNT(*) FROM "Bono"       WHERE "conjuntoId" IS NULL)
  + (SELECT COUNT(*) FROM "Comentario" WHERE "conjuntoId" IS NULL)
  INTO faltan;
  IF faltan > 0 THEN
    RAISE EXCEPTION 'CONTRACT abortado: quedan % filas con conjuntoId NULL. Completa el backfill (C3) antes de C5.', faltan;
  END IF;
END $$;

-- 1) conjuntoId NOT NULL en las cuatro tablas.
ALTER TABLE "User"       ALTER COLUMN "conjuntoId" SET NOT NULL;
ALTER TABLE "Package"    ALTER COLUMN "conjuntoId" SET NOT NULL;
ALTER TABLE "Bono"       ALTER COLUMN "conjuntoId" SET NOT NULL;
ALTER TABLE "Comentario" ALTER COLUMN "conjuntoId" SET NOT NULL;

-- 2) FKs a Conjunto: de ON DELETE SET NULL a ON DELETE RESTRICT (borrar un
--    conjunto con datos queda prohibido; nunca deja usuarios/paquetes huérfanos).
ALTER TABLE "User"       DROP CONSTRAINT "User_conjuntoId_fkey";
ALTER TABLE "User"       ADD CONSTRAINT "User_conjuntoId_fkey"
  FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Package"    DROP CONSTRAINT "Package_conjuntoId_fkey";
ALTER TABLE "Package"    ADD CONSTRAINT "Package_conjuntoId_fkey"
  FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Bono"       DROP CONSTRAINT "Bono_conjuntoId_fkey";
ALTER TABLE "Bono"       ADD CONSTRAINT "Bono_conjuntoId_fkey"
  FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Comentario" DROP CONSTRAINT "Comentario_conjuntoId_fkey";
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_conjuntoId_fkey"
  FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
