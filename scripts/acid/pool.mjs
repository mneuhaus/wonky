import os from 'node:os';

export function acidJobs(setting=process.env.WONKY_ACID_JOBS, cores=os.availableParallelism()) {
  if(setting===undefined||setting==='')return Math.max(1,cores-2);
  const jobs=Number(setting);
  if(!Number.isSafeInteger(jobs)||jobs<1)throw new Error(`WONKY_ACID_JOBS must be a positive integer (got '${setting}')`);
  return jobs;
}

// Dispatch in serial order; commit only the contiguous completed prefix. Each
// worker holds at most one completed result, so a slow early cell cannot cause
// an unbounded queue of buffered rows. On failure drain active work, then throw.
export async function orderedPool(items,jobs,run,commit) {
  const pending=new Map();
  let next=0,published=0,failure;
  async function worker() {
    while(next<items.length&&!failure) {
      const index=next++;
      try {
        const result=await run(items[index],index);
        await new Promise((resolve,reject)=>{
          pending.set(index,{result,resolve,reject});
          while(pending.has(published)&&!failure) {
            const item=pending.get(published);
            pending.delete(published);
            try { commit(item.result,items[published],published);published++;item.resolve(); }
            catch(error){item.reject(error);failure=error;}
          }
          if(failure)reject(failure);
        });
      } catch(error) {
        failure??=error;
        for(const item of pending.values())item.reject(failure);
        pending.clear();
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(jobs,items.length)},worker));
  if(failure)throw failure;
}

// Preloads are part of the execution environment (including real planted
// failures). Entry-point flags such as --eval, --input-type and --test must
// not cause a cell child to rerun the parent program or discover more tests.
export function cellPreloads(argv=process.execArgv) {
  const args=[];
  for(let i=0;i<argv.length;i++) {
    if(['--import','--require','-r'].includes(argv[i]))args.push(argv[i],argv[++i]);
    else if(argv[i].startsWith('--import=')||argv[i].startsWith('--require='))args.push(argv[i]);
  }
  return args;
}

// Share one host allowance between independent pools; small allowances run pools serially.
export function splitPoolBudget(total, limits) {
  if (!Number.isSafeInteger(total) || total < 1 || !Array.isArray(limits) || !limits.length ||
      limits.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('INVALID_POOL_BUDGET');
  if (total < limits.length) return {concurrent:false, jobs:limits.map(n => Math.min(n,total))};
  const jobs=limits.map(() => 1);
  let left=total-jobs.length;
  while(left && jobs.some((n,i) => n < limits[i])) {
    for(let i=0;i<jobs.length && left;i++)if(jobs[i]<limits[i]){jobs[i]++;left--;}
  }
  return {concurrent:true,jobs};
}
