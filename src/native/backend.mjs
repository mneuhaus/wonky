// Kernel backend selection (docs/native-bridge.md section 5.2). The backend is
// chosen explicitly by WONKY_BACKEND and never switched silently:
//   unset | js  the Bend JS target (loadJsKernel(), today's path)
//   native      the ARM64 addon; the Bend JS kernel is never loaded
//   diff        both, every native call compared word for word with the JS target
//   rust        the Rust kernel addon, wire v2 (binary64); nothing Bend is loaded
//   rust-diff   unavailable until B1 ports entries (implementation retained)
//   rust-mixed  unavailable until B1 provides per-build provenance
//               (the rust* backends: src/native/rust-kernel.mjs)
// Any other value is an error. Importing this module has no side effects; the
// native, diff and rust* backends are imported only when selected.
import { NativeKernelError } from './errors.mjs';

export const BACKENDS = Object.freeze(['js', 'native', 'diff', 'rust', 'rust-diff', 'rust-mixed']);
export const RUST_BACKENDS = Object.freeze(['rust', 'rust-diff', 'rust-mixed']);
// Backends that never load the Bend JS kernel.
export const withoutBend = backend => backend === 'native' || backend === 'rust';
const blocks = new WeakMap();
// Keep the selected mode on the kernel object, not the process environment:
// different backends can be opened in the same process.
const strictRustKernels = new WeakSet();
export const isStrictRustKernel = kernel => strictRustKernels.has(kernel);

export function selectBackend(value = process.env.WONKY_BACKEND) {
  if (value === undefined) return 'js';
  if (!BACKENDS.includes(value)) throw new NativeKernelError('BX_BACKEND', `WONKY_BACKEND must be one of ${BACKENDS.join(', ')} (got '${value}')`);
  // B1: these modes cannot claim Rust execution until the first entries are ported.
  if (value === 'rust-diff' || value === 'rust-mixed') throw new NativeKernelError('BX_BACKEND', `WONKY_BACKEND=${value} is not available until package B1 ports the first entries`);
  return value;
}

export async function openKernel(mode = process.env.WONKY_BACKEND) {
  const backend = selectBackend(mode);
  if (backend === 'js') return (await import('../kernel.mjs')).loadJsKernel();
  if (RUST_BACKENDS.includes(backend)) {
    const rust = await import('./rust-kernel.mjs');
    const open = { rust: rust.openRustKernel, 'rust-diff': rust.openRustDiffKernel, 'rust-mixed': rust.openRustMixedKernel }[backend];
    const { kernel, backend: selected } = await open();
    if (backend === 'rust') strictRustKernels.add(kernel);
    const { target, sourceHash, wireHash, threads, mixed, mixedExecution } = selected.info;
    blocks.set(kernel, { target, sourceHash, wireHash, wire: backend === 'rust' ? 2 : 1, ...(backend === 'rust' ? { hostWire: 3 } : {}), threads, ...(mixed ? { mixed } : {}), ...(mixedExecution ? { mixedExecution } : {}) });
    return kernel;
  }
  const { kernel, backend: selected } = backend === 'native'
    ? await (await import('./native-kernel.mjs')).openNativeKernel()
    : await (await import('./diff-kernel.mjs')).openDiffKernel();
  const { target, sourceHash, wireHash, threads } = selected.info;
  blocks.set(kernel, { target, sourceHash, wireHash, threads });
  return kernel;
}

// The two STEP pcurve modules src/exporters.mjs loads at import time. On
// native and diff an entry the build serves as an export-scope op
// (step-cylinder-pcurves for_cylinders_domains and max_budget since the R20
// gate) runs through the kernel loadKernel() opened; every other entry refuses
// when called. Nothing Bend-JS is loaded. On the rust* backends every entry
// resolves when called through the kernel loadKernel() opened (rust-kernel.mjs).
export async function exportKernels(mode = process.env.WONKY_BACKEND) {
  const backend = selectBackend(mode);
  if (backend === 'js') {
    const [{ loadStepPCurves }, { loadStepCylinderPCurves }] = await Promise.all([import('../step-pcurves.mjs'), import('../step-cylinder-pcurves.mjs')]);
    return Promise.all([loadStepPCurves(), loadStepCylinderPCurves()]);
  }
  if (RUST_BACKENDS.includes(backend)) {
    // Resolved when called, through the kernel loadKernel() opened.
    const { rustExportNamespace } = await import('./rust-kernel.mjs');
    return [rustExportNamespace({ file: 'kernel/step-pcurves.bend', namespace: 'stepPCurves', backend }),
      rustExportNamespace({ file: 'kernel/step-cylinder-pcurves.bend', namespace: 'stepCylinderPCurves', backend })];
  }
  const { locateBuild, exportNamespace } = await import('./native-kernel.mjs');
  // Only names the build in the refusal text; loadKernel() opens (and checks) it.
  let build = {};
  try { build = locateBuild().manifest; } catch { /* reported by loadKernel() */ }
  const served = (file, namespace) => exportNamespace({ file, namespace, backend, sourceHash: build.sourceHash ?? '(no build)', set: build.set ?? 'planar' });
  return [served('kernel/step-pcurves.bend', 'stepPCurves'), served('kernel/step-cylinder-pcurves.bend', 'stepCylinderPCurves')];
}

// The brep.json backend block fields that depend on the backend. The JS
// target keeps exactly today's { target: 'JavaScript' }.
export function backendInfo(kernel) {
  const block = blocks.get(kernel);
  if (!block) return { target: 'JavaScript' };
  const { mixedExecution, ...metadata } = block;
  return mixedExecution ? { ...metadata, mixedExecution: mixedExecution() } : metadata;
}
