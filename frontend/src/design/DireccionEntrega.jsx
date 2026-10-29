import { useId, useState } from 'react';
import Button from './Button.jsx';
import Field from './Field.jsx';
import Icon from './Icon.jsx';
import SelectorConjunto from './SelectorConjunto.jsx';
import Sheet from './Sheet.jsx';

const OTRA = '__otra__';

function linea(d, mostrarConjunto) {
  return [mostrarConjunto ? d.conjunto?.nombre : null, d.etiqueta, d.nombreRecibe].filter(Boolean).join(' · ');
}

/** Formulario de "Otra dirección". Se monta solo cuando hace falta. */
function FormOtra({ conjuntos, mostrarConjunto, precarga, onCrear, onListo }) {
  const [conjunto, setConjunto] = useState(conjuntos.length === 1 ? conjuntos[0].slug : '');
  const [torre, setTorre] = useState('');
  const [apto, setApto] = useState('');
  const [nombreRecibe, setNombre] = useState(precarga?.nombreRecibe ?? '');
  const [telefono, setTelefono] = useState(precarga?.telefono ?? '');
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(false);
  const [fallo, setFallo] = useState('');
  const faltaConjunto = !conjunto;
  const faltaApto = !apto.trim();
  const faltaNombre = !nombreRecibe.trim();
  const telMal = telefono.replace(/\D/g, '').length !== 10;

  async function enviar(e) {
    e?.preventDefault();
    setIntento(true);
    setFallo('');
    if (faltaConjunto || faltaApto || faltaNombre || telMal) return;
    setEnviando(true);
    try {
      await onCrear?.({
        conjunto,
        torre: torre.trim(),
        apto: apto.trim(),
        nombreRecibe: nombreRecibe.trim(),
        telefono: telefono.replace(/\D/g, ''),
      });
      onListo?.();
    } catch {
      setFallo('No pudimos guardar la dirección. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="ds-dir__form" onSubmit={enviar} noValidate>
      {mostrarConjunto && (
        <SelectorConjunto
          conjuntos={conjuntos}
          value={conjunto}
          onChange={setConjunto}
          invalido={intento && faltaConjunto ? 'Falta el conjunto. Elige uno de la lista.' : undefined}
        />
      )}
      <div className="ds-dir__fila">
        <Field label="Torre" mono inputMode="numeric" autoComplete="off" value={torre} onChange={(e) => setTorre(e.target.value)} />
        <Field
          label="Apartamento"
          mono
          inputMode="numeric"
          autoComplete="off"
          value={apto}
          onChange={(e) => setApto(e.target.value)}
          error={intento && faltaApto ? 'Falta el apartamento. Escríbelo.' : undefined}
        />
      </div>
      <Field
        label="Nombre de quien recibe"
        autoComplete="name"
        value={nombreRecibe}
        onChange={(e) => setNombre(e.target.value)}
        error={intento && faltaNombre ? 'Falta el nombre. Escribe quién recibe.' : undefined}
      />
      <Field
        label="Teléfono"
        mono
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        error={intento && telMal ? 'El número no es válido. Revisa que tenga 10 dígitos.' : undefined}
      />
      {fallo && (
        <div className="ds-field__error" role="alert">
          <Icon nombre="error" size={18} trazo={2.5} />
          {fallo}
        </div>
      )}
      <Button type="submit" disabled={enviando} aria-busy={enviando || undefined}>
        {enviando ? 'Guardando…' : 'Usar esta dirección'}
      </Button>
    </form>
  );
}

/** Dirección de entrega: vista corta por defecto ("Conjunto · T2 · 304 · Ana" + "Cambiar").
 *  direcciones: [{id, conjunto:{slug,nombre}, etiqueta, nombreRecibe, telefono}]. valor: id elegido.
 *  onElegir(id). onCrear({conjunto, torre, apto, nombreRecibe, telefono}) → Promise.
 *  conjuntos: [{slug,nombre}] para el selector. mostrarConjunto: bool.
 *  precarga: {nombreRecibe, telefono}. `tema` solo para vistas previas.
 *  Sin direcciones, el formulario sale en la vista (sin Sheet) y su botón guarda y elige. */
export default function DireccionEntrega({
  direcciones = [],
  valor,
  onElegir,
  onCrear,
  conjuntos = [],
  mostrarConjunto = false,
  precarga,
  tema,
  className = '',
}) {
  const [abierta, setAbierta] = useState(false);
  const [sel, setSel] = useState(null);
  const grupo = useId();
  const actual = direcciones.find((d) => d.id === valor) ?? direcciones[0];
  const cerrar = () => setAbierta(false);

  if (direcciones.length === 0) {
    return (
      <div className={`ds-dir ${className}`.trim()}>
        <h3 className="ds-dir__titulo">Dónde entregamos</h3>
        <FormOtra conjuntos={conjuntos} mostrarConjunto={mostrarConjunto} precarga={precarga} onCrear={onCrear} />
      </div>
    );
  }

  const elegido = sel ?? actual.id;

  function abrir() {
    setSel(actual.id);
    setAbierta(true);
  }

  function usar() {
    onElegir?.(elegido);
    cerrar();
  }

  return (
    <div className={`ds-dir ${className}`.trim()}>
      <div className="ds-dir__corta">
        <Icon nombre="casa" size={24} />
        <p className="ds-dir__linea">
          <span className="ds-sr-only">Entrega en: </span>
          {linea(actual, mostrarConjunto)}
        </p>
        <button type="button" className="ds-enlace" onClick={abrir}>
          Cambiar
        </button>
      </div>
      <Sheet open={abierta} onClose={cerrar} title="Dónde entregamos" tema={tema}>
        <div role="radiogroup" aria-label="Direcciones guardadas" className="ds-dir__lista">
          {direcciones.map((d) => (
            <label key={d.id} className={`ds-dir__opcion${elegido === d.id ? ' ds-dir__opcion--sel' : ''}`}>
              <input type="radio" name={grupo} value={d.id} checked={elegido === d.id} onChange={() => setSel(d.id)} />
              <span>{linea(d, mostrarConjunto)}</span>
            </label>
          ))}
          <label className={`ds-dir__opcion${elegido === OTRA ? ' ds-dir__opcion--sel' : ''}`}>
            <input type="radio" name={grupo} value={OTRA} checked={elegido === OTRA} onChange={() => setSel(OTRA)} />
            <span>Otra dirección</span>
          </label>
        </div>
        {elegido === OTRA ? (
          <FormOtra
            conjuntos={conjuntos}
            mostrarConjunto={mostrarConjunto || conjuntos.length > 1}
            precarga={precarga}
            onCrear={async (datos) => {
              await onCrear?.(datos);
            }}
            onListo={cerrar}
          />
        ) : (
          <Button onClick={usar}>Usar esta dirección</Button>
        )}
      </Sheet>
    </div>
  );
}
