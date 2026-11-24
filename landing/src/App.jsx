import { useState } from "react";
import logoLight from "../../frontend/src/puertaya-brand/logos/lockup/puertaya-lockup-light.png";
import logoWhite from "../../frontend/src/puertaya-brand/logos/lockup/puertaya-lockup-3d-blanco.png";

const APP_URL = "https://mensajeria-app-iota.vercel.app";

const Icon = ({ name, size = 22 }) => {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const paths = {
    package: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/><path d="m7.5 5.5 9 5"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>
  };
  return <svg {...common}>{paths[name] || paths.check}</svg>;
};

const steps = [
  { n: "01", icon: "package", title: "Pre-alerta tu paquete", text: "El residente registra que espera un envío y comparte los datos importantes para recibirlo." },
  { n: "02", icon: "bell", title: "La portería lo recibe", text: "El operador registra la llegada y el residente recibe una notificación por correo." },
  { n: "03", icon: "calendar", title: "Elige cuándo recibirlo", text: "Cuando el paquete está listo, el residente programa su franja de entrega." },
  { n: "04", icon: "check", title: "Llega hasta tu puerta", text: "El operador realiza la entrega y la confirma con el PIN correspondiente." }
];

const faqs = [
  ["¿Puertayá es una empresa de mensajería?", "Puertayá es una plataforma de gestión logística residencial. Organiza el proceso entre la recepción del conjunto, el operador y el residente; no reemplaza a las transportadoras que llevan los paquetes hasta la portería."],
  ["¿Quién puede usar la plataforma?", "Residentes y operadores de conjuntos residenciales habilitados en Puertayá. Cada conjunto administra su propia operación y sus usuarios."],
  ["¿Cómo sé cuándo llegó mi paquete?", "Cuando el operador registra la recepción, la plataforma envía una notificación por correo. También puedes consultar el estado de tus paquetes desde tu cuenta."],
  ["¿Puedo elegir cuándo me entregan?", "Sí. Cuando el paquete ya está recibido, el residente puede seleccionar o reprogramar una franja horaria disponible desde la plataforma."],
  ["¿Mis paquetes se mezclan con los de otros conjuntos?", "No. La plataforma está preparada para trabajar con múltiples conjuntos y mantener separados sus residentes, operadores y paquetes."]
];

function Header() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <header className="site-header">
    <div className="nav-wrap">
      <a className="brand" href="#inicio" aria-label="Puertayá, inicio"><img src={logoLight} alt="Puertayá — De la portería a tu puerta" /></a>
      <button className="mobile-toggle" aria-label={open ? "Cerrar menú" : "Abrir menú"} onClick={() => setOpen(!open)}><Icon name={open ? "close" : "menu"} /></button>
      <nav className={open ? "nav-links is-open" : "nav-links"}>
        <a href="#como-funciona" onClick={close}>Cómo funciona</a>
        <a href="#beneficios" onClick={close}>Beneficios</a>
        <a href="#preguntas" onClick={close}>Preguntas frecuentes</a>
        <a className="nav-login" href={`${APP_URL}/login`}>Iniciar sesión</a>
        <a className="button button-small" href={`${APP_URL}/registro`}>Crear mi cuenta <Icon name="arrow" size={17}/></a>
      </nav>
    </div>
  </header>;
}

function PackagePreview() {
  return <div className="preview-shell" aria-label="Vista ilustrativa del seguimiento de paquetes">
    <div className="preview-glow" />
    <div className="preview-card">
      <div className="preview-top"><div><span className="eyebrow">MI ESPACIO</span><h3>Hola, Andrea <span>✦</span></h3><p>Así va todo con tus paquetes.</p></div><div className="avatar">A</div></div>
      <div className="preview-stats">
        <div className="stat"><span className="stat-icon teal"><Icon name="package" size={18}/></span><strong>02</strong><small>En proceso</small></div>
        <div className="stat"><span className="stat-icon blue"><Icon name="check" size={18}/></span><strong>05</strong><small>Entregados</small></div>
      </div>
      <div className="package-row">
        <div className="parcel-icon"><Icon name="package" size={21}/></div>
        <div className="parcel-info"><strong>Compra en línea</strong><small>Paquete recibido en portería</small></div>
        <span className="status-pill"><i/> Recibido</span>
      </div>
      <div className="timeline">
        <div className="timeline-line"/>
        <div className="timeline-item done"><span><Icon name="check" size={12}/></span><div><strong>Pre-alerta registrada</strong><small>Hoy · 9:14 a. m.</small></div></div>
        <div className="timeline-item done"><span><Icon name="check" size={12}/></span><div><strong>Paquete recibido</strong><small>Hoy · 11:32 a. m.</small></div></div>
        <div className="timeline-item current"><span><Icon name="clock" size={12}/></span><div><strong>Entrega por programar</strong><small>Elige tu franja cuando quieras</small></div></div>
      </div>
      <div className="preview-bottom"><span><Icon name="shield" size={16}/> Tu entrega, bajo control</span><span className="preview-dots">•••</span></div>
    </div>
    <div className="float-note note-top"><span className="float-check"><Icon name="check" size={15}/></span><div><strong>¡Te avisamos!</strong><small>Tu paquete ya llegó</small></div></div>
    <div className="float-note note-bottom"><span className="float-clock"><Icon name="calendar" size={16}/></span><div><strong>A tu ritmo</strong><small>Programa la entrega</small></div></div>
  </div>;
}

function Hero() {
  return <section className="hero" id="inicio">
    <div className="hero-grid">
      <div className="hero-copy">
        <div className="hero-kicker"><span className="kicker-dot"/> LOGÍSTICA RESIDENCIAL, MÁS SIMPLE</div>
        <h1>De la portería <span>a tu puerta.</span><br/>Sin perder el hilo.</h1>
        <p className="hero-lead">Recibir paquetes en tu conjunto puede ser mucho más fácil. Puertayá conecta residentes y operadores para que cada entrega tenga orden, seguimiento y tranquilidad.</p>
        <div className="hero-actions"><a className="button" href={`${APP_URL}/registro`}>Empieza con Puertayá <Icon name="arrow" size={18}/></a><a className="text-link" href="#como-funciona">Descubre cómo funciona <span>↓</span></a></div>
        <div className="hero-trust"><div className="trust-avatars"><span>R</span><span>O</span><span>✓</span></div><p><strong>Un proceso conectado</strong><br/>para residentes y operadores</p></div>
      </div>
      <PackagePreview/>
    </div>
    <div className="hero-bottom"><span>UNA MEJOR EXPERIENCIA EN TU CONJUNTO</span><div><i/><span>Recepción</span><b>→</b><span>Notificación</span><b>→</b><span>Entrega</span></div></div>
  </section>;
}

function HowItWorks() {
  return <section className="section how-section" id="como-funciona">
    <div className="section-heading centered"><span className="section-kicker">ASÍ DE FÁCIL</span><h2>Tu paquete, en buenas manos.<br/><em>Y tú, siempre al tanto.</em></h2><p>Un recorrido claro desde que esperas tu compra hasta que la recibes en casa.</p></div>
    <div className="steps-grid">{steps.map(s=><article className="step-card" key={s.n}><div className="step-top"><span className="step-number">{s.n}</span><span className="step-icon"><Icon name={s.icon} size={23}/></span></div><h3>{s.title}</h3><p>{s.text}</p></article>)}</div>
  </section>;
}

function Benefits() {
  return <section className="benefits-section" id="beneficios">
    <div className="benefits-inner">
      <div className="benefits-copy"><span className="section-kicker light-kicker">ORDEN PARA TODOS</span><h2>Una sola plataforma.<br/><em>Dos grandes aliados.</em></h2><p>La operación de paquetes se vuelve más clara cuando todos comparten la misma información.</p>
        <div className="benefit-list"><div><span><Icon name="users"/></span><div><h3>Para residentes</h3><p>Consulta tus paquetes, recibe avisos, programa entregas y comunícate con el operador desde un solo lugar.</p></div></div><div><span><Icon name="building"/></span><div><h3>Para operadores</h3><p>Organiza recepción, reparto y bitácora; registra evidencias y confirma las entregas con PIN.</p></div></div></div>
      </div>
      <div className="benefit-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hub"><img src={logoWhite} alt="Puertayá"/></div><div className="orbit-node node-one"><Icon name="package" size={24}/><small>Paquetes</small></div><div className="orbit-node node-two"><Icon name="bell" size={24}/><small>Avisos</small></div><div className="orbit-node node-three"><Icon name="calendar" size={24}/><small>Entregas</small></div><div className="orbit-node node-four"><Icon name="shield" size={24}/><small>Control</small></div></div>
    </div>
  </section>;
}

function MultiConjunto() {
  return <section className="section multi-section"><div className="multi-card"><div className="multi-icon"><Icon name="building" size={27}/></div><div className="multi-copy"><span className="section-kicker">PREPARADO PARA CRECER</span><h2>Cada conjunto, su propio espacio.</h2><p>Puertayá permite gestionar varios conjuntos residenciales manteniendo separados sus residentes, operadores y paquetes. Cada comunidad conserva su operación organizada.</p></div><div className="multi-stamp"><Icon name="shield" size={19}/><span>Datos por<br/>conjunto</span></div></div></section>;
}

function FAQ() {
  const [active, setActive] = useState(0);
  return <section className="section faq-section" id="preguntas"><div className="faq-layout"><div className="section-heading"><span className="section-kicker">RESOLVEMOS TUS DUDAS</span><h2>Lo que quieres<br/><em>saber.</em></h2><p>Si estás empezando a usar Puertayá, aquí tienes algunas respuestas.</p><a className="text-link faq-cta" href={`${APP_URL}/login`}>Ir a la plataforma <Icon name="arrow" size={17}/></a></div><div className="faq-list">{faqs.map(([q,a],i)=><article className={active===i?"faq-item active":"faq-item"} key={q}><button onClick={()=>setActive(active===i?-1:i)} aria-expanded={active===i}><span>{q}</span><b>{active===i?"−":"+"}</b></button>{active===i&&<p>{a}</p>}</article>)}</div></div></section>;
}

function FinalCTA() {
  return <section className="final-cta"><div className="cta-decoration decor-a"/><div className="cta-decoration decor-b"/><div className="cta-content"><span className="section-kicker light-kicker">EL SIGUIENTE PAQUETE PUEDE SER MÁS FÁCIL</span><h2>Que recibirlo sea<br/><em>la mejor parte.</em></h2><p>Entra a Puertayá y mantén tus entregas residenciales en orden.</p><a className="button button-white" href={`${APP_URL}/registro`}>Conoce Puertayá <Icon name="arrow" size={18}/></a></div></section>;
}

function Footer() {
  return <footer className="site-footer"><div className="footer-main"><img src={logoWhite} alt="Puertayá — De la portería a tu puerta" /><p>La logística residencial,<br/>más cerca de ti.</p><div className="footer-links"><a href="#como-funciona">Cómo funciona</a><a href="#beneficios">Beneficios</a><a href="#preguntas">Preguntas frecuentes</a><a href={`${APP_URL}/terminos`}>Términos y condiciones</a></div><a className="footer-login" href={`${APP_URL}/login`}>Acceder a la plataforma <Icon name="arrow" size={16}/></a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Puertayá. Todos los derechos reservados.</span><span>Hecho para conectar tu conjunto.</span></div></footer>;
}

export default function App() {
  return <><Header/><main><Hero/><HowItWorks/><Benefits/><MultiConjunto/><FAQ/><FinalCTA/></main><Footer/></>;
}
