import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import packagesRoutes from './routes/packages.routes.js';

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN }));
// El límite ya no es la defensa principal contra fotos gigantes — el
// frontend las comprime antes de enviarlas (ver utils/image.js). Esto es
// solo un margen de seguridad para no devolver una página HTML genérica
// si algo se cuela sin comprimir.
app.use(express.json({ limit: '4mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/packages', packagesRoutes);

// Sin esto, un body demasiado grande devuelve una página HTML de Express
// en vez de JSON, y el frontend solo puede mostrar "Error de red".
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La foto es demasiado pesada. Intenta con otra.' });
  }
  next(err);
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));
