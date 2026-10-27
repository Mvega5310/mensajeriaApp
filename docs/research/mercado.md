# Investigación de mercado y UX — Puertaya

Fecha: 2026-10-27. Alcance: 9 búsquedas y 2 lecturas de fuentes. Cobertura de competidores parcial.
Todo lo marcado **[NO VERIFICADO]** es conocimiento previo o inferencia, no una fuente citada.

## 1. Cinco hallazgos clave

1. **El líder global registra el paquete con un escaneo, sin aviso previo.** En BuildingLink, escanear la etiqueta identifica la transportadora y la guía, asigna la unidad y registra el paquete "en menos de 5 s" (dato del proveedor). Admite lote y registro manual. [Fuente](https://www.buildinglink.io/features/package-concierge-locker-system-software)
2. **Ningún competidor revisado exige que el residente avise antes.** El operador registra primero y el residente se entera después. Una reseña de Notifii señala como único inconveniente que "hay que ingresar la info primero" ([fuente](https://softwarefinder.com/marketing-software/notifii/reviews)). El aviso previo debe ser opcional, nunca un requisito.
3. **La entrega se prueba con firma, foto o PIN**, y queda en una línea de tiempo por paquete. Yardi SmartScan usa OCR de la etiqueta y firma digital. [Fuente](https://apps.apple.com/us/app/yardi-concierge-smartscan-2/id1314808715)
4. **Colombia es mayoritariamente Android**: 78,5 % Android frente a 21,5 % iOS en septiembre de 2026 ([Statcounter](https://gs.statcounter.com/os-market-share/mobile/colombia)). Hay mucha gama baja ([La República](https://www.larepublica.co/internet-economy/en-colombia-hay-mas-de-77-millones-de-celulares-activos-y-xiaomi-es-el-lider-en-ventas-3867685)). Conviene una PWA ligera, con tipografía grande, que funcione con señal intermitente.
5. **En Colombia el segmento de paquetes casi no tiene oferta.** Comunidad Feliz ([Xataka](https://www.xataka.com.co/aplicaciones/buenas-noticias-para-residentes-conjuntos-residenciales-colombia-esta-plataforma-internacional-llega-para-facilitar-administracion-digitalizar-propiedad-horizontal-pais)) es una plataforma de administración general. Portea ([ficha](https://www.softwareadvice.com.au/software/558403/Portea)) es un software de portería de Medellín. Ninguno se enfoca en el cobro por paquete. Esto es una inferencia, no un estudio formal.

## 2. Competidores

| Producto | Cómo recibe | Cómo avisa | Cómo prueba la entrega | Cobro |
|---|---|---|---|---|
| BuildingLink / Package Concierge | Escaneo + foto opcional; lote; manual | Push, email o SMS; recordatorios | Firma, foto o PIN | Suscripción [NO VERIFICADO] |
| Yardi Concierge SmartScan | OCR de foto de la etiqueta | Email | Firma digital + acuse | [NO VERIFICADO] |
| Luxer One (lockers) | Depósito en locker | [NO VERIFICADO] | Foto y firma bajo video (prensa) | [NO VERIFICADO] |
| Parcel Pending (lockers) | El courier deposita | Email | [NO VERIFICADO] | [NO VERIFICADO] |
| Notifii | Ingreso manual | [NO VERIFICADO] | [NO VERIFICADO] | [NO VERIFICADO] |
| DOOR / Latch Concierge Pro | Portero virtual | Aviso tras la entrega | [NO VERIFICADO] | [NO VERIFICADO] |
| Comunidad Feliz (CO) | El residente coordina con portería | [NO VERIFICADO] | [NO VERIFICADO] | Suscripción [NO VERIFICADO] |
| Portea (CO) | [NO VERIFICADO] | [NO VERIFICADO] | [NO VERIFICADO] | [NO VERIFICADO] |

Sin información: Amazon Hub, ButterflyMX, SwiftShelf, PackageX, Receivd, ParcelTracker, Habitanto, Kipo y Domus. No se contaron los toques de cada competidor porque ninguna fuente los detalla.

## 3. Patrones UX ordenados por impacto y esfuerzo

1. **Registrar sin aviso previo.** Si no hay coincidencia, el paquete queda "sin asignar". Impacto alto, esfuerzo bajo.
2. **Buscar el apartamento con teclado numérico y autocompletado**: se escribe "304" y aparece "Torre 2 · Apto 304 · Nombre". Impacto alto, esfuerzo bajo.
3. **Foto opcional al recibir y al entregar, con un toque.** Impacto alto, esfuerzo bajo.
4. **Aviso por wa.me con mensaje precargado** (guía, peso, tarifa y enlace de retiro). Mantiene la decisión de costo. Impacto alto, esfuerzo bajo.
5. **PIN de 4 dígitos o QR para retirar**, enviado en el aviso. Esfuerzo medio.
6. **Tarifa automática por peso** con 3 o 4 botones grandes, y el cobro marcado como "efectivo" o "transferencia". Impacto alto, esfuerzo bajo.
7. **Entrega masiva:** "Entregar todo" con los paquetes pendientes del apartamento. Impacto medio, esfuerzo bajo.
8. **Escaneo de guía u OCR.** Esfuerzo alto, y su precisión con etiquetas colombianas está [NO VERIFICADO]. Queda para la fase 2, empezando por leer solo el código de barras.

**Modo sin conexión** (cola local y sincronización al volver la señal): es una recomendación propia, no un patrón comprobado en el sector.

## 4. Flujos propuestos (metas de diseño, no medidas)

- **El operador recibe (4 toques):** abre la app en "Recibir" → escribe el apartamento y toca la sugerencia → elige el peso → "Guardar", con foto opcional. Luego, si quiere, "Avisar por WhatsApp" (1 toque más).
- **El residente retira (sin iniciar sesión):** abre el enlace de WhatsApp → muestra su PIN o QR → el operador lo escribe o lo escanea → "Entregar todo" → marca efectivo o transferencia.
- **El residente avisa (opcional, 3 toques):** abre el enlace → escribe la guía y la transportadora → "Enviar". El paquete se vincula solo cuando llega.

## 5. Contexto Colombia

- **Android**, 78,5 %: es tráfico web, no usuarios de la app.
- **WhatsApp**: no se consiguió una cifra de penetración [NO VERIFICADO]. Hay que confirmarla en DataReportal, Digital 2026 Colombia.
- **Correo o push**: no hay datos comparativos. La hipótesis es que WhatsApp llega mejor que el push de una app que el residente no instala.
- **Ley 1581 y RNBD**: la inscripción es obligatoria para personas jurídicas con activos de más de 100.000 UVT ([Holland & Knight, 2025](https://www.hklaw.com/es/insights/publications/2025/01/obligaciones-del-registro-nacional-de-bases-de-datos-personales)). **Sin confirmar** si aplica a una copropiedad o a un operador independiente. En todo caso hacen falta una política de tratamiento, la autorización del titular y medidas de seguridad. Hay que consultarlo con un abogado.

## 6. Qué le molesta al usuario

No se encontraron reseñas reales. DOOR indica que si no llega el aviso hay que revisar el teléfono registrado ([fuente](https://support.door.com/hc/en-us/articles/24676670054935-How-does-Concierge-Pro-work-in-the-DOOR-App)), así que un fallo probable son los datos de contacto desactualizados. Para tener evidencia hay que entrevistar al operador y a unos 5 residentes de Ipanema.

## 7. Riesgos

- **Paquetes sin dueño:** lista "sin asignar" con foto y fecha, y plazo máximo de custodia.
- **Aviso al apartamento equivocado:** mostrar nombre y apartamento antes de abrir wa.me.
- **wa.me manual en horas pico:** un toque extra por paquete. Si crece el volumen, reevaluar la API oficial (no se investigaron precios).
- **Custodia y responsabilidad:** la foto y la hora de recepción protegen al operador. Es un criterio de diseño, no asesoría legal.
- **Mercado colombiano poco atendido:** puede ser un nicho libre o falta de demanda. No hay datos para distinguirlo.

## 8. Pendiente de verificar

Penetración de WhatsApp, push y correo en Colombia. Toques, precios y modelos de cobro de los competidores. Reseñas reales. Obligación de RNBD. Funciones de paquetes en Comunidad Feliz y Portea. Precisión del OCR con etiquetas colombianas.
