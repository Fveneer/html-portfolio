# Job Tailor

Una alternativa gratuita a AIApply: adapta tu hoja de vida a cada oferta de empleo con IA, genera cartas de presentación, prepara entrevistas y lleva el seguimiento de tus postulaciones.

- **Sin pagos ni suscripciones.** Usas tu propia clave de un proveedor con plan gratuito (Gemini, Groq, OpenRouter `:free`) o un modelo local con Ollama.
- **Sin backend.** Es HTML + JS estático. Tus datos se guardan solo en tu navegador (IndexedDB) y las llamadas van directo al proveedor de IA que elijas.
- **No inventa experiencia.** Los prompts prohíben agregar empleos, fechas, títulos, herramientas o métricas que no estén en tu CV maestro o en tus notas.

## Cómo usarlo

1. Abre `job-tailor/index.html` con doble clic (funciona sin servidor) o publícalo con GitHub Pages. Para leer PDF y DOCX necesitas conexión a internet la primera vez (la librería se descarga de un CDN).
2. **Ajustes**: elige un proveedor y pega tu API key. Lo más fácil es Google Gemini (clave gratis en https://aistudio.google.com/apikey). Pulsa **Cargar modelos** (elige el modelo más reciente disponible con tu clave) y luego "Probar conexión". Si un proveedor retira un modelo, la app cambia sola a uno disponible.
3. **Mi CV**: sube tu CV (PDF, DOCX o TXT), arrástralo sobre el recuadro o pégalo, añade notas (logros extra, roles objetivo) y pulsa **Estructurar con IA**. Revisa el resultado.
4. **Ofertas**: pega una oferta (o varias separadas por `---`, o una lista de URLs) y pulsa **Adaptar CV**, o usa **Adaptar CV a todas las pendientes** para procesarlas en lote.
5. En cada oferta: descarga el CV en PDF, Word o TXT, edítalo a mano, genera la carta, prepara la entrevista y responde preguntas del formulario.
6. **Seguimiento**: arrastra cada oferta entre columnas (Guardada → CV listo → Aplicada → Entrevista → Oferta / Rechazada).

## Funciones

| Función | Detalle |
| --- | --- |
| CV adaptado por oferta | Reescribe titular, resumen, habilidades y viñetas con la terminología de la oferta. Tres niveles: conservador, equilibrado, agresivo. |
| Generación en lote | Procesa todas las ofertas pendientes, con pausa configurable para no superar los límites de los planes gratis y reintentos automáticos ante errores 429. |
| Puntaje ATS | Análisis local de palabras clave: % del CV maestro frente al CV adaptado, y qué palabras clave faltan. |
| Compatibilidad y brechas | La IA estima tu compatibilidad (0–100), explica qué cambió y qué requisitos no cubres. |
| Carta de presentación | Tres tonos; exporta a PDF o Word. |
| Preparación de entrevista | 10 preguntas probables con respuestas tipo STAR basadas en tu CV, más preguntas para hacerle al entrevistador. |
| Preguntas del formulario | Responde preguntas como "¿Por qué quieres trabajar aquí?" a partir de tu CV y de la oferta. |
| Idiomas | Escribe los documentos en el idioma de la oferta o en el que elijas (ES, EN, PT, FR, DE). |
| Plantillas | Clásica (ATS), Moderna y Compacta; edición manual en la vista previa. |
| Importar desde URL | Lee el texto de la oferta mediante `r.jina.ai` (gratis). Si la página requiere iniciar sesión, pega la descripción manualmente. |
| Copias de seguridad | Exporta e importa todos tus datos en JSON. |

## Limitaciones

- No envía las postulaciones por ti en los portales (LinkedIn, Computrabajo, etc.): eso requiere iniciar sesión en cada sitio y suele ir contra sus términos de uso. La app te deja todo listo (CV, carta y respuestas) para que postules en segundos, y luego marcas la oferta como "Aplicada".
- Los planes gratuitos tienen límites de solicitudes por minuto o por día. Si ves errores 429, sube la pausa entre ofertas en Ajustes.
- Revisa siempre el CV antes de enviarlo: la IA puede equivocarse.
