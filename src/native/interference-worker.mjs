// One interruptible native narrow-phase process. Kill the process, not a Node
// Worker thread: terminating a thread cannot interrupt a synchronous N-API call.
import { openKernel } from './backend.mjs';
import { RustBody, prepareInterferenceRustBody, clashRustBodies } from './rust-host.mjs';
const fault = error => process.send({ kind: 'fault', name: error.name, code: error.code, message: error.message });
try {
  const kernel = await openKernel('rust');
  process.on('message', ({ bodies, a, b }) => {
    if (bodies) {
      try {
        for (const body of bodies) {
          try { prepareInterferenceRustBody(kernel, new RustBody(body.id, body.words, null)); }
          catch (error) { if (error.name !== 'RustCapabilityError') throw error; }
        }
        process.send({ kind: 'prepared' });
      } catch (error) { fault(error); }
      return;
    }
    process.send({ kind: 'started' }, error => {
      if (error) throw error;
      try {
        const verdict = clashRustBodies(kernel, new RustBody(a.id, a.words, null), new RustBody(b.id, b.words, null), { certify: true });
        process.send({ kind: 'result', verdict });
      } catch (error) { fault(error); }
    });
  });
  process.on('disconnect', () => process.exit(0));
  process.send({ kind: 'ready' });
} catch (error) { fault(error); }
