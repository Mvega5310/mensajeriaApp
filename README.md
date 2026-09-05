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
  franja horaria preferida, método de pago del servicio, una nota libre
  para el operador (ej. "pago con billete de $100.000, llevar vueltos"),
  y el PIN que algunas plataformas (ej. Mercado Libre) generan para su
  propio mensajero — el operador lo necesita a mano en recepción.
- Seguimiento del paquete con su PIN de entrega, galería de hasta 3 fotos
  de evidencia colapsable, y reprogramación de franja una vez el paquete llega.
  La tarjeta muestra lo esencial (tarifa, PIN, franja); tocarla abre un
  modal con el detalle completo (guía, PIN del proveedor, cobros, nota,
  fechas).
- El estado se refresca solo (cada 20s mientras la pestaña está visible,
  y de una vez al volver a ella) — no hay que recargar a mano para ver
  cuándo el operador confirma la entrega.
- Buzón de comentarios/inquietudes generales hacia el operador — los
  mensajes largos se acortan en la lista y se tocan para ver el texto
  completo en un modal.
- Notificación automática por correo al crear una pre-alerta, y de nuevo
  (con agradecimiento) cuando el operador confirma la entrega.
- Modo oscuro/claro (botón en pantalla, recuerda la preferencia).
- "Salir" pide confirmación antes de cerrar sesión — evita cerrarla sin
  querer cuando el dedo buscaba el botón de tema, que está justo al lado
  (aplica igual para Residente y Operador, es el mismo encabezado).
- Las pestañas (Mis Paquetes/Notificar/Comentarios en Residente; Recepción/
  Reparto/Bitácora/Buzón en Operador) quedan fijas abajo de la pantalla,
  como el tab bar de una app nativa — no se pierden al hacer scroll.
- **Instalable como app** (PWA): en Android, Chrome ofrece "Instalar app"
  solo; en iPhone, Compartir → "Agregar a inicio". Queda con ícono propio
  y sin la barra del navegador — no es necesario pasar por App
  Store/Google Play para tenerla como app en el celular. Se actualiza
  sola: cuando hay una versión nueva desplegada, la próxima vez que se
  abre la app se recarga automáticamente para tomarla (sin pedir
  reinstalar ni tener que cerrarla dos veces).
- Identidad de marca navy/dorado (logo en `docs/logo-fuente.jpeg`),
  consistente entre la interfaz, el ícono de la app y el manifest de PWA.

**Operador**
- Alerta de primera entrega: el primer paquete que pre-alerta cada
  residente se cobra $0 automáticamente (cortesía de afiliación, la
  promo del flyer de campaña) — Recepción, Reparto, el modal de validar
  PIN y la Bitácora lo marcan con una franja dorada "🎁 NO cobrar" para
  que quede claro a quién sí toca cobrarle el servicio.
- Bonos prepago *(construido, en pausa)*: el operador podrá registrar
  que un residente pagó por adelantado un lote de entregas en una
  categoría de peso específica (cantidad y precio libres, el descuento
  lo decide caso a caso; el pago pasa por fuera de la app). Cada paquete
  de esa categoría descontaría 1 crédito y quedaría en $0 hasta
  agotarse; la cortesía de primera entrega siempre tiene prioridad y no
  gasta bono. Queda apagado con un interruptor
  (`BONOS_HABILITADOS` en `backend/src/config/features.js` y
  `frontend/src/utils/features.js`) hasta que haga falta manejar más de
  un residente frecuente a la vez — activarlo es cambiar ese valor a
  `true` en ambos archivos y desplegar, sin tocar el resto del código.
- Recepción: hasta 3 fotos por paquete (comprimidas en el navegador antes
  de subir) y categoría real — la tarifa final se recalcula server-side.
  Solo muestra lo pre-alertado que falta recibir; apenas se hace el
  checkin, el paquete desaparece de ahí solo y pasa a Reparto. Al
  confirmar la entrega, desaparece de Reparto y queda solo en Bitácora
  (nunca se borra de la base de datos) — cada pestaña se despeja sola a
  medida que el paquete avanza, sin superposición entre ellas.
- Ronda de reparto organizada en 2 sesiones fijas al día (9am-12m y 6pm-9pm).
- Nota del residente visible en Recepción, Reparto y al validar el PIN.
- Validación de PIN en puerta para cerrar la entrega. Al confirmar,
  aparece un botón de WhatsApp con mensaje de agradecimiento distinto al
  de recepción — no reemplaza el correo automático, es un segundo canal
  opcional para ese mismo momento.
- Bitácora: historial completo, buscable por residente/torre/apto/proveedor
  y filtrable por rango de fechas (Desde/Hasta) y por estado (Pre-alertado/
  En Recepción/Programado/Entregado) — útil cuando no se recuerda el
  nombre exacto. Exportable a CSV (sin PIN ni fotos) para llevar cuentas
  o compartir con un contador. Cada registro se toca para abrir un modal
  con el detalle completo (fotos más grandes, nota, PIN del proveedor,
  fechas, cobros).
- Paginación de 10 en 10 en toda lista que pueda crecer sin límite
  (Recepción, Reparto, Bitácora, Buzón del operador; Mis Paquetes y
  Comentarios del residente) — evita listas interminables a medida que
  se acumula historial.
- Recepción y Reparto: tocar el cuerpo de la tarjeta abre el mismo modal
  de detalle completo de la Bitácora (fotos, valor declarado, teléfono,
  fechas) sin perder los botones de acción rápida (Recibir, Editar,
  Validar PIN, WhatsApp), que siguen funcionando directo desde la tarjeta.
- Buzón: lee los comentarios de todos los residentes, con acceso directo a
  WhatsApp de cada uno. Los mensajes largos se acortan en la lista y se
  tocan para ver el texto completo en un modal.
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
- **App Store / Google Play**: la PWA (arriba) cubre "instalable" hoy. Para
  estar en las tiendas de verdad, el paso siguiente es envolver este mismo
  código con Capacitor — no es una reescritura, pero suma cuenta de Apple
  Developer (USD 99/año) y de Google Play (USD 25 única vez).
