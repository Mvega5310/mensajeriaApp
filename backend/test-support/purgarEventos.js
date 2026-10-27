// SOLO PARA PRUEBAS. PaqueteEvento es de solo inserción (trigger Postgres), así
// que la limpieza de las pruebas de integración necesita la vía de purga que la
// migración deja explícita: bandera de transacción `puertaya.purga_eventos`.
// Usa SQL crudo a propósito: las carpetas de pruebas están fuera de la auditoría
// de invariantes (E7.2) y este archivo nunca se importa desde src/.
export async function purgarEventos(prisma, conjuntoId) {
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('puertaya.purga_eventos', 'on', true)`,
    prisma.$executeRaw`DELETE FROM "PaqueteEvento" WHERE "conjuntoId" = ${conjuntoId}`,
  ]);
}
