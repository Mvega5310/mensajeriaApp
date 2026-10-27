/** Tarjeta tipo etiqueta. apto (mono grande), hora, detalles: [{ texto, valor? }],
 *  monto (texto ya formateado, p. ej. "$3.000"), children = zona extra al pie. */
export default function PackageLabel({ apto, hora, detalles = [], monto, children, className = '' }) {
  const lineas = [...detalles];
  return (
    <div className={`ds-label ${className}`.trim()}>
      <div className="ds-label__cab">
        <span className="ds-label__apto">{apto}</span>
        {hora && <span className="ds-label__hora">{hora}</span>}
      </div>
      {(lineas.length > 0 || monto) && (
        <div className="ds-label__cuerpo">
          {lineas.map((d, i) => (
            <div className="ds-label__linea" key={i}>
              <span>{d.texto}</span>
              {d.valor && <span className="ds-label__monto">{d.valor}</span>}
            </div>
          ))}
          {monto && (
            <div className="ds-label__linea">
              <span>Total</span>
              <span className="ds-label__monto">{monto}</span>
            </div>
          )}
        </div>
      )}
      {children && <div className="ds-label__extra">{children}</div>}
    </div>
  );
}
