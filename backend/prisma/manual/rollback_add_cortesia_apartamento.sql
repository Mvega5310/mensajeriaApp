-- ROLLBACK de la migración 20261029100600_add_cortesia_apartamento (revisión F2).
--
-- Quita la tabla de reservas de cortesía por apartamento. Es solo una reserva
-- para serializar la decisión: la verdad del cobro está en Package.costoServicio y
-- en PaqueteEvento (motivoCobro), que no se tocan. El código anterior ignora la
-- tabla. También borra la fila de `_prisma_migrations` para que `migrate deploy`
-- no crea que sigue aplicada.

BEGIN;

DROP TABLE IF EXISTS "CortesiaApartamento";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029100600_add_cortesia_apartamento';

COMMIT;
