import Icon from './Icon.jsx';

/** Barra superior: volver (48 px) + título (+ subtítulo) + acciones a la derecha.
 *  onBack (botón) o backHref (enlace; con `backAs` = Link de router recibe `to`).
 *  mono=true pone el título en tipografía mono (p. ej. "T2 · 304"). */
export default function TopBar({
  title,
  subtitle,
  mono = false,
  onBack,
  backHref,
  backAs: BackLink,
  backLabel = 'Volver',
  children,
  className = '',
}) {
  const icono = <Icon nombre="volver" size={24} trazo={2.5} />;
  let volver = null;
  if (backHref && BackLink) volver = <BackLink to={backHref} className="ds-topbar__volver" aria-label={backLabel}>{icono}</BackLink>;
  else if (backHref) volver = <a href={backHref} className="ds-topbar__volver" aria-label={backLabel}>{icono}</a>;
  else if (onBack) volver = <button type="button" className="ds-topbar__volver" aria-label={backLabel} onClick={onBack}>{icono}</button>;
  return (
    <header className={`ds-topbar ${className}`.trim()}>
      {volver}
      <div className="ds-topbar__textos">
        <span className={mono ? 'ds-topbar__titulo' : 'ds-topbar__titulo ds-topbar__titulo--texto'}>{title}</span>
        {subtitle && <span className="ds-topbar__sub">{subtitle}</span>}
      </div>
      {children && <div className="ds-topbar__acciones">{children}</div>}
    </header>
  );
}
