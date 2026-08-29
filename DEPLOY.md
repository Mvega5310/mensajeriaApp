# Desplegar Puertaya Ipanema — Railway (backend + Postgres) + Vercel (frontend) + Resend (correo)

## Estado actual del despliegue

| Pieza | Dónde | Detalle |
|---|---|---|
| Backend + API | Railway, proyecto **astonishing-truth**, servicio **mensajeriaApp** | https://mensajeriaapp-production.up.railway.app |
| Base de datos | Railway, mismo proyecto, servicio **Postgres** | Acceso solo interno/por túnel SSH — nunca se expuso públicamente |
| Frontend | Vercel, proyecto **mensajeria-app** | https://mensajeria-app-iota.vercel.app |
| Correo transaccional | Resend, dominio verificado **prospect01.com** (DNS en Cloudflare) | `EMAIL_FROM="Puertaya Ipanema <notificaciones@prospect01.com>"` |
| Repo | GitHub | https://github.com/Mvega5310/mensajeriaApp |

Esta guía sirve para reproducir el despliegue desde cero (por si hay que
recrear el ambiente) y como referencia de cómo está armado hoy.

## Requisitos

Cuenta de GitHub, Railway, Vercel, y Resend (con un dominio propio para que
el correo le llegue a cualquier residente, no solo a la cuenta del operador).
Ninguna la puedo crear por ti — son pasos en su dashboard/CLI.

## 0. Repo en GitHub

```
git add .
git commit -m "..."
git push
```

## 1. Backend + Postgres en Railway

1. **New Project → Deploy from GitHub repo** → selecciona el repo.
2. En el servicio creado, **Settings → Root Directory** → `backend`
   (el repo tiene `backend/` y `frontend/` en la misma raíz).
3. En el mismo proyecto: **New → Database → PostgreSQL**.
4. En el servicio del backend, pestaña **Variables**, agrega:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia al otro servicio) |
   | `JWT_SECRET` | valor largo y aleatorio — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `JWT_EXPIRES_IN` | `8h` |
   | `CORS_ORIGIN` | URL del frontend en Vercel (paso 3 más abajo la actualiza) |
   | `FRONTEND_URL` | igual a `CORS_ORIGIN` — se usa para armar los enlaces de los correos |
   | `RESEND_API_KEY` | API key de Resend |
   | `EMAIL_FROM` | `Puertaya Ipanema <remitente@tudominio>` — requiere dominio verificado (ver sección 2) |
   | `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, `OPERATOR_NOMBRE`, `OPERATOR_TELEFONO` | credenciales reales de la única cuenta de operador |

   `PORT` no se configura — Railway inyecta el suyo y `src/index.js` lo usa automático.

5. Deploy. Railway corre `npm install` → `postinstall` (`prisma generate`) → `npm start` (`prisma migrate deploy && node src/index.js`).

### Migraciones de Postgres — cómo se aplican de verdad

`railway run npx prisma migrate dev` **no funciona**: `railway run` solo
inyecta variables de entorno, no crea un túnel de red, y `DATABASE_URL`
apunta al hostname interno (`postgres.railway.internal`) que solo es
alcanzable *desde dentro* de Railway. El método que sí funciona es abrir un
túnel SSH real:

```
npm install -g @railway/cli
railway login
railway link                       # selecciona el proyecto/ambiente (no hace falta escoger servicio)
railway connect Postgres --tunnel-only -P 55432
```
Esto deja un túnel local escuchando en `127.0.0.1:55432` y muestra la
contraseña de la base. En otra terminal, con el schema en
`provider = "postgresql"`:
```
cd backend
$env:DATABASE_URL = "postgresql://postgres:<password>@127.0.0.1:55432/railway"   # PowerShell
npx prisma migrate dev --name <nombre_descriptivo>
```
Esto genera el archivo de migración, lo aplica contra la Postgres real de
Railway, y queda listo para comitear:
```
git add backend/prisma/migrations
git commit -m "Migración: <descripción>"
git push
```
Cada deploy futuro aplica migraciones pendientes solo, vía `prisma migrate
deploy` dentro del script `start` — el túnel manual solo hace falta para
generar migraciones *nuevas*, no para que el backend funcione día a día.

Si es la primera vez (base vacía), la migración inicial se genera igual con
este método — no hay atajo por `railway run`.

**Requiere una llave SSH local.** Si `railway connect` dice "No SSH keys
found", primero:
```
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519" -N '""'
railway ssh keys add
```

6. Crea la cuenta de operador en la base real (una sola vez, por el mismo túnel):
   ```
   node prisma/seed.js
   ```
   (con `DATABASE_URL` apuntando al túnel y `OPERATOR_*` en el entorno o en `.env`).
7. **Settings → Networking → Generate Domain** para obtener la URL pública del backend.

## 2. Correo transaccional: Resend + dominio propio

Sin esto, Resend solo entrega correos a la dirección con la que se creó la
cuenta — ningún residente real recibe nada (ni confirmaciones, ni
recuperación de contraseña).

1. Compra un dominio (cualquier registrador; en este proyecto se usó
   Cloudflare Registrar por el precio y porque el DNS queda en el mismo panel).
2. En Resend: **Domains → Add Domain** (o vía API,
   `POST https://api.resend.com/domains` con `{"name": "tudominio.com"}`) —
   devuelve 3 registros DNS (1 TXT DKIM, 1 MX, 1 TXT SPF).
3. Agrega esos 3 registros exactos en el DNS del dominio (en Cloudflare:
   dominio → **DNS → Records → Add record**). TTL en Auto, sin proxy naranja.
4. Verifica: `POST https://api.resend.com/domains/{id}/verify` (o el botón
   "Verify" en el dashboard). La propagación puede tardar unos minutos.
5. Actualiza `EMAIL_FROM` en Railway a una dirección de ese dominio, ej.
   `Puertaya Ipanema <notificaciones@tudominio.com>` — dispara un redeploy
   automático del backend.

## 3. Frontend en Vercel

1. **Add New → Project** → importa el mismo repo de GitHub.
2. **Root Directory** → `frontend`. Framework preset: Vite (Vercel lo detecta solo).
3. Variable de entorno: `VITE_API_URL` = `https://<tu-backend>.up.railway.app/api`
4. Deploy.

**`frontend/vercel.json` es obligatorio.** Sin el rewrite SPA que trae ese
archivo, cualquier ruta que no sea `/` (ej. `/login`, `/registro`) da 404 al
entrar directo o recargar — Vercel busca un archivo físico en esa ruta y no
lo encuentra. El archivo ya está en el repo; si se recrea el proyecto en
Vercel, confirma que sigue ahí.

## 4. Cerrar el círculo: CORS

Vuelve a Railway → variables del backend → actualiza `CORS_ORIGIN` y
`FRONTEND_URL` con la URL real de Vercel (sin slash final) → redeploy automático.

## 5. Verificación final

1. Abre la URL de Vercel → `/registro` → crea un residente real.
2. Revisa que llegue el correo de confirmación (requiere dominio verificado, sección 2).
3. Cierra sesión, entra con `OPERATOR_EMAIL` / `OPERATOR_PASSWORD`.
4. Recibe el paquete (con foto — se comprime sola en el navegador, ver
   nota abajo), prográmalo desde el residente, valida el PIN en la puerta.

Si algo no conecta, lo primero a revisar es `CORS_ORIGIN` en Railway y
`VITE_API_URL` en Vercel — son los dos puntos donde un typo rompe todo.

## Notas de problemas ya resueltos (por si vuelven a aparecer)

- **413 al confirmar recepción**: una foto de cámara real sin comprimir
  supera el límite del body JSON. El frontend ya comprime a JPEG (~1280px,
  calidad 0.7) antes de enviar (`frontend/src/utils/image.js`); el backend
  además subió su límite a 4mb como margen adicional.
- **`prisma migrate dev` con EPERM en Windows**: si nodemon tiene el backend
  corriendo en paralelo, el motor de Prisma no puede reescribir su `.dll`.
  Cierra el proceso de `npm run dev` antes de migrar, o vuelve a correr
  `npx prisma generate` después.
- **nodemon reiniciando solo en cada escritura de SQLite**: `backend/nodemon.json`
  ya limita el watch a `src/` — si se edita ese archivo y empieza a
  reiniciarse con cada cambio en `prisma/*.db`, revisar que siga así.

## Pendiente

- WhatsApp automático (Twilio u otro proveedor) — decisión consciente de
  dejarlo fuera por el costo; el botón manual de WhatsApp sigue funcionando.
- Mover fotos de custodia a almacenamiento de objetos en vez de base64 en Postgres.
- Soporte multi-conjunto (hoy todo asume un solo conjunto: Ipanema).
