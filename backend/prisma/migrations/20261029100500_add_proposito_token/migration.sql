-- CreateEnum
CREATE TYPE "PropositoToken" AS ENUM ('RESET', 'ACCESO');

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "proposito" "PropositoToken" NOT NULL DEFAULT 'RESET';
