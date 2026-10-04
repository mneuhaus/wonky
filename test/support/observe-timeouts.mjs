// Observe scheduling and cancellation, without giving CPU scheduling delay a
// pass/fail threshold. Real timers and real child processes still execute.
export function observeTimeouts(t) {
  const rows=[];
  let active=null;
  const schedule=globalThis.setTimeout,clear=globalThis.clearTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{
    const row={delay,scheduledAt:Date.now(),parent:active,fired:false,cancelled:false,cancelledBeforeFire:false};
    rows.push(row);
    row.timer=schedule(()=>{
      row.fired=true;
      const previous=active;
      active=row;
      try { callback(...args); } finally { active=previous; }
    },delay);
    return row.timer;
  });
  t.mock.method(globalThis,'clearTimeout',timer=>{
    const row=rows.find(row=>row.timer===timer);
    if(row){row.cancelled=true;row.cancelledBeforeFire ||= !row.fired;}
    return clear(timer);
  });
  return rows;
}
