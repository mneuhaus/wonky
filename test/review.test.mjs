import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("review.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFile, writeFile, mkdtemp, rm, readdir, mkdir } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { createHash } = await import("node:crypto");
const { build } = await import("../src/index.mjs");
const { reviewScene } = await import("../src/review-scene.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { createGeometryInspector } = await import("../src/geometry-summary.mjs");
const { serializeModel } = await import("../src/construction-history.mjs");












test('review display retains holes, curved topology targets and declared tessellation error without replacing the B-rep',async()=>{
  const source=await readFile(new URL('../examples/bored-spacer.fs',import.meta.url),'utf8');
  const model=await build(source), before=JSON.stringify(model), scene=await reviewScene(model,{id:'test'});
  assert.equal(JSON.stringify(model),before);
  assert.equal(scene.display.toleranceMm,0.02);assert.deepEqual(scene.display.notes,[]);
  const body=scene.bodies[0];
  assert.equal(body.faces.length,model.bodies[0].faces.length);
  assert.ok(body.faces.every(f=>f.triangles.length>0));
  for(const face of body.faces.filter(f=>f.surfaceType==='plane'))for(const t of face.triangles){
    const center=[0,1,2].map(i=>t.points.reduce((s,p)=>s+p[i]/3,0));
    assert.ok(Math.hypot(center[0],center[1])>=2-0.021,'cap tessellation must not fill the bore');
  }
  for(const edge of body.edges.filter(e=>e.curveType==='circle')){
    const r=Math.hypot(edge.points[0][0],edge.points[0][1]);
    for(let i=1;i<edge.points.length;i++){
      const a=edge.points[i-1],b=edge.points[i],midRadius=Math.hypot((a[0]+b[0])/2,(a[1]+b[1])/2);
      assert.ok(Math.abs(midRadius-r)<=0.02000001);
    }
  }
});

test('rendering reports serve only named images whose bytes match the recorded hash',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wonky-render-report-')), renders=join(dir,'out','visual-comparison');
  await mkdir(renders,{recursive:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');
  await writeFile(join(renders,'0-before.png'),png);
  await writeFile(join(renders,'report.json'),JSON.stringify({schema:'wonky.visual-comparison/1',status:'measured',views:[{name:'front',images:{before:{file:'0-before.png',sha256:createHash('sha256').update(png).digest('hex')}}}]}));
  const curved=join(dir,'out','curved-visual-comparison'),curvedPng=Buffer.concat([png,Buffer.from('distinct fixture bytes')]);
  await mkdir(curved,{recursive:true});await writeFile(join(curved,'0-before.png'),curvedPng);
  await writeFile(join(curved,'report.json'),JSON.stringify({schema:'wonky.visual-comparison/1',status:'measured',views:[{name:'front',images:{before:{file:'0-before.png',sha256:createHash('sha256').update(curvedPng).digest('hex')}}}]}));
  const path=join(dir,'part.brep.json');await writeFile(path,JSON.stringify(await build(await readFile(new URL('../examples/box.fs',import.meta.url),'utf8'))));
  const server=await createReviewServer({modelPaths:[path],root:dir,port:0});
  try{
    const base=server.url.replace('/viewer/',''),report=await (await fetch(base+'/api/reports/visual')).json();
    const imageUrl=base+report.views[0].images.before.url,response=await fetch(imageUrl);
    assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    const curvedResponse=await fetch(base+'/api/reports/curved-visual');assert.equal(curvedResponse.status,200);
    const curvedUrl=base+(await curvedResponse.json()).views[0].images.before.url;
    assert.notEqual(curvedUrl,imageUrl);assert.deepEqual(Buffer.from(await(await fetch(curvedUrl)).arrayBuffer()),curvedPng);
    await writeFile(join(renders,'0-before.png'),'changed after the rendering report');
    assert.equal((await fetch(imageUrl)).status,400);
    assert.equal((await fetch(curvedUrl)).status,200,'another report with the same image filename remains intact');
    assert.equal((await fetch(base+'/api/reports/visual/images/1-before.png')).status,404);
  }finally{await server.close();await rm(dir,{recursive:true,force:true});}
});

test('render generations preserve previous image URLs across refresh and reject invalid generation paths',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wonky-render-generation-')),renders=join(dir,'out','curved-visual-comparison');
  const ids=['1'.repeat(64),'2'.repeat(64)],images=[Buffer.from('first generation'),Buffer.from('second generation')];
  const report=id=>({schema:'wonky.visual-comparison/1',status:'measured',assetGeneration:{id,directory:`generations/${id}`},
    views:[{name:'front',images:{before:{file:'0-before.png',sha256:createHash('sha256').update(images[ids.indexOf(id)]).digest('hex')}}}]});
  for(const [i,id]of ids.entries()){
    const generation=join(renders,'generations',id);await mkdir(generation,{recursive:true});
    await writeFile(join(generation,'0-before.png'),images[i]);
  }
  await writeFile(join(renders,'report.json'),JSON.stringify(report(ids[0])));
  const path=join(dir,'part.brep.json');await writeFile(path,JSON.stringify(await build(await readFile(new URL('../examples/box.fs',import.meta.url),'utf8'))));
  const server=await createReviewServer({modelPaths:[path],root:dir,port:0});
  try{
    const base=server.url.replace('/viewer/',''),current=()=>fetch(base+'/api/reports/curved-visual');
    const first=await(await current()).json(),firstUrl=base+first.views[0].images.before.url;
    assert.ok(firstUrl.includes('/images/'+ids[0]+'/'));
    await writeFile(join(renders,'report.json'),JSON.stringify(report(ids[1])));
    assert.equal((await fetch(base+'/api/workspace')).status,200);
    const second=await(await current()).json(),secondUrl=base+second.views[0].images.before.url;
    assert.notEqual(firstUrl,secondUrl);
    assert.deepEqual(Buffer.from(await(await fetch(firstUrl)).arrayBuffer()),images[0]);
    assert.deepEqual(Buffer.from(await(await fetch(secondUrl)).arrayBuffer()),images[1]);
    assert.equal((await fetch(base+'/api/reports/curved-visual/images/'+'3'.repeat(64)+'/0-before.png')).status,404);
    for(const invalid of [{id:ids[1],directory:'../../outside'},{id:'../outside',directory:'generations/../outside'},null]){
      await writeFile(join(renders,'report.json'),JSON.stringify({...report(ids[1]),assetGeneration:invalid}));
      const rejected=await fetch(base+'/api/workspace');assert.equal(rejected.status,400);
      assert.match((await rejected.json()).error,/Invalid recorded render generation/);
      assert.deepEqual((await(await current()).json()).assetGeneration,second.assetGeneration);
      assert.equal((await fetch(firstUrl)).status,200);assert.equal((await fetch(secondUrl)).status,200);
    }
    await writeFile(join(renders,'generations',ids[0],'0-before.png'),'changed');
    assert.equal((await fetch(firstUrl)).status,400);assert.equal((await fetch(secondUrl)).status,200);
  }finally{await server.close();await rm(dir,{recursive:true,force:true});}
});

test('source inspector serves exact frozen code after edits and refuses mismatching current source',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wonky-source-')), path=join(dir,'part.brep.json'), sourcePath=join(dir,'part.fs');
  const reviews=join(dir,'reviews'), source=await readFile(new URL('../examples/box.fs',import.meta.url),'utf8');
  const sha=createHash('sha256').update(source).digest('hex');
  await writeFile(sourcePath,source);
  const model=await build(source,{sourcePath});
  await writeFile(path,JSON.stringify(model));
  let server=await createReviewServer({modelPaths:[path],root:dir,reviewDirectory:reviews,port:0});
  try{
    const get=()=>fetch(server.url.replace('/viewer/','')+'/api/source/'+sha);
    const frozen=await (await get()).json();assert.equal(frozen.text,source);assert.equal(frozen.sha256,sha);
    await writeFile(sourcePath,'// changed after the reviewed model was built\n');
    assert.equal((await (await get()).json()).text,source);
    await server.close();server=null;
    server=await createReviewServer({modelPaths:[path],root:dir,reviewDirectory:reviews,port:0});
    assert.equal((await (await get()).json()).text,source,'frozen source survives server restart');
    await server.close();server=null;
    server=await createReviewServer({modelPaths:[path],root:dir,reviewDirectory:join(dir,'fresh-reviews'),port:0});
    assert.equal((await get()).status,404,'never return newer code as the old source revision');
  }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('rejected refreshes publish neither invalid topology nor failed display scenes and remain restartable',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wonky-review-rejected-')),path=join(dir,'part.brep.json'),reviews=join(dir,'reviews');
  const model=await build(await readFile(new URL('../examples/box.fs',import.meta.url),'utf8'));
  const original=JSON.stringify(model),id=createHash('sha256').update(original).digest('hex');
  await writeFile(path,original);
  let server=await createReviewServer({modelPaths:[path],root:dir,reviewDirectory:reviews,port:0});
  try{
    const stale=structuredClone(model);stale.bodies[0].vertices[0][0]+=1;
    const undisplayable=structuredClone(model);delete undisplayable.bodies[0].identity;undisplayable.bodies[0].edges[0].curve={type:'spline'};
    assert.doesNotThrow(()=>createGeometryInspector(undisplayable),'second case reaches display preparation after geometry inspection');
    for(const [invalid,expected]of [[stale,/Stale geometry revision/],[undisplayable,/Unsupported display edge spline/]]){
      const bytes=JSON.stringify(invalid),rejectedId=createHash('sha256').update(bytes).digest('hex');
      await writeFile(path,bytes);
      const base=server.url.replace('/viewer/',''),rejected=await fetch(base+'/api/workspace');
      assert.equal(rejected.status,400);assert.match((await rejected.json()).error,expected);
      assert.deepEqual([...server.models.keys()],[id],'failed refresh cannot publish a model registry entry');
      assert.deepEqual(await readdir(join(reviews,'models')),[id+'.brep.json'],'failed refresh cannot leave an archived model');
      const missingScene=await fetch(base+'/api/models/'+rejectedId);
      assert.equal(missingScene.status,400);assert.match((await missingScene.json()).error,/Unknown model revision/);
      assert.equal((await fetch(base+'/api/models/'+rejectedId+'/summary')).status,404,'failed refresh cannot publish an inspector');
      assert.equal((await fetch(base+'/api/models/'+id)).status,200,'original scene remains usable');
    }
    await writeFile(path,original);
    const refreshed=await fetch(server.url.replace('/viewer/','')+'/api/workspace');
    assert.equal(refreshed.status,200);assert.deepEqual((await refreshed.json()).models.map(model=>model.id),[id]);
    await server.close();server=null;
    server=await createReviewServer({modelPaths:[path],root:dir,reviewDirectory:reviews,port:0});
    const restarted=await fetch(server.url.replace('/viewer/','')+'/api/workspace');
    assert.equal(restarted.status,200);assert.deepEqual((await restarted.json()).models.map(model=>model.id),[id]);
    assert.equal((await fetch(server.url.replace('/viewer/','')+'/api/models/'+id)).status,200);
  }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('preexisting corrupt or invalid archived models fail with the snapshot path and are preserved',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wonky-review-archive-')),path=join(dir,'part.brep.json');
  const model=await build(await readFile(new URL('../examples/box.fs',import.meta.url),'utf8'));
  await writeFile(path,JSON.stringify(model));
  const stale=structuredClone(model);stale.bodies[0].vertices[0][0]+=1;
  const invalid=JSON.stringify(stale),invalidId=createHash('sha256').update(invalid).digest('hex');
  try{
    for(const [name,id,bytes,reason]of [['corrupt','a'.repeat(64),'corrupt bytes',/hash mismatch/],['invalid',invalidId,invalid,/Stale geometry revision/]]){
      const reviews=join(dir,name),snapshots=join(reviews,'models'),snapshot=join(snapshots,id+'.brep.json');
      await mkdir(snapshots,{recursive:true});await writeFile(snapshot,bytes);
      let unexpected;
      try{
        await assert.rejects(async()=>{unexpected=await createReviewServer({modelPaths:[path],root:dir,reviewDirectory:reviews,port:0});},error=>{
          assert.match(error.message,/Cannot load archived model snapshot/);assert.ok(error.message.includes(snapshot));assert.match(error.message,reason);return true;
        });
      }finally{if(unexpected)await unexpected.close();}
      assert.equal(await readFile(snapshot,'utf8'),bytes,'startup must not delete or repair evidence automatically');
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('review server saves resolvable revision-bound feedback and rejects bad references and cross-origin writes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wonky-review-')), path=join(dir,'part.brep.json'), reviews=join(dir,'reviews');
  const model=await build(await readFile(new URL('../examples/box.fs',import.meta.url),'utf8'));
  await writeFile(path,JSON.stringify(model));
  let server=await createReviewServer({modelPaths:[path],reviewDirectory:reviews,port:0});
  try{
    const base=server.url.replace('/viewer/','');
    const workspace=await (await fetch(base+'/api/workspace')).json();const id=workspace.models[0].id;
    const scene=await (await fetch(base+'/api/models/'+id)).json();
    const summary=await (await fetch(base+'/api/models/'+id+'/summary')).json();
    assert.equal(summary.modelId,id);assert.equal(summary.bodies[0].alias,'B1');
    const compact=await (await fetch(base+'/api/models/'+id+'/summary?level=bodies')).json();
    assert.equal(compact.bodies[0].faces,undefined);assert.equal(compact.counts.faces,summary.counts.faces);
    const detail=await (await fetch(base+'/api/models/'+id+'/entities/B1.F1')).json();
    assert.equal(detail.reference.bodyId,scene.bodies[0].id);assert.equal(detail.reference.entityIndex,0);
    assert.deepEqual(detail.geometry,JSON.parse(JSON.stringify(model.bodies[0].faces[0])));
    assert.equal((await fetch(base+'/api/models/'+id+'/entities/B1.F999')).status,400);
    const camera={yaw:-0.6,pitch:-0.5,zoom:1,pan:[0,0]},view={before:id,after:id,split:0.5,compare:true,layout:'side-by-side',aspect:1.5};
    const payload={title:'Inspect this edge',notes:'Keep the bore clear',models:[id],camera,comparison:view,
      annotations:[{tool:'arrow',text:'Here',points:[[0.1,0.2],[0.3,0.4]],camera,view,target:{modelId:id,bodyId:scene.bodies[0].id,entityType:'edge',entityIndex:0}}]};
    const post=data=>fetch(base+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const response=await post(payload);assert.equal(response.status,201);const saved=await response.json();
    assert.match(saved.id,/^WKR-[A-F0-9]{10}$/);assert.match(saved.url,/#review=WKR-/);
    const record=await (await fetch(base+'/api/feedback/'+saved.id)).json();
    assert.deepEqual(record.comparison,view);assert.deepEqual(record.annotations[0].view,view);assert.equal(record.revisions[0].sha256,id);
    assert.equal(record.annotations[0].target.alias,'B1.E1');
    const persistentContext=await readFile(saved.contextFile,'utf8');
    assert.match(persistentContext,/B1.E1/);assert.ok(!persistentContext.includes(base),'persisted context is not tied to an ephemeral server port');
    const packet=await (await fetch(saved.contextUrl)).text();
    assert.ok(packet.includes(id));assert.match(packet,/--detail B1.F1/);
    assert.equal(JSON.parse(await readFile(saved.file,'utf8')).id,saved.id);
    assert.ok((await readdir(reviews)).includes(saved.id+'.md'));
    const invalid=structuredClone(payload);invalid.annotations[0].target.entityIndex=99999;
    assert.equal((await post(invalid)).status,400);
    const badCoordinate=structuredClone(payload);badCoordinate.annotations[0].points[0][0]=-2;
    assert.equal((await post(badCoordinate)).status,400);
    for(const layout of ['wipe',undefined]){
      const compatible=structuredClone(payload);compatible.comparison.layout=layout;compatible.annotations[0].view.layout=layout;
      const compatibleSaved=await (await post(compatible)).json();
      const compatibleRecord=await (await fetch(base+'/api/feedback/'+compatibleSaved.id)).json();
      assert.equal(compatibleRecord.comparison.layout,layout);assert.equal(compatibleRecord.annotations[0].view.layout,layout);
    }
    for(const target of ['comparison','annotation']){
      const invalidLayout=structuredClone(payload);
      (target==='comparison'?invalidLayout.comparison:invalidLayout.annotations[0].view).layout='stacked';
      assert.equal((await post(invalidLayout)).status,400);
    }
    assert.equal((await fetch(base+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://elsewhere.invalid'},body:JSON.stringify(payload)})).status,403);
    // A later model replacing the input path must not move an old annotation.
    await writeFile(path,JSON.stringify(await build(await readFile(new URL('../examples/bracket.fs',import.meta.url),'utf8'))));
    const refreshed=await (await fetch(base+'/api/workspace')).json();
    assert.equal(refreshed.models.length,2);assert.ok(refreshed.models.some(m=>m.id!==id));
    assert.equal((await (await fetch(base+'/api/models/'+id)).json()).sha256,id);
    await server.close();server=null;
    server=await createReviewServer({modelPaths:[path],reviewDirectory:reviews,port:0});
    const later=server.url.replace('/viewer/','');
    const oldScene=await (await fetch(later+'/api/models/'+id)).json();assert.equal(oldScene.sha256,id);
    assert.equal((await (await fetch(later+'/api/feedback/'+saved.id)).json()).annotations[0].target.modelId,id);
    const laterContext=await (await fetch(later+'/api/feedback/'+saved.id+'/context')).text();
    assert.ok(laterContext.includes(id));assert.ok(laterContext.includes(later));
    assert.equal(await readFile(saved.contextFile,'utf8'),persistentContext,'server restarts preserve portable on-disk references');
  }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a certified-mesh body is served as its mesh with its certified deviation, with no B-rep edges invented',async()=>{
  // Crossed rods r 5 along x and r 3 along y: the hybrid Boolean answers a certified mesh
  // (test/hybrid-mesh.test.mjs, same rods). Before, the viewer refused it: "Face references invalid coedges".
  const cylinder=(name,origin,radius,axis)=>`
    var s${name} = newSketchOnPlane(context, id + "s${name}", { "sketchPlane" : plane(vector(${origin})*millimeter, vector(${axis})) });
    skCircle(s${name}, "c", { "center" : vector(0,0)*millimeter, "radius" : ${radius}*millimeter });
    skSolve(s${name});
    opExtrude(context, id + "${name}", { "entities" : qSketchRegion(id + "s${name}"), "direction" : vector(${axis}), "endBound" : BoundingType.BLIND, "endDepth" : 20*millimeter });`;
  const source=`FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\nexport function part(context is Context, id is Id, definition is map)\n{${cylinder('p','-10,0,0',5,'1,0,0')}${cylinder('q','0,-10,0',3,'0,1,0')}
    opBoolean(context, id + "u", { "tools" : qUnion([qCreatedBy(id + "p", EntityType.BODY), qCreatedBy(id + "q", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });\n}`;
  const model=await build(source,{feature:'part'}),[body]=model.bodies;
  assert.equal(body.geometry,'mesh');
  const dir=await mkdtemp(join(tmpdir(),'wonky-review-mesh-')),path=join(dir,'crossed.brep.json'),json=serializeModel(model);
  await writeFile(path,json);
  const server=await createReviewServer({modelPaths:[path],root:dir,reviewDirectory:join(dir,'reviews'),port:0});
  try{
    const base=server.url.replace('/viewer/',''),id=createHash('sha256').update(json).digest('hex');
    const response=await fetch(base+'/api/models/'+id);
    assert.equal(response.status,200,await response.clone().text());
    const scene=await response.json(),[shown]=scene.bodies;
    assert.deepEqual([shown.vertices,shown.edges],[[],[]]);
    assert.equal(shown.faces.length,body.faces.length);
    shown.faces.forEach((face,index)=>{
      const own=body.mesh.triangles.filter(triangle=>triangle[3]===index).map(triangle=>triangle.slice(0,3).map(v=>body.mesh.vertices[v]));
      assert.deepEqual(face.triangles.map(triangle=>triangle.points),own,`face ${index}`);
      assert.equal(face.displayTessellation.maxChordalErrorBoundMm,body.mesh.deviationMm);
    });
    const all=body.mesh.vertices;
    assert.deepEqual(scene.bounds,{min:[0,1,2].map(i=>Math.min(...all.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...all.map(p=>p[i])))});
    assert.ok(scene.display.notes.some(note=>note.includes(`${body.id} is a certified-mesh approximation within 0.01 mm`)));
    const detail=await fetch(base+`/api/models/${id}/entities/B1.F1`);
    assert.equal(detail.status,200,await detail.clone().text());
    assert.deepEqual((await detail.json()).relations,{loops:[]});
  }finally{await server.close();await rm(dir,{recursive:true,force:true});}
});

}
