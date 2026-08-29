# Puertaya Ipanema

Gestión y entrega residencial puerta a puerta, operada por una sola persona
para el **Conjunto Residencial Ipanema**. Nació de reestructurar un prototipo
estático (ver `docs/`) tras una auditoría de seguridad y contractual que
encontró que el control de roles y el PIN de entrega no tenían ningún
respaldo del lado servidor.

**En producción:**
- App: https://mensajeria-app-iota.vercel.app
- API: https://mensajeriaapp-production.up.railway.app

Ver [DEPLOY.md](DEPLOY.md) para el detalle de infraestructura (Railway,
Vercel, Resend) y cómo redesplegar o recuperar el ambiente desde cero.

## Estructura

```
puertaya-ipanema/
├── backend/     # API Express + Prisma/PostgreSQL — auth, roles y PIN reales
├── frontend/    # SPA Vite + React — consume la API, sin lógica de negocio propia
└── docs/        # Prototipo original y modelo de datos, como referencia histórica
```

## Arrancar en desarrollo

El backend soporta dos motores: **SQLite** (cero setup, recomendado para
desarrollo local) y **PostgreSQL** (el que usa producción). El campo
`provider` en `backend/prisma/schema.prisma` decide cuál — el que queda
comiteado siempre es `"postgresql"`, así que para desarrollo local se
cambia temporalmente y se revierte antes de comitear.

**Backend (con SQLite local)**
```
cd backend
cp .env.example .env
```
En `.env`, cambia `DATABASE_URL="file:./dev.db"` y en
`prisma/schema.prisma` pon `provider = "sqlite"` temporalmente.
```
npm install
npx prisma migrate dev --name init   # crea prisma/dev.db y aplica el esquema
npm run seed                          # crea la cuenta de operador desde OPERATOR_* en .env
npm run dev                           # http://localhost:4000
```
Antes de comitear, vuelve a poner `provider = "postgresql"` en el schema
(los `.db`/migraciones de SQLite están en `.gitignore`, nunca se suben).

**Frontend**
```
cd frontend
npm install
npm run dev              # http://localhost:5173 (proxy a /api -> :4000)
```

Flujo: el operador inicia sesión con la cuenta creada por `npm run seed`.
Los residentes se crean ellos mismos en `/registro` (ese formulario nunca
puede crear una cuenta de operador — el rol lo fuerza el backend), exclusivo
para residentes de Conjunto Ipanema.

## Funcionalidades

**Residente**
- Registro con aceptación obligatoria de Términos y Aviso de Privacidad
  (queda constancia con fecha — `termsAcceptedAt`).
- Recuperación de contraseña por correo (enlace de un solo uso, vence en 1h).
- Pre-alerta de paquete: categoría de peso estimada (con tarifa de
  referencia), valor declarado (tope de responsabilidad por custodia),
  franja horaria preferida, método de pago del servicio, y una nota libre
  para el operador (ej. "pago con billete de $100.000, llevar vueltos").
- Seguimiento del paquete con su PIN de entrega, galería de hasta 3 fotos
  de evidencia colapsable, y reprogramación de franja una vez el paquete llega.
- Buzón de comentarios/inquietudes generales hacia el operador.
- Notificación automática por correo al crear una pre-alerta.
- Modo oscuro/claro (botón en pantalla, recuerda la preferencia).

**Operador**
- Recepción: hasta 3 fotos por paquete (comprimidas en el navegador antes
  de subir) y categoría real — la tarifa final se recalcula server-side.
- Ronda de reparto organizada en 2 sesiones fijas al día (9am-12m y 6pm-9pm).
- Nota del residente visible en Recepción, Reparto y al validar el PIN.
- Validación de PIN en puerta para cerrar la entrega.
- Bitácora: historial completo con fotos de evidencia, buscable por
  residente/torre/apto, exportable a CSV (sin PIN ni fotos) para llevar
  cuentas o compartir con un contador.
- Buzón: lee los comentarios de todos los residentes, con acceso directo a
  WhatsApp de cada uno.
- Generador de QR (código apunta a `/registro`) para distribuir e invitar
  residentes a crear su cuenta, descargable como PNG.
- Notificación automática por correo cuando entra una pre-alerta nueva.

**Backend / seguridad** (ver auditoría original para el detalle completo)
- Roles decididos server-side vía JWT — nunca por un valor que mande el
  cliente.
- PIN generado con `crypto`, nunca expuesto al operador; el residente
  siempre puede consultar el suyo.
- Política de contraseñas validada en servidor (no solo en el formulario).
- Correo transaccional vía Resend, con dominio propio verificado
  (`prospect01.com`) — llega a cualquier residente, no solo a la cuenta
  del operador.

## Pendiente

- **WhatsApp automático**: decisión consciente de no implementarlo por
  ahora (requiere WhatsApp Business API de pago, ej. Twilio). El botón
  manual de WhatsApp del operador sigue funcionando.
- **Fotos en almacenamiento de objetos**: hoy viven comprimidas como
  base64 en una columna de Postgres — funciona, pero no escala igual de
  bien que un bucket dedicado si el volumen crece mucho.
- **Multi-conjunto**: toda la app asume un solo conjunto (Ipanema). Si se
  usa en más de un conjunto residencial, hace falta un modelo de
  "tenant" que separe los datos entre conjuntos.
- **Cédula personal en Términos**: `Terms.jsx` expone la C.C. del operador
  públicamente — considerar usar NIT si se formaliza el negocio.
