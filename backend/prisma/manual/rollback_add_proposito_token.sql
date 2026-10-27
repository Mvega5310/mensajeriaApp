-- ROLLBACK de la migración 20261031120000_add_proposito_token (T3.2).
--
-- Quita el propósito de los tokens. ANTES borra los tokens de acceso (ACCESO):
-- sin la columna no se distinguirían de los de restablecer contraseña y un
-- enlace de acceso pendiente serviría para cambiar la clave. Los de RESET no se
-- tocan. También borra la fila de `_prisma_migrations` para que `migrate deploy`
-- no crea que sigue aplicada. El código anterior a T3.2 ignora la columna.

BEGIN;

DELETE FROM "PasswordResetToken" WHERE "proposito" = 'ACCESO';
ALTER TABLE "PasswordResetToken" DROP COLUMN IF EXISTS "proposito";
DROP TYPE IF EXISTS "PropositoToken";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261031120000_add_proposito_token';

COMMIT;
