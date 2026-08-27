# Desplegar puertaya — Railway (backend + Postgres) + Vercel (frontend)

Requiere: cuenta de GitHub, cuenta de Railway, cuenta de Vercel. Ninguna de las
tres la puedo crear por ti — son pasos que haces tú en su dashboard/CLI.

## 0. Subir el repo a GitHub

```
git add .
git commit -m "Estructura backend/frontend + auditoría"
```
Crea un repositorio vacío en GitHub y sigue las instrucciones para conectar
este remoto (`git remote add origin ...` y `git push -u origin main`).

## 1. Backend + Postgres en Railway

1. En Railway: **New Project → Deploy from GitHub repo** → selecciona este repo.
2. En el servicio creado, entra a **Settings → Root Directory** y pon `backend`
   (el repo tiene backend/ y frontend/ en la misma raíz, Railway necesita saber
   cuál construir).
3. En el mismo proyecto: **New → Database → PostgreSQL**. Railway crea el
   servicio de base de datos y expone `DATABASE_URL` como variable interna.
4. En el servicio del backend, pestaña **Variables**, agrega:
   - `DATABASE_URL` → referencia a la del servicio Postgres: `${{Postgres.DATABASE_URL}}`
   - `JWT_SECRET` → un valor largo y aleatorio (genera uno con
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `JWT_EXPIRES_IN` → `8h`
   - `PORT` → Railway ya inyecta su propio `PORT`; puedes omitir esta o dejarla, `src/index.js` usa `process.env.PORT` de todas formas.
   - `CORS_ORIGIN` → de momento pon cualquier valor placeholder, lo actualizas en el paso 3 con la URL real del frontend.
   - `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, `OPERATOR_NOMBRE`, `OPERATOR_TELEFONO` → credenciales reales de la única cuenta de operador.
5. Deploy. Railway corre `npm install` → `postinstall` (`prisma generate`) →
   `npm start` (`prisma migrate deploy && node src/index.js`).

   **La primera vez no hay migraciones que aplicar** porque el repo aún no
   tiene ninguna generada contra Postgres real (la que se probó en local era
   para SQLite y se descartó). Genera la migración inicial una sola vez desde
   tu máquina, apuntando a la base de Railway:

   ```
   npm install -g @railway/cli
   railway login
   railway link          # selecciona este proyecto/servicio
   railway run npx prisma migrate dev --name init
   ```
   Esto crea `backend/prisma/migrations/…/migration.sql`, lo aplica contra la
   Postgres real de Railway, y lo deja listo para commitear:
   ```
   git add backend/prisma/migrations
   git commit -m "Migración inicial de Postgres"
   git push
   ```
   Cada redeploy futuro (nuevas migraciones) las aplica solo, vía `prisma migrate deploy` en el script `start`.

6. Crea la cuenta de operador en la base real (una sola vez):
   ```
   railway run npm run seed
   ```
7. Copia la URL pública que Railway asigna al backend (Settings → Networking →
   Generate Domain), algo como `https://puertaya-backend.up.railway.app`.

## 2. Frontend en Vercel

1. **Add New → Project** → importa el mismo repo de GitHub.
2. **Root Directory** → `frontend`. Framework preset: Vite (Vercel lo detecta solo).
3. Variable de entorno: `VITE_API_URL` = `https://<tu-backend>.up.railway.app/api`
   (la URL del paso 1.7, con `/api` al final).
4. Deploy. Copia la URL que asigna Vercel, algo como `https://puertaya.vercel.app`.

## 3. Cerrar el círculo: CORS

Vuelve a Railway → variables del backend → actualiza `CORS_ORIGIN` con la URL
real de Vercel del paso 2.4 (sin slash final) → esto dispara un redeploy
automático del backend.

## 4. Verificación final

1. Abre la URL de Vercel.
2. `/registro` → crea un residente real.
3. Cierra sesión, entra con `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` del paso 1.4.
4. Recibe el paquete, prográmalo desde el otro usuario, valida el PIN en la puerta.

Si algo no conecta, lo primero a revisar es `CORS_ORIGIN` en Railway y
`VITE_API_URL` en Vercel — son los dos puntos donde un typo rompe todo.

## Pendiente de la auditoría, no bloquea el despliegue

Aviso de privacidad / consentimiento (Ley 1581) y términos de servicio siguen
sin implementarse — usar la app con vecinos reales sin eso es el mismo riesgo
legal que señaló la auditoría, independientemente de dónde esté desplegada.
