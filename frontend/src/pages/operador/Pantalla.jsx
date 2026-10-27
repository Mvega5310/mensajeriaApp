import { Link } from 'react-router-dom';
import { BottomNav } from '../../design';
import './operador.css';

/** Marco de toda pantalla del operador: contenedor .pt (tema) + columna + barra inferior opcional.
 *  activo = 'recibir' | 'entregar' | 'pendientes' muestra BottomNav; sin él, la pantalla no lleva barra. */
export default function Pantalla({ activo, pendientes, children }) {
  const items = [
    { id: 'recibir', label: 'Recibir', icono: 'recibir', href: '/op/recibir' },
    { id: 'entregar', label: 'Entregar', icono: 'entregar', href: '/op/entregar' },
    { id: 'pendientes', label: 'Pendientes', icono: 'lista', href: '/op/pendientes', contador: pendientes },
  ];
  return (
    <div className="pt op-root">
      <main className="op">
        <div className="op__cuerpo">{children}</div>
        {activo && <BottomNav items={items} activo={activo} as={Link} />}
      </main>
    </div>
  );
}
