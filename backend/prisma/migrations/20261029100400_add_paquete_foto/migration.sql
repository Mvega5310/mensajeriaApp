-- CreateTable
CREATE TABLE "PaqueteFoto" (
    "id" TEXT NOT NULL,
    "conjuntoId" TEXT NOT NULL,
    "paqueteId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaqueteFoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaqueteFoto_conjuntoId_paqueteId_orden_idx" ON "PaqueteFoto"("conjuntoId", "paqueteId", "orden");

-- AddForeignKey
ALTER TABLE "PaqueteFoto" ADD CONSTRAINT "PaqueteFoto_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaqueteFoto" ADD CONSTRAINT "PaqueteFoto_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

