import Icon from './Icon.jsx';

/** Barra inferior de 3 pestañas. items: [{ id, label, icono, href?, onClick?, contador? }].
 *  activo = id de la pestaña actual (aria-current="page").
 *  as: componente de enlace (p. ej. Link de react-router, recibe `to`); por defecto <a href>. */
export default function BottomNav({ items, activo, as: Link, label = 'Navegación principal', className = '' }) {
  return (
    <nav className={`ds-nav ${className}`.trim()} aria-label={label}>
      {items.map((it) => {
        const texto = it.contador != null ? `${it.label} · ${it.contador}` : it.label;
        const contenido = (
          <>
            <Icon nombre={it.icono} size={24} />
            <span className="ds-nav__txt">{texto}</span>
          </>
        );
        const comunes = {
          className: 'ds-nav__tab',
          'aria-current': it.id === activo ? 'page' : undefined,
          onClick: it.onClick,
        };
        if (it.href && Link) return <Link key={it.id} to={it.href} {...comunes}>{contenido}</Link>;
        if (it.href) return <a key={it.id} href={it.href} {...comunes}>{contenido}</a>;
        return <button key={it.id} type="button" {...comunes}>{contenido}</button>;
      })}
    </nav>
  );
}
