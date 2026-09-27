# Control de Vehículos PNP

Aplicación web para llevar el **control de la flota vehicular de una unidad de la Policía Nacional del Perú**:
vehículos, conductores, papeletas de salida y retorno, combustible, mantenimiento y alertas de vencimiento.
Funciona íntegramente en el navegador, sin servidor ni instalación.

## Cómo usarla

1. Abre `index.html` en Chrome, Edge, Firefox o Safari (doble clic). También puedes servir la carpeta: `npx serve .`
2. Escribe tu grado y apellidos en **Operador**: queda registrado en la bitácora de cada acción.
3. Registra los **vehículos** y los **efectivos conductores** (o pulsa «Cargar datos de ejemplo» para probar).
4. Registra cada **salida** y su **retorno**; imprime la papeleta para las firmas.

> Los datos se guardan en el almacenamiento local de ese navegador. Descarga con frecuencia la
> **copia de seguridad** (Reportes) y restáurala para pasar la información a otro equipo.

## Qué controla

| Módulo | Contenido |
| --- | --- |
| Panel | Vehículos disponibles, en servicio, en mantenimiento e inoperativos; operatividad de la flota; vehículos fuera en este momento; alertas. |
| Vehículos | Placa, tipo, marca/modelo/año, serie (VIN), motor, combustible, unidad asignada, estado, kilometraje, SOAT, revisión técnica y ficha con historial. |
| Conductores | CIP, grado, DNI, unidad y licencia (número, categoría y vencimiento). |
| Salidas y retornos | Papeleta numerada: conductor, acompañantes, misión, destino, quién autoriza, km y combustible de salida y retorno, novedades. |
| Combustible | Vales (sin duplicados), galones, monto, grifo y rendimiento km/galón entre cargas. |
| Mantenimiento | Preventivo o correctivo, taller, orden de trabajo, costo; el preventivo reinicia el contador de km. |
| Reportes | Uso por vehículo en un periodo (salidas, km, horas, galones, km/gal, gastos), exportación CSV, impresión, parámetros y bitácora. |

## Reglas que aplica al registrar una salida

- El vehículo debe estar **operativo** y no tener otra salida sin retorno.
- **SOAT** registrado y vigente; **revisión técnica** vigente (si está registrada).
- El conductor debe estar activo, sin otro vehículo a su cargo y con **licencia vigente** de una
  **categoría que habilite** ese tipo de vehículo (por ejemplo, B-IIb o B-IIc para motocicletas).
- El kilometraje nunca puede retroceder, y el retorno no puede ser anterior a la salida.

Alertas: SOAT, revisión técnica y licencias vencidas o por vencer (30 días por defecto),
mantenimiento preventivo pasado o próximo (cada 5 000 km por defecto) y salidas sin retorno
de más de 12 horas. Los tres umbrales se cambian en **Reportes → Parámetros**.

## Estructura y pruebas

```
index.html        Interfaz
css/styles.css    Estilos (claro/oscuro e impresión de papeletas)
js/flota.js       Datos y reglas de negocio (sin DOM)
js/app.js         Pantallas, formularios, impresión y exportación
test/             Pruebas de las reglas: node --test test/
```
