-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "bonoId" TEXT;

-- CreateTable
CREATE TABLE "Bono" (
    "id" TEXT NOT NULL,
    "residenteId" TEXT NOT NULL,
    "categoriaPeso" TEXT NOT NULL,
    "cantidadTotal" INTEGER NOT NULL,
    "cantidadUsada" INTEGER NOT NULL DEFAULT 0,
    "precioPagado" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bono_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Bono" ADD CONSTRAINT "Bono_residenteId_fkey" FOREIGN KEY ("residenteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_bonoId_fkey" FOREIGN KEY ("bonoId") REFERENCES "Bono"("id") ON DELETE SET NULL ON UPDATE CASCADE;
