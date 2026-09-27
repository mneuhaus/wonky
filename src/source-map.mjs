import { createHash } from 'node:crypto';
import { resolveTopology } from './queries.mjs';
import { noteSketch, noteSource } from './diagnostics.mjs';

const geometric=name=>/^(op[A-Z]|sk[A-Z]|f[A-Z])/.test(name)||['newSketchOnPlane','newInstantiator','addInstance','instantiate','setProperty'].includes(name);
const location=loc=>loc?{line:loc.line,column:loc.column}:null;

function sourceDocument(source,language,file) {
  const sha256=createHash('sha256').update(source).digest('hex'),lines=source.split('\n');
  return {source:{language,file,sha256},at:loc=>({language,file,sha256,url:`/api/source/${sha256}`,span:location(loc),
    ...(loc?{excerpt:{firstLine:Math.max(1,loc.line-2),text:lines.slice(Math.max(0,loc.line-3),Math.min(lines.length,loc.line+3)).join('\n')}}:{})})};
}

// This is a bounded debug value snapshot, never an input to geometry. Omitted
// children are identified explicitly, rather than presented as complete data.
function valueSnapshot(value,depth=0,seen=new WeakSet()) {
  if(value===undefined)return {type:'undefined'};
  if(value===null||['string','number','boolean'].includes(typeof value))return value;
  if(typeof value!=='object')return {type:typeof value};
  if(value.constructor?.name==='Id')return {type:'Id',value:String(value)};
  if(value.constructor?.name==='Quantity')return {type:'Quantity',value:value.value,lengthPower:value.dimension,anglePower:value.angle,baseUnits:'meter/radian'};
  if(value.type==='Context')return {type:'Context'};
  if(value.type==='Sketch')return {type:'Sketch',id:String(value.id)};
  if(value.type==='function'||value.type==='feature')return {type:value.type,declaration:location(value.ast?.loc??value.fn?.ast?.loc)};
  if(seen.has(value))return {type:'reference',truncated:true};
  if(depth>=5)return {type:value.constructor?.name??'object',truncated:true};
  seen.add(value);
  if(Array.isArray(value))return value.length<=64?value.map(v=>valueSnapshot(v,depth+1,seen)):{type:'array',length:value.length,items:value.slice(0,64).map(v=>valueSnapshot(v,depth+1,seen)),truncated:true};
  const entries=Object.entries(value).filter(([key])=>!['engine','env','records','kernel'].includes(key));
  const result=Object.fromEntries(entries.slice(0,64).map(([k,v])=>[k,valueSnapshot(v,depth+1,seen)]));
  if(entries.length>64)result.truncated=true;
  if(value.constructor?.name&&value.constructor.name!=='Object')result.type??=value.constructor.name;
  return result;
}

export function sourceTracker(engine,source,program,{sourcePath=null}={}) {
  const document=sourceDocument(source,'FeatureScript',sourcePath),operations=[];
  const names=new WeakMap();
  for(const declaration of program.declarations){const value=declaration.value;if(value?.kind==='function')names.set(value,declaration.name);else for(const arg of value?.args??[])if(arg.kind==='function')names.set(arg,declaration.name);}
  const frameName=fn=>fn.name??names.get(fn.ast??fn.fn?.ast)??(fn.ast?.loc?`function@${fn.ast.loc.line}`:fn.type);
  const observer={
    watches:fn=>geometric(fn.name),
    enter({fn,args,loc,stack}) {
      if(fn?.type!=='builtin'||!geometric(fn.name))return {frame:{fn,args,loc}};
      const id=args.find(v=>v?.constructor?.name==='Id');
      const feature = stack.findLast(frame=>frame.fn.type==='feature');
      const record={sequence:operations.length,operationId:id?String(id):null,name:fn.name,status:'running',source:document.at(loc),
        callStack:stack.filter(f=>f.fn.type!=='builtin').map(f=>({name:frameName(f.fn),calledAt:location(f.loc),declaration:location(f.fn.ast?.loc??f.fn.fn?.ast?.loc)})),
        parameters:valueSnapshot(args.filter(v=>v?.type!=='Context')),outputs:[],removedBodies:[]};
      record.feature=feature?{id:String(feature.args[1]),name:frameName(feature.fn),line:feature.fn.fn?.ast?.loc?.line??null}:null;
      operations.push(record);
      return {record,args,before:engine.bodies};
    },
    leave(token,{error}) {
      if(!token)return;
      const {record,before,args}=token;
      if(error && !error.diagnosticContext && (record || error.name==='UnsupportedFeatureError')) {
        const operation=record??{sequence:operations.length,name:frameName(token.frame.fn),operationId:String(token.frame.args[1]??''),source:document.at(error)};
        const inputs=[],roles=new Map();let inputResolutionError;
        const definition=(args??token.frame?.args)?.at(-1);
        for(const role of ['targets','tools','entities'])if(definition?.[role]) {
          try { for(const row of resolveTopology(engine,definition[role],error))if(row.record?.kind==='solid') {
            const body=row.record.body;if(!inputs.includes(body))inputs.push(body);roles.set(body,role);
          }} catch(failure) {inputResolutionError=failure.message;}
        }
        Object.defineProperty(error,'diagnosticContext',{value:{operation,inputs,roles,bodies:before??engine.bodies,file:sourcePath,inputResolutionError}});
      }
      if(!record)return;
      record.status=error?'failed':'completed';
      if(error){
        record.error={name:error.name,message:error.message,line:error.line,column:error.column};
        // The innermost failing operation names itself on the error, so a
        // refusal raised inside a shared helper reports the operation id chain
        // (model/T01/hollow/subtract) and the calls that reached it, not only
        // the helper's line (bin/wonky.mjs, src/r20-export.mjs error.json).
        // Each callStack frame is a user function with the line and column it
        // was called at (null for the feature the build entered).
        if(error&&typeof error==='object'&&!error.operation)
          error.operation={id:record.operationId,name:record.name,callStack:record.callStack.map(f=>({function:f.name,line:f.calledAt?.line??null,column:f.calledAt?.column??null}))};
        return;
      }
      if(/^sk(?:Arc|Circle|LineSegment|Rectangle|Polyline)$/.test(record.name))noteSketch(args[0],args[1],record);
      let sketch=null;
      if(['opExtrude','opRevolve'].includes(record.name)) {
        try {sketch=engine.resolve(args[2].entities);} catch { /* location remains on the generating operation */ }
      }
      const after=engine.bodies,changed=after.filter(b=>!before.includes(b));
      record.outputs=changed.map(b=>({bodyId:b.id,identity:b.identity?{originId:b.identity.originId,instanceId:b.identity.instanceId,revision:b.identity.revision}:null}));
      record.removedBodies=before.filter(b=>!after.includes(b)).map(b=>b.id);
      for(const body of changed){
        noteSource(body,record,sketch);
        body.debug={sourceOperation:record.sequence,operationId:record.operationId,source:record.source,callStack:record.callStack};
        if(body.identity?.operation){
          body.identity.operation.source=record.source;
          body.identity.operation.parameters=record.parameters;
          body.identity.operation.callStack=record.callStack;
        }
      }
    },
  };
  return {observer,report:()=>({schema:'wonky-source-map/1',source:document.source,
    scope:'Observed modeling calls and actual resulting body objects; source locations are call points, not full expression ranges. Missing spans remain null.',operations})};
}

export function pythonSourceTracker(source,filename) {
  const document=sourceDocument(source,'Python',filename.startsWith('<')?null:filename),operations=[];
  return {
    enter(request) {
      if(request.op==='volume')return null;
      const {type,id,op,location:loc,callStack,...parameters}=request;
      const valid=loc?.file===filename&&Number.isInteger(loc.line)&&loc.line>0&&loc.line<=source.split('\n').length;
      const record={sequence:operations.length,requestId:id,operationId:null,name:op,status:'running',source:document.at(valid?{line:loc.line,column:loc.column??null}:null),
        callStack:(callStack??[]).filter(frame=>frame.calledAt?.file===filename),parameters,outputs:[],removedBodies:[]};
      operations.push(record);return record;
    },
    leave(record,{bodies=[],error}={}) {
      if(!record)return;
      record.status=error?'failed':'completed';
      if(error){record.error={name:error.name,message:error.message,line:error.line,column:error.column};return;}
      record.operationId=bodies[0]?.identity?.operation?.id??bodies[0]?.id??null;
      record.outputs=bodies.map(body=>({bodyId:body.id,identity:body.identity?{originId:body.identity.originId,instanceId:body.identity.instanceId,revision:body.identity.revision}:null}));
      for(const body of bodies){
        body.debug={sourceOperation:record.sequence,operationId:record.operationId,source:record.source,callStack:record.callStack};
        if(body.identity?.operation)Object.assign(body.identity.operation,{source:record.source,parameters:record.parameters,callStack:record.callStack});
      }
    },
    report:()=>({schema:'wonky-source-map/1',source:document.source,
      scope:'Observed eager Python modeling requests. Call lines and stack frames refer only to the executed source; columns are 1-based character columns on Python 3.11 and newer, null before. Shape IDs are session-serial and are not stable across inserted operations. Intermediate shapes remain available; result selects exported bodies.',operations}),
  };
}
