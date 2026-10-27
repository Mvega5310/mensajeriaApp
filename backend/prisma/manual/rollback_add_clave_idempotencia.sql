-- ROLLBACK de la migración 20261029120000_add_clave_idempotencia (T2.3).
--
-- Quita la tabla ClaveIdempotencia (claves de reintento de POST /packages/recepcion)
-- y la fila de `_prisma_migrations`. Solo pierde las claves de idempotencia (dato
-- desechable de 24 h): los paquetes no se tocan. El código de T2.3 necesita la
-- tabla: revertir el despliegue de la app ANTES o junto con este script.

BEGIN;

DROP TABLE IF EXISTS "ClaveIdempotencia";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029120000_add_clave_idempotencia';

COMMIT;
