// Pruebas unitarias de las reglas de cobro (T1.2). Sin base de datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularCobro, esPrimeraEntrega, primerasEntregas, CATEGORIAS_VALIDAS } from '../cobro.js';
import { AppError, CODIGOS } from '../errores.js';

const tarifas = { MANO: 3000, ESTANDAR: 5000, VOLUMEN: 8000, PESADO: 12000 };
const base = { tarifas, categoria: 'ESTANDAR', esPrimeraEntrega: false, bonosHabilitados: false, creditosBono: 0 };

const P = (id, estado, residenteId = 'r1') => ({ id, estado, residenteId });

test('esPrimeraEntrega: sin paquetes del apto => true', () => {
  assert.equal(esPrimeraEntrega({ paquetesDelApto: [] }), true);
  assert.equal(esPrimeraEntrega({}), true);
});

test('esPrimeraEntrega: el propio paquete no cuenta contra sí mismo', () => {
  assert.equal(esPrimeraEntrega({ paquetesDelApto: [P('a', 'EN_RECEPCION')], excluirId: 'a' }), true);
});

test('esPrimeraEntrega: otro paquete ya cobrado (de cualquier cuenta del apto) => false', () => {
  for (const estado of ['EN_RECEPCION', 'PROGRAMADO', 'ENTREGADO']) {
    assert.equal(esPrimeraEntrega({ paquetesDelApto: [P('x', estado, 'r2')], excluirId: 'a' }), false, estado);
  }
});

test('esPrimeraEntrega: SIN_ASIGNAR y PREALERTADO NO gastan la cortesía (escenario de la revisión)', () => {
  assert.equal(esPrimeraEntrega({ paquetesDelApto: [P('lunes', 'SIN_ASIGNAR', null), P('pre', 'PREALERTADO')], excluirId: 'martes' }), true);
});

test('esPrimeraEntrega: un EN_RECEPCION sin dueño no cuenta (dato imposible, no cobra)', () => {
  assert.equal(esPrimeraEntrega({ paquetesDelApto: [P('x', 'EN_RECEPCION', null)] }), true);
});

test('primerasEntregas: SIN_ASIGNAR antiguo asignado después NO es primera si otro ya se llevó la cortesía', () => {
  const k = '2|710';
  const set = primerasEntregas([
    { id: 'lunes', clave: k, estado: 'EN_RECEPCION', residenteId: 'r1', motivoCobro: 'TARIFA', cobradoEn: null, createdAt: new Date('2026-01-05') },
    { id: 'martes', clave: k, estado: 'ENTREGADO', residenteId: 'r1', motivoCobro: 'CORTESIA', cobradoEn: null, createdAt: new Date('2026-01-06') },
  ]);
  assert.deepEqual([...set], ['martes']);
});

test('primerasEntregas: legado sin eventos => el cobrado más antiguo; sin cobrados => ninguno', () => {
  const k = '1|101';
  const legado = (id, estado, f) => ({ id, clave: k, estado, residenteId: 'r', motivoCobro: null, cobradoEn: null, createdAt: new Date(f) });
  assert.deepEqual([...primerasEntregas([legado('b', 'ENTREGADO', '2026-02-01'), legado('a', 'ENTREGADO', '2026-01-01')])], ['a']);
  assert.equal(primerasEntregas([legado('p', 'PREALERTADO', '2026-01-01'), legado('s', 'SIN_ASIGNAR', '2026-01-01')]).size, 0);
});

test('primerasEntregas: apartamentos distintos son independientes', () => {
  const mk = (id, clave) => ({ id, clave, estado: 'EN_RECEPCION', residenteId: 'r', motivoCobro: 'CORTESIA', cobradoEn: null, createdAt: new Date() });
  assert.equal(primerasEntregas([mk('a', '1|1'), mk('b', '2|2')]).size, 2);
});

test('cortesía: monto 0, motivo CORTESIA, no consume bono', () => {
  assert.deepEqual(calcularCobro({ ...base, esPrimeraEntrega: true }), { monto: 0, motivo: 'CORTESIA', consumeBono: false });
});

test('cortesía tiene precedencia sobre el bono (no gasta crédito)', () => {
  assert.deepEqual(
    calcularCobro({ ...base, esPrimeraEntrega: true, bonosHabilitados: true, creditosBono: 5 }),
    { monto: 0, motivo: 'CORTESIA', consumeBono: false },
  );
});

test('bono: habilitado y con créditos => monto 0, motivo BONO, consume', () => {
  assert.deepEqual(
    calcularCobro({ ...base, bonosHabilitados: true, creditosBono: 1 }),
    { monto: 0, motivo: 'BONO', consumeBono: true },
  );
});

test('bono habilitado pero sin créditos => tarifa', () => {
  assert.deepEqual(
    calcularCobro({ ...base, bonosHabilitados: true, creditosBono: 0 }),
    { monto: 5000, motivo: 'TARIFA', consumeBono: false },
  );
});

test('bonos deshabilitados ignoran los créditos => tarifa', () => {
  assert.deepEqual(
    calcularCobro({ ...base, bonosHabilitados: false, creditosBono: 9 }),
    { monto: 5000, motivo: 'TARIFA', consumeBono: false },
  );
});

for (const cat of CATEGORIAS_VALIDAS) {
  test(`tarifa normal categoría ${cat}`, () => {
    const r = calcularCobro({ ...base, categoria: cat });
    assert.deepEqual(r, { monto: tarifas[cat], motivo: 'TARIFA', consumeBono: false });
    assert.ok(Number.isInteger(r.monto));
  });
}

test('categoría inválida => AppError DATOS_INVALIDOS 400, incluso con cortesía o bono', () => {
  for (const extra of [{}, { esPrimeraEntrega: true }, { bonosHabilitados: true, creditosBono: 3 }]) {
    for (const categoria of ['GIGANTE', undefined, null, '', 'estandar']) {
      assert.throws(
        () => calcularCobro({ ...base, ...extra, categoria }),
        (e) => e instanceof AppError && e.code === CODIGOS.DATOS_INVALIDOS && e.status === 400,
      );
    }
  }
});
