// Independent diagnostic oracle: source text, elementary plane/circle/cone
// equations in binary64, no production carrier/provenance helpers imported.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a.reduce((v,x,i)=>v+x*b[i],0);
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const mm = value => value?.items?.map(q=>q.value*1000);
const close = (a,b,why,tol=2e-9) => assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<tol,`${why}: ${a} != ${b}`);

export function checkCarrierSource(carrier, directory) {
  assert.ok(carrier.parameters && carrier.provenance.length, 'carrier parameters and origins are required');
  const surface = carrier.parameters;
  for (const origin of carrier.provenance) {
    assert.equal(origin.missing, undefined, origin.missing);
    assert.equal(dirname(origin.file), resolve(directory), 'source must be the frozen source, not a live CAD project');
    const text = readFileSync(origin.file,'utf8'), lines = text.split('\n');
    assert.ok(Number.isInteger(origin.line) && origin.line>0);
    const line = lines[origin.line-1];
    assert.ok(line?.includes(origin.sketchOperation ?? origin.operationName), `wrong source call at ${origin.file}:${origin.line}`);
    if (origin.featureLine) assert.ok(lines[origin.featureLine-1].includes(origin.featureName), 'feature declaration must actually name the feature');
    const entity = origin.sketchEntityId, geometry = origin.entityGeometry, frame = origin.sketchPlane;
    let points = geometry?.start ? [geometry.start, geometry.mid, geometry.end].filter(Boolean)
      : geometry?.startMm ? [geometry.startMm,geometry.endMm]
        : geometry?.start?.items ? [mm(geometry.start),mm(geometry.end)] : [];
    // Named M3 arc indices are evaluated against the frozen literal table,
    // not against another copy of the diagnostic's own geometry.
    if (/^a\d+$/.test(entity ?? '')) {
      assert.match(line,/skArc\([^,]+,\s*"a"\s*~\s*i/);
      const match = text.match(/const M3_HYBRID_ARCS\s*=\s*(\[[\s\S]*?\n\]);/);
      assert.ok(match,'frozen M3 arc table is required');
      const expected = JSON.parse(match[1])[Number(entity.slice(1))];
      assert.ok(expected, 'named entity index must exist');
      expected.forEach((p,i)=>p.forEach((v,k)=>close(points[i][k],v,'source arc coordinates',1e-12)));
    } else if (entity) {
      const literal = line.includes(JSON.stringify(entity));
      const dynamic = /^s\d+$/.test(entity) && /"s"\s*~\s*i/.test(line);
      assert.ok(literal||dynamic,`named sketch entity ${entity} is absent from source call`);
    }
    if (geometry?.start?.items) points=[mm(geometry.start),mm(geometry.end)];
    if (origin.sketchOperation==='skCircle') {
      close(surface.radius,geometry.radius.value*1000,'circle radius');
      const center=mm(geometry.center);points=[center];
    }
    if (!frame || !points.length) {
      // Extrusion caps must at least have the source sweep's normal. Other
      // non-entity faces have only a feature-level provenance contract.
      if(surface.type==='plane'&&origin.operationName==='opExtrude'&&frame&&!origin.transforms?.length)
        close(Math.abs(dot(surface.normal,frame.normal)),1,'extrusion cap normal');
      continue;
    }
    const y=cross(frame.normal,frame.x);
    for(const p of points) {
      let world=frame.origin.map((o,k)=>o+p[0]*frame.x[k]+p[1]*y[k]);
      for(const transform of origin.transforms??[]) world=transform.rows.map((row,k)=>dot(row,world)+transform.offsetMm[k]);
      const v=sub(world,surface.origin);
      if(surface.type==='plane') close(dot(v,surface.normal),0,'line point on plane');
      else if(surface.type==='cylinder'||surface.type==='cone') {
        const h=dot(v,surface.axis),radius=Math.hypot(...v.map((x,k)=>x-h*surface.axis[k]));
        const expected=surface.type==='cone'?surface.radius+h*Math.tan(surface.angle):surface.radius;
        close(radius,origin.sketchOperation==='skCircle'?0:expected,'sketch point on carrier');
        if(origin.sketchOperation==='skCircle')close(Math.abs(dot(surface.axis,frame.normal)),1,'circle extrusion axis');
      }
    }
  }
}
