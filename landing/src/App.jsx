import { useState, useRef, useEffect } from "react";
import logoWhite from "./assets/brand/puertaya-lockup-dark-new.png";
import heroPhoto from "./assets/hero-delivery.webp";

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
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    play: <path d="M9.5 7.5v9l7-4.5-7-4.5Z"/>,
    mobile: <><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></>
  };
  return <svg {...common}>{paths[name] || paths.check}</svg>;
};

function Reveal({ as: Tag = "div", className = "", children, ...rest }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`reveal${visible ? " in-view" : ""}${className ? " " + className : ""}`} {...rest}>{children}</Tag>;
}

const features = [
  { icon: "package", label: "Recepción de paquetes" },
  { icon: "bell", label: "Notificaciones en tiempo real" },
  { icon: "lock", label: "Entrega segura con PIN" },
  { icon: "building", label: "Multi-conjunto residencial" },
  { icon: "mobile", label: "App móvil (PWA)" }
];

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
      <a className="brand" href="#inicio" aria-label="Puertayá, inicio"><img src={logoWhite} alt="Puertayá — De la portería a tu puerta" /></a>
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

function FeatureBar() {
  return <div className="feature-bar">
    {features.map(f => <div className="feature-item" key={f.icon}><span className="feature-icon"><Icon name={f.icon} size={21}/></span><small>{f.label}</small></div>)}
  </div>;
}

function Hero() {
  return <section className="hero" id="inicio">
    <div className="hero-bg">
      <img className="hero-bg-photo" src={heroPhoto} alt="Mensajero entregando un paquete a una residente en la puerta de su apartamento" />
      <div className="hero-scrim" />
    </div>
    <div className="hero-content">
      <div className="hero-kicker"><span className="kicker-dot"/> LOGÍSTICA RESIDENCIAL, MÁS SIMPLE</div>
      <h1>De la portería <span>a tu puerta.</span><br/>Sin perder el hilo.</h1>
      <p className="hero-lead">Recibir paquetes en tu conjunto puede ser mucho más fácil. Puertayá conecta residentes y operadores para que cada entrega tenga orden, seguimiento y tranquilidad.</p>
      <div className="hero-actions">
        <a className="button" href={`${APP_URL}/registro`}>Empieza con Puertayá <Icon name="arrow" size={18}/></a>
        <a className="button button-ghost" href="#como-funciona">Ver demostración <Icon name="play" size={16}/></a>
      </div>
    </div>
    <div className="float-note hero-float"><span className="float-check"><Icon name="check" size={15}/></span><div><strong>¡Tu paquete ya está disponible!</strong><small>Recógelo cuando quieras</small></div></div>
    <FeatureBar/>
  </section>;
}

function HowItWorks() {
  return <section className="section how-section" id="como-funciona">
    <Reveal as="div" className="section-heading centered"><span className="section-kicker">ASÍ DE FÁCIL</span><h2>Tu paquete, en buenas manos.<br/><em>Y tú, siempre al tanto.</em></h2><p>Un recorrido claro desde que esperas tu compra hasta que la recibes en casa.</p></Reveal>
    <Reveal as="div" className="steps-grid">{steps.map(s=><article className="step-card" key={s.n}><div className="step-top"><span className="step-number">{s.n}</span><span className="step-icon"><Icon name={s.icon} size={23}/></span></div><h3>{s.title}</h3><p>{s.text}</p></article>)}</Reveal>
  </section>;
}

function DeviceMockup() {
  return <div className="device-mockup">
    <div className="device-laptop">
      <div className="laptop-bar"><span/><span/><span/></div>
      <div className="laptop-body">
        <div className="laptop-head"><strong>Mis Paquetes</strong><span className="laptop-tag">3 activos</span></div>
        <div className="laptop-row done"><span className="row-icon"><Icon name="check" size={14}/></span><div className="laptop-row-info"><strong>Compra en línea</strong><small>Recibido hoy · 11:32 a.m.</small></div></div>
        <div className="laptop-row"><span className="row-icon"><Icon name="clock" size={14}/></span><div className="laptop-row-info"><strong>Encomienda</strong><small>Entrega por programar</small></div></div>
        <div className="laptop-row"><span className="row-icon"><Icon name="package" size={14}/></span><div className="laptop-row-info"><strong>Mercado libre</strong><small>Pre-alerta registrada</small></div></div>
      </div>
      <div className="laptop-base"/>
    </div>
    <div className="device-phone">
      <div className="phone-notch"/>
      <div className="phone-screen">
        <div className="phone-notif"><span className="float-check"><Icon name="bell" size={13}/></span><div><strong>¡Hola, María!</strong><small>Tu paquete ya está disponible</small></div></div>
        <div className="phone-mini-row"/>
        <div className="phone-mini-row short"/>
      </div>
    </div>
  </div>;
}

function Benefits() {
  return <section className="benefits-section" id="beneficios">
    <div className="benefits-inner">
      <Reveal as="div" className="benefits-copy"><span className="section-kicker light-kicker">ORDEN PARA TODOS</span><h2>Una sola plataforma.<br/><em>Dos grandes aliados.</em></h2><p>La operación de paquetes se vuelve más clara cuando todos comparten la misma información.</p>
        <div className="benefit-list"><div><span><Icon name="users"/></span><div><h3>Para residentes</h3><p>Consulta tus paquetes, recibe avisos, programa entregas y comunícate con el operador desde un solo lugar.</p></div></div><div><span><Icon name="building"/></span><div><h3>Para operadores</h3><p>Organiza recepción, reparto y bitácora; registra evidencias y confirma las entregas con PIN.</p></div></div></div>
      </Reveal>
      <Reveal as="div" className="benefit-visual"><DeviceMockup/></Reveal>
    </div>
  </section>;
}

function MultiConjunto() {
  return <section className="section multi-section">
    <Reveal as="div" className="multi-grid">
      <div className="multi-card">
        <div className="multi-icon"><Icon name="building" size={24}/></div>
        <div className="multi-copy"><span className="section-kicker">PREPARADO PARA CRECER</span><h2>Cada conjunto, su propio espacio.</h2><p>Puertayá permite gestionar varios conjuntos residenciales manteniendo separados sus residentes, operadores y paquetes. Cada comunidad conserva su operación organizada.</p></div>
      </div>
      <div className="multi-card">
        <div className="multi-icon"><Icon name="shield" size={24}/></div>
        <div className="multi-copy"><span className="section-kicker">SEGURIDAD Y CONFIANZA</span><h2>Cada entrega, con respaldo.</h2><p>Toda entrega se confirma con un PIN de 4 dígitos, y cada recepción queda con una foto de evidencia del estado del paquete.</p></div>
      </div>
    </Reveal>
  </section>;
}

function FAQ() {
  const [active, setActive] = useState(0);
  return <section className="section faq-section" id="preguntas"><div className="faq-layout"><Reveal as="div" className="section-heading"><span className="section-kicker">RESOLVEMOS TUS DUDAS</span><h2>Lo que quieres<br/><em>saber.</em></h2><p>Si estás empezando a usar Puertayá, aquí tienes algunas respuestas.</p><a className="text-link faq-cta" href={`${APP_URL}/login`}>Ir a la plataforma <Icon name="arrow" size={17}/></a></Reveal><Reveal as="div" className="faq-list">{faqs.map(([q,a],i)=><article className={active===i?"faq-item active":"faq-item"} key={q}><button onClick={()=>setActive(active===i?-1:i)} aria-expanded={active===i}><span>{q}</span><b>{active===i?"−":"+"}</b></button>{active===i&&<p>{a}</p>}</article>)}</Reveal></div></section>;
}

function FinalCTA() {
  return <section className="final-cta"><div className="cta-decoration decor-a"/><div className="cta-decoration decor-b"/><Reveal as="div" className="cta-content"><span className="section-kicker light-kicker">EL SIGUIENTE PAQUETE PUEDE SER MÁS FÁCIL</span><h2>Que recibirlo sea<br/><em>la mejor parte.</em></h2><p>Entra a Puertayá y mantén tus entregas residenciales en orden.</p><a className="button button-white" href={`${APP_URL}/registro`}>Conoce Puertayá <Icon name="arrow" size={18}/></a></Reveal></section>;
}

function Footer() {
  return <footer className="site-footer"><div className="footer-main"><img src={logoWhite} alt="Puertayá — De la portería a tu puerta" /><p>La logística residencial,<br/>más cerca de ti.</p><div className="footer-links"><a href="#como-funciona">Cómo funciona</a><a href="#beneficios">Beneficios</a><a href="#preguntas">Preguntas frecuentes</a><a href={`${APP_URL}/terminos`}>Términos y condiciones</a></div><a className="footer-login" href={`${APP_URL}/login`}>Acceder a la plataforma <Icon name="arrow" size={16}/></a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Puertayá. Todos los derechos reservados.</span><span>Hecho para conectar tu conjunto.</span></div></footer>;
}

export default function App() {
  return <><Header/><main><Hero/><HowItWorks/><Benefits/><MultiConjunto/><FAQ/><FinalCTA/></main><Footer/></>;
}
