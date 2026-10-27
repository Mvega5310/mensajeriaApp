/** Sello naranja inclinado (cortesía / lo nuevo). Ej.: <Stamp>Primera entrega gratis</Stamp> */
export default function Stamp({ children, className = '' }) {
  return <span className={`ds-stamp ${className}`.trim()}>{children}</span>;
}
