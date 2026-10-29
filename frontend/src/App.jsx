import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Terms from './pages/Terms.jsx';
import Abrir from './pages/residente/Abrir.jsx';
import Acceso from './pages/residente/Acceso.jsx';
import AccesoToken from './pages/residente/AccesoToken.jsx';
import Avisar from './pages/residente/Avisar.jsx';
import Buzon from './pages/residente/Buzon.jsx';
import EnlaceInvalido from './pages/residente/EnlaceInvalido.jsx';
import MisBonos from './pages/residente/MisBonos.jsx';
import Historial from './pages/residente/Historial.jsx';
import MisPaquetes from './pages/residente/MisPaquetes.jsx';
import PedirEntrega from './pages/residente/PedirEntrega.jsx';
import Recibir from './pages/operador/Recibir.jsx';
import RecibirPeso from './pages/operador/RecibirPeso.jsx';
import Guardado from './pages/operador/Guardado.jsx';
import Entregar from './pages/operador/Entregar.jsx';
import Cobrar from './pages/operador/Cobrar.jsx';
import Pendientes from './pages/operador/Pendientes.jsx';
import { getRole, isAuthenticated } from './services/auth.js';
import { modoDeSesion } from './hooks/residente/sesionEnlace.js';
import { ThemeToggle, useTheme } from './design';
import Logo from './puertaya-brand/Logo.jsx';
import './pages/auth.css';

// Catálogo del sistema de diseño: solo existe en desarrollo (se elimina del build).
const DesignSystem = import.meta.env.DEV ? lazy(() => import('./design/DesignSystemPage.jsx')) : null;

// Título de la pestaña por pantalla (lectores de pantalla y historial): "Pantalla · Puertayá".
// Sin nombre de conjunto: ese dato es de configuración, no del código.
const TITULOS = [
  [/^\/login$/, 'Entrar'], [/^\/registro$/, 'Crear cuenta'], [/^\/recuperar$/, 'Recuperar contraseña'],
  [/^\/restablecer$/, 'Nueva contraseña'], [/^\/terminos$/, 'Términos y condiciones'],
  [/^\/acceso$/, 'Entrar con correo'], [/^\/acceso\/.+/, 'Entrando'],
  [/^\/p$/, 'Abriendo tus paquetes'], [/^\/p\/.+/, 'Enlace no válido'],
  [/^\/paquetes$/, 'Mis paquetes'], [/^\/paquetes\/entrega$/, 'Pedir entrega'], [/^\/paquetes\/avisar$/, 'Avisar un paquete'],
  [/^\/paquetes\/historial$/, 'Historial'], [/^\/paquetes\/buzon$/, 'Escribir al operador'],
  [/^\/op\/recibir$/, 'Recibir'], [/^\/op\/recibir\/.+/, 'Tamaño del paquete'], [/^\/op\/guardado\/.+/, 'Paquete guardado'],
  [/^\/op\/entregar$/, 'Entregar'], [/^\/op\/entregar\/lote$/, 'Cobrar'], [/^\/op\/pendientes$/, 'Pendientes'],
  [/^\/_ds$/, 'Sistema de diseño'],
];

function TituloDePagina() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = TITULOS.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} · Puertayá` : 'Puertayá';
  }, [pathname]);
  return null;
}

function Protected({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
}

// Las páginas públicas (login, registro, etc.) no tienen topbar propio —
// esto les da el mismo botón de tema y el logo de marca sin tocar cada
// archivo por separado.
function PublicPage({ children }) {
  const { tema } = useTheme();
  const theme = tema === 'noche' ? 'dark' : 'light';
  return (
    <div className="pt auth-root">
      {/* display: contents conserva el diseño en columna y da a lectores de pantalla sus regiones */}
      <header style={{ display: 'contents' }}>
        <div className="auth-top"><ThemeToggle /></div>
        <div className="auth-brand"><Logo variant="lockup" size={72} mode={theme} /></div>
      </header>
      <main style={{ display: 'contents' }}>{children}</main>
    </div>
  );
}

// Pantallas del operador (/op/*): requieren sesión y rol OPERATOR.
function SoloOperador({ children }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return getRole() === 'OPERATOR' ? children : <Navigate to="/" replace />;
}

// Pantallas del residente (/paquetes/*): sesión normal o la limitada del enlace de WhatsApp.
function SoloResidente({ children }) {
  const modo = modoDeSesion();
  if (!modo) return <Navigate to="/acceso" replace />;
  return modo === 'normal' && getRole() === 'OPERATOR' ? <Navigate to="/op/recibir" replace /> : children;
}

// El operador aterriza en Recibir; el residente, en Mis paquetes.
function Raiz() {
  return <Navigate to={getRole() === 'OPERATOR' ? '/op/recibir' : '/paquetes'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <TituloDePagina />
      <Routes>
        <Route path="/login" element={<PublicPage><Login /></PublicPage>} />
        <Route path="/registro" element={<PublicPage><Register /></PublicPage>} />
        <Route path="/recuperar" element={<PublicPage><ForgotPassword /></PublicPage>} />
        <Route path="/restablecer" element={<PublicPage><ResetPassword /></PublicPage>} />
        <Route path="/terminos" element={<PublicPage><Terms /></PublicPage>} />
        {DesignSystem && (
          <Route path="/_ds" element={<Suspense fallback={null}><DesignSystem /></Suspense>} />
        )}
        <Route path="/p" element={<Abrir />} />
        <Route path="/p/:token" element={<EnlaceInvalido />} />
        <Route path="/acceso" element={<Acceso />} />
        <Route path="/acceso/:token" element={<AccesoToken />} />
        <Route path="/paquetes" element={<SoloResidente><MisPaquetes /></SoloResidente>} />
        <Route path="/paquetes/entrega" element={<SoloResidente><PedirEntrega /></SoloResidente>} />
        <Route path="/paquetes/avisar" element={<SoloResidente><Avisar /></SoloResidente>} />
        <Route path="/paquetes/historial" element={<SoloResidente><Historial /></SoloResidente>} />
        <Route path="/paquetes/bonos" element={<SoloResidente><MisBonos /></SoloResidente>} />
        <Route path="/paquetes/buzon" element={<SoloResidente><Buzon /></SoloResidente>} />
        <Route path="/op/recibir" element={<SoloOperador><Recibir /></SoloOperador>} />
        <Route path="/op/recibir/:domicilioId" element={<SoloOperador><RecibirPeso /></SoloOperador>} />
        <Route path="/op/guardado/:id" element={<SoloOperador><Guardado /></SoloOperador>} />
        <Route path="/op/entregar" element={<SoloOperador><Entregar /></SoloOperador>} />
        <Route path="/op/entregar/lote" element={<SoloOperador><Cobrar /></SoloOperador>} />
        <Route path="/op/pendientes" element={<SoloOperador><Pendientes /></SoloOperador>} />
        <Route path="/op" element={<Navigate to="/op/recibir" replace />} />
        <Route path="/" element={<Protected><Raiz /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
