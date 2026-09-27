import earcut, { deviation } from 'earcut';
import { loadKernel } from './kernel.mjs';
import { real, number, vector, coords } from './real.mjs';
import { triangulateFace } from './brep.mjs';
import { loadCylinderDisplay } from './display-cylinder.mjs';

const encode = geometry => Object.fromEntries(Object.entries(geometry).map(([key,value]) => [key==='type'?'$':key,
  key==='type'?value[0].toUpperCase()+value.slice(1):Array.isArray(value)?vector(value):real(value)]));
const near = (a,b,t=1e-8) => Math.hypot(...a.map((v,i)=>v-b[i]))<=t;
const triangles = (points,indices,normal) => Array.from({length:indices.length/3},(_,i)=>({points:indices.slice(i*3,i*3+3).map(j=>points[j]),normal}));

// A certified-mesh body (src/hybrid-mesh.mjs) is shown as its mesh: each face
// gets the triangles tagged with it and their winding normals. It has no B-rep
// edges or vertices, and its display error is the mesh's certified deviation,
// not the display tolerance.
function meshSceneBody(body, notes) {
  const {vertices, triangles: tagged, deviationMm} = body.mesh, source = body.identity?.operation?.source ?? body.debug?.source;
  notes.add(`${body.id} is a certified-mesh approximation within ${deviationMm} mm of its carriers; no exact B-rep edges`);
  const faces = body.faces.map((face, index) => ({index, surfaceType: face.surface.type, edgeIndices: [], triangles: [],
    displayTessellation: {source: 'certified-mesh', maxChordalErrorBoundMm: deviationMm},
    identity: body.identity?.topology?.faces?.[index], source}));
  for (const [a, b, c, face] of tagged) {
    const points = [vertices[a], vertices[b], vertices[c]];
    const u = [0, 1, 2].map(i => points[1][i] - points[0][i]), v = [0, 1, 2].map(i => points[2][i] - points[0][i]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]], length = Math.hypot(...n);
    if (length > 0) faces[face].triangles.push({points, normal: n.map(value => value/length)});
  }
  return {id: body.id, name: body.name ?? body.id, volumeMm3: body.validation?.volumeMm3 ?? null, identity: body.identity, source, debug: body.debug,
    vertices: [], edges: [], faces};
}

export async function reviewScene(model, metadata, {toleranceMm=0.02}={}) {
  if (!(toleranceMm>=0.001 && toleranceMm<=1)) throw new Error('Display tolerance must be between 0.001 and 1 mm');
  const kernel=await loadKernel(), {default:D}=await import('../kernel/display.bend');
  const cylinderDisplay=model.bodies.some(body=>body.geometry==='analytic'&&body.faces.some(face=>face.surface.type==='cylinder'))?await loadCylinderDisplay():null;
  const A=kernel.analytic, G=kernel.precise;
  const notes=new Set();
  const bodies=model.bodies.map(body=>{
    if(body.geometry==='mesh')return meshSceneBody(body,notes);
    const cylinder=body.geometry==='analytic'&&body.faces.some(face=>face.surface.type==='cylinder')?cylinderDisplay(body,kernel,D):null;
    const edges=body.edges.map((edge,index)=>{
      const type=typeof edge.curve==='string'?edge.curve:edge.curve.type;
      const identity=body.identity?.topology?.edges?.[index], source=body.identity?.operation?.source??body.debug?.source;
      if(type==='line')return {index,curveType:type,points:[body.vertices[edge.start],body.vertices[edge.end]],identity,source};
      if(!['circle','ellipse'].includes(type))throw new Error(`Unsupported display edge ${type}`);
      const curve=encode(edge.curve), radius=edge.curve.radius??Math.max(edge.curve.major,edge.curve.minor);
      let first,last;
      if(edge.curveRange)[first,last]=edge.curveRange;
      else if(edge.start===edge.end){first=number(A.curve_parameter(curve,vector(body.vertices[edge.start])));last=first+2*Math.PI;}
      else {
        first=number(A.curve_parameter(curve,vector(body.vertices[edge.sameSense===false?edge.end:edge.start])));
        last=number(A.curve_parameter(curve,vector(body.vertices[edge.sameSense===false?edge.start:edge.end])));
        while(last<=first)last+=2*Math.PI;
      }
      const maxAngle=2*Math.acos(Math.max(-1,1-toleranceMm/radius));
      const count=Math.max(4,Math.ceil((last-first)/Math.min(Math.PI/12,maxAngle)));
      if(count>8192)throw new Error('Display edge exceeds the supported tessellation budget');
      const points=Array.from({length:count+1},(_,i)=>coords(A.curve_point(curve,real(first+(last-first)*i/count))));
      if(edge.sameSense===false)points.reverse();
      return {index,curveType:type,points,identity,source};
    });
    const faces=body.faces.map((face,index)=>{
      const result={index,surfaceType:face.surface.type,edgeIndices:[...new Set(face.loops.flatMap(l=>l.map(u=>u.edge)))],triangles:[],identity:body.identity?.topology?.faces?.[index],source:body.identity?.operation?.source??body.debug?.source};
      try {
        if(body.geometry!=='analytic') {
          result.triangles=triangulateFace(body,face).map(ids=>({points:ids.map(i=>body.vertices[i]),normal:face.surface.normal}));
        } else if(face.surface.type==='plane') {
          const s=face.surface, origin=vector(s.origin), x=vector(s.x), y=G.cross(vector(s.normal),x);
          const rings=face.loops.map(loop=>{
            const ring=[];
            for(const use of loop){const points=use.forward?edges[use.edge].points:[...edges[use.edge].points].reverse();for(const p of points)if(!ring.length||!near(p,ring.at(-1)))ring.push(p);}
            if(ring.length>1&&near(ring[0],ring.at(-1)))ring.pop();
            return ring;
          });
          const outer=face.outer?.findIndex(Boolean)??0;
          if(outer>0)rings.unshift(...rings.splice(outer,1));
          const points=rings.flat(),holes=[];let count=0;
          for(let i=0;i<rings.length;i++){if(i)holes.push(count);count+=rings[i].length;}
          const xy=points.flatMap(p=>{const d=G.sub(vector(p),origin);return [number(G.dot(d,x)),number(G.dot(d,y))];});
          const indices=earcut(xy,holes,2);
          if(points.length<3||!indices.length)throw new Error('No reliable planar display triangulation');
          if(deviation(xy,holes,2,indices)>1e-5)throw new Error('Planar display triangulation has a coverage discrepancy');
          result.triangles=triangles(points,indices,s.normal.map(v=>v*(face.sameSense===false?-1:1)));
        } else if(face.surface.type==='cylinder') {
          Object.assign(result,cylinder(index,edges,toleranceMm));
        } else if(face.surface.type==='cone') {
          const rims=result.edgeIndices.filter(i=>body.edges[i].curve?.type==='circle'&&body.edges[i].start===body.edges[i].end);
          if(rims.length!==2)throw new Error('This trimmed curved face is shown by its analytic boundaries; shaded tessellation is not available');
          for(const i of result.edgeIndices.filter(i=>!rims.includes(i))){
            const uses=face.loops.flat().filter(u=>u.edge===i);
            if(body.edges[i].curve?.type!=='line'||uses.length!==2||uses[0].forward===uses[1].forward)throw new Error('Curved trim contains more than two full rims and a periodic seam; displayed as boundaries');
          }
          const s=face.surface, surface=encode(s), axis=vector(s.axis), origin=vector(s.origin);
          const levels=rims.map(i=>number(G.dot(G.sub(vector(body.edges[i].curve.origin),origin),axis)));
          const radius=Math.max(...rims.map(i=>body.edges[i].curve.radius));
          const count=Math.max(24,Math.ceil(2*Math.PI/(2*Math.acos(Math.max(-1,1-toleranceMm/radius)))));
          if(count>8192)throw new Error('Curved face exceeds display tessellation budget');
          const ring=levels.map(level=>Array.from({length:count},(_,i)=>coords(D.surface_point(surface,real(i*2*Math.PI/count),real(level)))));
          for(let i=0;i<count;i++) {
            const j=(i+1)%count, normal=coords(D.surface_normal(surface,real((i+0.5)*2*Math.PI/count))).map(v=>v*(face.sameSense===false?-1:1));
            result.triangles.push({points:[ring[0][i],ring[0][j],ring[1][j]],normal},{points:[ring[0][i],ring[1][j],ring[1][i]],normal});
          }
        } else throw new Error(`Shading for ${face.surface.type} is not available`);
      } catch(error) {
        result.triangles=[];result.displayWarning=error.message;notes.add(error.message);
      }
      return result;
    });
    const source=body.identity?.operation?.source??body.debug?.source;
    return {id:body.id,name:body.name??body.id,volumeMm3:body.validation?.volumeMm3??null,identity:body.identity,source,debug:body.debug,
      vertices:body.vertices.map((point,index)=>({index,point,identity:body.identity?.topology?.vertices?.[index],source})),edges,faces};
  });
  const all=bodies.flatMap((b,i)=>[...b.vertices.map(v=>v.point),...b.edges.flatMap(e=>e.points),...(model.bodies[i].geometry==='mesh'?model.bodies[i].mesh.vertices:[])]);
  const bounds={min:[0,1,2].map(i=>all.reduce((v,p)=>Math.min(v,p[i]),Infinity)),max:[0,1,2].map(i=>all.reduce((v,p)=>Math.max(v,p[i]),-Infinity))};
  if(!all.length||!Object.values(bounds).flat().every(Number.isFinite))throw new Error('Model has no finite display geometry');
  return {...metadata,bounds,bodies,sourceMap:model.sourceMap,diagnostic:model.diagnostic??null,display:{toleranceMm,notes:[...notes],purpose:'Approximate display only; analytic B-rep remains authoritative. Curved points are evaluated in Bend.'}};
}
