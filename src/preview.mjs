import { triangulate } from './brep.mjs';
import { unsupported } from './errors.mjs';
import { isMeshBody, refuseMeshBody } from './hybrid-mesh.mjs';
import { readFileSync } from 'node:fs';
import { isRustBody, measureRustBody, rustMesh, rustModelKernel, isRustReferenceBody, referenceBodyReport } from './native/rust-host.mjs';
import { basis, normalMatrix, PRESETS } from '../viewer/render/camera.js';

// Embed the live viewer's pure rotation functions, not a second yaw/pitch
// implementation. The standalone file needs no imports, server or CDN.
const cameraSource = `const previewCamera = (() => {
${basis.toString()}
${normalMatrix.toString()}
return { normalMatrix, iso: ${JSON.stringify(PRESETS.iso)} };
})();`;

// Chordal deviation (mm) stated for the display mesh of a Rust body.
export const RUST_HTML_DEVIATION_MM = 0.02;

// Display geometry of a Rust model from the Rust mesh path (wonky-mesh/1):
// mesh vertices, sampled edge polylines as index pairs, one normal per triangle.
// The page states the deviation; volume comes from the kernel measurement, not
// from these triangles. A body the mesh path refuses raises its named refusal.
function rustGeometry(model) {
  const kernel = rustModelKernel(model);
  const mesh = rustMesh(kernel, model.bodies, RUST_HTML_DEVIATION_MM);
  const geometry = mesh.bodies.map(body => {
    const vertices = [];
    for (let i = 0; i < body.vertices.length; i += 3) vertices.push([body.vertices[i], body.vertices[i + 1], body.vertices[i + 2]]);
    const triangles = [];
    for (let t = 0; t < body.triangles.length; t += 3) {
      const ids = [body.triangles[t], body.triangles[t + 1], body.triangles[t + 2]];
      const [a, b, c] = ids.map(i => vertices[i]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...n);
      if (length > 0) triangles.push({ vertices: ids, normal: n.map(x => x / length) });
    }
    const edges = body.edges.flatMap(sample => {
      const ids = [...sample.vertices];
      if (sample.closed && ids.length) ids.push(ids[0]);
      return ids.slice(1).map((id, k) => [ids[k], id]);
    });
    return { vertices, edges, triangles };
  });
  const faces = model.bodies.reduce((n, body) => n + measureRustBody(kernel, body).topology.faces, 0);
  const reference = model.bodies.some(isRustReferenceBody);
  const volume = reference ? null : model.bodies.reduce((n, body) => n + measureRustBody(kernel, body).volumeMm3, 0);
  return { geometry, faces, volume, note: reference ? `Imported reference · exact:false · tessellated mesh · deviation ${RUST_HTML_DEVIATION_MM} mm · producer uncertainty ${model.bodies.filter(isRustReferenceBody).map(b=>referenceBodyReport(b).uncertainty.mm + ' mm').join(', ')}; volume not evaluated` : `display mesh, chordal deviation at most ${RUST_HTML_DEVIATION_MM} mm; volume from the Rust kernel measurement` };
}

export function toHtml(model) {
  const rust = model.bodies.length > 0 && model.bodies.every(isRustBody) ? rustGeometry(model) : null;
  if (!rust && model.bodies.some(isRustBody)) throw new Error('HTML preview: a model mixes Rust WC0 bodies and legacy bodies');
  const geometry = rust ? rust.geometry : model.bodies.map(body => {
    // The same limit toStl states. Without this the polygon triangulator runs
    // on curved loops it cannot index and dies with a TypeError out of
    // brep.mjs, which reads as a crash rather than as the capability boundary
    // it actually is.
    if (body.geometry === 'analytic') unsupported('HTML preview of curved B-reps is not implemented; use --format print for a watertight mesh, or STEP');
    if (isMeshBody(body)) refuseMeshBody(body, 'HTML preview (it draws exact B-rep facets; --format print or r20-check write the certified mesh)');
    return {
      vertices: body.vertices,
      edges: body.edges.map(e => [e.start, e.end]),
      triangles: triangulate(body).map(t => ({ vertices: t.vertices, normal: body.faces[t.face].surface.normal })),
    };
  });
  // Only numeric geometry is embedded in script; source/IDs are never injected.
  const data = JSON.stringify(geometry);
  const faces = rust ? rust.faces : model.bodies.reduce((n, b) => n + b.faces.length, 0);
  const volume = rust ? rust.volume : model.bodies.reduce((n, b) => n + b.validation.volumeMm3, 0);
  const faceText = rust ? `faces · ${rust.note}` : 'planar faces';
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wonky Kernel · Model preview</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f2f1eb;color:#19322b;font:14px system-ui,sans-serif}
header{height:76px;padding:0 30px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #19322b20}
h1{font-size:19px;letter-spacing:-.5px;margin:0}h1 span{font-weight:400;color:#69766b;margin-left:12px}
main{height:calc(100dvh - 76px);position:relative;min-height:360px}canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}
canvas:active{cursor:grabbing}.stats{position:absolute;left:30px;top:25px;line-height:1.8;pointer-events:none}
.stats strong{font-size:24px;display:block;font-weight:500;letter-spacing:-.7px}.hint{position:absolute;bottom:25px;left:30px;color:#69766b}
button{border:1px solid #b8c3b9;border-radius:6px;background:transparent;color:inherit;padding:8px 13px;cursor:pointer}
button:hover{background:#e1e6dc}button:focus-visible{outline:2px solid #20785f;outline-offset:3px}
@media(max-width:600px){header{padding:0 18px}h1 span{display:none}.stats,.hint{left:18px}.hint{font-size:12px}}
</style>
<header><h1>Wonky Kernel<span>Model preview</span></h1><div><button id="edges" aria-pressed="true">Edges</button> <button id="fit">Reset view</button></div></header>
<main><canvas aria-label="Interactive 3D CAD model. Drag to orbit, scroll to zoom." tabindex="0"></canvas>
<div class="stats"><strong>${model.bodies.length} ${model.bodies.length === 1 ? 'solid' : 'solids'}</strong>${faces} ${faceText}<br>${volume === null ? 'Volume not evaluated' : volume.toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' mm³'}</div>
<div class="hint">Drag to orbit · Scroll to zoom · Arrows to rotate · Units: mm</div></main>
<script type="module">
const bodies=${data};
${cameraSource}
${readFileSync(new URL('./preview-client.js', import.meta.url), 'utf8')}
</script></html>`;
}
