-- ROLLBACK de la migración 20261027130000_add_pin_intentos (T1.4).
--
-- Quita las columnas del límite de intentos del PIN. PIERDE el contador de
-- fallos y los bloqueos vigentes (los paquetes y sus PIN no se tocan). También
-- borra la fila de `_prisma_migrations` para que `migrate deploy` no crea que
-- sigue aplicada. El código anterior a T1.4 ignora las columnas.

BEGIN;

ALTER TABLE "Package" DROP COLUMN IF EXISTS "intentosPin";
ALTER TABLE "Package" DROP COLUMN IF EXISTS "pinBloqueadoHasta";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261027130000_add_pin_intentos';

COMMIT;
