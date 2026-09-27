import { before, test } from "node:test";
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("native-bridge-binding.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFileSync } = await import("node:child_process");
const { existsSync, readdirSync, readFileSync, statSync } = await import("node:fs");
const { createRequire } = await import("node:module");
const { dirname, join, resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");
// In-process binding (docs/native-bridge/binding.md): Bend-emitted C loaded
// into this Node process as an N-API addon. One runtime per process, so every
// test here shares the probe runtime initialised in `before`.








const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const probeNode = join(root, "tmp/native-bridge/binding/build/probe.node");
const kgen = join(root, "tmp/native-bridge/binding/kgen");
const PROBE_CALLS = ["echo", "bits", "mix", "tree", "deep", "boom", "par"];

const newer = (target, sources) => existsSync(target) && sources.every((s) => statSync(s).mtimeMs <= statSync(target).mtimeMs);
const script = (name, args) => execFileSync(process.execPath, [join(root, "scripts/native-bridge", name), ...args], { stdio: ["ignore", "ignore", "inherit"] });

let b;
before(() => {
  const sources = ["kernel/service/binding/probe.bend", "kernel/service/binding/bridge.c", "src/native/binding/bx_addon.c", "src/native/binding/bx_pre.h", "scripts/native-bridge/binding-build.mjs"].map((f) => join(root, f));
  if (!newer(probeNode, sources)) {
    script("binding-build.mjs", [join(root, "kernel/service/binding/probe.bend"), ...PROBE_CALLS.flatMap((c) => ["--call", c])]);
  }
  b = require(probeNode);
  b.init({ threads: 2 });
});

const W = (xs) => Uint32Array.from(xs);

test("bridge run and direct call return the same exact words", () => {
  const xs = W([0, 1, 0x7fffffff, 0x80000000, 0xffffffff]);
  assert.deepEqual([...b.run("Echo", xs, "hi").words], [...xs]);
  assert.equal(b.run("Text", W([]), "grüße").text, "grüße|ok");
  assert.deepEqual([...b.call("echo", [xs])], [...xs]);
  assert.deepEqual([...b.call("mix", [xs])], [...b.run("Mix", xs, "").words]);
});

test("F32 crosses as its bit pattern: -0, subnormals, infinities, NaN payloads", () => {
  const cases = [0x80000000, 0x00000001, 0x007fffff, 0x7f7fffff, 0x7f800000, 0xff800000, 0x7fc12345];
  const got = b.call("bits", [W(cases)]);
  cases.forEach((x, i) => assert.equal(got[i * 5], x, `bits(${x.toString(16)})`));
  assert.equal(got[1 * 5 + 1], 0x00000001, "subnormal + 0.0 stays subnormal (no flush to zero)");
  assert.equal(got[0 * 5 + 3], 0x00000000, "-(-0) is +0");
});

test("fork-join work in a call matches the JS reference", () => {
  const mix = (x) => ((Math.imul(x, 2654435761) >>> 0) ^ (x >>> 16)) >>> 0;
  const spin = (s) => { for (let i = 0; i < 256; i += 1) s = mix(s); return s; };
  const tree = (n, s) => (n === 0 ? spin(s) : ((tree(n - 1, (s * 2) >>> 0) ^ tree(n - 1, (s * 2 + 1) >>> 0)) + 1) >>> 0);
  assert.equal(b.call("tree", [10, 1]), tree(10, 1));
  assert.equal(b.run("Tree", W([10]), "").words[0], tree(10, 1));
});

test("resident handles: a result stays in the Bend heap and is consumed once", () => {
  const h = b.call("echo", [W([4, 5, 6])], true);
  assert.deepEqual([...b.read(h)], [4, 5, 6]);
  const h2 = b.dup(h);
  assert.deepEqual([...b.call("echo", [h])], [4, 5, 6]);
  assert.throws(() => b.call("echo", [h]), { code: "BX_HANDLE" });
  assert.deepEqual([...b.call("echo", [h2])], [4, 5, 6]);
  b.run("Store", W([1, 2, 3]), "");
  assert.deepEqual([...b.run("Held", W([9]), "").words], [6, 9]);
});

test("errors: IO.die is an exception, a fail-stop poisons until reset, bad arguments are rejected", () => {
  assert.throws(() => b.run("Die", W([3]), "kernel said no"), (e) => e.code === "BX_DIE" && e.exitCode === 3 && /kernel said no/.test(e.message));
  assert.deepEqual([...b.run("Sum", W([1, 2]), "").words], [3, 2]);
  assert.throws(() => b.run("Big", W([20000000]), ""), { code: "BX_FAILSTOP", message: /Nat past the largest immediate/ });
  assert.throws(() => b.call("echo", [W([1])]), { code: "BX_POISONED" });
  b.reset();
  assert.deepEqual([...b.call("echo", [W([1])])], [1]);
  assert.throws(() => b.run(99, W([]), ""), { code: "BX_ARGS" });
  assert.throws(() => b.call("deep", [-1]), { code: "BX_ARGS" });
  assert.throws(() => b.call("nosuch", []), { code: "BX_ARGS" });
  assert.throws(() => b.init({ threads: 1 }), { code: "BX_ONCE" });
});

test("V8's own SIGSEGV handling survives the runtime (WebAssembly bounds trap)", () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 7, 1, 3, 111, 111, 98, 0, 0, 10, 13, 1, 11, 0, 65, 255, 255, 255, 255, 7, 40, 2, 0, 11]);
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes));
  assert.throws(() => inst.exports.oob(), WebAssembly.RuntimeError);
});

test("real kernel: captured planar-union call is bit-exact with the captured JS-target result", { timeout: 600000 }, async () => {
  const kernelNode = join(kgen, "kernel.node");
  const bendIn = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".bend")).map((f) => join(root, dir, f));
  const kernelSources = [...bendIn("kernel"), ...bendIn("kernel/ports"), ...["scripts/native-bridge/binding-kernel.mjs", "scripts/native-bridge/gen-wire.mjs",
    "scripts/native-bridge/binding-build.mjs", "src/native/binding/bx_addon.c", "src/native/binding/bx_pre.h", "kernel/service/binding/bridge.c"].map((f) => join(root, f))];
  if (!newer(kernelNode, kernelSources)) {
    script("binding-kernel.mjs", []);
  }
  // a second addon is a second, independent runtime (its own statics)
  const k = require(kernelNode);
  k.init({ threads: 1 });
  const { ops, codecs } = await import(join(kgen, "wire.mjs"));
  const captured = JSON.parse(readFileSync(join(root, "fixtures/native-bridge/captured-planar-union.json"), "utf8"));
  const call = captured.cases.find((c) => c.id === "planar-union").calls[0];
  const out = k.call("kcall", [0, ops[0].encode(call.args)]);
  const want = codecs["ports/planar-boolean-types.bend:Result"].encode(call.result);
  assert.equal(out[0], 0);
  assert.deepEqual([...out.subarray(1)], [...want]);
  assert.deepEqual(ops[0].decode(out), call.result);
});

}
