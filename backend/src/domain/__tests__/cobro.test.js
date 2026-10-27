// Pruebas unitarias de las reglas de cobro (T1.2). Sin base de datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularCobro, esPrimeraEntrega, CATEGORIAS_VALIDAS } from '../cobro.js';
import { AppError, CODIGOS } from '../errores.js';

const tarifas = { MANO: 3000, ESTANDAR: 5000, VOLUMEN: 8000, PESADO: 12000 };
const base = { tarifas, categoria: 'ESTANDAR', esPrimeraEntrega: false, bonosHabilitados: false, creditosBono: 0 };

test('esPrimeraEntrega: sin paquetes previos del apto => true', () => {
  assert.equal(esPrimeraEntrega({ createdAt: new Date('2026-01-02'), createdAtDelApto: [] }), true);
  assert.equal(esPrimeraEntrega({ createdAt: new Date('2026-01-02') }), true);
});

test('esPrimeraEntrega: el propio paquete como único del apto => true', () => {
  const f = new Date('2026-01-02');
  assert.equal(esPrimeraEntrega({ createdAt: f, createdAtDelApto: [f] }), true);
});

test('esPrimeraEntrega: hay uno anterior (de cualquier cuenta del apto) => false', () => {
  assert.equal(esPrimeraEntrega({
    createdAt: new Date('2026-01-05'),
    createdAtDelApto: [new Date('2026-01-02'), new Date('2026-01-05')],
  }), false);
});

test('esPrimeraEntrega: los posteriores no cuentan; empate exacto => ambos primera', () => {
  const f = new Date('2026-01-02');
  assert.equal(esPrimeraEntrega({ createdAt: f, createdAtDelApto: [new Date('2026-02-01')] }), true);
  assert.equal(esPrimeraEntrega({ createdAt: f, createdAtDelApto: [new Date(f.getTime())] }), true);
});

test('esPrimeraEntrega acepta timestamps numéricos', () => {
  assert.equal(esPrimeraEntrega({ createdAt: 200, createdAtDelApto: [100] }), false);
  assert.equal(esPrimeraEntrega({ createdAt: 100, createdAtDelApto: [200] }), true);
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
