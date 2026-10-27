-- ROLLBACK de la migración CONTRACT del multi-conjunto (KAN-8, Fase F).
--
-- Deshace contract_conjunto_not_null.sql SIN pérdida de datos: vuelve
-- conjuntoId a NULLABLE y las FK a ON DELETE SET NULL. No borra ni vacía nada.
-- Úsalo si tras C5 hay que retroceder (p. ej. un problema detectado en caliente).

BEGIN;

-- 1) conjuntoId vuelve a aceptar NULL.
ALTER TABLE "User"       ALTER COLUMN "conjuntoId" DROP NOT NULL;
ALTER TABLE "Package"    ALTER COLUMN "conjuntoId" DROP NOT NULL;
ALTER TABLE "Bono"       ALTER COLUMN "conjuntoId" DROP NOT NULL;
ALTER TABLE "Comentario" ALTER COLUMN "conjuntoId" DROP NOT NULL;

-- 2) FKs vuelven a ON DELETE SET NULL (estado de la fase expand).
ALTER TABLE "User"       DROP CONSTRAINT "User_conjuntoId_fkey";
ALTER TABLE "User"       ADD CONSTRAINT "User_conjuntoId_fkey"
  FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Package"    DROP CONSTRAINT "Package_conjuntoId_fkey";
ALTER TABLE "Package"    ADD CONSTRAINT "Package_conjuntoId_fkey"
  FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Bono"       DROP CONSTRAINT "Bono_conjuntoId_fkey";
ALTER TABLE "Bono"       ADD CONSTRAINT "Bono_conjuntoId_fkey"
  FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Comentario" DROP CONSTRAINT "Comentario_conjuntoId_fkey";
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_conjuntoId_fkey"
  FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
