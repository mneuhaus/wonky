// Warm STEP round-trip workers (pkg-perf-roundtrip, 2026-10-02). A fresh
// uv/Python/OCP process per check cost ~1150 ms of a median 1296 ms wonky cell;
// one long-lived worker per kind and pool slot (scripts/acid/serve_worker.py)
// runs the same scripts with the same argv. A worker that exits, hangs past the
// timeout or breaks the protocol yields an answer marked `infrastructure`; the
// caller reports an in-request failure as a cell ERROR. Startup failure
// aborts the entire run before cell dispatch, never as a check result.
import {spawn} from 'node:child_process';

const STDERR_KEEP=8192;
export const WORKER_START_TIMEOUT_MS=600000;

export class RoundTripWorker {
  constructor(command,args,{cwd,env=process.env,maxRssBytes=3*2**30,startTimeoutMs=WORKER_START_TIMEOUT_MS,onStart=()=>{}}={}) {
    Object.assign(this,{command,args,cwd,env,maxRssBytes,startTimeoutMs,onStart});
    this.child=null;this.nextId=0;
  }
  // The Python interpreter's own pid (uv is its parent), once ready.
  get pid() { return this.child?this.workerPid:undefined; }
  // Resolves when the worker reported ready; rejects with the reason it did not.
  // Handlers are bound to their own process: a replaced one cannot answer.
  start(timeoutMs=this.startTimeoutMs) {
    if(this.starting)return this.starting;
    if(this.child)return Promise.resolve();
    const started=performance.now();
    const child=spawn(this.command,this.args,{cwd:this.cwd,env:this.env,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    this.child=child;this.failureAnswer=null;this.stderrTail='';this.pending=null;
    let buffer='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk=>{if(child===this.child)this.stderrTail=(this.stderrTail+chunk).slice(-STDERR_KEEP);});
    child.stdin.on('error',()=>{}); // EPIPE after a crash; the exit handler reports it.
    const ready=new Promise((resolve,reject)=>{this.readyWaiter={resolve,reject};});
    child.stdout.on('data',chunk=>{
      buffer+=chunk;let newline;
      while((newline=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
        if(child===this.child)this.line(child,line);
      }
    });
    child.once('error',error=>this.fail(child,`ROUNDTRIP_WORKER_SPAWN_FAILED: ${error.message}`,{status:null,signal:null}));
    child.once('close',(status,signal)=>this.fail(child,`ROUNDTRIP_WORKER_EXITED: status=${status} signal=${signal}`,{status,signal}));
    const timer=setTimeout(()=>this.fail(child,`ROUNDTRIP_WORKER_START_TIMEOUT after ${timeoutMs} ms`,{status:null,signal:'SIGKILL'}),timeoutMs);
    this.starting=ready.then(()=>this.onStart({pid:this.workerPid,wallMs:performance.now()-started})).finally(()=>{clearTimeout(timer);this.starting=null;});
    return this.starting;
  }
  line(child,line) {
    let message;
    try { message=JSON.parse(line); } catch { return this.fail(child,`ROUNDTRIP_WORKER_PROTOCOL: unparseable line ${JSON.stringify(line.slice(0,200))}`,{status:null,signal:'SIGKILL'}); }
    if(message.ready&&this.readyWaiter){const w=this.readyWaiter;this.readyWaiter=null;this.workerPid=message.pid;return w.resolve();}
    const pending=this.pending;
    if(!pending||message.id!==pending.id)return this.fail(child,`ROUNDTRIP_WORKER_PROTOCOL: unexpected answer ${JSON.stringify(message.id)}`,{status:null,signal:'SIGKILL'});
    this.pending=null;clearTimeout(pending.timer);
    // Bounded memory: OCCT allocations are not all returned to the system.
    if(message.maxRssBytes>this.maxRssBytes)this.close();
    pending.resolve({status:message.status,signal:null,stdout:message.stdout,stderr:message.stderr});
  }
  // Every failure ends this process; the pool readies a replacement before the next cell.
  fail(child,reason,{status,signal}) {
    if(child.exitCode===null&&child.signalCode===null)killGroup(child);
    if(child!==this.child)return;
    this.child=null;
    const answer={status,signal,error:reason,stdout:'',stderr:this.stderrTail,infrastructure:true};
    this.failureAnswer=answer;
    if(this.readyWaiter){const w=this.readyWaiter;this.readyWaiter=null;w.reject(Object.assign(new Error(reason),{answer}));}
    if(this.pending){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.resolve(answer);}
  }
  async run(argv,{timeoutMs,perfFile=null}) {
    if(this.pending)throw new Error('ROUNDTRIP_WORKER_BUSY');
    // A readied worker can die while its admitted cell is still building.
    // Preserve that crash for this cell; only the pool starts a replacement.
    if(!this.child&&this.failureAnswer)return this.failureAnswer;
    if(!this.child||this.starting)throw new Error('ROUNDTRIP_WORKER_NOT_READY');
    const id=++this.nextId,child=this.child;
    return new Promise(resolve=>{
      this.pending={id,resolve,timer:setTimeout(()=>this.fail(child,`ROUNDTRIP_WORKER_TIMEOUT after ${timeoutMs} ms`,{status:null,signal:'SIGKILL'}),timeoutMs)};
      child.stdin.write(JSON.stringify({id,argv,...(perfFile?{perfFile}:{})})+'\n');
    });
  }
  // EOF ends the serve loop; a worker that does not leave within 5 s is killed.
  close() {
    const child=this.child;
    if(this.readyWaiter){const w=this.readyWaiter;this.readyWaiter=null;w.reject(new Error('ROUNDTRIP_WORKER_CLOSED_DURING_START'));}
    this.child=null;
    if(!child||child.exitCode!==null||child.signalCode!==null)return;
    child.stdin.end();
    setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)killGroup(child);},5000).unref();
  }
}

function killGroup(child) {
  try { process.kill(process.platform!=='win32'?-child.pid:child.pid,'SIGKILL'); }
  catch(error) { if(error.code!=='ESRCH')throw error; }
}

// One worker per kind and slot; a cell holds one slot while it runs.
export class RoundTripPool {
  constructor(size,kinds,options={}) {
    this.free=Array.from({length:size},(_,slot)=>Object.fromEntries(Object.entries(kinds).map(([kind,[command,args]])=>[kind,new RoundTripWorker(command,args,{...options,onStart:timing=>options.onStart?.({slot,kind,...timing})})])));
    this.slots=[...this.free];this.waiters=[];this.started=false;
  }
  async ready(slot) {
    try { await Promise.all(Object.values(slot).map(worker=>worker.start())); }
    catch(error) { throw new Error(`ROUNDTRIP_WORKERS_START_FAILED: ${error.message}\n${error.answer?.stderr??''}`,{cause:error}); }
  }
  async start() {
    try { await Promise.all(this.slots.map(slot=>this.ready(slot)));this.started=true; }
    catch(error) { this.close();throw error; }
  }
  async with(work) {
    if(!this.started)throw new Error('ROUNDTRIP_POOL_NOT_READY');
    const slot=this.free.pop()??await new Promise(resolve=>this.waiters.push(resolve));
    try {
      // Replacement startup also precedes the next cell, outside its timers.
      await this.ready(slot);
      return await work((kind,argv,options)=>slot[kind].run(argv,options));
    }
    finally { const next=this.waiters.shift(); if(next)next(slot); else this.free.push(slot); }
  }
  close() { for(const slot of this.slots)for(const worker of Object.values(slot))worker.close(); }
}
