import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// wait4/getrusage charges the completed process and its reaped descendants,
// including native threads. Scheduler wait and unrelated load are not charged.
export function cpuMeasured(command,args,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'wonky-cpu-'));
  try {
    const output=join(dir,'usage.json');
    const program=`import json, resource, subprocess, sys, time
start = time.monotonic()
child = subprocess.run(sys.argv[2:])
r = resource.getrusage(resource.RUSAGE_CHILDREN)
with open(sys.argv[1], 'w') as f:
    json.dump({'cpuSeconds': r.ru_utime + r.ru_stime, 'wallSeconds': time.monotonic() - start}, f)
sys.exit(child.returncode if child.returncode >= 0 else 128 - child.returncode)
`;
    const env={...(options.env??process.env)};
    // A node:test child must be a fresh runner, not an inherited recursive
    // runner that exits successfully without executing its test files.
    delete env.NODE_TEST_CONTEXT;
    const result=spawnSync('python3',['-c',program,output,command,...args],{stdio:'inherit',...options,env});
    if(result.error)throw result.error;
    return {status:result.status,...JSON.parse(readFileSync(output,'utf8'))};
  } finally {rmSync(dir,{recursive:true,force:true});}
}
