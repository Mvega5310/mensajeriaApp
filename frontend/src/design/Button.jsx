import Icon from './Icon.jsx';

/** variante: 'primario' | 'secundario' | 'whatsapp'. as="a" para enlaces
 *  (o un componente de router con `to`). `icono` = nombre de Icon. */
export default function Button({
  variante = 'primario',
  as: Tag = 'button',
  icono,
  block = true,
  className = '',
  children,
  ...rest
}) {
  const props = { ...rest };
  if (Tag === 'button' && !props.type) props.type = 'button';
  const cls = `ds-btn ds-btn--${variante}${block ? '' : ' ds-btn--auto'} ${className}`.trim();
  return (
    <Tag className={cls} {...props}>
      {icono && <Icon nombre={icono} size={22} trazo={2} />}
      {children}
    </Tag>
  );
}
