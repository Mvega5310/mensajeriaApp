-- ROLLBACK de la migración 20261029100800_add_paquete_residente_idx (M5, T8.1).
--
-- Quita el índice [conjuntoId, residenteId, estado] de Package. Solo es un índice:
-- no se pierde ningún dato y el código sigue funcionando (más lento en listMine y
-- /api/p/paquetes). También borra la fila de `_prisma_migrations` para que
-- `migrate deploy` no crea que sigue aplicada.

BEGIN;

DROP INDEX IF EXISTS "Package_conjuntoId_residenteId_estado_idx";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029100800_add_paquete_residente_idx';

COMMIT;
