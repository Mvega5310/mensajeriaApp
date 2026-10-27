-- CreateTable
CREATE TABLE "CortesiaApartamento" (
    "id" TEXT NOT NULL,
    "conjuntoId" TEXT NOT NULL,
    "claveApto" TEXT NOT NULL,
    "paqueteId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CortesiaApartamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CortesiaApartamento_paqueteId_key" ON "CortesiaApartamento"("paqueteId");

-- CreateIndex
CREATE UNIQUE INDEX "CortesiaApartamento_conjuntoId_claveApto_key" ON "CortesiaApartamento"("conjuntoId", "claveApto");

-- AddForeignKey
ALTER TABLE "CortesiaApartamento" ADD CONSTRAINT "CortesiaApartamento_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- DEFERRABLE INITIALLY DEFERRED (a mano, Prisma no lo modela): al recibir un paquete NUEVO
-- la cortesía se reserva ANTES de insertar el paquete (con su id ya fijado), dentro de la
-- misma transacción; la FK se comprueba al confirmar. `prisma migrate diff` no lo ve como drift.
ALTER TABLE "CortesiaApartamento" ADD CONSTRAINT "CortesiaApartamento_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
