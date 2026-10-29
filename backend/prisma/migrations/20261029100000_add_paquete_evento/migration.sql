-- CreateTable
CREATE TABLE "PaqueteEvento" (
    "id" TEXT NOT NULL,
    "conjuntoId" TEXT NOT NULL,
    "paqueteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "deEstado" TEXT,
    "aEstado" TEXT NOT NULL,
    "actorId" TEXT,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaqueteEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaqueteEvento_conjuntoId_paqueteId_creadoEn_idx" ON "PaqueteEvento"("conjuntoId", "paqueteId", "creadoEn");

-- AddForeignKey
ALTER TABLE "PaqueteEvento" ADD CONSTRAINT "PaqueteEvento_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaqueteEvento" ADD CONSTRAINT "PaqueteEvento_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (RESTRICT, no SET NULL: SET NULL haría un UPDATE sobre la bitácora y el trigger lo rechazaría)
ALTER TABLE "PaqueteEvento" ADD CONSTRAINT "PaqueteEvento_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Solo inserción (T1.3): la bitácora de eventos no se modifica ni se borra.
-- El trigger rechaza UPDATE y DELETE fila a fila. Única vía de purga (limpieza
-- de datos de pruebas / depuración legal explícita): dentro de una transacción,
-- `SELECT set_config('puertaya.purga_eventos', 'on', true)` y luego el DELETE.
-- La app nunca lo hace (el UPDATE sigue prohibido incluso con la bandera).
CREATE OR REPLACE FUNCTION "paquete_evento_solo_insercion"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('puertaya.purga_eventos', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PaqueteEvento es de solo inserción: % no permitido', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaqueteEvento_solo_insercion"
  BEFORE UPDATE OR DELETE ON "PaqueteEvento"
  FOR EACH ROW EXECUTE FUNCTION "paquete_evento_solo_insercion"();
