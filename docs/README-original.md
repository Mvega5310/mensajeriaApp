# 📦 puertaya - Gestión y Entrega Residencial Puerta a Puerta

> Solución integral para la recepción, custodia, programación y entrega de paquetería en conjuntos y edificios residenciales, optimizada para **operadores independientes (Solopreneurs)**.

---

## 📋 Descripción del Proyecto

**puertaya** es una aplicación web progresiva diseñada para resolver la congestión de paquetes en recepciones de conjuntos residenciales y edificios. Bajo el modelo de **"vecino de confianza"**, permite a un único operador multifuncional (recepcionista, domiciliario y administrador) gestionar la cadena de custodia de extremo a extremo:

1. **Pre-alerta:** El residente notifica la llegada de su compra desde su interfaz.
2. **Recepción con Evidencia:** El operador recibe el paquete, toma una foto de estado y asigna la categoría de peso.
3. **Programación Inteligente:** El cliente elige su franja horaria de entrega en puerta.
4. **Cierre Seguro con PIN:** Validación de entrega mediante un código de 4 dígitos que garantiza que el paquete fue entregado al titular.

---

## ✨ Características Principales

### 👤 Interfaz del Residente (Cliente)
* **Formulario de Pre-alerta:** Registro rápido de Torre, Apartamento, Tienda y No. de Guía.
* **Control de Cobro Contra Entrega:** Indicador especial si el transportista exige recaudo en portería.
* **Seguimiento en Vivo:** Estados en tiempo real (`Pre-alertado` ➔ `En Recepción` ➔ `Programado` ➔ `Entregado`).
* **Visualizador de Foto de Custodia:** Fotografía de evidencia tomada al momento de la recepción.
* **Programador de Franjas:** Selección de horarios de entrega y método de pago del servicio.
* **PIN de Entrega:** Código único de 4 dígitos para autorizar la entrega en la puerta.

### 🛡️ Panel del Operador (Recepción + Domiciliario)
* **Métricas en Vivo:** Contadores rápidos de paquetes en custodia, por repartir y entregados.
* **Check-in Rápido con Cámara:** Captura o subida de foto de evidencia directamente desde el móvil.
* **Tarificación Automática:** Cálculo de costos según categoría de peso/volumen.
* **Modo Ronda de Reparto:** Entregas agrupadas por Torre y Piso para optimizar ascensor/escaleras.
* **Validador de PIN en Puerta:** Verificación estricta del código de seguridad antes de soltar el paquete.
* **Botón Rápido de WhatsApp:** Abre chats con mensajes prediseñados y enlace a la app.

---

## 💰 Estructura Tarifaria Integrada (Pesos Colombianos - COP)

| Categoría | Peso / Dimensiones | Ejemplos Típicos | Modalidad de Traslado | Tarifa Base |
| :--- | :--- | :--- | :--- | :--- |
| **1. Mano** | Hasta 1 kg (< 20 cm) | Sobres, maquillaje, fundas de celular, accesorios | Riñonera / Mano | **$3.000 COP** |
| **2. Estándar** | 1 a 5 kg (Hasta 35x35 cm) | Ropa, calzado, libros, pequeños electrodomésticos | Mochila / Canasta | **$4.500 COP** |
| **3. Voluminoso**| 5 a 15 kg (Hasta 50x50 cm)| Freidoras de aire, ventiladores, mercado mediano | Traslado a dos manos | **$7.000 COP** |
| **4. Carga Especial**| > 15 kg o extra-volumen | Bultos de concentrado (20-25 kg), televisores | Carretilla de carga | **$12.000 COP** |

---

## 🔄 Protocolo para Cobro Contra Entrega (Seguridad Financiera)

Para proteger el flujo de caja del operador independiente:
1. **Cobro del Servicio de Entrega:** Se recauda en puerta (Efectivo o Nequi/Daviplata) al validar el PIN.
2. **Recaudo del Producto al Transportista Externo:**
   * El cliente pre-alerta el monto exacto en la app.
   * Al llegar la transportadora, el operador solicita la transferencia digital inmediata vía WhatsApp.
   * **Regla de Oro:** No se desembolsa dinero propio; si el cliente no transfiere en el tiempo de espera del transportista, el paquete se deja para reprogramación.

---

## 🛠️ Estructura de Archivos

```plaintext
entrega-vecina/
├── index.html          # Aplicación SPA (HTML5 + Tailwind CSS + Vanilla JS)
├── README.md           # Documentación técnica y operativa