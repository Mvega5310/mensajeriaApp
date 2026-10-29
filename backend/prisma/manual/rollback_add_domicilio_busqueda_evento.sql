-- ROLLBACK de la migración 20261029120000_add_domicilio_busqueda_evento (revisión S3.2).
--
-- Quita la tabla DomicilioEvento (la bitácora de "desactivar dirección": se pierde) y la
-- columna Domicilio.nombreBusqueda (derivada de nombreRecibe: se recalcula al volver a aplicar
-- la migración). NO reactiva los domicilios que el operador desactivó (Domicilio.activo ya
-- existía antes de esta migración): si hay que reactivarlos, hazlo a mano con un UPDATE.
-- Borra la fila de `_prisma_migrations` para que `migrate deploy` pueda volver a aplicarla.
--
-- Uso:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/prisma/manual/rollback_add_domicilio_busqueda_evento.sql

BEGIN;

DROP TABLE IF EXISTS "DomicilioEvento";
ALTER TABLE "Domicilio" DROP COLUMN IF EXISTS "nombreBusqueda";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029120000_add_domicilio_busqueda_evento';

COMMIT;
