import { triangulate } from './brep.mjs';
import { unsupported } from './errors.mjs';
import { isMeshBody, refuseMeshBody } from './hybrid-mesh.mjs';
import { readFileSync } from 'node:fs';

export function toHtml(model) {
  const geometry = model.bodies.map(body => {
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
  const faces = model.bodies.reduce((n, b) => n + b.faces.length, 0);
  const volume = model.bodies.reduce((n, b) => n + b.validation.volumeMm3, 0);
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
<div class="stats"><strong>${model.bodies.length} ${model.bodies.length === 1 ? 'solid' : 'solids'}</strong>${faces} planar faces<br>${volume.toLocaleString('en-US', { maximumFractionDigits: 3 })} mm³</div>
<div class="hint">Drag to orbit · Scroll to zoom · Arrows to rotate · Units: mm</div></main>
<script type="module">
const bodies=${data};
${readFileSync(new URL('./preview-client.js', import.meta.url), 'utf8')}
</script></html>`;
}
