// Errors of the native kernel backend (docs/native-bridge.md section 7).
// None of them ever triggers a second run on the JS target.
import { UnsupportedFeatureError } from '../errors.mjs';

// A bridge failure: bad arguments to the addon (BX_ARGS), a Rust kernel fault
// (BX_FAULT: a panic caught in the addon, status 5), request/reply words
// that do not fit the wire (BX_WIRE), an addon/codec/API mismatch (BX_ABI), a
// missing or unloadable build (BX_LOAD), a runtime fail-stop on the calling
// thread (BX_FAILSTOP) and every later call until reset() (BX_POISONED), an
// invalid WONKY_BACKEND (BX_BACKEND). Deliberately not a FeatureScriptError:
// FeatureScript `try` never catches it.
export class NativeKernelError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'NativeKernelError';
    this.code = code;
    Object.assign(this, details);
  }
}

// The cached binary does not match the sources it was built from. Raised
// before the addon is opened; nothing runs.
export class NativeKernelStaleError extends NativeKernelError {
  constructor({ set, changed = [], reason, command, build = `the native kernel build for set '${set}'` }) {
    const list = changed.map(c => `${c.path}${c.now === null ? ' (missing)' : ''}`);
    super('BX_STALE', `${build} is stale: ${reason ?? `${changed.length} input file(s) changed since it was built`}` +
      `${list.length ? ` [${list.join(', ')}]` : ''}; rebuild with: ${command}`, { set, changed: list, command });
    this.name = 'NativeKernelStaleError';
  }
}

// A kernel entry the native build does not contain (or, on WONKY_BACKEND=rust*,
// that the Rust kernel does not serve). It is a missing
// capability like any other: an UnsupportedFeatureError, which FeatureScript
// `try` and `try silent` cannot swallow.
export class NativeCapabilityError extends UnsupportedFeatureError {
  constructor({ entry, label, backend, sourceHash, set }) {
    super(String(backend).startsWith('rust')
      ? `kernel entry ${entry} (kernel.${label}) is not ported to the Rust kernel ${String(sourceHash).slice(0, 12)} (WONKY_BACKEND=${backend})`
      : `kernel entry ${entry} (kernel.${label}) is not in the native build ${String(sourceHash).slice(0, 12)} ` +
        `(set ${set}, WONKY_BACKEND=${backend})`);
    this.name = 'NativeCapabilityError';
    Object.assign(this, { entry, label, backend, sourceHash, set, code: 'BX_UNAVAILABLE' });
  }
}

// WONKY_BACKEND=diff: the native reply and the JS target's re-encoded result
// differ. The request and both replies are dumped for replay.
export class BackendDivergenceError extends Error {
  // target 'rust': WONKY_BACKEND=rust-diff, where nativeWord is the Rust kernel's word.
  constructor({ op, entry, wordIndex, fieldPath, nativeWord, jsWord, dump, target = 'native' }) {
    const [left, right] = target === 'rust' ? ['the Rust kernel', 'the Bend JS target'] : ['native', 'JS target'];
    super(`${left} and ${right} diverge in op ${op} (${entry}) at reply word ${wordIndex} (${fieldPath}): ` +
      `${target} ${nativeWord === undefined ? '<end>' : `0x${nativeWord.toString(16)}`}, js ${jsWord === undefined ? '<end>' : `0x${jsWord.toString(16)}`}` +
      `${dump ? `; dump in ${dump}` : ''}`);
    this.name = 'BackendDivergenceError';
    Object.assign(this, { op, entry, wordIndex, fieldPath, nativeWord, jsWord, dump, target });
  }
}

// Failures of the native backend itself, as opposed to modeling errors: a
// bridge error (NativeKernelError, incl. BX_STALE) or a divergence between the
// native build and the JS target. They end the whole run. A frontend must not
// hand them to user code as a catchable geometry error (src/python.mjs aborts
// the Python process instead; FeatureScript `try` only catches
// FeatureScriptError). They are never raised on WONKY_BACKEND=js.
export const endsRun = error => error instanceof NativeKernelError || error instanceof BackendDivergenceError;
