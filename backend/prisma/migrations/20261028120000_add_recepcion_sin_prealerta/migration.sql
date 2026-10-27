-- AlterTable
ALTER TABLE "Conjunto" ADD COLUMN     "custodiaMaxDias" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "franjasEntrega" JSONB,
ADD COLUMN     "maxFotos" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "prefijoPais" TEXT NOT NULL DEFAULT '57';

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "etiquetaNombre" TEXT,
ADD COLUMN     "metodoPago" TEXT,
ADD COLUMN     "recibidoEn" TIMESTAMP(3),
ADD COLUMN     "transportadora" TEXT,
ALTER COLUMN "residenteId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Package_conjuntoId_guia_idx" ON "Package"("conjuntoId", "guia");

