// View-bound annotation geometry: normalized points -> canvas pixels
// (harness: annotationPoint) and the SVG markup of drawings.
// Owner of annotationPoint: camera-navigation (W1).
//
// Legacy drawings (saved on the mirrored convention-1 view, spec D6) are
// mirrored in X within their pane, which puts them back over the geometry
// they were drawn on. Legacy wipe drawings over two different models cannot
// be re-projected and are not drawn; the view feature shows the note
// (render/panes.js: legacyDrawing, LEGACY_WIPE_NOTE).
import { legacyDrawing, mirrorLegacyPoint } from '../../render/panes.js';

export function createAnnotationGeometry({ canvas }) {
  // Rescales a normalized point saved at another viewport aspect, per pane in
  // side by side.
  function annotationPoint(point, annotation) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const aspect = annotation.view?.aspect ?? width / height;
    const paired = annotation.view?.compare && annotation.view?.layout === 'side-by-side';
    const [x, y] = legacyDrawing(annotation) === 'mirrored'
      ? mirrorLegacyPoint(point, annotation) : point;
    const centerX = paired ? (x < 0.5 ? 0.25 : 0.75) : 0.5;
    const savedMin = Math.min(aspect / (paired ? 2 : 1), 1);
    const currentMin = Math.min(width / (paired ? 2 : 1), height);
    return [(x - centerX) * aspect / savedMin * currentMin + width * centerX,
      (y - 0.5) / savedMin * currentMin + height / 2];
  }

  function drawingMarkup(annotation, index, draft = false) {
    if (legacyDrawing(annotation) === 'hidden') return '';
    const points = annotation.points.map(point => annotationPoint(point, annotation));
    if (!points.length) return '';
    const color = draft ? '#c69a75' : '#b5774e';
    const line = `stroke="${color}" stroke-width="2"`;
    const joins = 'stroke-linecap="round" stroke-linejoin="round"';
    const stroke = `${line} fill="none" ${joins}`;
    let content = '';
    if (annotation.tool === 'arrow' && points.length === 2) {
      content = `<line x1="${points[0][0]}" y1="${points[0][1]}" x2="${points[1][0]}"`
        + ` y2="${points[1][1]}" ${stroke} marker-end="url(#arrowhead)"/>`;
    }
    if (annotation.tool === 'box' && points.length === 2) {
      const [[x0, y0], [x1, y1]] = points;
      content = `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}"`
        + ` width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" rx="2" ${line}`
        + ` fill="#b5774e07" ${joins}/>`;
    }
    if (annotation.tool === 'pen') {
      content = `<polyline points="${points.map(point => point.join(',')).join(' ')}" ${stroke}/>`;
    }
    if (!draft) {
      const [x, y] = points[0];
      content += `<circle cx="${x}" cy="${y}" r="11" fill="#fffaf3" stroke="${color}"`
        + ` stroke-width="1.5"/><text x="${x}" y="${y + 3.5}" fill="${color}" text-anchor="middle"`
        + ' font-family="system-ui,sans-serif" font-size="10" font-weight="600">'
        + `${index + 1}</text>`;
    }
    return content;
  }

  return { annotationPoint, drawingMarkup };
}

export const ARROWHEAD = '<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5"'
  + ' markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="m1 1 7 4-7 4"'
  + ' fill="none" stroke="#b5774e" stroke-width="1.6" stroke-linecap="round"'
  + ' stroke-linejoin="round"/></marker></defs>';
