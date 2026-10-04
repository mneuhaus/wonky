// Imported references expose approximate display geometry, never exact facts.
import {ReferenceMeshError} from './native/reference-mesh.mjs';
export function referenceReviewScene(model,metadata,toleranceMm) {
  const bodies=model.bodies.map(body=>{
    if(!body.referenceDisplay)throw new Error('import/mesh/reference-display-record-missing');
    const {source,mesh:stored}=body.referenceDisplay;
    if(toleranceMm<stored.deviationMm)throw new ReferenceMeshError('import/mesh/saved-boundary-budget');
    const mesh=stored;
    const point=i=>mesh.vertices.slice(3*i,3*i+3),byFace=new Map(source.faces.map((f,i)=>[f.id,i]));
    const faces=source.faces.map((face,index)=>({index,surfaceType:source.carriers.find(c=>c.id===face.surface).kind,
      edgeIndices:[...new Set(face.loops.flatMap(l=>l.uses.map(([id])=>source.edges.findIndex(e=>e.id===id))))],triangles:[],
      displayTessellation:{source:'imported-reference',approximate:true,exact:false,approximation:'tessellated mesh',maxChordalErrorBoundMm:toleranceMm}}));
    for(let t=0;t<mesh.faces.length;t++) {
      const ps=mesh.triangles.slice(3*t,3*t+3).map(point),a=ps[1].map((x,i)=>x-ps[0][i]),b=ps[2].map((x,i)=>x-ps[0][i]),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...n);
      faces[byFace.get(mesh.faces[t])].triangles.push({points:ps,normal:n.map(x=>x/length)});
    }
    return {id:body.id,name:body.name??body.id,volumeMm3:null,exact:false,uncertainty:body.uncertainty,
      vertices:body.vertices.map((point,index)=>({index,point})),
      edges:mesh.edges.map((edge,index)=>({index,curveType:'reference',points:edge.vertices.map(point)})),faces};
  });
  const all=bodies.flatMap(b=>b.faces.flatMap(f=>f.triangles.flatMap(t=>t.points))),bounds={min:[0,1,2].map(i=>all.reduce((m,p)=>Math.min(m,p[i]),Infinity)),max:[0,1,2].map(i=>all.reduce((m,p)=>Math.max(m,p[i]),-Infinity))};
  return {...metadata,bodies,bounds,sourceMap:model.sourceMap,display:{toleranceMm,exact:false,approximation:'tessellated mesh',notes:[],
    purpose:`Imported reference; tessellated mesh, exact:false, deviation ${toleranceMm} mm. Source uncertainty: ${JSON.stringify(bodies.map(b=>b.uncertainty))}. Exact area and volume are not evaluated.`}};
}
