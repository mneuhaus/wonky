// Fault injection preload for the loud-failure tests: wraps the native
// addon's call() in an otherwise unchanged CLI process so a test can see what
// the frontends do with a native reply that is wrong (diff divergence) or
// refused (bridge error). init, info, stats and reset pass through unchanged,
// so the loader's checks run on the real addon. Test use only.
//
//   WONKY_FAULT_OP=<op spec, e.g. ports/planar-boolean.bend:union>
//   WONKY_FAULT_KIND=flip   flip bit 0 of reply word WONKY_FAULT_WORD (default 7)
//   WONKY_FAULT_KIND=status answer status 1 (malformed request) -> BX_WIRE
//   node --import ./scripts/native-bridge/fault-inject.mjs bin/wonky-python.mjs ...
const spec = process.env.WONKY_FAULT_OP;
const kind = process.env.WONKY_FAULT_KIND ?? 'flip';
const word = Number(process.env.WONKY_FAULT_WORD ?? 7);
if (!spec || !['flip', 'status'].includes(kind)) throw new Error('fault-inject: set WONKY_FAULT_OP and WONKY_FAULT_KIND=flip|status');

const dlopen = process.dlopen;
process.dlopen = function faultyDlopen(module, filename, ...rest) {
  dlopen.call(this, module, filename, ...rest);
  if (!String(filename).endsWith('/wonky-kernel.node')) return;
  const addon = module.exports;
  let target = null, injected = 0;
  module.exports = {
    init: (...a) => addon.init(...a),
    info: (...a) => addon.info(...a),
    reset: (...a) => addon.reset(...a),
    stats: (...a) => ({ ...addon.stats(...a), faultsInjected: injected }),
    call(op, words) {
      target ??= addon.info().ops.indexOf(spec);
      if (target < 0) throw new Error(`fault-inject: ${spec} is not in this build`);
      const reply = addon.call(op, words);
      if (op !== target) return reply;
      injected += 1;
      if (kind === 'status') return Uint32Array.of(1);
      if (reply.length > word) reply[word] ^= 1;
      return reply;
    },
  };
};
