// `npm run e2e:a11y`: levanta el entorno E2E (e2e/entorno.mjs) y corre la auditoría de
// accesibilidad existente (e2e/a11y.audit.mjs) contra él. No duplica la auditoría: solo
// le pasa BASE_URL, CODIGO_INVITACION y las credenciales del operador.
// En modo remoto (E2E_BASE_URL/E2E_API_URL) audita esas URLs.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarEntorno } from './entorno.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const entorno = await levantarEntorno();
let codigo = 1;
try {
  codigo = await new Promise((resolve) => {
    const hijo = spawn(process.execPath, [path.join(AQUI, 'a11y.audit.mjs'), ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_URL: entorno.baseUrl,
        API_URL: entorno.modo === 'local' ? `${entorno.baseUrl}/api` : `${entorno.apiUrl}/api`,
        CODIGO_INVITACION: entorno.codigo,
        OP_EMAIL: entorno.operador.email,
        OP_PASSWORD: entorno.operador.password,
      },
    });
    hijo.on('exit', (c) => resolve(c ?? 1));
  });
} finally {
  await entorno.detener();
}
process.exit(codigo);
