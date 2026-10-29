-- ROLLBACK de la migración 20261029100000_add_paquete_evento (T1.3).
--
-- Quita el trigger, la función y la tabla PaqueteEvento. PIERDE la bitácora de
-- eventos de estado (los paquetes y su estado actual no se tocan). También borra
-- la fila de `_prisma_migrations` para que `migrate deploy` no crea que sigue
-- aplicada. El código anterior a T1.3 ignora la tabla, así que se puede
-- desplegar encima.

BEGIN;

DROP TRIGGER IF EXISTS "PaqueteEvento_solo_insercion" ON "PaqueteEvento";
DROP FUNCTION IF EXISTS "paquete_evento_solo_insercion"();
DROP TABLE IF EXISTS "PaqueteEvento";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029100000_add_paquete_evento';

COMMIT;
