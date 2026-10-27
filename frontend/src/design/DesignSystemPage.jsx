// Catálogo del sistema de diseño (/_ds, solo en desarrollo). Muestra todos los
// componentes en día y noche lado a lado. Los datos son de ejemplo (DEMO).
import { useState } from 'react';
import {
  Badge, BottomNav, Button, Field, Keypad, PackageLabel, PinInput, Sheet, Stamp, ThemeToggle, Toast, TopBar,
} from './index.js';

const TABS = [
  { id: 'recibir', label: 'Recibir', icono: 'recibir', href: '#recibir' },
  { id: 'entregar', label: 'Entregar', icono: 'entregar', href: '#entregar' },
  { id: 'pendientes', label: 'Pendientes', icono: 'lista', href: '#pendientes', contador: 5 },
];

function Seccion({ titulo, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      <h2 className="ds-titulo" style={{ margin: 0, fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Panel({ tema }) {
  const [pin, setPin] = useState('48');
  const [hoja, setHoja] = useState(false);
  const [tab, setTab] = useState('recibir');
  const onKey = (k) => {
    if (k === 'borrar') setPin((p) => p.slice(0, -1));
    else if (/^\d$/.test(k)) setPin((p) => (p.length < 4 ? p + k : p));
  };
  const items = TABS.map((t) => ({ ...t, href: undefined, onClick: () => setTab(t.id) }));
  return (
    <div
      className={`pt ${tema}`}
      style={{ width: 390, maxWidth: '100%', boxSizing: 'border-box', padding: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}
    >
      <h1 className="ds-titulo" style={{ margin: 0, fontSize: 28 }}>
        {tema === 'dia' ? 'Día' : 'Noche'}
      </h1>

      <Seccion titulo="Botones">
        <Button>Guardar</Button>
        <Button variante="whatsapp" icono="whatsapp">Avisar por WhatsApp</Button>
        <Button variante="secundario">Recibir otro</Button>
        <Button as="a" href="#enlace" variante="secundario">Botón como enlace</Button>
        <Button disabled>Deshabilitado</Button>
      </Seccion>

      <Seccion titulo="Estados y sello">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Badge estado="en-porteria" />
          <Badge estado="programado">Programado 6–8 p. m.</Badge>
          <Badge estado="entregado" />
          <Badge estado="sin-asignar" />
          <Badge estado="demo" />
          <Stamp>Primera entrega gratis</Stamp>
        </div>
      </Seccion>

      <Seccion titulo="Etiqueta de paquete">
        <PackageLabel
          apto="T2 · 304"
          hora="10:42"
          detalles={[{ texto: 'Servientrega · Estándar', valor: '$3.000' }]}
        />
      </Seccion>

      <Seccion titulo="PIN y teclado">
        <PinInput value={pin} />
        <PinInput value="4821" error label="PIN incorrecto" />
        <Keypad onKey={onKey} extra={{ id: 'torre', label: 'Torre' }} />
      </Seccion>

      <Seccion titulo="Campos">
        <Field label="Nombre" placeholder="Ana Gómez" />
        <Field label="Apartamento" mono defaultValue="304" ayuda="Solo números." />
        <Field label="Teléfono" error="El número no es válido. Revisa que tenga 10 dígitos." defaultValue="31234" />
      </Seccion>

      <Seccion titulo="Avisos">
        <Toast>Sin señal. Guardamos el registro y lo enviamos al volver.</Toast>
        <Toast tipo="error">PIN incorrecto. Te quedan 4 intentos.</Toast>
        <Toast tipo="info" onClose={() => {}}>Paquete guardado.</Toast>
      </Seccion>

      <Seccion titulo="Barra superior, hoja y tema">
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', paddingBottom: 'var(--sp-1)' }}>
          <TopBar title="T2 · 304" subtitle="Ana Gómez" mono onBack={() => {}}>
            <ThemeToggle />
          </TopBar>
        </div>
        <Button variante="secundario" onClick={() => setHoja(true)}>Abrir hoja</Button>
        <Sheet open={hoja} onClose={() => setHoja(false)} title="Agregar detalles">
          <Field label="Guía" placeholder="Número de guía" />
          <Button onClick={() => setHoja(false)}>Listo</Button>
        </Sheet>
      </Seccion>

      <Seccion titulo="Barra inferior">
        <BottomNav items={items} activo={tab} />
      </Seccion>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <Panel tema="dia" />
      <Panel tema="noche" />
    </div>
  );
}
