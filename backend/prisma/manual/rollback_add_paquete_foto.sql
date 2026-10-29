-- ROLLBACK de la migración 20261029100400_add_paquete_foto (T5.1).
--
-- Quita la tabla PaqueteFoto (referencias a fotos del almacén) y la fila de
-- `_prisma_migrations`. ATENCIÓN: las fotos nuevas viven en el bucket y esta tabla
-- es lo único que las enlaza a su paquete; al borrarla esas fotos quedan huérfanas
-- (los objetos siguen en el bucket, pero sin referencia). Las fotos antiguas
-- (Package.fotoUrl) no se tocan. Revertir el despliegue de la app ANTES o junto
-- con este script.

BEGIN;

DROP TABLE IF EXISTS "PaqueteFoto";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029100400_add_paquete_foto';

COMMIT;
