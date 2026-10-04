// Explicit display approximation of retained STEP carriers and shared trims.
// No mesh is admitted to the exact modelling kernel.
import {createRequire} from 'node:module';
import { meshDefects } from '../print-mesh.mjs';
const TAU = 2 * Math.PI;
// Registry tooling can import carriers without installing display dependencies.
const requireMeshDependency=createRequire(import.meta.url);
let chartTriangulator;
function triangulateChart(points,holes) {
  try {chartTriangulator??=requireMeshDependency('earcut').default;}
  catch(error) {throw new ReferenceMeshError('import/mesh/triangulator-unavailable',{cause:error});}
  return chartTriangulator(points,holes);
}
export class ReferenceMeshError extends Error {
  constructor(reason,options) { super(reason,options); this.reason = reason; }
}
const refuse = reason => { throw new ReferenceMeshError(`import/mesh/${reason}`); };
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const add = (a,b) => a.map((v,i)=>v+b[i]);
const mul = (a,s) => a.map(v=>v*s);
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const norm = a => Math.hypot(...a);
const distance = (a,b) => norm(sub(a,b));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const local = (f,p) => f.columns.map(c=>dot(c,sub(p,f.origin)));
const global = (f,p) => add(f.origin,[0,1,2].map(i=>f.columns.reduce((s,c,j)=>s+c[i]*p[j],0)));
export function placeReferencePoint(source,p) { for(const [from,to] of source.placements)p=global(to,local(from,p));return p; }
function unplace(source,p) { for(const [from,to] of [...source.placements].reverse())p=global(from,local(to,p));return p; }
const edgeKey = (a,b) => a<b?`${a}/${b}`:`${b}/${a}`;
function basis(knots,degree,t) {
  const high=knots[knots.length-degree-1];
  let v=knots.slice(1).map((_,i)=>t>=knots[i]&&t<knots[i+1]?1:0);
  if(t===high) {v.fill(0);v[knots.length-degree-2]=1;}
  for(let d=1;d<=degree;d++)v=v.slice(1).map((_,i)=>{
    const l=knots[i+d]-knots[i],r=knots[i+d+1]-knots[i+1];
    return (l?(t-knots[i])*v[i]/l:0)+(r?(knots[i+d+1]-t)*v[i+1]/r:0);
  });
  return v;
}
export function carrierPoint(c,uv,scale=1) {
  const [u,v]=uv,[r,s]=c.parameters;
  if(c.kind==='spline') {
    const a=basis(c.knots[0],c.degrees[0],u),b=basis(c.knots[1],c.degrees[1],v),p=[0,0,0];let w=0;
    for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++) {
      const weight=a[i]*b[j]*c.weights[i][j];w+=weight;
      for(let k=0;k<3;k++)p[k]+=weight*c.points[i][j][k];
    }
    if(!(w>0))refuse('spline-weight-invalid');return mul(p,1/w);
  }
  let p;
  switch(c.kind) {
    case 'plane':p=[u*scale,v*scale,0];break;
    case 'cylinder':p=[r*Math.cos(u),r*Math.sin(u),v*scale];break;
    case 'cone': {const radius=r+v*scale*Math.sin(s);p=[radius*Math.cos(u),radius*Math.sin(u),v*scale*Math.cos(s)];break;}
    case 'sphere':p=[r*Math.cos(v)*Math.cos(u),r*Math.cos(v)*Math.sin(u),r*Math.sin(v)];break;
    case 'torus':p=[(r+s*Math.cos(v))*Math.cos(u),(r+s*Math.cos(v))*Math.sin(u),s*Math.sin(v)];break;
    default:refuse('carrier-unsupported');
  }
  return global(c.frame,p);
}
export function carrierParameters(c,p,scale=1) {
  if(c.kind==='spline') {
    const ranges=[[c.knots[0][c.degrees[0]],c.knots[0][c.points.length]],[c.knots[1][c.degrees[1]],c.knots[1][c.points[0].length]]];
    let best=null;const solutions=[];
    for(let i=0;i<=4;i++)for(let j=0;j<=4;j++) {
      let uv=ranges.map(([lo,hi],k)=>lo+(hi-lo)*(k?j:i)/4);
      for(let n=0;n<32;n++) {
        const q=carrierPoint(c,uv),d=sub(p,q),derivatives=uv.map((_,k)=>{
          const h=(ranges[k][1]-ranges[k][0])*1e-5,aa=[...uv],bb=[...uv];
          aa[k]=Math.max(ranges[k][0],uv[k]-h);bb[k]=Math.min(ranges[k][1],uv[k]+h);
          return mul(sub(carrierPoint(c,bb),carrierPoint(c,aa)),1/(bb[k]-aa[k]));
        });
        const [a,b]=derivatives,aa=dot(a,a),ab=dot(a,b),bb=dot(b,b),det=aa*bb-ab*ab;
        if(!(det>0))break;
        const delta=[(dot(a,d)*bb-dot(b,d)*ab)/det,(dot(b,d)*aa-dot(a,d)*ab)/det];
        uv=uv.map((t,k)=>Math.max(ranges[k][0],Math.min(ranges[k][1],t+delta[k])));
        if(norm(delta)<1e-12)break;
      }
      const error=distance(p,carrierPoint(c,uv));solutions.push({uv,error});if(!best||error<best.error)best={uv,error};
    }
    if(!best)refuse('spline-inversion-undecidable');
    const guard=128*Number.EPSILON*Math.max(1,norm(p));
    if(solutions.some(s=>s.error<=best.error+guard&&s.uv.some((v,k)=>Math.abs(v-best.uv[k])>1e-8*(ranges[k][1]-ranges[k][0]))))refuse('spline-inversion-ambiguous');
    return best.uv;
  }
  const [x,y,z]=local(c.frame,p),[r,s]=c.parameters,u=Math.atan2(y,x);
  switch(c.kind) {
    case 'plane':return [x/scale,y/scale];
    case 'cylinder':return [u,z/scale];
    case 'cone':return [u,z/(scale*Math.cos(s))];
    case 'sphere':return [u,Math.atan2(z,Math.hypot(x,y))];
    case 'torus':return [u,Math.atan2(z,Math.hypot(x,y)-r)];
    default:refuse('carrier-unsupported');
  }
}
// Rational tensor-product derivative hulls, followed by the quotient rule.
// Positive weights bound the denominator. A non-C1 internal knot refuses.
function splineHessian(c) {
  for(let k=0;k<2;k++) {
    const knots=c.knots[k],degree=c.degrees[k],lo=knots[degree],hi=knots[knots.length-degree-1];
    for(const t of new Set(knots))if(t>lo&&t<hi&&knots.filter(x=>x===t).length>=degree)refuse('spline-non-C1-knot');
  }
  const origin=c.points[0][0],net=c.points.map((row,i)=>row.map((p,j)=>[...mul(sub(p,origin),c.weights[i][j]),c.weights[i][j]]));
  function derivative(net,degree,knots,k) {
    if(degree===0)return net.map(row=>row.map(()=>[0,0,0,0]));
    if(k===1)return net.map(row=>row.slice(1).map((p,j)=>mul(sub(p,row[j]),degree/(knots[j+degree+1]-knots[j+1])||0)));
    return net.slice(1).map((row,i)=>row.map((p,j)=>mul(sub(p,net[i][j]),degree/(knots[i+degree+1]-knots[i+1])||0)));
  }
  const magnitude=net=>[Math.max(...net.flat().map(p=>norm(p.slice(0,3)))),Math.max(...net.flat().map(p=>Math.abs(p[3])))];
  const [du,dv]=[0,1].map(k=>derivative(net,c.degrees[k],c.knots[k],k));
  const [uu,uv,vv]=[derivative(du,c.degrees[0]-1,c.knots[0].slice(1,-1),0),derivative(du,c.degrees[1],c.knots[1],1),derivative(dv,c.degrees[1]-1,c.knots[1].slice(1,-1),1)].map(magnitude);
  const [au,wu]=magnitude(du),[av,wv]=magnitude(dv),w=Math.min(...c.weights.flat()),f=Math.max(...c.points.flat().map(p=>distance(p,origin))),fu=(au+f*wu)/w,fv=(av+f*wv)/w;
  c.metric=[fu,fv];
  return [(uu[0]+f*uu[1]+2*fu*wu)/w,(uv[0]+f*uv[1]+fu*wv+fv*wu)/w,(vv[0]+f*vv[1]+2*fv*wv)/w].map(x=>x*(1+1e-12));
}
function errorBound(c,uvs,scale) {
  const du=Math.max(...uvs.map(p=>p[0]))-Math.min(...uvs.map(p=>p[0])),dv=Math.max(...uvs.map(p=>p[1]))-Math.min(...uvs.map(p=>p[1])),[r,s]=c.parameters;
  let h;
  switch(c.kind) {
    case 'plane':return 0;
    case 'cylinder':h=[r,0,0];break;
    case 'cone':h=[Math.max(...uvs.map(p=>Math.abs(r+p[1]*scale*Math.sin(s)))),scale*Math.abs(Math.sin(s)),0];break;
    case 'sphere':h=[r,r,r];break;
    case 'torus':h=[r+s,s,s];break;
    case 'spline':h=c.hessian??=splineHessian(c);break;
    default:refuse('carrier-unsupported');
  }
  const bound=(h[0]*du*du+2*h[1]*du*dv+h[2]*dv*dv)/2*(1+1e-12);
  if(!Number.isFinite(bound)||bound<0)refuse('interpolation-bound-unavailable');
  return bound;
}
// The error bound may be a seminorm (a cylinder has zero axial curvature).
// A positive chart metric keeps longest-edge refinement shape regular.
function chartMetric(c,uvs,scale) {
  const [r,s]=c.parameters;let metric;
  switch(c.kind) {
    case 'plane':metric=[scale,scale];break;
    case 'cylinder':metric=[r,scale];break;
    case 'cone':metric=[Math.max(...uvs.map(p=>Math.abs(r+p[1]*scale*Math.sin(s)))),scale];break;
    case 'sphere':metric=[r,r];break;
    case 'torus':metric=[r+s,s];break;
    case 'spline':c.hessian??=splineHessian(c);metric=c.metric;break;
    default:refuse('carrier-unsupported');
  }
  return metric;
}
function edgeMetric(c,uvs,scale) {
  const metric=chartMetric(c,uvs,scale);
  return Math.hypot(...uvs[0].map((v,k)=>(v-uvs[1][k])*metric[k]));
}
function unwrap(points,periodic) {
  for(let i=1;i<points.length;i++)for(const k of periodic)points[i].uv[k]+=TAU*Math.round((points[i-1].uv[k]-points[i].uv[k])/TAU);
  return points;
}
// Exact dyadic orientation of the displayed binary64 chart coordinates.
function dyadic(v) {
  const b=new DataView(new ArrayBuffer(8));b.setFloat64(0,v);const bits=b.getBigUint64(0),e=Number(bits>>52n&2047n);
  if(e===2047)refuse('nonfinite-coordinate');
  return [(bits>>63n?-1n:1n)*((e?1n<<52n:0n)+(bits&((1n<<52n)-1n))),e?e-1075:-1074];
}
function orient(a,b,c) {
  const left=(a[0]-c[0])*(b[1]-c[1]),right=(a[1]-c[1])*(b[0]-c[0]),det=left-right;
  const error=3.3306690738754716e-16*(Math.abs(left)+Math.abs(right));
  if(Number.isFinite(det)&&Math.abs(det)>error)return det>0?1:-1;
  const ds=[...a,...b,...c].map(dyadic),exponent=Math.min(...ds.map(x=>x[1])),v=ds.map(([n,e])=>n<<BigInt(e-exponent));
  const exact=(v[2]-v[0])*(v[5]-v[1])-(v[3]-v[1])*(v[4]-v[0]);return exact>0n?1:exact<0n?-1:0;
}
function polygonSign(loop) {
  const ds=loop.flat().map(dyadic),exponent=Math.min(...ds.map(x=>x[1])),v=ds.map(([n,e])=>n<<BigInt(e-exponent));let area=0n;
  for(let i=0;i<loop.length;i++){const j=(i+1)%loop.length;area+=v[2*i]*v[2*j+1]-v[2*j]*v[2*i+1];}
  return area>0n?1:area<0n?-1:0;
}
function inside(p,loop) {
  let winding=0;
  for(let i=0;i<loop.length;i++) {
    const a=loop[i],b=loop[(i+1)%loop.length],o=orient(a,b,p);
    if(o===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]))return true;
    if(a[1]<=p[1]&&b[1]>p[1]&&o>0)winding++;
    if(a[1]>p[1]&&b[1]<=p[1]&&o<0)winding--;
  }
  return winding!==0;
}
function inDomain(uv,loops,periodic=[]) {
  const candidates=[uv];
  for(const k of periodic)for(const p of [...candidates])for(const shift of [-TAU,TAU]){const q=[...p];q[k]+=shift;candidates.push(q);}
  return candidates.some(p=>inside(p,loops[0])&&!loops.slice(1).some(loop=>inside(p,loop)));
}

function trimLoops(source, points, edgeIds, carrier, face, append) {
  const periodic=carrier.kind==='torus'?[0,1]:['plane','spline'].includes(carrier.kind)?[]:[0];
  let periodicRings = null, spherePole = null;
    let loops=face.loops.map(loop=>{
      const nodes=[];
      for(const [eid,forward] of loop.uses) {
        let ids=edgeIds.get(eid);if(!forward)ids=[...ids].reverse();
        for(const id of ids.slice(0,-1))nodes.push({id,uv:carrierParameters(carrier,points[id],source.unitToMm)});
      }
      return unwrap(nodes,periodic);
    });
    // Full-period annuli are cut once in the quotient chart. Duplicated cut
    // endpoints retain the same source IDs, so the cut is not a mesh boundary.
    if(periodic.length&&loops.length===2&&loops.every(l=>l.length>2&&Math.abs(l.at(-1).uv[0]-l[0].uv[0])>Math.PI)) {
      const rings=loops.map(l=>{if(l.at(-1).uv[0]<l[0].uv[0])l=[...l].reverse();return [...l,{id:l[0].id,uv:[l[0].uv[0]+TAU,l[0].uv[1]]}];});
      const shift=TAU*Math.round((rings[0][0].uv[0]-rings[1][0].uv[0])/TAU);for(const p of rings[1])p.uv[0]+=shift;
      periodicRings = rings;
      loops=[[...rings[0],...[...rings[1]].reverse()]];
    } else if(carrier.kind==='sphere'&&loops.length===1&&loops[0].length>2&&Math.abs(loops[0].at(-1).uv[0]-loops[0][0].uv[0])>Math.PI) {
      let ring=loops[0];if(ring.at(-1).uv[0]<ring[0].uv[0])ring=[...ring].reverse();
      const v=ring.reduce((s,p)=>s+p.uv[1],0)/ring.length;
      // Source winding and face sense select the polar cap.
      const original=loops[0],positive=original.at(-1).uv[0]>original[0].uv[0],pole=(positive===face.sameSense?1:-1)*Math.PI/2;
      const id=append(carrierPoint(carrier,[ring[0].uv[0],pole],source.unitToMm));
      spherePole = {ring: [...ring,{id:ring[0].id,uv:[ring[0].uv[0]+TAU,v]}], pole, id};
      loops=[[...ring,{id:ring[0].id,uv:[ring[0].uv[0]+TAU,v]},{id,uv:[ring[0].uv[0]+TAU,pole]},{id,uv:[ring[0].uv[0],pole]}]];
    } else if(loops.length>1) {
      // Explicit STEP outer bounds take precedence. Otherwise use oriented
      // dyadic chart winding, never a rounded area ranking.
      const explicit=face.loops.map((l,i)=>l.outer?i:-1).filter(i=>i>=0);
      const exterior=explicit.length?explicit:loops.map((l,i)=>((polygonSign(l.map(n=>n.uv))>0)===face.sameSense)?i:-1).filter(i=>i>=0);
      if(exterior.length!==1)refuse('trim-exterior-undecidable');
      const outer=loops.splice(exterior[0],1)[0];loops.unshift(outer);
    }
  return {loops,periodicRings,spherePole};
}

export function tessellateReference(source,deviationMm,legalize) {
  if(!(deviationMm>32*source.uncertaintyMm)&&Number.isFinite(deviationMm))refuse('budget-below-source-uncertainty');
  if(!Number.isFinite(deviationMm)||deviationMm<=0)refuse('budget-invalid');
  const points=[],vertexIds=new Map(),edgeIds=new Map(),carriers=new Map(source.carriers.map(c=>[c.id,c]));
  const append=p=>{points.push(p);return points.length-1;};
  for(const [id,p] of source.vertices)vertexIds.set(id,append(p));
  for(const edge of source.edges) {
    const incident=source.faces.filter(f=>f.loops.some(l=>l.uses.some(([id])=>id===edge.id))).map(f=>carriers.get(f.surface));
    const samples=[];
    for(let k=0;k<edge.points.length-1;k++) {
      const a=edge.points[k],b=edge.points[k+1];let divisions=1;
      for(const c of incident) {
        const uv=[carrierParameters(c,a,source.unitToMm),carrierParameters(c,b,source.unitToMm)];
        for(const axis of c.kind==='torus'?[0,1]:['plane','spline'].includes(c.kind)?[]:[0])uv[1][axis]+=TAU*Math.round((uv[0][axis]-uv[1][axis])/TAU);
        divisions=Math.max(divisions,Math.ceil(Math.sqrt(errorBound(c,uv,source.unitToMm)/(deviationMm/16))));
      }
      if(divisions>4096)refuse('shared-boundary-refinement-budget');
      for(let j=0;j<divisions;j++)samples.push(j===0?a:add(a,mul(sub(b,a),j/divisions)));
    }
    samples.push(edge.points.at(-1));
    const ids=samples.map((p,i)=>i===0?vertexIds.get(edge.vertices[0]):i===samples.length-1?vertexIds.get(edge.vertices[1]):append(p));
    edgeIds.set(edge.id,ids);
  }
  const triangles=[],owners=[],triangleUvs=[],domains=[];let boundMaximum=0;
  for(const face of source.faces) {
    const carrier=carriers.get(face.surface),periodic=carrier.kind==='torus'?[0,1]:['plane','spline'].includes(carrier.kind)?[]:[0];
    const {loops,periodicRings,spherePole} = trimLoops(source,points,edgeIds,carrier,face,append);
    if(loops.some(l=>l.length<3))refuse(`face-${face.id}-trim-degenerate`);
    const nodes=loops.flat(),holes=[];let count=loops[0].length;for(const l of loops.slice(1)){holes.push(count);count+=l.length;}
    let ts=[];
    const register = n => { let i=nodes.indexOf(n); if(i<0){i=nodes.length;nodes.push(n);}return i; };
    function zipper(a,b) {
      let i=0,j=0;
      while(i<a.length-1||j<b.length-1) {
        if(j===b.length-1||(i<a.length-1&&a[i+1].uv[0]<b[j+1].uv[0])) {ts.push([register(a[i]),register(a[i+1]),register(b[j])]);i++;}
        else {ts.push([register(a[i]),register(b[j+1]),register(b[j])]);j++;}
      }
    }
    if(periodicRings || spherePole) {
      const a=periodicRings?.[0]??spherePole.ring, v0=a.reduce((s,p)=>s+p.uv[1],0)/a.length;
      const b=periodicRings?.[1],v1=b?b.reduce((s,p)=>s+p.uv[1],0)/b.length:spherePole.pole;
      const maxRadius=Math.max(...carrier.parameters.map(Math.abs),1);
      const steps=carrier.kind==='cylinder'?1:Math.max(1,Math.ceil(Math.abs(v1-v0)/Math.sqrt(deviationMm/(16*maxRadius))));
      if(steps>4096)refuse('periodic-grid-budget');
      let previous=a;
      for(let row=1;row<=steps;row++) {
        if(row===steps&&spherePole) {
          for(let i=0;i<previous.length-1;i++) {
            const pole={id:spherePole.id,uv:[(previous[i].uv[0]+previous[i+1].uv[0])/2,v1]};
            ts.push([register(previous[i]),register(previous[i+1]),register(pole)]);
          }
        }else {
          const v=v0+(v1-v0)*row/steps;
          const next=row===steps?b:a.map((p,i)=>({uv:[p.uv[0],v],id:i===a.length-1?-1:append(carrierPoint(carrier,[p.uv[0],v],source.unitToMm))}));
          if(row!==steps)next.at(-1).id=next[0].id;
          zipper(previous,next);previous=next;
        }
      }
    }else {
      const indices=triangulateChart(nodes.flatMap(p=>p.uv),holes);
      for(let i=0;i<indices.length;i+=3)ts.push(indices.slice(i,i+3));
    }
    if(!ts.length)refuse(`face-${face.id}-triangulation-empty`);
    // Earcut can remove collinear boundary samples. Reinsert every omitted
    // topological sample by splitting its containing boundary triangle.
    for(const loop of (spherePole?[]:loops)) {
      const ids=loop.map(n=>nodes.indexOf(n));
      const used=new Set(ts.flat());
      for(let i=0;i<ids.length;i++)if(!used.has(ids[i])) {
        let prev=i,next=i;while(!used.has(ids[prev]))prev=(prev+ids.length-1)%ids.length;while(!used.has(ids[next]))next=(next+1)%ids.length;
        const a=ids[prev],b=ids[next],run=[];for(let j=(prev+1)%ids.length;j!==next;j=(j+1)%ids.length)run.push(ids[j]);
        const at=ts.findIndex(t=>t.includes(a)&&t.includes(b));if(at<0)refuse('boundary-sample-lost');
        const t=ts[at],third=t.find(x=>x!==a&&x!==b),forward=t[(t.indexOf(a)+1)%3]===b,chain=[a,...run,b];
        const replacement=chain.slice(1).map((x,j)=>forward?[chain[j],x,third]:[x,chain[j],third]);ts.splice(at,1,...replacement);for(const id of run)used.add(id);
      }
    }
    const boundary=new Set();for(const loop of loops)for(let i=0;i<loop.length;i++)boundary.add(edgeKey(nodes.indexOf(loop[i]),nodes.indexOf(loop[(i+1)%loop.length])));
    if(legalize&&!periodicRings&&!spherePole)ts=legalize(nodes.map(n=>n.uv),ts,[...boundary].map(key=>key.split('/').map(Number)),chartMetric(carrier,nodes.map(n=>n.uv),source.unitToMm));
    // Bisect interior edges conformingly. Taylor's Hessian bound controls the
    // entire triangle, rather than just a centre or sampled chord.
    const active=new Map(),adjacent=new Map(),pending=[];let serial=0,iterations=0;
    function addTriangle(t) {
      const id=serial++;active.set(id,t);
      for(let j=0;j<3;j++){const key=edgeKey(t[j],t[(j+1)%3]);const uses=adjacent.get(key)??new Set();uses.add(id);adjacent.set(key,uses);}
      if(errorBound(carrier,t.map(i=>nodes[i].uv),source.unitToMm)>deviationMm/2)pending.push(id);
    }
    function removeTriangle(id,t) {
      active.delete(id);
      for(let j=0;j<3;j++){const key=edgeKey(t[j],t[(j+1)%3]),uses=adjacent.get(key);uses.delete(id);if(!uses.size)adjacent.delete(key);}
    }
    for(const t of ts)addTriangle(t);
    for(let cursor=0;cursor<pending.length;cursor++) {
      const t=active.get(pending[cursor]);if(!t)continue;
      if(++iterations>200000)refuse(`face-${face.id}-refinement-budget`);
      const candidates=t.map((a,j)=>[a,t[(j+1)%3]]).filter(([a,b])=>!boundary.has(edgeKey(a,b)));
      if(!candidates.length)refuse(`face-${face.id}-boundary-resolution`);
      candidates.sort((a,b)=>edgeMetric(carrier,b.map(i=>nodes[i].uv),source.unitToMm)-edgeMetric(carrier,a.map(i=>nodes[i].uv),source.unitToMm));
      const [a,b]=candidates[0],uv=mul(add(nodes[a].uv,nodes[b].uv),.5),id=append(carrierPoint(carrier,uv,source.unitToMm)),mid=nodes.length;nodes.push({id,uv});
      for(const tid of [...adjacent.get(edgeKey(a,b))]) {
        const tri=active.get(tid);removeTriangle(tid,tri);
        const j=tri.findIndex((x,k)=>(x===a&&tri[(k+1)%3]===b)||(x===b&&tri[(k+1)%3]===a)),x=tri[j],y=tri[(j+1)%3],z=tri[(j+2)%3];
        addTriangle([x,mid,z]);addTriangle([mid,y,z]);
      }
    }
    ts=[...active.values()];
    const domain=loops.map(l=>l.map(n=>n.uv));domains.push({face:face.id,surface:face.surface,loops:domain});
    for(let t of ts) {
      const uv=t.map(i=>nodes[i].uv),sign=orient(...uv);if(sign===0)refuse(`face-${face.id}-zero-chart-triangle`);
      const centre=mul(uv.reduce(add,[0,0]),1/3);if(!inDomain(centre,domain,periodic))refuse(`face-${face.id}-outside-trim`);
      if((sign>0)!==face.sameSense)t=[t[0],t[2],t[1]];
      const ids=t.map(i=>nodes[i].id);
      // Polar quotient cuts can have a collapsed edge. It is a singular point,
      // not a finite-area triangle or an omitted source face.
      if(new Set(ids).size<3)continue;
      triangles.push(ids);owners.push(face.id);triangleUvs.push(t.map(i=>nodes[i].uv));boundMaximum=Math.max(boundMaximum,errorBound(carrier,uv,source.unitToMm));
    }
  }
  const world=points.map(p=>placeReferencePoint(source,p));
  let magnitude=1;
  for(const p of [...points,...world,...source.placements.flatMap(pair=>pair.map(f=>f.origin))])for(const v of p) {
    if(!Number.isFinite(v))refuse('nonfinite-coordinate');magnitude=Math.max(magnitude,Math.abs(v));
  }
  const maximumArithmeticErrorBoundMm=128*Number.EPSILON*magnitude*(1+source.placements.length);
  if(maximumArithmeticErrorBoundMm>deviationMm/32)refuse('placement-arithmetic-budget');
  const mesh={vertices:world.flat(),triangles:triangles.flat(),faces:owners,edges:source.edges.map(e=>({sourceEdge:e.id,vertices:edgeIds.get(e.id),closed:e.closed})),
    exact:false,approximation:'tessellated mesh',deviationMm,uncertainty:{status:'producer-declared',mm:source.uncertaintyMm},
    triangleUvs,domains,maximumArithmeticErrorBoundMm,maximumInterpolationBoundMm:boundMaximum};
  const validation=validateReferenceMesh(source,mesh,deviationMm);mesh.validation=validation;return mesh;
}

export function validateReferenceMesh(source,mesh,deviationMm=mesh.deviationMm) {
  const carriers=new Map(source.carriers.map(c=>[c.id,c])),faces=new Map(source.faces.map(f=>[f.id,f]));
  // Reconstruct trims from the retained source, never from mesh-supplied domains.
  const sourcePoints=[],sourceEdges=new Map();
  for(const edge of source.edges)sourceEdges.set(edge.id,edge.points.map(p=>{sourcePoints.push(p);return sourcePoints.length-1;}));
  const domains=new Map(source.faces.map(face=>[face.id,trimLoops(source,sourcePoints,sourceEdges,carriers.get(face.surface),face,()=>-1).loops.map(l=>l.map(n=>n.uv))]));
  const edges=new Map(),seen=new Set();let maximumVertexDeviationMm=0,maximumSampledDeviationMm=0;
  const point=i=>mesh.vertices.slice(3*i,3*i+3);
  for(let i=0;i<mesh.faces.length;i++) {
    const face=faces.get(mesh.faces[i]);if(!face)refuse('unknown-face');seen.add(face.id);
    const c=carriers.get(face.surface),ids=mesh.triangles.slice(3*i,3*i+3),uvs=mesh.triangleUvs[i],ps=ids.map(j=>unplace(source,point(j)));
    if(ids.length!==3||!uvs||new Set(ids).size!==3)refuse('malformed-triangle');
    for(let j=0;j<3;j++) {
      const error=distance(ps[j],carrierPoint(c,uvs[j],source.unitToMm));maximumVertexDeviationMm=Math.max(maximumVertexDeviationMm,error);
      if(error>deviationMm)refuse(`vertex-off-carrier:${face.id}`);
      const a=ids[j],b=ids[(j+1)%3],key=edgeKey(a,b);const use=edges.get(key)??[];use.push(a<b?1:-1);edges.set(key,use);
    }
    const centre=mul(uvs.reduce(add,[0,0]),1/3);if(!inDomain(centre,domains.get(face.id),c.kind==='torus'?[0,1]:['plane','spline'].includes(c.kind)?[]:[0]))refuse(`outside-trim:${face.id}`);
    for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]) {
      const uv=uvs.reduce((p,q,j)=>add(p,mul(q,weights[j])),[0,0]),p=ps.reduce((p,q,j)=>add(p,mul(q,weights[j])),[0,0,0]);
      const error=distance(p,carrierPoint(c,uv,source.unitToMm));maximumSampledDeviationMm=Math.max(maximumSampledDeviationMm,error);
      if(error>deviationMm)refuse(`triangle-off-carrier:${face.id}`);
    }
  }
  for(const uses of edges.values())if(uses.length!==2||uses[0]+uses[1]!==0)refuse('not-watertight');
  if(seen.size!==source.faces.length)refuse('dropped-face');
  return {watertight:true,faces:seen.size,triangles:mesh.faces.length,maximumVertexDeviationMm,maximumSampledDeviationMm};
}
export function referenceStl(meshes,deviationMm) {
  const count=meshes.reduce((s,m)=>s+m.triangles.length/3,0),out=Buffer.alloc(84+50*count);out.write('Wonky imported reference; tessellated mesh; exact:false');out.writeUInt32LE(count,80);let offset=84;
  for (const mesh of meshes) {
    const rounded=Array.from({length:mesh.triangles.length/3},(_,i)=>mesh.triangles.slice(3*i,3*i+3).map(id=>mesh.vertices.slice(3*id,3*id+3).map(Math.fround)));
    let maximumStlRoundingMm=0;
    for(let t=0;t<rounded.length;t++)for(let j=0;j<3;j++)maximumStlRoundingMm=Math.max(maximumStlRoundingMm,distance(rounded[t][j],mesh.vertices.slice(3*mesh.triangles[3*t+j],3*mesh.triangles[3*t+j]+3)));
    if(maximumStlRoundingMm>deviationMm/32)refuse('stl-quantization-budget');
    if(rounded.some(ps=>norm(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])))===0))refuse('stl-degenerate-after-quantization');
    const defects=meshDefects(rounded);if(!defects.watertight)refuse('stl-not-watertight-after-quantization');
    mesh.validation.stlDefects=defects;
    mesh.validation.maximumStlRoundingMm=maximumStlRoundingMm;
  }
  for(const mesh of meshes)for(let i=0;i<mesh.triangles.length;i+=3) {
    const ps=mesh.triangles.slice(i,i+3).map(id=>mesh.vertices.slice(3*id,3*id+3)),n=cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),length=norm(n);
    if(!(length>0))refuse('degenerate-stl-triangle');
    const values=[...mul(n,1/length),...ps.flat()];
    for(let j=0;j<values.length;j++){const v=values[j];if(j>=3&&Math.abs(Math.fround(v)-v)>deviationMm/32)refuse('stl-quantization-budget');out.writeFloatLE(v,offset+4*j);}
    offset+=50;
  }
  return out;
}

export function exactCarrierPointRows(source,mesh) {
  const faces=new Map(source.faces.map(f=>[f.id,f])),seen=new Set(),rows=[];
  for(let t=0;t<mesh.faces.length;t++)for(let j=0;j<3;j++) {
    const id=mesh.triangles[3*t+j],surface=faces.get(mesh.faces[t]).surface,key=`${surface}/${id}`;
    if(seen.has(key))continue;seen.add(key);
    const uv=mesh.triangleUvs[t][j],point=unplace(source,mesh.vertices.slice(3*id,3*id+3));
    rows.push([source.id,surface,...uv,...point].join(' '));
  }
  return rows.join('\n');
}
