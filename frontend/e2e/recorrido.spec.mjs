// Recorrido principal de Puertayá (T6.1): LLEGA -> REGISTRO -> AVISO -> ENTREGA CON PIN.
// Cada escenario crea sus propios datos (residente y apartamento únicos) y es independiente.
// Corre en `movil` (390x844) y `escritorio` (1280x800). Ver README, "Pruebas E2E".
import {
  test, expect, entorno, api, crearResidente, sesionOperador, recibirPorApi, misPaquetes, pinDe,
  enlaceDe, sql, sinPin, iniciarSesion, contextoNuevo, sinScrollHorizontal, teclear, recibirPorUI,
  sufijo, siguienteApto,
} from './fixtures.mjs';
import crypto from 'node:crypto';

const remoto = () => entorno().modo === 'remoto';

test.describe('Residente: registro y acceso', () => {
  test('se registra con el código de invitación y entra', async ({ page }) => {
    const s = sufijo();
    const { apto } = siguienteApto();
    const nombre = `Registro ${s}`;
    const email = `reg-${s}@e2e.test`;
    await page.goto(`/registro?c=${encodeURIComponent(entorno().codigo)}`);
    await expect(page.getByRole('heading', { name: 'Crear cuenta de residente' })).toBeVisible();
    await sinScrollHorizontal(page, 'Registro');
    await page.getByLabel('Nombre completo').fill(nombre);
    await page.getByLabel('Correo').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill('ClaveSegura123');
    await page.getByLabel('Teléfono (WhatsApp)').fill('3001234567');
    await page.getByLabel('Apartamento').fill(apto);
    await page.getByRole('checkbox', { name: /Acepto/ }).check();
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Cuenta creada')).toBeVisible();

    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Correo').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill('ClaveSegura123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/paquetes$/);
    await expect(page.getByRole('heading', { name: `Hola, ${nombre.split(' ')[0]}` })).toBeVisible();
    await sinScrollHorizontal(page, 'Mis paquetes');
  });

  test('un código de invitación inválido no registra', async ({ page }) => {
    const s = sufijo();
    await page.goto('/registro');
    await page.getByLabel('Código de invitación').fill('codigo-que-no-existe');
    await page.getByLabel('Nombre completo').fill(`Falso ${s}`);
    await page.getByLabel('Correo').fill(`falso-${s}@e2e.test`);
    await page.getByLabel('Contraseña', { exact: true }).fill('ClaveSegura123');
    await page.getByLabel('Teléfono (WhatsApp)').fill('3001234567');
    await page.getByLabel('Apartamento').fill('101');
    await page.getByRole('checkbox', { name: /Acepto/ }).check();
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.locator('.ds-toast--error')).toBeVisible();
    await expect(page).toHaveURL(/\/registro/);
  });

  test('acceso por enlace mágico: entra a Mis paquetes y el enlace usado ya no sirve', async ({ page, browser }, testInfo) => {
    test.skip(remoto(), 'Necesita escribir el token del enlace en la base de datos (el correo real solo lo recibe el residente): solo en entorno local.');
    const res = await crearResidente();
    await page.goto('/acceso');
    await sinScrollHorizontal(page, 'Acceso');
    await page.getByLabel('Correo').fill(res.email);
    await page.getByRole('button', { name: 'Enviarme el enlace' }).click();
    await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

    // El token en claro solo viaja por correo (la base guarda su hash): para el E2E se crea uno
    // equivalente directamente en la base de prueba, igual que lo hace el backend.
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    sql(`INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", proposito, "expiresAt") VALUES ('e2e${sufijo()}${sufijo()}', '${res.id}', '${hash}', 'ACCESO', now() + interval '15 minutes')`);

    await page.goto(`/acceso/${token}`);
    await expect(page).toHaveURL(/\/paquetes$/);
    await expect(page.getByRole('heading', { name: /^Hola, / })).toBeVisible();
    await sinScrollHorizontal(page, 'Mis paquetes (acceso)');

    // Reutilizar el mismo token, en un navegador limpio: mensaje y opción de pedir otro.
    const otro = await contextoNuevo(browser, testInfo, entorno().baseUrl);
    const p2 = await otro.newPage();
    await p2.goto(`/acceso/${token}`);
    await expect(p2.getByText('Este enlace ya no sirve')).toBeVisible();
    await expect(p2.getByLabel('Correo')).toBeVisible();
    await sinScrollHorizontal(p2, 'Enlace usado');
    await otro.close();
  });

  test('enlace de WhatsApp alterado: "Este enlace ya no sirve"', async ({ page }) => {
    const res = await crearResidente();
    const r = await recibirPorApi({ residenteId: res.id });
    const enlace = enlaceDe(r.aviso.texto);
    expect(enlace, 'el aviso debe traer el enlace /p#token').toBeTruthy();
    const alterado = `${enlace.slice(0, -4)}${enlace.endsWith('abcd') ? 'wxyz' : 'abcd'}`;
    await page.goto(new URL(alterado).pathname + new URL(alterado).hash);
    await expect(page.getByRole('heading', { name: 'Este enlace ya no sirve' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar con correo' })).toBeVisible();
    await sinScrollHorizontal(page, 'Enlace alterado');
    // El token en la ruta (enlace viejo /p/<token>) tampoco abre nada.
    await page.goto(`/p/${enlace.split('#')[1]}`);
    await expect(page.getByRole('heading', { name: 'Este enlace ya no sirve' })).toBeVisible();
    expect(page.url()).not.toContain(enlace.split('#')[1]);
  });
});

test.describe('Operador: recibir', () => {
  test('con residente: Guardado con aviso (waUrl) y SIN PIN, en pocos toques [noche]', async ({ page, context }) => {
    const res = await crearResidente();
    await iniciarSesion(context, await sesionOperador(), { tema: 'noche' });
    const c = await recibirPorUI(page, res);

    await expect(page.locator('html')).toHaveAttribute('data-tema', 'noche');
    await expect(page.getByText(res.nombre)).toBeVisible();
    const wa = page.getByRole('link', { name: 'Avisar por WhatsApp' });
    await expect(wa).toBeVisible();
    const href = await wa.getAttribute('href');
    expect(href).toMatch(/^https:\/\/wa\.me\/57\d+\?text=/);
    const texto = decodeURIComponent(href);
    expect(texto).toContain('/p#');

    // El operador nunca ve el PIN: ni en la pantalla ni en el enlace de WhatsApp.
    const pin = await pinDe(res);
    expect(pin).toMatch(/^\d{4}$/);
    expect(sinPin(await page.locator('body').innerText(), pin), 'el PIN no debe verse en pantalla').toBe(true);
    expect(sinPin(texto, pin), 'el PIN no debe ir en el waUrl').toBe(true);
    await expect(page.getByText(/PIN \d/)).toHaveCount(0);

    // Toques hasta Guardado: teclas del apto + elegir residente + tamaño + Guardar (<= 3 + dígitos).
    expect(c.n).toBeLessThanOrEqual(3 + res.apto.length);
  });

  test('sin dueño: queda en Pendientes "Sin asignar" y se asigna', async ({ page, context }) => {
    const res = await crearResidente();
    const etiqueta = `Caja ${sufijo()}`;
    await iniciarSesion(context, await sesionOperador());
    await page.goto('/op/recibir');
    await page.getByRole('button', { name: 'Registrar sin dueño' }).click();
    await page.getByLabel('Nombre en la etiqueta').fill(etiqueta);
    await sinScrollHorizontal(page, 'Sin dueño');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.locator('.op-tile').nth(1).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Guardado', exact: true })).toBeVisible();
    await expect(page.getByText(etiqueta)).toBeVisible();
    await expect(page.getByText('Sin asignar')).toBeVisible();

    await page.getByRole('link', { name: 'Ver pendientes' }).click();
    await expect(page).toHaveURL(/\/op\/pendientes$/);
    await expect(page.getByRole('heading', { name: /^Sin asignar/ })).toBeVisible();
    await sinScrollHorizontal(page, 'Pendientes');
    const fila = page.locator('.op-fila--aviso', { hasText: etiqueta });
    await expect(fila).toBeVisible();
    await fila.getByRole('button', { name: 'Asignar' }).click();
    await page.getByLabel('Apartamento o nombre').fill(res.apto);
    await page.locator('.op-hoja .op-sug', { hasText: res.nombre }).click();
    await expect(page.getByRole('heading', { name: 'Guardado', exact: true })).toBeVisible();
    await expect(page.getByText(res.nombre)).toBeVisible();

    const mios = await misPaquetes(res);
    expect(mios).toHaveLength(1);
    expect(mios[0].pin).toMatch(/^\d{4}$/);
  });

  test('pre-alerta del residente: el operador recibe con la misma guía y se vincula (un solo paquete)', async ({ browser, page, context }, testInfo) => {
    const res = await crearResidente();
    const guia = `E2E${sufijo().toUpperCase()}`;

    // El residente avisa desde la app.
    const ctxRes = await contextoNuevo(browser, testInfo, entorno().baseUrl);
    await iniciarSesion(ctxRes, res.token);
    const pr = await ctxRes.newPage();
    await pr.goto('/paquetes/avisar');
    await sinScrollHorizontal(pr, 'Avisar');
    await pr.getByRole('radio', { name: 'Servientrega' }).click();
    await pr.getByLabel('Número de guía').fill(guia);
    await pr.getByRole('button', { name: 'Avisar', exact: true }).click();
    await expect(pr).toHaveURL(/\/paquetes$/);
    await expect(pr.getByText(/Avisado/)).toBeVisible();
    expect((await misPaquetes(res)).map((p) => p.estado)).toEqual(['PREALERTADO']);

    // El operador lo recibe con la misma guía.
    await iniciarSesion(context, await sesionOperador());
    await recibirPorUI(page, res, { guia });

    const despues = await misPaquetes(res);
    expect(despues, 'la pre-alerta se vincula: no se crea un segundo paquete').toHaveLength(1);
    expect(despues[0].estado).toBe('EN_RECEPCION');
    expect(despues[0].pin).toMatch(/^\d{4}$/);

    await pr.reload();
    await expect(pr.getByText(/En portería/)).toBeVisible();
    await ctxRes.close();
  });

  test('cortesía: el primer paquete del apto sale gratis y el segundo con tarifa', async ({ page, context }) => {
    const res = await crearResidente();
    await iniciarSesion(context, await sesionOperador());
    await recibirPorUI(page, res);
    await expect(page.getByText('Primera entrega gratis')).toBeVisible();
    await expect(page.getByText(/Cobro:/)).toHaveCount(0);

    await page.getByRole('link', { name: 'Recibir otro' }).click();
    await recibirPorUI(page, res, { nuevaPagina: false });
    await expect(page.getByText(/Cobro:\s*\$/)).toBeVisible();
    await expect(page.getByText('Primera entrega gratis')).toHaveCount(0);

    const motivos = (await misPaquetes(res)).map((p) => p.motivoCobro).sort();
    expect(motivos).toEqual(['CORTESIA', 'TARIFA']);
  });
});

test.describe('Residente por enlace de WhatsApp', () => {
  test('abre /p#token, ve el PIN, el hash se borra, pide entrega y queda "Programado"', async ({ page, browser, context }, testInfo) => {
    const res = await crearResidente();
    await iniciarSesion(context, await sesionOperador());
    await recibirPorUI(page, res);
    const texto = await page.locator('.op-msg__burbuja').innerText();
    const enlace = enlaceDe(texto);
    expect(enlace, 'aviso.texto trae el enlace /p#token').toBeTruthy();
    const pin = await pinDe(res);

    // El residente, sin sesión previa, abre el enlace en su teléfono.
    const ctxRes = await contextoNuevo(browser, testInfo, entorno().baseUrl);
    const pr = await ctxRes.newPage();
    const url = new URL(enlace);
    await pr.goto(url.pathname + url.hash);
    await expect(pr).toHaveURL(/\/paquetes$/);
    expect(pr.url(), 'el token no debe quedar en la barra de direcciones').not.toContain('#');
    await expect(pr.locator('.res-pin__valor')).toHaveText(pin);
    await sinScrollHorizontal(pr, 'Mis paquetes (enlace)');

    await pr.getByRole('link', { name: 'Pedir entrega' }).click();
    await expect(pr).toHaveURL(/\/paquetes\/entrega$/);
    await sinScrollHorizontal(pr, 'Pedir entrega');
    await pr.getByRole('radiogroup', { name: 'Franja de entrega' }).getByRole('radio').first().click();
    await pr.getByRole('button', { name: /^Confirmar / }).click();
    await expect(pr).toHaveURL(/\/paquetes$/);
    await expect(pr.getByText(/Programado/)).toBeVisible();
    expect((await misPaquetes(res))[0].estado).toBe('PROGRAMADO');
    await ctxRes.close();
  });

  test('"Prefiero recogerlo en portería" llega al operador como "Recoge en portería"', async ({ page, browser, context }, testInfo) => {
    const res = await crearResidente();
    const r = await recibirPorApi({ residenteId: res.id });
    const url = new URL(enlaceDe(r.aviso.texto));

    const ctxRes = await contextoNuevo(browser, testInfo, entorno().baseUrl);
    const pr = await ctxRes.newPage();
    await pr.goto(url.pathname + url.hash);
    await expect(pr.locator('.res-pin__valor')).toBeVisible();
    await pr.getByRole('link', { name: 'Pedir entrega' }).click();
    await pr.getByRole('button', { name: 'Prefiero recogerlo en portería' }).click();
    await expect(pr).toHaveURL(/\/paquetes$/);
    await ctxRes.close();

    await iniciarSesion(context, await sesionOperador());
    await page.goto('/op/pendientes');
    await page.getByLabel('Buscar').fill(res.apto);
    await expect(page.locator('.op-fila', { hasText: res.nombre }).getByText('Recoge en portería')).toBeVisible();
    await sinScrollHorizontal(page, 'Pendientes');
  });
});

test.describe('Operador: entrega con PIN', () => {
  test('lote: PIN -> todos los paquetes del apto -> Transferencia -> Entregar todo; el residente ve el historial [noche]', async ({ page, browser, context }, testInfo) => {
    const res = await crearResidente();
    await recibirPorApi({ residenteId: res.id });
    await recibirPorApi({ residenteId: res.id, categoriaPeso: 'MANO' });
    const pin = await pinDe(res);

    await iniciarSesion(context, await sesionOperador(), { tema: 'noche' });
    await page.goto('/op/entregar');
    await expect(page.getByRole('heading', { name: 'Entregar' })).toBeVisible();
    await sinScrollHorizontal(page, 'Entregar');
    await teclear(page, pin);
    await expect(page).toHaveURL(/\/op\/entregar\/lote$/);
    await expect(page.getByRole('heading', { name: res.etiqueta })).toBeVisible();
    await expect(page.getByText(`${res.nombre} · 2 paquetes`)).toBeVisible();
    await sinScrollHorizontal(page, 'Cobrar');
    await page.getByRole('radio', { name: 'Transferencia' }).click();
    await page.getByRole('button', { name: 'Entregar todo' }).click();
    await expect(page).toHaveURL(/\/op\/entregar$/);
    await expect(page.locator('.ds-toast')).toBeVisible();

    const ctxRes = await contextoNuevo(browser, testInfo, entorno().baseUrl);
    await iniciarSesion(ctxRes, res.token);
    const pr = await ctxRes.newPage();
    await pr.goto('/paquetes/historial');
    await expect(pr.locator('.res-hist')).toHaveCount(2);
    await expect(pr.getByText('Entregado', { exact: true })).toHaveCount(2);
    await sinScrollHorizontal(pr, 'Historial');
    await ctxRes.close();
    expect(await misPaquetes(res), 'ya no quedan paquetes por entregar').toHaveLength(0);
  });

  test('PIN incorrecto 5 veces: el apto queda bloqueado (423) y se ve en pantalla', async ({ page, context }) => {
    const res = await crearResidente();
    await recibirPorApi({ residenteId: res.id });
    const pin = await pinDe(res);
    const equivocado = String((Number(pin) + 1) % 10000).padStart(4, '0');
    const token = await sesionOperador();

    const estados = [];
    for (let i = 0; i < 5; i++) {
      const r = await api('/entregas/verificar-pin', { metodo: 'POST', token, cuerpo: { pin: equivocado, residenteId: res.id } });
      estados.push(r.status);
    }
    expect(estados.slice(0, 4)).toEqual([400, 400, 400, 400]);
    expect(estados[4]).toBe(423);

    await iniciarSesion(context, token);
    await page.goto('/op/entregar');
    await teclear(page, pin); // incluso el PIN correcto está bloqueado
    await expect(page.locator('.ds-toast--error')).toContainText(/Demasiados intentos/);
    await expect(page).toHaveURL(/\/op\/entregar$/);
    await sinScrollHorizontal(page, 'Entregar (bloqueado)');
  });

  test('PIN que coincide con dos apartamentos: chips de apto y entrega del elegido', async ({ page, context }) => {
    test.skip(remoto(), 'Necesita forzar la colisión de PIN escribiendo en la base de datos: solo en entorno local.');
    const a = await crearResidente();
    const b = await crearResidente();
    await recibirPorApi({ residenteId: a.id });
    await recibirPorApi({ residenteId: b.id });
    const pin = '7' + String(100 + Math.floor(Math.random() * 800));
    sql(`UPDATE "Package" SET pin='${pin}' WHERE "residenteId" IN ('${a.id}','${b.id}')`);

    await iniciarSesion(context, await sesionOperador());
    await page.goto('/op/entregar');
    await teclear(page, pin);
    const grupo = page.getByRole('group', { name: 'Elige el apartamento' });
    await expect(grupo).toBeVisible();
    await expect(grupo.getByRole('button')).toHaveCount(2);
    await sinScrollHorizontal(page, 'PIN ambiguo');
    await grupo.getByRole('button', { name: a.etiqueta }).click();
    await expect(page).toHaveURL(/\/op\/entregar\/lote$/);
    await expect(page.getByRole('heading', { name: a.etiqueta })).toBeVisible();
    await expect(page.getByText(`${a.nombre} · 1 paquete`)).toBeVisible();
  });
});

test.describe('Operador: sin señal', () => {
  test('guardar sin conexión queda "1 por enviar" y al volver la señal se crea un solo paquete', async ({ page, context }) => {
    const res = await crearResidente();
    await iniciarSesion(context, await sesionOperador());
    await page.goto('/op/recibir');
    await teclear(page, res.apto);
    await page.locator('.op-sug', { hasText: res.nombre }).click();
    await expect(page.locator('.op-tile').first()).toBeVisible();
    await page.locator('.op-tile').nth(1).click();

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Guardado en el teléfono' })).toBeVisible();
    await expect(page.getByText('1 por enviar')).toBeVisible();
    await sinScrollHorizontal(page, 'Guardado sin señal');
    expect(await misPaquetes(res)).toHaveLength(0);

    await context.setOffline(false);
    await expect.poll(async () => (await misPaquetes(res)).length, { timeout: 30_000 }).toBe(1);
    await expect(page.getByText('1 por enviar')).toHaveCount(0);
    // Un reintento manual tras el envío no duplica (misma Idempotency-Key).
    await page.waitForTimeout(500);
    expect(await misPaquetes(res)).toHaveLength(1);
  });
});
