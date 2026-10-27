-- AlterTable (T1.4): límite de intentos del PIN de entrega. Aditiva.
ALTER TABLE "Package" ADD COLUMN     "intentosPin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinBloqueadoHasta" TIMESTAMP(3);
