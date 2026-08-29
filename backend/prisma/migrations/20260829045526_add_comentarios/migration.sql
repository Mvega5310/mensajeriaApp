-- CreateTable
CREATE TABLE "Comentario" (
    "id" TEXT NOT NULL,
    "residenteId" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comentario_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_residenteId_fkey" FOREIGN KEY ("residenteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
