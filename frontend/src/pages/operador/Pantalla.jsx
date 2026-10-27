import { createContext, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { BottomNav, ThemeToggle, useTheme } from '../../design';
import Logo from '../../puertaya-brand/Logo.jsx';
import useConfig from '../../hooks/operador/useConfig.js';
import IndicadorCola from './IndicadorCola.jsx';
import MasSheet from './MasSheet.jsx';
import './operador.css';

const AbrirMasCtx = createContext(() => {});

/** Devuelve la función que abre la hoja "Más" del marco (la usa Pendientes en la cabecera móvil). */
export function useAbrirMas() {
  return useContext(AbrirMasCtx);
}

/** Marco de toda pantalla del operador: contenedor .pt (tema) + barra de navegación opcional + columna.
 *  activo = 'recibir' | 'entregar' | 'pendientes' muestra la navegación; sin él, la pantalla no lleva barra.
 *  ancho = 'amplio' ensancha el contenido en escritorio (Pendientes, lista + detalle). */
export default function Pantalla({ activo, pendientes, ancho = 'normal', children }) {
  const config = useConfig();
  const { tema } = useTheme();
  const [masAbierto, setMasAbierto] = useState(false);
  const items = [
    { id: 'recibir', label: 'Recibir', icono: 'recibir', href: '/op/recibir' },
    { id: 'entregar', label: 'Entregar', icono: 'entregar', href: '/op/entregar' },
    { id: 'pendientes', label: 'Pendientes', icono: 'lista', href: '/op/pendientes', contador: pendientes },
  ];
  const abrirMas = () => setMasAbierto(true);
  return (
    <AbrirMasCtx.Provider value={abrirMas}>
      <div className={`pt op-root${activo ? ' op-root--nav' : ''}`}>
        {activo && (
          <BottomNav
            items={items}
            activo={activo}
            as={Link}
            marca={<Logo variant="lockup" size={72} mode={tema === 'noche' ? 'dark' : 'light'} />}
            pie={(
              <>
                <button type="button" className="ds-nav__accion" onClick={abrirMas}>Más</button>
                <ThemeToggle />
              </>
            )}
          />
        )}
        <main className={`op${ancho === 'amplio' ? ' op--amplio' : ''}`}>
          <IndicadorCola />
          <div className="op__cuerpo">{children}</div>
        </main>
      </div>
      <MasSheet open={masAbierto} onClose={() => setMasAbierto(false)} config={config} />
    </AbrirMasCtx.Provider>
  );
}
