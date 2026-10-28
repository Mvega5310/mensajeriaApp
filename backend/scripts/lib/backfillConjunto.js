// Lógica PURA del backfill de un conjunto sobre datos de legado (KAN-8, Fase F).
// Sin readline ni prompts: recibe la config ya parseada y un flag `apply`.
//
// A diferencia de altaDeConjunto (crea Conjunto + operador NUEVO), esto crea el
// Conjunto SIN usuario y asigna el conjuntoId a las filas existentes (Ipanema:
// Francisco ya es un User OPERATOR). Es idempotente: una corrida con 0 NULLs no
// cambia nada.

import { prisma } from '../../src/config/db.js';
import { generarCodigoInvitacion } from '../../src/services/invitacion.service.js';
import {
  TABLAS_CON_TENANT,
  asignarConjuntoALegado,
  contarPorTabla,
  contarAsignadasAOtroConjunto,
  contarInconsistenciasCruzadas,
  contarOperadoresDelConjunto,
  bloquearTablasConTenant,
} from './asignarConjuntoALegado.js';

export const RESULTADO = Object.freeze({
  DRY_RUN: 'DRY_RUN',
  APLICADO: 'APLICADO',
  SIN_CAMBIOS: 'SIN_CAMBIOS', // idempotente: 0 filas por asignar
  CONJUNTO_CREADO: 'CONJUNTO_CREADO', // --solo-conjunto: creó el conjunto, sin tocar filas
  CONJUNTO_YA_EXISTE: 'CONJUNTO_YA_EXISTE', // --solo-conjunto: ya existía (config igual), nada que hacer
});

// Campos de config que deben coincidir si el conjunto ya existe (caso P1).
const CAMPOS_CONFIG = [
  'nombre', 'slug', 'operadorNombre', 'operadorWhatsapp', 'operadorDomicilio',
  'puntoRecepcion', 'tarifaMano', 'tarifaEstandar', 'tarifaVolumen', 'tarifaPesado',
];

class BackfillError extends Error {}

// lock_timeout del LOCK TABLE (env BACKFILL_LOCK_TIMEOUT, default 10s). Solo se
// aceptan enteros con 'ms' o 's': el valor llega a Postgres como parámetro, pero
// validarlo da un error claro antes de abrir nada.
function lockTimeoutConfigurado() {
  const valor = process.env.BACKFILL_LOCK_TIMEOUT ?? '10s';
  if (!/^\d+(ms|s)$/.test(valor)) {
    throw new BackfillError(
      `BACKFILL_LOCK_TIMEOUT inválido ("${valor}"): usa un entero con ms o s, p. ej. 10s o 500ms.`
    );
  }
  return valor;
}

// Prisma envuelve el error de Postgres; 55P03 = lock_not_available (lock_timeout vencido).
function esLockTimeout(err) {
  const textos = [err?.message, err?.meta?.code, err?.meta?.message].filter(Boolean).join(' ');
  return /55P03|lock timeout/i.test(textos);
}

function validarConfig(config) {
  for (const campo of ['nombre', 'slug', 'operadorNombre', 'operadorWhatsapp', 'operadorDomicilio', 'puntoRecepcion']) {
    if (!config[campo] || typeof config[campo] !== 'string') {
      throw new BackfillError(`config.${campo} es obligatorio`);
    }
  }
  for (const t of ['tarifaMano', 'tarifaEstandar', 'tarifaVolumen', 'tarifaPesado']) {
    if (!Number.isInteger(config[t]) || config[t] < 0) {
      throw new BackfillError(`config.${t} debe ser un entero >= 0`);
    }
  }
  if ('bonosHabilitados' in config && config.bonosHabilitados === true) {
    // No lo aceptamos nunca; avisamos explícitamente para que no se cuele.
    throw new BackfillError('bonosHabilitados no se acepta en el backfill: siempre queda false');
  }
}

// Diferencias entre la config pedida y un conjunto ya existente.
function diferenciasConfig(existente, config) {
  const difs = [];
  for (const campo of CAMPOS_CONFIG) {
    if (existente[campo] !== config[campo]) {
      difs.push({ campo, enBD: existente[campo], enConfig: config[campo] });
    }
  }
  return difs;
}

// SQL de rollback: deja en NULL exactamente lo asignado a este conjunto.
function sqlRollback(conjuntoId) {
  return TABLAS_CON_TENANT.map(
    (t) => `UPDATE "${t}" SET "conjuntoId" = NULL WHERE "conjuntoId" = '${conjuntoId}';`
  );
}

/**
 * Ejecuta (o ensaya) el backfill.
 * @param {object} opts
 * @param {object} opts.config  config del conjunto (ya parseada/validada por el CLI)
 * @param {boolean} opts.apply  true = escribe; false (default) = dry-run
 * @param {(msg:string)=>void} [opts.log]  sink de logs (default: no-op)
 * @returns {Promise<object>} reporte
 */
export async function backfillConjunto({ config, apply = false, soloConjunto = false, log = () => {} }) {
  validarConfig(config);
  const lockTimeout = lockTimeoutConfigurado();

  // --- Pre-chequeos (fuera de la transacción de escritura; solo lectura) ---
  const conteosAntes = await contarPorTabla(prisma);
  log(`Conteos antes: ${JSON.stringify(conteosAntes)}`);

  // ¿Ya existe el conjunto por slug? (caso P1: creado días antes, sin backfill)
  const existente = await prisma.conjunto.findUnique({ where: { slug: config.slug } });
  if (existente) {
    const difs = diferenciasConfig(existente, config);
    if (difs.length > 0) {
      throw new BackfillError(
        `El conjunto "${config.slug}" ya existe con config DISTINTA del JSON; no se sobrescribe. ` +
          `Diferencias: ${JSON.stringify(difs)}`
      );
    }
    log(`Conjunto "${config.slug}" ya existe (caso P1): se reutiliza.`);
  }

  // --- Modo --solo-conjunto (paso P1): crea el Conjunto SIN tocar ninguna fila.
  //     Excluyente con el backfill completo. No exige el pre-chequeo de "1
  //     operador" (no asigna nada) ni mira NULLs: solo la config del conjunto.
  if (soloConjunto) {
    if (!apply) {
      log('DRY-RUN (--solo-conjunto): crearía el conjunto, sin tocar filas.');
      return {
        resultado: RESULTADO.DRY_RUN,
        soloConjunto: true,
        conteosAntes,
        conjuntoExistente: !!existente,
      };
    }
    if (existente) {
      // Config ya validada como igual arriba; no se hace nada.
      log(`Conjunto "${config.slug}" ya existe (config igual): nada que crear.`);
      return {
        resultado: RESULTADO.CONJUNTO_YA_EXISTE,
        soloConjunto: true,
        conjunto: existente,
        codigoInvitacion: existente.codigoInvitacion,
        conteosAntes,
      };
    }
    const codigoInvitacion = generarCodigoInvitacion({ prefijo: config.slug });
    const conjunto = await prisma.conjunto.create({
      data: {
        nombre: config.nombre,
        slug: config.slug,
        codigoInvitacion,
        operadorNombre: config.operadorNombre,
        operadorWhatsapp: config.operadorWhatsapp,
        operadorDomicilio: config.operadorDomicilio,
        puntoRecepcion: config.puntoRecepcion,
        tarifaMano: config.tarifaMano,
        tarifaEstandar: config.tarifaEstandar,
        tarifaVolumen: config.tarifaVolumen,
        tarifaPesado: config.tarifaPesado,
        // bonosHabilitados omitido -> false por default.
      },
    });
    log(`Conjunto "${config.slug}" creado (sin tocar filas).`);
    return {
      resultado: RESULTADO.CONJUNTO_CREADO,
      soloConjunto: true,
      conjunto,
      codigoInvitacion: conjunto.codigoInvitacion,
      conteosAntes,
    };
  }

  // Filas apuntando a OTRO conjunto -> no es un backfill limpio.
  // (si el conjunto aún no existe, conjuntoId objetivo es desconocido todavía;
  // usamos el existente si lo hay, o verificamos que no haya NINGÚN conjuntoId
  // no-nulo ajeno al que vamos a crear).
  const idTentativo = existente?.id ?? '__NUEVO__';
  const ajenas = await contarAsignadasAOtroConjunto(prisma, idTentativo);
  if (ajenas > 0) {
    throw new BackfillError(
      `Hay ${ajenas} filas con conjuntoId de OTRO conjunto; no es un backfill limpio de Ipanema. Abortado.`
    );
  }

  // Exactamente 1 OPERATOR entre los que quedarán en el conjunto
  // (operadorDelConjuntoActual depende de esto). La consulta cruda vive en el
  // archivo autorizado (asignarConjuntoALegado.js), no aquí.
  const numOperadores = await contarOperadoresDelConjunto(prisma, idTentativo);
  if (numOperadores !== 1) {
    throw new BackfillError(
      `Se esperaba exactamente 1 operador para el conjunto, hay ${numOperadores}. ` +
        `operadorDelConjuntoActual() depende de que sea 1. Abortado.`
    );
  }

  const totalNulos = Object.values(conteosAntes).reduce((s, c) => s + c.nulos, 0);

  // --- dry-run: no escribe ---
  if (!apply) {
    log('DRY-RUN: no se escribe nada.');
    return {
      resultado: RESULTADO.DRY_RUN,
      conteosAntes,
      filasPorAsignar: totalNulos,
      conjuntoExistente: !!existente,
    };
  }

  // --- Transacción única: lock + recuento + (crear conjunto si falta) + asignar + verificar ---
  // Con --apply SIEMPRE se abre la transacción y se toma el lock, aun si el
  // pre-chequeo vio 0 NULLs: ese conteo (fuera de la txn) no ve INSERTs en curso
  // sin confirmar. "Nada que hacer" solo se decide DESPUÉS del lock, cuando esos
  // escritores ya terminaron (ver DEPLOY.md).
  const reporte = await prisma.$transaction(async (tx) => {
    // 1) Bloquear las 4 tablas (SHARE ROW EXCLUSIVE): permite lecturas, bloquea
    //    escrituras concurrentes del código viejo hasta el COMMIT/ROLLBACK. Evita
    //    la carrera entre el conteo y el UPDATE en C1/C3 con tráfico vivo (ver
    //    DEPLOY.md). Los escritores esperan y luego insertan con NULL, que C3
    //    recogerá. Va PRIMERO: espera a los INSERT en curso antes de contar.
    await bloquearTablasConTenant(tx, lockTimeout);

    // 2) Recontar NULLs DENTRO de la transacción (post-lock): es la cifra
    //    consistente contra la que se decide y se verifica, no la de los
    //    pre-chequeos (tomada fuera de la txn, puede haber cambiado antes del lock).
    const conteosEnTxn = await contarPorTabla(tx);
    const nulosEnTxn = Object.values(conteosEnTxn).reduce((s, c) => s + c.nulos, 0);

    // 2b) Idempotente: conjunto existente y 0 NULLs post-lock -> nada que hacer
    //     (la transacción termina sin escribir).
    if (existente && nulosEnTxn === 0) {
      return {
        resultado: RESULTADO.SIN_CAMBIOS,
        conteosAntes: conteosEnTxn,
        filasPorAsignar: 0,
        conjunto: existente,
        codigoInvitacion: existente.codigoInvitacion,
        sqlRollback: sqlRollback(existente.id),
      };
    }

    // 3) Crear el conjunto si no existe (bonosHabilitados omitido -> false).
    let conjunto = existente;
    if (!conjunto) {
      const codigoInvitacion = generarCodigoInvitacion({ prefijo: config.slug });
      conjunto = await tx.conjunto.create({
        data: {
          nombre: config.nombre,
          slug: config.slug,
          codigoInvitacion,
          operadorNombre: config.operadorNombre,
          operadorWhatsapp: config.operadorWhatsapp,
          operadorDomicilio: config.operadorDomicilio,
          puntoRecepcion: config.puntoRecepcion,
          tarifaMano: config.tarifaMano,
          tarifaEstandar: config.tarifaEstandar,
          tarifaVolumen: config.tarifaVolumen,
          tarifaPesado: config.tarifaPesado,
        },
      });
    }

    // 4) Asignar conjuntoId a las filas de legado (SQL crudo acotado).
    const afectadas = await asignarConjuntoALegado(tx, conjunto.id);

    // 5) Verificaciones DENTRO de la transacción (si fallan -> throw -> rollback).
    //    5a) filas afectadas == NULLs post-lock por tabla.
    for (const tabla of TABLAS_CON_TENANT) {
      if (afectadas[tabla] !== conteosEnTxn[tabla].nulos) {
        throw new BackfillError(
          `Verificación fallida en ${tabla}: afectadas=${afectadas[tabla]} != nulos (post-lock)=${conteosEnTxn[tabla].nulos}`
        );
      }
    }
    //    5b) 0 NULL en las 4 tablas.
    const conteosDespues = await contarPorTabla(tx);
    for (const tabla of TABLAS_CON_TENANT) {
      if (conteosDespues[tabla].nulos !== 0) {
        throw new BackfillError(`Verificación fallida: quedan ${conteosDespues[tabla].nulos} NULL en ${tabla}`);
      }
    }
    //    5c) integridad cruzada: paquetes/bonos/comentarios con el conjunto de su residente.
    const inconsistencias = await contarInconsistenciasCruzadas(tx);
    if (inconsistencias > 0) {
      throw new BackfillError(`Verificación fallida: ${inconsistencias} filas con conjunto distinto al de su residente`);
    }

    return {
      resultado: RESULTADO.APLICADO,
      conjunto,
      codigoInvitacion: conjunto.codigoInvitacion,
      conteosAntes: conteosEnTxn, // post-lock: incluye lo que entró mientras se esperaba
      conteosDespues,
      afectadas,
      sqlRollback: sqlRollback(conjunto.id),
    };
  }, { timeout: 120_000 }) // holgado: el UPDATE de Package puede tocar muchas filas con fotos
    .catch((err) => {
      if (esLockTimeout(err)) {
        throw new BackfillError(
          `No se obtuvo el lock en ${lockTimeout}: hay una transacción larga o colgada. No se escribió nada. ` +
            'Revisa pg_stat_activity y reintenta; el backfill es idempotente.'
        );
      }
      throw err;
    });

  if (reporte.resultado === RESULTADO.SIN_CAMBIOS) {
    log('0 filas por asignar: nada que hacer (idempotente).');
  } else {
    log(`Backfill aplicado. Afectadas: ${JSON.stringify(reporte.afectadas)}`);
  }
  return reporte;
}

export { BackfillError };
