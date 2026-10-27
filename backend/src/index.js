import 'dotenv/config';
import { validarEntorno } from './config/env.js';

// Se valida ANTES de cargar la app (import dinámico, no estático): así ningún
// módulo se inicializa con un entorno roto. Si falta algo, se listan todos los
// problemas y el proceso termina con código 1 (T0.3).
let config;
try {
  config = validarEntorno(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
for (const aviso of config.avisos) console.warn(`AVISO: ${aviso}`);

const { createApp } = await import('./app.js');
const app = createApp();

app.listen(config.puerto, () => console.log(`API escuchando en http://localhost:${config.puerto}`));
