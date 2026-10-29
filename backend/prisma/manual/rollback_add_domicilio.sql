-- ROLLBACK de la migración 20261029110000_add_domicilio (PLAN-conjunto S1.1).
--
-- Quita Package.domicilioId (+ su FK e índice) y las tablas Domicilio y UsuarioConjunto.
-- Es seguro porque la migración fue solo ADITIVA: `Package.residenteId` y los datos de
-- `User` (torre, apto, nombre, teléfono) nunca se tocaron, así que el código anterior
-- sigue funcionando con lo que ya tenía. Se pierde únicamente lo escrito DESPUÉS de la
-- migración en esas tablas (direcciones nuevas y su enlace con los paquetes nuevos).
-- Borra también la fila de `_prisma_migrations` para que `migrate deploy` pueda volver a
-- aplicarla (la migración de datos es idempotente).
--
-- Uso:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/prisma/manual/rollback_add_domicilio.sql

BEGIN;

DROP INDEX IF EXISTS "Package_conjuntoId_domicilioId_idx";
ALTER TABLE "Package" DROP CONSTRAINT IF EXISTS "Package_domicilioId_fkey";
ALTER TABLE "Package" DROP COLUMN IF EXISTS "domicilioId";

DROP TABLE IF EXISTS "UsuarioConjunto";
DROP TABLE IF EXISTS "Domicilio";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029110000_add_domicilio';

COMMIT;
