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

function Protected({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
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
          <strong>EntregaVecina</strong>
          {me && <span className="topbar-user"> — {me.nombre} ({role === 'OPERATOR' ? 'Operador' : 'Residente'})</span>}
        </div>
        <button className="btn-link" onClick={() => { logout(); window.location.href = '/login'; }}>Salir</button>
      </header>
      {role === 'OPERATOR' ? <OperatorView /> : <ResidentView />}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/recuperar" element={<ForgotPassword />} />
        <Route path="/restablecer" element={<ResetPassword />} />
        <Route path="/terminos" element={<Terms />} />
        <Route path="/" element={<Protected><Home /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
