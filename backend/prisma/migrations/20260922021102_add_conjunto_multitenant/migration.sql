-- AlterTable
ALTER TABLE "Bono" ADD COLUMN     "conjuntoId" TEXT;

-- AlterTable
ALTER TABLE "Comentario" ADD COLUMN     "conjuntoId" TEXT;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "conjuntoId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "conjuntoId" TEXT;

-- CreateTable
CREATE TABLE "Conjunto" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "codigoInvitacion" TEXT NOT NULL,
    "invitacionActiva" BOOLEAN NOT NULL DEFAULT true,
    "operadorNombre" TEXT NOT NULL,
    "operadorWhatsapp" TEXT NOT NULL,
    "operadorDomicilio" TEXT NOT NULL,
    "puntoRecepcion" TEXT NOT NULL,
    "tarifaMano" INTEGER NOT NULL DEFAULT 3000,
    "tarifaEstandar" INTEGER NOT NULL DEFAULT 4500,
    "tarifaVolumen" INTEGER NOT NULL DEFAULT 7000,
    "tarifaPesado" INTEGER NOT NULL DEFAULT 12000,
    "bonosHabilitados" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conjunto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conjunto_slug_key" ON "Conjunto"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Conjunto_codigoInvitacion_key" ON "Conjunto"("codigoInvitacion");

-- CreateIndex
CREATE INDEX "Bono_conjuntoId_idx" ON "Bono"("conjuntoId");

-- CreateIndex
CREATE INDEX "Comentario_conjuntoId_idx" ON "Comentario"("conjuntoId");

-- CreateIndex
CREATE INDEX "Package_conjuntoId_estado_idx" ON "Package"("conjuntoId", "estado");

-- CreateIndex
CREATE INDEX "User_conjuntoId_role_idx" ON "User"("conjuntoId", "role");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bono" ADD CONSTRAINT "Bono_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
