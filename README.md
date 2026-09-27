# Estudio Álbum

Aplicación web para **mejorar fotos automáticamente como lo haría un diseñador profesional** y
**maquetar un álbum listo para imprimir**. Funciona íntegramente en el navegador: las fotos no se
suben a ningún servidor.

## Cómo usarla

1. Abre `index.html` en Chrome, Edge, Firefox o Safari (doble clic; no requiere instalación).
   También puedes servir la carpeta: `npx serve .`
2. **Fotos**: arrastra tus fotos (JPG, PNG o WebP). Cada una se analiza y se revela al instante.
   Activa «Ver originales» para comparar.
3. **Edición** (opcional): compara antes/después con el deslizador, elige un estilo y afina con los
   controles. Marca el *punto de interés* para que el álbum encuadre alrededor de él.
4. **Álbum**: se diseña automáticamente. Cambia tamaño, fondo, márgenes, plantillas y pies de foto,
   y arrastra fotos entre huecos.
5. **Exportar para imprimir**: PDF a 300 ppp con 3 mm de sangrado (o un JPG por página).

## Qué hace el revelado automático

| Paso | Descripción |
| --- | --- |
| Balance de blancos y niveles | Estira el histograma por canal (percentiles 0,4 % / 99,6 %) mezclado con el de luminancia para quitar dominantes de color y velo sin «sobrecorregir» atardeceres. |
| Exposición | Ajusta la gamma para llevar la mediana de luminancia a un valor natural; aclara subexposiciones y es prudente al oscurecer. |
| Luces y sombras | Recupera luces y abre sombras de forma local (máscara de luminancia desenfocada). |
| Contraste | Curva en S cuya intensidad depende del contraste real de la foto. |
| Intensidad del color | *Vibrance* que satura más los colores apagados y protege los tonos de piel. |
| Claridad y nitidez | Contraste local de medios tonos y máscara de enfoque escalada según la resolución. |
| Estilos | Natural, Vívido, Luminoso, Cálido dorado, Retrato suave, Cine, Película, B/N clásico y B/N suave. |

Además calcula una puntuación de nitidez (varianza del laplaciano) para marcar fotos
**destacadas** —que van a portada o a página completa— y avisar de las **poco nítidas**.

## Maquetación e impresión

- Tamaños: 20×20, 30×30, 30×20, A4 horizontal/vertical y 20×30 cm.
- 11 plantillas (a sangre, 1–6 fotos). El diseño automático alterna composiciones y asigna cada
  foto al hueco cuyas proporciones mejor encajan, para recortar lo mínimo.
- Aviso de **resolución insuficiente** (< 150 ppp efectivos) en cada hueco.
- La exportación re-revela cada foto desde el archivo original a la resolución exacta necesaria,
  así que la calidad no se limita a la vista previa.
- El PDF incluye `TrimBox`/`BleedBox` para imprenta y se genera sin librerías externas.

## Estructura

```
index.html        Interfaz
css/styles.css    Estilos
js/enhance.js     Motor de revelado (análisis + procesado de píxeles)
js/album.js       Tamaños, plantillas, diseño automático y dibujo de páginas
js/pdf.js         Generador de PDF para imprenta
js/app.js         Flujo de la aplicación
```

> Nota: los archivos HEIC del iPhone solo se abren en Safari; en otros navegadores conviértelos a JPG.
