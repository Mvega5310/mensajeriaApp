import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button, Field, SelectorConjunto, Toast } from '../design';
import { register } from '../services/auth.js';
import { getConfigPublica, getConjuntos } from '../services/conjunto.js';
import PasswordField from '../components/PasswordField.jsx';

const initial = { email: '', password: '', nombre: '', telefono: '', torre: 'Torre 1', apto: '', acceptedTerms: false };

export default function Register() {
  const [searchParams] = useSearchParams();
  // PLAN-conjunto S2.3: el conjunto se ELIGE con el selector (sin código de invitación). `?conjunto=<slug>`
  // (QR nuevo) llega preseleccionado. Los enlaces/QR viejos `?c=<codigo>` siguen sirviendo: el código viaja
  // en silencio y solo se usa si la persona no eligió conjunto (con 1 conjunto el selector ya lo lleva).
  const codigoDeUrl = (searchParams.get('c') || '').trim();
  const slugDeUrl = (searchParams.get('conjunto') || '').trim();

  const [fields, setFields] = useState(initial);
  const [conjuntos, setConjuntos] = useState([]);
  const [cargandoConjuntos, setCargandoConjuntos] = useState(true);
  const [errorConjuntos, setErrorConjuntos] = useState('');
  const [slug, setSlug] = useState(slugDeUrl);
  const [errorConjunto, setErrorConjunto] = useState('');
  // Datos públicos del conjunto elegido (nombre, punto de recepción) para mostrarlos.
  const [conjunto, setConjunto] = useState(null);

  const cargarConjuntos = useCallback(() => {
    setCargandoConjuntos(true);
    setErrorConjuntos('');
    getConjuntos()
      .then((lista) => {
        setConjuntos(Array.isArray(lista) ? lista : []);
        // Un ?conjunto= que ya no existe no se arrastra: se pide elegir.
        setSlug((s) => (s && !lista.some((c) => c.slug === s) ? '' : s));
      })
      .catch(() => setErrorConjuntos('No pudimos cargar los conjuntos. Revisa tu conexión.'))
      .finally(() => setCargandoConjuntos(false));
  }, []);
  useEffect(() => { cargarConjuntos(); }, [cargarConjuntos]);

  // Un `?c=<codigo>` antiguo (sin `?conjunto=`) se convierte en el conjunto elegido: se consulta
  // config-publica?c= (que devuelve el slug) y se preselecciona. Si el código no sirve, se
  // ignora en silencio: la persona elige el conjunto (o el único activo queda puesto) y el
  // registro sigue. El código solo viaja si no hay conjunto elegido (ver handleSubmit).
  const [resolviendoCodigo, setResolviendoCodigo] = useState(Boolean(codigoDeUrl && !slugDeUrl));
  useEffect(() => {
    if (!codigoDeUrl || slugDeUrl) return undefined;
    let vigente = true;
    getConfigPublica(codigoDeUrl)
      .then((cfg) => { if (vigente && cfg?.slug) setSlug((s) => s || cfg.slug); })
      .catch(() => {})
      .finally(() => { if (vigente) setResolviendoCodigo(false); });
    return () => { vigente = false; };
  }, [codigoDeUrl, slugDeUrl]);

  useEffect(() => {
    let vigente = true;
    setConjunto(null);
    if (slug) getConfigPublica('', slug).then((cfg) => { if (vigente) setConjunto(cfg); }).catch(() => {});
    return () => { vigente = false; };
  }, [slug]);

  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const irA = useNavigate();

  function update(key, value) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function elegirConjunto(valor) {
    setSlug(valor);
    setErrorConjunto('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setErrorConjunto('');
    if (!slug && !codigoDeUrl) {
      setErrorConjunto('Falta el conjunto. Elige uno de la lista.');
      return;
    }
    setLoading(true);
    try {
      // Con conjunto elegido manda el slug; el código viejo (?c=) solo si no hay slug.
      await register({ ...fields, ...(slug ? { conjunto: slug } : { codigoInvitacion: codigoDeUrl }) });
      setDone(true);
      setTimeout(() => irA('/login', { replace: true }), 1200);
    } catch (err) {
      if (err.code === 'CONJUNTO_REQUERIDO' || err.code === 'CONJUNTO_INVALIDO') setErrorConjunto(err.message);
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Crear cuenta de residente</h1>
      <p className="auth-sub">
        {slug && conjuntos.find((c) => c.slug === slug)
          ? `Te estás registrando en ${conjuntos.find((c) => c.slug === slug).nombre}.`
          : 'Elige tu conjunto y cuéntanos dónde recibes tus paquetes.'}
      </p>
      {conjunto?.puntoRecepcion && (
        <p className="auth-sub">Punto de recepción: {conjunto.puntoRecepcion}</p>
      )}

      {done ? (
        <p role="status">Cuenta creada. Te llevamos a entrar…</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <SelectorConjunto conjuntos={conjuntos} value={slug} onChange={elegirConjunto} cargando={cargandoConjuntos}
            error={errorConjuntos} onReintentar={cargarConjuntos} invalido={errorConjunto} id="conjunto" />
          <Field label="Nombre completo" id="nombre" required value={fields.nombre} onChange={(e) => update('nombre', e.target.value)} />
          <Field label="Correo" id="email" type="email" required autoComplete="email" value={fields.email} onChange={(e) => update('email', e.target.value)} />
          <PasswordField id="password" value={fields.password} autoComplete="new-password" onChange={(e) => update('password', e.target.value)}
            minLength={8} pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
            hint="Mínimo 8 caracteres, con al menos una letra y un número." />
          <Field label="Teléfono (WhatsApp)" id="telefono" type="tel" inputMode="numeric" required pattern="[0-9]{10}" title="10 dígitos"
            value={fields.telefono} onChange={(e) => update('telefono', e.target.value)} />
          <div className="auth-dos">
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="torre">Torre</label>
              <select id="torre" className="auth-select" value={fields.torre} onChange={(e) => update('torre', e.target.value)}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{`Torre ${n}`}</option>)}
              </select>
            </div>
            <Field label="Apartamento" id="apto" required placeholder="Ej. 402" mono value={fields.apto} onChange={(e) => update('apto', e.target.value)} />
          </div>

          <label className="auth-check">
            <input type="checkbox" required checked={fields.acceptedTerms}
              onChange={(e) => update('acceptedTerms', e.target.checked)} />
            <span>
              Acepto los <Link
                to={codigoDeUrl ? `/terminos?c=${encodeURIComponent(codigoDeUrl)}` : '/terminos'}
                target="_blank" rel="noreferrer">Términos y Condiciones y el Aviso de Tratamiento de Datos</Link>.
            </span>
          </label>

          {error && <Toast tipo="error">{error}</Toast>}
          <Button type="submit" disabled={loading || !fields.acceptedTerms || cargandoConjuntos || resolviendoCodigo} aria-busy={loading}>{loading ? 'Creando…' : 'Crear cuenta'}</Button>
        </form>
      )}

      <p className="auth-switch">¿Ya tienes cuenta? <Link to="/login">Entra aquí</Link></p>
    </div>
  );
}
