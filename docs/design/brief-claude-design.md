# Brief para Claude Design: Puertayá mobile-first

Pega este documento en claude.ai/design. Pide primero el **sistema de diseño** y después las **pantallas a 390 px**, en tema oscuro y claro. Cuando estén listas, exporta las pantallas a `docs/design/`.

## Producto en una línea

Puertayá recibe, guarda y entrega los paquetes de un conjunto residencial en Colombia. El operador del conjunto cobra una tarifa por paquete según el peso, en efectivo o por transferencia.

## Recorrido principal

**LLEGA → REGISTRO (operador, 4 toques) → AVISO (WhatsApp) → ENTREGA CON PIN → ENTREGADO**

El residente **no necesita avisar antes**. La pre-alerta es opcional y, si existe, se vincula sola cuando llega el paquete.

## Usuarios

- **Operador:** Android de gama media, una mano, apurado, a veces al sol y con mala señal. Registra muchos paquetes seguidos.
- **Residente:** de cualquier edad, poco técnico, se comunica por WhatsApp. Puede no tener la app abierta.

## Principios (heredados de QUIÉN?)

1. **Una pantalla, una decisión.** Un solo botón principal, abajo y al alcance del pulgar (56 px).
2. **Primero mostrar, después leer.** Número de apartamento, ícono y foto antes que el texto. Frases cortas.
3. **Controles de 48 px como mínimo**, con 8 px de separación. Texto corrido de 16 px como mínimo.
4. **Contraste de 4,5:1 o más en ambos temas.** El estado nunca se indica solo con color: siempre lleva ícono o palabra.
5. **Un color, un significado.** Si una pantalla tiene dos botones del color de acción, uno sobra.
6. **La espera nunca es una pantalla muerta.** Si no hay señal: "Sin señal. Guardamos el registro y lo enviamos al volver la conexión."
7. **Mobile primero y también web.** En escritorio el mismo diseño pasa a dos columnas.

## Marca

Identidad azul, turquesa y plata (`frontend/src/puertaya-brand/tokens.css`):

| Nombre | Hex |
|---|---|
| navy | `#13294B` |
| blue | `#1E63C9` |
| blue-deep | `#0C2E73` |
| teal | `#17B6C4` |
| silver | `#C7D0DA` |
| fondo oscuro | `#0A1428` |
| fondo claro | `#F4F6F9` |

**Aviso:** el turquesa sobre fondo claro da 2,2:1 y no sirve para texto. Hay que oscurecerlo en el tema claro o usarlo solo como acento.

### Tokens a definir

- **Colores:** `--bg`, `--surface`, `--surface-raised`, `--ink`, `--ink-muted` y `--action` (solo la acción principal).
- **Colores de significado:** `--whatsapp`, `--pin` (confianza), `--courtesy` (primera entrega gratis), `--warning` y `--danger`.
- **Medidas:** `--tap-min: 48px`, radios y espacios.
- **Tipografía:** una familia para títulos, una para texto y una monoespaciada con números tabulares para el PIN, los montos y el apartamento.
- **Temas:** oscuro y claro con las mismas variables.

## Pantallas (390 px)

### Operador

1. **Recibir.** Pantalla de inicio con un teclado numérico grande para escribir el apartamento. Al escribir "304" aparecen sugerencias del tipo "T2 · 304 · Ana Gómez". Abajo, el contador "Hoy: 12 recibidos · 5 por entregar".
2. **Peso y foto.** Cuatro botones grandes de categoría, cada uno con su tarifa (Mano, Estándar, Volumen, Pesado; los montos vienen del conjunto). Debajo, una foto opcional de un toque. Botón principal: **"Guardar"**. Si el residente tiene la primera entrega gratis, se ve la etiqueta "Primera entrega gratis".
3. **Guardado.** Confirmación con el resumen y el botón principal **"Avisar por WhatsApp"**, que abre wa.me con el mensaje ya escrito. Acción secundaria: "Recibir otro".
4. **Entregar.** Teclado de PIN de 4 dígitos (o escanear QR). Después muestra todos los paquetes pendientes de ese apartamento, el total a cobrar y el método de pago (Efectivo o Transferencia). Botón: **"Entregar todo"**.
5. **Por entregar.** Lista agrupada por apartamento, con filtros mínimos y búsqueda.
6. **Sin asignar.** Paquetes cuyo destinatario no se reconoció, con foto y fecha, y el botón **"Asignar"**.
7. **Estados:** vacío, sin señal, error (qué pasó y qué hacer) y PIN incorrecto (con intentos restantes).

### Residente (se entra desde el enlace de WhatsApp)

1. **Mis paquetes.** Tarjeta grande con el estado ("En portería desde las 10:42"), la foto, el monto y el **PIN en grande**. Botón principal: **"Pedir entrega"**.
2. **Pedir entrega.** Una sola decisión: elegir la franja (chips grandes) y **"Confirmar"**.
3. **Avisar un paquete (opcional).** Dos campos: transportadora y guía. Todo lo demás va escondido en "Agregar detalles". Botón: **"Avisar"**.
4. **Acceso.** Sin contraseña: enlace mágico por correo o código. Si hay una cuenta existente, se conserva.
5. **Historial.** Paquetes entregados con fecha, monto y foto.

### Ambos

- **Escritorio a 1280 px:** solo hace falta una pantalla de ejemplo (Por entregar en dos columnas).

## Textos

- **Tuteo y tono cercano:** "Te llegó un paquete", "Ana tiene 2 paquetes".
- **Botones con verbo primero y tres palabras como máximo.**
- **Errores en dos partes:** qué pasó y qué hacer. Sin exclamaciones y sin culpar al usuario.
- **Sin emoji en la interfaz.**
- **Formato de cifras:** `$3.000`, `10:42`, `T2 · 304`.
- **Datos de prueba siempre con la etiqueta DEMO.**
- **Nunca un nombre de conjunto fijo:** "Ipanema" aparece solo como dato de ejemplo.

## Qué entregar

1. Sistema de diseño con tokens CSS, tipografía y componentes: botón principal y secundario, tarjeta de paquete, chip, teclado numérico, campo PIN, insignias de estado, barra inferior, hoja (sheet) y toast.
2. Las 12 pantallas listadas, en tema oscuro y claro.
3. Notas de interacción: qué pasa al tocar cada botón y las animaciones con su versión `prefers-reduced-motion`.
