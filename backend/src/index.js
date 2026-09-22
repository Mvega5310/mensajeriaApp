import 'dotenv/config';
import { createApp } from './app.js';

const app = createApp();

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));
