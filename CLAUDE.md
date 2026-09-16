# Puertaya Ipanema

App real en producción de recepción/custodia/entrega de paquetes para el
Conjunto Residencial Ipanema, operada por Francisco Caro Yances (un solo
operador). Repo: `Mvega5310/mensajeriaApp`. La app está por arrancar de
verdad en el conjunto — por eso la rama de trabajo es `develop`, no `main`
(ver regla de ramas abajo, es la más importante de este archivo).

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
- **Bonos prepago**: la funcionalidad está construida pero **apagada** detrás de un flag (`BONOS_HABILITADOS` en `backend/src/config/features.js` y `frontend/src/utils/features.js`, ambos en `false`). No se activa hasta que el operador maneje más de un residente frecuente a la vez.
- **Fotos fuera de los listados**: `GET /packages` y `GET /packages/mine` NUNCA deben incluir `fotoUrl` (pueden pesar cientos de KB en base64 cada una) — se piden aparte vía `GET /packages/:id/foto`, solo al abrir el detalle de un paquete puntual. Esto fue la causa real de una caída seria en producción (ver historial de commits) — no revertir este patrón.
- **Sin pasarela de pagos real**: todo el cobro es manual/efectivo/transferencia, coordinado por fuera de la app.

## Limitación conocida de este entorno

No hay forma de reproducir aquí comportamientos específicos de iOS
Safari (barra de direcciones dinámica, controles `<input type="date">`
nativos, `env(safe-area-inset-*)`) — Chromium headless los ignora o los
simula distinto. Cuando un bug reportado suene a esto, aplicar el
arreglo estándar conocido, ser explícito con el usuario sobre esa
limitación, y pedirle que confirme en su iPhone real.
