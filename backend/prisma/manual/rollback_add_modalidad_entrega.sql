-- ROLLBACK de la migración 20261102120000_add_modalidad_entrega (T2.8).
--
-- Quita Package.modalidadEntrega (preferencia DOMICILIO | RECOGER del residente).
-- PIERDE esa preferencia; el estado y el resto del paquete no se tocan. El código
-- anterior ignora la columna. También borra la fila de `_prisma_migrations` para
-- que `migrate deploy` no crea que sigue aplicada.

BEGIN;

ALTER TABLE "Package" DROP COLUMN IF EXISTS "modalidadEntrega";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261102120000_add_modalidad_entrega';

COMMIT;
