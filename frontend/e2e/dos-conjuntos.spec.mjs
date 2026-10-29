// Escenarios con DOS conjuntos activos (PLAN-conjunto S2.3/S2.4): el conjunto se elige en cada solicitud.
// Este archivo levanta su propia pila (base + backend + vite) con un conjunto B sembrado, para no alterar
// los escenarios de 1 conjunto del recorrido principal. En modo remoto (Railway, 1 conjunto) se omite.
import {
  test, expect, entorno, api, crearResidente, sesionOperador, iniciarSesion, contextoNuevo, sinScrollHorizontal,
  recibirPorUI, sufijo, siguienteApto, contadorDeToques,
} from './fixtures.mjs';
import { levantarEntorno } from './entorno.mjs';

const remoto = () => entorno().modo === 'remoto';
let pila = null;
let entornoPrevio;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  if (remoto()) return;
  entornoPrevio = process.env.E2E_ENTORNO;
  pila = await levantarEntorno({ segundoConjunto: true }); // deja su JSON en process.env.E2E_ENTORNO
});

test.afterAll(async () => {
  if (pila) await pila.detener();
  if (entornoPrevio !== undefined) process.env.E2E_ENTORNO = entornoPrevio;
  pila = null;
});

test.beforeEach(() => {
  test.skip(remoto(), 'Necesita sembrar un segundo conjunto en la base: el entorno remoto (Railway) tiene un solo conjunto.');
});

const nombreDe = (p) => p.locator('.ds-dir__linea');

test.describe('Dos conjuntos', () => {
  test('registro eligiendo B: el selector se puede cambiar y la cuenta queda en B', async ({ page }) => {
    const e = entorno();
    const s = sufijo();
    const { apto } = await siguienteApto();
    await page.goto('/registro');
    const selector = page.getByLabel('Conjunto', { exact: true });
    await expect(selector).toBeEnabled();
    await sinScrollHorizontal(page, 'Registro (2 conjuntos)');
    await page.getByLabel('Nombre completo').fill(`Registro B ${s}`);
    await page.getByLabel('Correo').fill(`regb-${s}@e2e.test`);
    await page.getByLabel('Contraseña', { exact: true }).fill('ClaveSegura123');
    await page.getByLabel('Teléfono (WhatsApp)').fill('3001234567');
    await page.getByLabel('Apartamento').fill(apto);
    await page.getByRole('checkbox', { name: /Acepto/ }).check();
    // Sin elegir conjunto: el mensaje sale junto al selector y no se crea nada.
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Falta el conjunto')).toBeVisible();
    await selector.selectOption(e.b.slug);
    await expect(page.getByText(`Te estás registrando en ${e.b.nombre}.`)).toBeVisible();
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Cuenta creada')).toBeVisible();

    const l = await api('/auth/login', { metodo: 'POST', cuerpo: { email: `regb-${s}@e2e.test`, password: 'ClaveSegura123' } });
    const d = await api('/domicilios', { token: l.datos.token });
    expect(d.datos).toHaveLength(1);
    expect(d.datos[0].conjunto.slug).toBe(e.b.slug);
  });

  test('QR nuevo /registro?conjunto=<slug> llega con B elegido', async ({ page }) => {
    const e = entorno();
    await page.goto(`/registro?conjunto=${e.b.slug}`);
    await expect(page.getByLabel('Conjunto', { exact: true })).toHaveValue(e.b.slug);
    await expect(page.getByText(`Te estás registrando en ${e.b.nombre}.`)).toBeVisible();
  });

  test('ayudar a un amigo: persona de A avisa en B; el operador de B lo ve y lo recibe; el de A no; "Mis paquetes" muestra B', async ({ browser, page, context }, testInfo) => {
    const e = entorno();
    const res = await crearResidente(); // registrada en A
    const guia = `AMI${sufijo().toUpperCase()}`;
    const aptoB = (await siguienteApto()).apto;
    const amigo = { nombre: `Amigo ${sufijo()}`, apto: aptoB };

    const ctxRes = await contextoNuevo(browser, testInfo, e.baseUrl);
    await iniciarSesion(ctxRes, res.token);
    const pr = await ctxRes.newPage();
    const c = contadorDeToques();
    await pr.goto('/paquetes/avisar');
    // Con 2 conjuntos activos la línea ya nombra el conjunto, pero sigue sin campos de dirección.
    await expect(nombreDe(pr)).toContainText(e.a.nombre);
    await expect(pr.getByLabel('Apartamento')).toHaveCount(0);
    await sinScrollHorizontal(pr, 'Avisar (2 conjuntos)');

    await c.tocar(pr.getByRole('button', { name: 'Cambiar' }));
    await c.tocar(pr.getByRole('radio', { name: 'Otra dirección' }));
    await pr.getByLabel('Conjunto', { exact: true }).selectOption(e.b.slug);
    c.n += 1; // elegir el conjunto
    await pr.getByLabel('Torre').fill('1');
    await pr.getByLabel('Apartamento').fill(amigo.apto);
    await pr.getByLabel('Nombre de quien recibe').fill(amigo.nombre);
    await pr.getByLabel('Teléfono').fill('3009998877');
    await c.tocar(pr.getByRole('button', { name: 'Usar esta dirección' }));
    await expect(nombreDe(pr)).toContainText(e.b.nombre);
    await expect(nombreDe(pr)).toContainText(amigo.nombre);
    await c.tocar(pr.getByRole('radio', { name: 'Servientrega' }));
    await pr.getByLabel('Número de guía').fill(guia);
    await c.tocar(pr.getByRole('button', { name: 'Avisar', exact: true }));
    await expect(pr).toHaveURL(/\/paquetes$/);
    await expect(pr.getByText(/Avisado/)).toBeVisible();
    testInfo.annotations.push({ type: 'toques-ayudar-a-un-amigo', description: String(c.n) });
    console.log(`[e2e] toques "ayudar a un amigo" (${testInfo.project.name}): ${c.n}`);

    // Mis paquetes nombra el conjunto del paquete (la persona tiene direcciones en 2).
    await expect(pr.getByText(e.b.nombre).first()).toBeVisible();

    // La API: el operador de B ve la pre-alerta; el de A no.
    const tokenA = await sesionOperador();
    const tokenB = await sesionOperador(e.b.operador);
    const verEn = async (token) => {
      const r = await api('/packages', { token });
      expect(r.ok).toBe(true);
      const lista = Array.isArray(r.datos) ? r.datos : (r.datos.packages ?? r.datos.paquetes ?? []);
      return lista.filter((p) => p.guia === guia);
    };
    expect(await verEn(tokenB), 'el operador de B ve la pre-alerta').toHaveLength(1);
    expect(await verEn(tokenA), 'el operador de A no la ve').toHaveLength(0);

    // El operador de B la recibe por la guía (UI) y se vincula: un solo paquete.
    await iniciarSesion(context, tokenB);
    await recibirPorUI(page, amigo, { guia });
    expect(await verEn(tokenB)).toHaveLength(1);
    await pr.reload();
    await expect(pr.getByText(/En portería/)).toBeVisible();
    await expect(pr.getByText(e.b.nombre).first()).toBeVisible();
    await sinScrollHorizontal(pr, 'Mis paquetes (2 conjuntos)');
    await ctxRes.close();
  });

  test('C5: dos personas en el mismo apartamento de B se distinguen por nombre en Recibir', async ({ page, context }) => {
    const e = entorno();
    const { apto } = await siguienteApto();
    const nombres = [`Ana ${sufijo()}`, `Luis ${sufijo()}`];
    for (const nombre of nombres) {
      const s = sufijo();
      const reg = await api('/auth/register', {
        metodo: 'POST',
        cuerpo: { nombre, email: `c5-${s}@e2e.test`, password: 'ClaveSegura123', telefono: '3001234567', torre: 'Torre 1', apto, acceptedTerms: true, conjunto: e.b.slug },
      });
      expect(reg.ok, reg.datos.message).toBe(true);
    }
    await iniciarSesion(context, await sesionOperador(e.b.operador));
    await page.goto('/op/recibir');
    for (const d of apto) await page.locator('.ds-key', { hasText: new RegExp(`^${d}$`) }).first().click();
    for (const nombre of nombres) await expect(page.locator('.op-sug', { hasText: nombre })).toBeVisible();
    await expect(page.locator('.op-sug')).toHaveCount(2);
    await sinScrollHorizontal(page, 'Recibir (mismo apto)');
  });

  test('InvitarVista del operador usa /registro?conjunto=<slug>', async ({ page, context }) => {
    const e = entorno();
    await iniciarSesion(context, await sesionOperador(e.b.operador));
    await page.goto('/op/recibir');
    await page.getByRole('button', { name: 'Más' }).click();
    await page.getByRole('button', { name: /invitar|QR/i }).first().click();
    await expect(page.getByText(`/registro?conjunto=${e.b.slug}`)).toBeVisible();
  });
});
