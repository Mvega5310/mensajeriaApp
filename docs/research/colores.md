# Investigación de color: paleta de Puertayá

Fecha: 2026-10-27. Se tomó esta decisión porque al usuario no le gustaron ni el fondo kraft ni el look oscuro con turquesa neón.

## Qué dice la evidencia

1. **El modo claro se lee mejor a pleno sol.** Un estudio de 2026 (215 usuarios) dio 5,78 para el modo claro y 4,29 para el oscuro con luz intensa; con poca luz ganó el oscuro (5,67 contra 4,42). El propio artículo lo presenta como orientativo. Una revisión de 2025 también concluye que el modo claro rinde mejor en lectura. Fuentes: [Gadget Hacks](https://android.gadgethacks.com/news/dark-mode-vs-light-mode-what-research-says-about-when-each-works-best/), [revisión 2025](https://ejournal.uinsaizu.ac.id/index.php/tids/article/download/13903/4311/41748) y [SoluteLabs](https://solutelabs.com/blog/light-vs-dark-mode).
   → **Decisión:** el operador trabaja en portería, muchas veces con sol. El tema por defecto es claro y el oscuro queda opcional para el turno de noche.
2. **El texto claro sobre fondo oscuro cuesta más a personas con baja visión** ([UM-Flint](https://www.umflint.edu/accessibility/dark-mode/)).
   → **Decisión:** el tema por defecto es claro.
3. **Con la edad cuesta más distinguir azul de violeta y azul de verde.** Los rojos y amarillos se distinguen mejor ([GerontoVis, arXiv](https://arxiv.org/pdf/2403.13173) y [Chalmers](https://research.chalmers.se/publication/?id=36320)). Los adultos mayores necesitan más brillo y contraste por luminosidad, no solo por tono ([UW CSE 440](https://courses.cs.washington.edu/courses/cse440/13wi/lecture_files/06-human-abilities.pdf)).
   → **Decisión:** el azul de acción no convive con otros azules, verdes o violetas que signifiquen algo distinto. El color complementario es naranja, y los estados llevan siempre palabra e ícono.
4. **El azul se asocia con confianza y seguridad, y el naranja con energía y acción** ([Adobe](https://www.adobe.com/express/learn/blog/best-color-combinations-that-build-trust) y [TrackMage](https://trackmage.com/color-customers-happy-branded-tracking/)). Estas fuentes son de marketing: sirven como heurística, no como ciencia.
   → **Decisión:** la acción y la confianza van en azul; la cortesía y lo nuevo, en naranja.
5. **Las transportadoras ya usan sus propios colores.** Servientrega usa verde azulado ([whatthelogo](https://whatthelogo.com/logo/servientrega/206223)) y Rappi, coral ([whatthelogo](https://whatthelogo.com/logo/rappi/48480)).
   → **Decisión:** el verde se reserva solo para el botón de WhatsApp. El turquesa de la marca queda como acento del logo y nunca se usa para dar significado.
6. **Ya existe un kit de marca** (`frontend/src/puertaya-brand/tokens.css`), con uniformes y publicidad en azul, turquesa y plata. Usar esos mismos colores da coherencia y ahorra rehacer la marca.

## Paleta elegida (v3)

| Rol | Día (por defecto) | Contraste | Noche |
|---|---|---|---|
| Fondo | `#F4F6F9` crema de marca | | `#0A1428` |
| Tarjeta | `#FFFFFF` | | `#13213B` |
| Texto | `#13294B` marino de marca | 13:1 | `#EEF2F8` |
| Texto secundario | `#4A5872` | 6,5:1 | `#B3BFD2` |
| **Acción (solo el botón principal)** | `#1E63C9` azul de marca, texto blanco | 5,7:1 | `#6EA0FF` |
| PIN | `#0C2E73` azul profundo | | `#C7D0DA` plata |
| Cortesía, lo nuevo | `#C2410C` naranja | 5,2:1 | `#FF9A4D` |
| WhatsApp | `#0F7A40` | 5,4:1 | `#25D366` |
| Aviso (con ícono) | `#8A5A00` | 5,5:1 | `#F2B33D` |
| Error | `#B42318` | 5,4:1 | `#FF6B5B` |
| Marca, solo decorativo | `#17B6C4` turquesa | no se usa en texto | igual |

**Qué hace que no se vea genérica:** no lleva degradados ni brillos neón. El botón principal tiene una sombra dura en azul profundo, los números van en tipografía monoespaciada como en una guía impresa y la cortesía aparece como un sello naranja inclinado. La tipografía es Atkinson Hyperlegible, pensada para baja visión, sobre una base clara y limpia.

**Descartadas:**
- Kraft: no le gustó al usuario.
- Oscuro con turquesa neón: se ve genérica, como hecha por IA, y se lee mal al sol.
- Violeta como color de cortesía: se confunde con el azul en adultos mayores.
