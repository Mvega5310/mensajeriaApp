# Puertayá — Landing pública

Landing comercial independiente de la aplicación operativa de Puertayá.

## Estructura

Esta carpeta se despliega como un proyecto Vercel independiente usando `landing/` como **Root Directory**. Los logotipos oficiales se importan desde `../frontend/src/puertaya-brand/logos/`; por eso, al desplegar desde el mismo repositorio, no se deben excluir esos archivos del checkout.

## Desarrollo local

```bash
cd landing
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Despliegue independiente en Vercel

1. Crea un proyecto nuevo en Vercel conectado al repositorio `Mvega5310/mensajeriaApp`.
2. Configura **Root Directory** como `landing`.
3. Framework: Vite.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.
6. No cambies el proyecto de producción de la aplicación; la landing debe tener su propio proyecto y dominio.
7. **Dominio: `proyects.com`** (por ahora). En el proyecto nuevo de Vercel →
   **Settings → Domains** → agrega `proyects.com` (y opcionalmente
   `www.proyects.com` con redirect). Vercel muestra los registros DNS exactos
   a crear (normalmente un `A` a `76.76.21.21` y/o un `CNAME` a
   `cname.vercel-dns.com`); se configuran donde esté administrado el DNS de
   ese dominio (registrador o Cloudflare, como con `prospect01.com` para el
   correo). Vercel emite el certificado SSL solo una vez el DNS propaga.

Los CTA enlazan a la aplicación actual:
- Inicio de sesión: `https://mensajeria-app-iota.vercel.app/login`
- Registro: `https://mensajeria-app-iota.vercel.app/registro`

La tarjeta de seguimiento del hero es una representación visual ilustrativa, no una conexión a datos reales.
