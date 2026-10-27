-- CreateTable
CREATE TABLE "ClaveIdempotencia" (
    "id" TEXT NOT NULL,
    "conjuntoId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "paqueteId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaveIdempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaveIdempotencia_conjuntoId_creadoEn_idx" ON "ClaveIdempotencia"("conjuntoId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "ClaveIdempotencia_conjuntoId_operadorId_clave_key" ON "ClaveIdempotencia"("conjuntoId", "operadorId", "clave");

-- AddForeignKey
ALTER TABLE "ClaveIdempotencia" ADD CONSTRAINT "ClaveIdempotencia_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaveIdempotencia" ADD CONSTRAINT "ClaveIdempotencia_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaveIdempotencia" ADD CONSTRAINT "ClaveIdempotencia_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

