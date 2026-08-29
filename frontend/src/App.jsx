import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Terms from './pages/Terms.jsx';
import ResidentView from './pages/ResidentView.jsx';
import OperatorView from './pages/OperatorView.jsx';
import { getRole, isAuthenticated, logout } from './services/auth.js';
import { api } from './services/api.js';
import ThemeToggle from './components/ThemeToggle.jsx';

function Protected({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
}

// Las páginas públicas (login, registro, etc.) no tienen topbar propio —
// esto les da el mismo botón de tema sin tocar cada archivo por separado.
function PublicPage({ children }) {
  return (
    <>
      <div className="floating-theme-toggle"><ThemeToggle /></div>
      {children}
    </>
  );
}

function Home() {
  const [me, setMe] = useState(null);
  const role = getRole();

  useEffect(() => {
    api('/auth/me').then(setMe).catch(() => {});
  }, []);

  return (
    <>
      <header className="topbar">
        <div>
          <strong>Puertaya Ipanema</strong>
          {me && <span className="topbar-user"> — {me.nombre} ({role === 'OPERATOR' ? 'Operador' : 'Residente'})</span>}
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <button className="btn-link" onClick={() => { logout(); window.location.href = '/login'; }}>Salir</button>
        </div>
      </header>
      {role === 'OPERATOR' ? <OperatorView /> : <ResidentView />}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PublicPage><Login /></PublicPage>} />
        <Route path="/registro" element={<PublicPage><Register /></PublicPage>} />
        <Route path="/recuperar" element={<PublicPage><ForgotPassword /></PublicPage>} />
        <Route path="/restablecer" element={<PublicPage><ResetPassword /></PublicPage>} />
        <Route path="/terminos" element={<PublicPage><Terms /></PublicPage>} />
        <Route path="/" element={<Protected><Home /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
