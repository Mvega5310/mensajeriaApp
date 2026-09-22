# Puertaya

App de recepción/custodia/entrega de paquetes para conjuntos residenciales.
Repo: `Mvega5310/mensajeriaApp`. Nació monoconjunto (Ipanema, operado por
Francisco Caro Yances) y ahora soporta **multi-conjunto**: cada conjunto tiene
sus residentes, su operador y sus paquetes, aislados entre sí (KAN-8).

> **Estado del multi-conjunto (KAN-8):** implementado y validado en la rama
> `feature/kan-8-multiconjunto`, **NO desplegado en producción**. El corte a
> producción (backfill + fase contract + despliegue) es la Fase F y aún no se
> ha ejecutado — ver DEPLOY.md. Producción sigue siendo, por ahora, el conjunto
> único Ipanema con el esquema previo hasta que se ejecute ese corte.

La rama de trabajo es `develop`, no `main` (ver regla de ramas abajo, es la más
importante de este archivo).

**Para features, funcionalidades y cómo levantar el proyecto en local:
lee [README.md](README.md).** Para infraestructura, despliegue y cómo
migrar la base de datos de producción: lee [DEPLOY.md](DEPLOY.md). Este
archivo no repite ese contenido — son las convenciones de trabajo que
no están ahí.

**En producción:**
- App: https://mensajeria-app-iota.vercel.app
- API: https://mensajeriaapp-production.up.railway.app

## Regla de ramas: todo el trabajo va a `develop`, nunca directo a `main`

`main` es lo que Railway y Vercel despliegan a producción automáticamente
en cada push — y la app está a punto de arrancar de verdad con el
conjunto, así que un push a `main` ya no es un ensayo, es tocar el
sistema en uso. Desde ahora:

- **Todo commit va a `develop`** (`git checkout develop` si no estás ahí).
  `git push origin develop` es seguro: Railway solo despliega desde
  `main`, así que no dispara nada en producción (Vercel puede crear un
  *preview* aparte de esa rama, pero no toca la URL real).
- **Nunca hacer merge/push a `main` por iniciativa propia.** Eso solo pasa
  cuando el usuario lo pide explícitamente (ej. "ya podemos pasar esto a
  producción", "mergea a main"). Si no lo dice, el trabajo se queda en
  `develop` aunque esté terminado y probado.
- Esto **no** aplica a operaciones directas sobre la base de datos de
  producción (como una limpieza de datos) cuando el usuario las pide
  explícitamente — esas son independientes de qué rama esté commiteada.

**Cambios grandes o de varios pasos → rama de tarea aparte.** Para una spec (con
requisitos/diseño), una migración de esquema, o cualquier trabajo que tome más de
un par de commits, se abre una rama de tarea desde `develop`
(`feature/<nombre>`), se trabaja ahí con **un commit por paso**, y solo se
integra a `develop` cuando está **validado en local**. Los cambios pequeños y ya
probados siguen yendo directo a `develop`, como siempre. Referencia: la propia
rama `feature/kan-8-multiconjunto` (KAN-8).

## Regla de oro: documentación al día

Cada cambio funcional se documenta en el mismo commit que lo implementa
(README.md y/o DEPLOY.md), no después. Es una instrucción explícita del
usuario, no opcional.

## Estructura

```
backend/     # Express + Prisma — PostgreSQL en producción, SQLite solo para probar en local
frontend/    # Vite + React (PWA) — sin lógica de negocio propia, todo vía la API
docs/        # Prototipo original, flyer de campaña, logo — referencia histórica
```

## Flujo de trabajo esperado en cada cambio

1. **Probar en local con SQLite** antes de tocar producción:
   - `backend/prisma/schema.prisma`: cambiar `provider` a `"sqlite"` (nunca comitear así — el commiteado siempre es `"postgresql"`).
   - Crear `backend/.env` a partir de `.env.example` con `DATABASE_URL="file:./dev.db"` (gitignorado, no se comitea).
   - `npx prisma db push --skip-generate && npx prisma generate && npm run seed`.
   - Si el cambio toca UI: levantar `npm run dev` en `backend/` y `frontend/`, y verificar en un navegador real — no solo `npm run build`. Playwright con Chromium ya está cacheado en esta máquina (`C:\Users\ACER\AppData\Local\ms-playwright\`); solo falta `npm install playwright@1.61.1` en el scratchpad de la sesión si no está.
   - Limpiar al terminar: matar `nodemon`/`vite`, volver el `provider` a `"postgresql"`, borrar `backend/.env` y `backend/prisma/dev.db*`, `npx prisma generate`.
2. **Si el cambio requiere migración de esquema**, aplicarla contra Postgres de producción vía túnel SSH de Railway — `railway run` NO funciona para esto (ver DEPLOY.md, sección "Migraciones de Postgres"). Nunca commitear migraciones generadas contra SQLite.
3. **Commit + push a `develop`** (ver "Regla de ramas" arriba — nunca a `main` sin que el usuario lo pida). Nunca force-push, nunca amend de un commit ya publicado — siempre un commit nuevo.
4. Solo cuando el usuario pida explícitamente pasar algo a producción: merge de `develop` a `main` y push. Ahí sí, **verificar en vivo** después: sondear el bundle/API de producción hasta confirmar que el deploy nuevo está activo (los hashes de archivo cambian con cada build), no asumir que terminó por el solo hecho de haber hecho push.
5. **Actualizar README.md/DEPLOY.md** en el mismo commit (ver regla de oro arriba), sea en `develop` o al mergear a `main`.

## Cosas ya decididas — no las reabras sin que el usuario lo pida

- **WhatsApp es manual, no automático**: enlaces `wa.me` con mensaje precargado que el operador confirma a mano. Se descartó Twilio/WhatsApp Business API explícitamente por costo.
- **Bonos prepago**: la funcionalidad está construida pero **apagada por conjunto**. La única fuente es `Conjunto.bonosHabilitados` (`false` por defecto para todo conjunto nuevo). **Ya NO existe** la constante `BONOS_HABILITADOS` (se eliminó de `backend/src/config/features.js` y `frontend/src/utils/features.js`, ambos archivos borrados en KAN-8): backend lee del conjunto del contexto, frontend de `GET /conjunto/config`.
- **Tarifas por conjunto**: las tarifas por categoría de peso salen del `Conjunto` (`tarifaMano/Estandar/Volumen/Pesado`), no de una constante fija. Backend: `costoPara()` las lee del conjunto del contexto (nunca del cliente). Frontend: `utils/tiers.js` solo tiene etiquetas; los montos vienen de `GET /conjunto/config`. No hay montos fijos en el cliente.
- **Fotos fuera de los listados**: `GET /packages` y `GET /packages/mine` NUNCA deben incluir `fotoUrl` (pueden pesar cientos de KB en base64 cada una) — se piden aparte vía `GET /packages/:id/foto`, solo al abrir el detalle de un paquete puntual. Esto fue la causa real de una caída seria en producción (ver historial de commits) — no revertir este patrón.
- **Sin pasarela de pagos real**: todo el cobro es manual/efectivo/transferencia, coordinado por fuera de la app.
- **La app ya no es exclusiva de Ipanema**: no incrustar el nombre "Ipanema", el operador, su domicilio, WhatsApp ni tarifas en el código. Todo eso es configuración por conjunto (ver reglas del multi-conjunto abajo).

## Reglas del multi-conjunto (no negociables)

El aislamiento entre conjuntos es **estructural**: lo garantiza una extensión de
Prisma que filtra por `conjuntoId` a partir de un contexto por-request
(`AsyncLocalStorage`), no cada consulta a mano. Las siguientes invariantes lo
sostienen. Cada una tiene una prueba automatizada; si tu cambio rompe una,
**arréglalo, no relajes la prueba**.

1. **Un solo `PrismaClient`.** Todo pasa por el cliente extendido de
   `config/db.js`. Un segundo cliente sin extender sería una vía sin aislamiento,
   invisible y silenciosa. — *Prueba:* `auditoriaInvariantes.test.js` (E7.3).
2. **`GLOBAL_LOOKUP` solo en `buscarUsuarioPorEmailSinTenant()`.** Es la única
   exención al filtro (login/forgot: lookup por email sin sesión). Concentrarla
   en un punto la hace auditable de un vistazo. — *Prueba:* `auditoriaInvariantes.test.js` (E7.1).
3. **Consultas crudas solo en `resolverConjuntoIdPorUsuario()`.**
   `$queryRaw`/`$executeRaw`/`*Unsafe` saltan la extensión por completo; fuera de
   ese bootstrap serían una fuga. — *Prueba:* `auditoriaInvariantes.test.js` (E7.2).
4. **El `await` va DENTRO de `run()`, y lo garantizan los helpers.** Las
   `PrismaPromise` son perezosas: devolver la promesa sin `await` cierra el
   contexto antes de que la query corra y la extensión lanzaría (falla cerrado).
   Por eso `runWithTenant`/`buscarUsuarioPorEmailSinTenant` hacen `run(ctx, async
   () => await fn())`. No repliques el patrón a mano en cada call site. — *Prueba:*
   `tenantContext.test.js` (regresión con thenable perezoso).
5. **Toda ruta autenticada lleva `requireAuth` y luego `requireTenant`.** Sin el
   segundo, el handler corre sin contexto y la extensión lanza. — *Prueba:*
   `tenantGuard.routes.test.js` (E6, recorre el app real).
6. **Una ruta pública nueva exige agregarla a la lista de E6, justificándolo.**
   `tenantGuard.routes.test.js` falla si aparece una ruta sin `requireAuth` que no
   esté en `RUTAS_SIN_SESION`. Agregarla es una decisión consciente (¿de verdad
   debe ser accesible sin sesión?), no un descuido.
7. **Nunca se pasa `conjuntoId` en `data`.** El conjunto de toda escritura sale
   del contexto; un `conjuntoId` en `data` se rechaza. El llamador jamás decide el
   tenant. — *Prueba:* `tenantExtension.helpers.test.js` / `*.interceptor.test.js`.
8. **`Conjunto` y `PasswordResetToken` son los ÚNICOS modelos sin tenant.** El
   resto (`User`, `Package`, `Bono`, `Comentario`) lleva `conjuntoId` y está en
   `MODELOS_CON_TENANT` (`config/tenantModels.js`). Un modelo nuevo entra ahí a
   propósito, o queda fuera del aislamiento. — *Prueba:* cubierto por las de la
   extensión.
9. **Nada de datos, montos ni nombres de conjunto fijos en el frontend.** Ni
   "Ipanema", ni tarifas, ni domicilio/WhatsApp del operador: todo viene de
   `GET /conjunto/config` (con sesión) o `GET /conjuntos/config-publica?c=`
   (registro/Términos sin sesión). — *Prueba:* `frontendSinFijos.test.js`.

**Regla de proceso.** Cualquier cambio que toque la extensión de tenant, el
contexto (`AsyncLocalStorage`/helpers) o los flujos sin sesión
(register/login/forgot/reset, seed, bootstrap) **requiere pruebas de integración
contra Postgres real** (`*.integration.test.js`), no solo pruebas con fakes. En
KAN-8, las pruebas con fakes NO detectaron dos errores reales: el `AND` en un
`WhereUniqueInput` y la `PrismaPromise` perezosa que cerraba el contexto. Las dos
las cazó la integración contra Postgres.

## Limitación conocida de este entorno

No hay forma de reproducir aquí comportamientos específicos de iOS
Safari (barra de direcciones dinámica, controles `<input type="date">`
nativos, `env(safe-area-inset-*)`) — Chromium headless los ignora o los
simula distinto. Cuando un bug reportado suene a esto, aplicar el
arreglo estándar conocido, ser explícito con el usuario sobre esa
limitación, y pedirle que confirme en su iPhone real.
