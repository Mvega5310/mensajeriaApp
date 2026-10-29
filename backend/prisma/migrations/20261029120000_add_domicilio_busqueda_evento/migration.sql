-- Revisión S3.2 (C5 / spam): búsqueda por nombre en la base y bitácora de domicilios.
-- Solo ADITIVA: una columna con default, una tabla nueva y su backfill idempotente.

-- AlterTable
ALTER TABLE "Domicilio" ADD COLUMN     "nombreBusqueda" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "DomicilioEvento" (
    "id" TEXT NOT NULL,
    "conjuntoId" TEXT NOT NULL,
    "domicilioId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "actorId" TEXT,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomicilioEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomicilioEvento_conjuntoId_domicilioId_creadoEn_idx" ON "DomicilioEvento"("conjuntoId", "domicilioId", "creadoEn");

-- AddForeignKey
ALTER TABLE "DomicilioEvento" ADD CONSTRAINT "DomicilioEvento_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomicilioEvento" ADD CONSTRAINT "DomicilioEvento_domicilioId_fkey" FOREIGN KEY ("domicilioId") REFERENCES "Domicilio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomicilioEvento" ADD CONSTRAINT "DomicilioEvento_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BACKFILL: nombreBusqueda = nombreRecibe sin tildes y en minúsculas, igual que
-- domain/apartamento.js#sinTildes (NFD + quitar diacríticos + minúsculas; la ñ pasa a n).
-- Se traducen primero las vocales/ñ/ç acentuadas (mayúsculas y minúsculas) a ASCII y luego
-- lower(): así no depende de la configuración regional (LC_CTYPE) de la base.
-- Idempotente: solo toca filas con nombreBusqueda vacío.
UPDATE "Domicilio"
SET "nombreBusqueda" = lower(translate("nombreRecibe",
      'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÝýÿÑñÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyyNnCc'))
WHERE "nombreBusqueda" = '';
