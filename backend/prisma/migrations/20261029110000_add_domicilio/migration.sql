-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "domicilioId" TEXT;

-- CreateTable
CREATE TABLE "Domicilio" (
    "id" TEXT NOT NULL,
    "conjuntoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "torre" TEXT NOT NULL DEFAULT '',
    "apto" TEXT NOT NULL DEFAULT '',
    "nombreRecibe" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "ultimoUsoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Domicilio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioConjunto" (
    "usuarioId" TEXT NOT NULL,
    "conjuntoId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsuarioConjunto_pkey" PRIMARY KEY ("usuarioId","conjuntoId")
);

-- CreateIndex
CREATE INDEX "Domicilio_conjuntoId_apto_idx" ON "Domicilio"("conjuntoId", "apto");

-- CreateIndex
CREATE UNIQUE INDEX "Domicilio_conjuntoId_usuarioId_torre_apto_key" ON "Domicilio"("conjuntoId", "usuarioId", "torre", "apto");

-- CreateIndex
CREATE INDEX "Package_conjuntoId_domicilioId_idx" ON "Package"("conjuntoId", "domicilioId");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_domicilioId_fkey" FOREIGN KEY ("domicilioId") REFERENCES "Domicilio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domicilio" ADD CONSTRAINT "Domicilio_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domicilio" ADD CONSTRAINT "Domicilio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioConjunto" ADD CONSTRAINT "UsuarioConjunto_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioConjunto" ADD CONSTRAINT "UsuarioConjunto_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- MIGRACIÓN DE DATOS (PLAN-conjunto C4): cada RESIDENT existente conserva su torre y
-- apartamento como su primer Domicilio en SU conjunto, y cada paquete con residente se
-- enlaza con el Domicilio de ese residente en el conjunto del paquete.
--
-- Forma canónica (idéntica a services/domicilio.service.js#canonicalizarDireccion):
--   torre = tokenTorre(torre) ?? ''  -> sin tildes, mayúsculas, sin el prefijo "TORRE",
--           solo A-Z0-9, sin "T" delante de un dígito, sin ceros a la izquierda de un número.
--   apto  = solo dígitos ?? ''
-- Solo ADITIVA: no borra ni modifica datos existentes (User.torre/apto/nombre/telefono se
-- quedan). Idempotente: ids deterministas, ON CONFLICT DO NOTHING y WHERE domicilioId IS NULL.
-- ============================================================================

-- 1) Un Domicilio por residente, en su conjunto.
INSERT INTO "Domicilio" ("id", "conjuntoId", "usuarioId", "torre", "apto", "nombreRecibe", "telefono", "ultimoUsoEn", "activo", "creadoEn")
SELECT
    'dom' || substr(md5(u."id" || ':' || u."conjuntoId"), 1, 22),
    u."conjuntoId",
    u."id",
    COALESCE(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              translate(upper(btrim(COALESCE(u."torre", ''))), 'ÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑ', 'AAAAEEEEIIIIOOOOUUUUN'),
              '^TORRE\y\s*', ''),
            '[^A-Z0-9]', '', 'g'),
          '^T(?=[0-9])', ''),
        '^0+(?=[0-9])', ''),
      ''),
    COALESCE(regexp_replace(COALESCE(u."apto", ''), '[^0-9]', '', 'g'), ''),
    u."nombre",
    u."telefono",
    u."createdAt",
    true,
    u."createdAt"
FROM "User" u
WHERE u."role" = 'RESIDENT'
ON CONFLICT DO NOTHING;

-- 2) Índice persona -> conjunto (sin datos personales).
INSERT INTO "UsuarioConjunto" ("usuarioId", "conjuntoId")
SELECT d."usuarioId", d."conjuntoId" FROM "Domicilio" d
ON CONFLICT DO NOTHING;

-- 3) Paquetes con residente -> Domicilio de ese residente en el conjunto del paquete.
UPDATE "Package" p
SET "domicilioId" = d."id"
FROM "Domicilio" d
WHERE p."domicilioId" IS NULL
  AND p."residenteId" IS NOT NULL
  AND d."usuarioId" = p."residenteId"
  AND d."conjuntoId" = p."conjuntoId";
