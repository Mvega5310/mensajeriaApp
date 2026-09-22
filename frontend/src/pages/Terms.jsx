import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isAuthenticated } from '../services/auth.js';
import { getConjuntoConfig, getConfigPublica } from '../services/conjunto.js';

// Términos según el contexto (KAN-8, Fase D — design.md §4.3.1):
// - con ?c=<codigo> (sin sesión): datos del operador desde config-publica;
// - con sesión: desde /conjunto/config;
// - sin ninguno: versión genérica, sin datos de operador, con una nota.
// No se inventa texto legal nuevo más allá de esa nota.
export default function Terms() {
  const [searchParams] = useSearchParams();
  const codigo = (searchParams.get('c') || '').trim();

  // Datos del operador/conjunto (null = aún sin resolver / genérico).
  const [op, setOp] = useState(null);

  useEffect(() => {
    if (isAuthenticated()) {
      getConjuntoConfig().then(setOp).catch(() => setOp(null));
    } else if (codigo) {
      getConfigPublica(codigo).then(setOp).catch(() => setOp(null));
    }
  }, [codigo]);

  const hayOperador = !!op;
  const nombreConjunto = op?.nombre || null;
  const opNombre = op?.operadorNombre || null;
  const opDomicilio = op?.operadorDomicilio || null;
  const opWhatsapp = op?.operadorWhatsapp || null;

  // Marca para encabezado: nombre del conjunto si hay, si no la marca neutra.
  const marca = nombreConjunto ? `Puertaya · ${nombreConjunto}` : 'Puertaya';

  return (
    <div className="legal-shell">
      <Link to={codigo ? `/registro?c=${encodeURIComponent(codigo)}` : '/registro'} className="legal-back">← Volver al registro</Link>
      <h1>Términos y Condiciones y Aviso de Tratamiento de Datos Personales</h1>
      <p className="updated">Última actualización: agosto de 2026 · {marca}</p>

      {!hayOperador && (
        <div className="callout">
          Los datos del responsable del servicio (operador, domicilio y contacto) se muestran al abrir
          estos Términos desde el enlace de invitación de tu conjunto o cuando inicias sesión.
        </div>
      )}

      <h2>1. Quién presta el servicio</h2>
      {hayOperador ? (
        <p>
          {marca} es operado de forma independiente por <strong>{opNombre}</strong>,
          domiciliado en <strong>{opDomicilio}</strong>, contacto <strong>{opWhatsapp}</strong>.
        </p>
      ) : (
        <p>
          El servicio es operado de forma independiente por el responsable de cada conjunto. Sus datos
          (nombre, domicilio y contacto) se muestran al abrir estos Términos desde el enlace de
          invitación o al iniciar sesión.
        </p>
      )}

      <h2>2. Qué hace el servicio</h2>
      <p>
        El operador recibe paquetes de proveedores y transportadoras a nombre de los residentes
        registrados, los custodia temporalmente, y coordina su entrega en la puerta del apartamento
        en la franja horaria que el residente programe. El servicio tiene un costo por entrega según
        el tamaño/peso del paquete, visible en la aplicación antes de confirmar la recepción.
      </p>
      <p>
        Este servicio opera exclusivamente para residentes del conjunto residencial{nombreConjunto ? <> <strong>{nombreConjunto}</strong></> : ''} al
        que pertenece tu registro. Toda pre-alerta, recepción y entrega registrada en esta aplicación
        corresponde a paquetes de ese conjunto — no se reciben ni entregan paquetes de otras direcciones.
      </p>

      <h2>3. Datos personales que recogemos y para qué (Ley 1581 de 2012)</h2>
      <p>Al crear una cuenta, recogemos: nombre completo, correo electrónico, teléfono, torre y apartamento.</p>
      <p>Al usar el servicio, además: fotos de tus paquetes al momento de la recepción, y el detalle de cada paquete que notificas (proveedor, guía, si hay cobro contra entrega y el monto).</p>
      <p>Estos datos se usan únicamente para:</p>
      <ul>
        <li>Identificarte y darte acceso a tu cuenta.</li>
        <li>Coordinar la recepción y entrega de tus paquetes.</li>
        <li>Contactarte por WhatsApp sobre el estado de tus envíos.</li>
        <li>Dejar constancia del estado físico del paquete al momento de recibirlo (evidencia ante disputas).</li>
      </ul>
      <p>
        <strong>Tus derechos:</strong> puedes solicitar en cualquier momento acceder a tus datos,
        corregirlos, o pedir que se eliminen (derechos de acceso, rectificación, cancelación y
        oposición){opWhatsapp ? <>, escribiendo al <strong>{opWhatsapp} (WhatsApp)</strong></> : ' escribiendo al contacto del operador'}. Si eliminas tu
        cuenta, tus datos se conservan solo el tiempo necesario para resolver disputas de paquetes
        en curso y luego se eliminan.
      </p>
      <p>
        Tus datos no se venden ni se comparten con terceros distintos a las transportadoras
        estrictamente necesarias para completar una entrega puntual.
      </p>

      <h2>4. Custodia de paquetes y responsabilidad</h2>
      <p>
        El operador actúa como depositario temporal de tus paquetes desde que los recibe hasta que
        te los entrega. Se compromete a un cuidado razonable, incluyendo una foto de evidencia del
        estado del paquete al recibirlo.
      </p>
      <p>
        El operador <strong>no es responsable por el contenido</strong> de paquetes que no fueron
        declarados como de alto valor al momento de la pre-alerta, ni por daños o defectos de fábrica
        anteriores a la recepción. La responsabilidad del operador por pérdida o daño comprobado
        durante la custodia se limita <strong>al valor del producto que hayas declarado al crear la
        pre-alerta</strong>. Si no declaraste ningún valor, no hay base para reclamar un monto
        específico. Si vas a recibir un artículo de alto valor, decláralo o coordina su recepción de
        forma personal.
      </p>

      <h2>5. Cobro contra entrega y manejo de dinero de terceros</h2>
      <p>
        Si tu paquete tiene cobro contra entrega para la transportadora, ese dinero se transfiere
        directamente al operador (o a quien la transportadora indique) cuando esta se presenta —
        el operador nunca adelanta dinero propio. Si no transfieres a tiempo mientras la
        transportadora espera, el paquete queda pendiente para una nueva ronda de reparto, con el
        riesgo de que sea devuelto al remitente según las políticas de esa transportadora, ajenas al operador.
      </p>
      <p>
        La tarifa del servicio de entrega es independiente de ese cobro contra entrega, y se paga
        directamente al operador según el método que elijas al programar la entrega.
      </p>

      <h2>6. PIN de entrega</h2>
      <p>
        Cada paquete tiene un PIN de 4 dígitos que debes entregarle al operador en la puerta para
        confirmar la entrega. Es un control operativo básico para reducir entregas equivocadas —
        no es una verificación de identidad, así que evita compartirlo con nadie más que la persona
        que vaya a recibir el paquete en tu nombre.
      </p>

      <h2>7. Tarifas</h2>
      <p>
        Las tarifas por categoría de peso/tamaño se muestran en la aplicación y pueden cambiar; el
        precio que aplica es el vigente en el momento en que el operador recibe tu paquete.
      </p>

      <h2>8. Terminación</h2>
      <p>
        Puedes dejar de usar el servicio cuando quieras. El operador puede suspender una cuenta que
        incumpla reiteradamente estos términos (por ejemplo, no pagar cobros contra entrega
        acordados).
      </p>

      <h2>9. Contacto</h2>
      <p>
        Preguntas, quejas o solicitudes sobre tus datos personales:{' '}
        {opWhatsapp ? <strong>{opWhatsapp} (WhatsApp)</strong> : 'el contacto del operador, visible al abrir estos Términos desde el enlace de invitación o al iniciar sesión'}.
      </p>
    </div>
  );
}
