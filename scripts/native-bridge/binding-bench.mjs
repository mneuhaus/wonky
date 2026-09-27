#!/usr/bin/env node
// In-process binding measurements for docs/native-bridge/binding.md.
// Every mode runs in its own Node process (the Bend runtime is process-global
// and its pool size is fixed at init). The driver (`all`) spawns them one after
// the other and writes out/native-bridge/binding/<mode>.json.
//
// usage: node scripts/native-bridge/binding-bench.mjs all [--quick]
//        node scripts/native-bridge/binding-bench.mjs fails | kernels | soak [N] [THREADS]
//        node scripts/native-bridge/binding-bench.mjs <mode> [args...]   (one child)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { loadavg } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const build = join(root, "tmp/native-bridge/binding/build");
const outDir = join(root, "out/native-bridge/binding");
const require = createRequire(import.meta.url);
const self = fileURLToPath(import.meta.url);
process.env.BEND_NO_TELEMETRY = "1";

const load = () => loadavg().map((x) => Number(x.toFixed(2)));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
const summary = (ts) => {
  const s = [...ts].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const r = (x) => Number(x.toFixed(4));
  return { n: s.length, p50: r(pct(s, 50)), p95: r(pct(s, 95)), p99: r(pct(s, 99)), min: r(s[0]), max: r(s[s.length - 1]), mean: r(mean) };
};
const threadsOf = (pid) => {
  try {
    return execFileSync("ps", ["-M", "-p", String(pid)], { encoding: "utf8" }).trim().split("\n").length - 1;
  } catch {
    return null;
  }
};
const W = (a) => Uint32Array.from(a);
const words = (n, seed = 1) => {
  const a = new Uint32Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    a[i] = x;
  }
  return a;
};
const bytesAsWords = (n) => words(n).map((x) => x & 255);
const sameWords = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const jsSum = (a) => {
  let s = 0;
  for (const x of a) s = (s + x) >>> 0;
  return s;
};
const mix = (x) => ((Math.imul(x, 2654435761) >>> 0) ^ (x >>> 16)) >>> 0;
const spin = (s) => {
  for (let i = 0; i < 256; i += 1) s = mix(s);
  return s;
};
const tree = (n, s) => (n === 0 ? spin(s) : ((tree(n - 1, (s * 2) >>> 0) ^ tree(n - 1, (s * 2 + 1) >>> 0)) + 1) >>> 0);

function open(kind = "cpu") {
  const file = join(build, kind === "metal" ? "probe.metal.node" : "probe.node");
  const t0 = performance.now();
  const b = require(file);
  return { b, loadMs: performance.now() - t0, file };
}

function timeCalls(n, warm, f) {
  for (let i = 0; i < warm; i += 1) f(i);
  const ts = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = performance.now();
    f(i);
    ts[i] = performance.now() - t;
  }
  return ts;
}

const SIZES = [
  { label: "64 B", bytes: 64 },
  { label: "4 KB", bytes: 4096 },
  { label: "100 KB", bytes: 102400 },
  { label: "1 MB", bytes: 1048576 },
];
const samplesFor = (bytes, quick) => (bytes <= 4096 ? (quick ? 1000 : 5000) : bytes <= 102400 ? (quick ? 100 : 300) : quick ? 20 : 50);

// ------------------------------------------------------------------ modes

const modes = {};

modes.latency = (threads = "1", quick = "0") => {
  const q = quick === "1";
  const pid = process.pid;
  const osThreads = { beforeLoad: threadsOf(pid) };
  const { b, loadMs } = open();
  const t0 = performance.now();
  const info = b.init({ threads: Number(threads) });
  const initMs = performance.now() - t0;
  osThreads.afterInit = threadsOf(pid);
  const res = { mode: "latency", threads: Number(threads), loadBefore: load(), loadMs, initMs, info, rows: [] };
  // N-API floor: a call that crosses into the addon and takes the lock but runs no Bend code
  res.napiFloor = summary(timeCalls(q ? 2000 : 10000, 200, () => b.stats()));
  // Bend floor: the smallest request that resumes the parked IO loop
  const empty = new Uint32Array(0);
  res.bendFloor = summary(timeCalls(q ? 2000 : 10000, 200, () => b.run("Echo", empty, "")));
  // direct-call floor: the same echo def evaluated from its FID, no IO loop
  res.callFloor = summary(timeCalls(q ? 2000 : 10000, 200, () => b.call("echo", [empty])));
  for (const packing of ["u32", "byte"]) {
    for (const { label, bytes } of SIZES) {
      const input = packing === "u32" ? words(bytes / 4, bytes) : bytesAsWords(bytes);
      const n = samplesFor(bytes, q);
      const warm = Math.max(3, n >> 5);
      let bad = 0;
      const echo = timeCalls(n, warm, () => {
        const r = b.run("Echo", input, "");
        if (r.words.length !== input.length || r.words[input.length - 1] !== input[input.length - 1]) bad += 1;
      });
      const full = b.run("Echo", input, "").words;
      if (!sameWords(full, input)) bad += 1;
      const call = timeCalls(n, warm, () => {
        const r = b.call("echo", [input]);
        if (r.length !== input.length || r[input.length - 1] !== input[input.length - 1]) bad += 1;
      });
      if (!sameWords(b.call("echo", [input]), input)) bad += 1;
      const want = jsSum(input);
      const sum = timeCalls(n, warm, () => {
        const r = b.run("Sum", input, "");
        if (r.words[0] !== want || r.words[1] !== input.length) bad += 1;
      });
      const e = summary(echo);
      res.rows.push({
        packing, label, bytes, cells: input.length, echo: e, callEcho: summary(call), sum: summary(sum), bad,
        echoMBps: Number((bytes / 1048576 / (e.p50 / 1000)).toFixed(1)),
        load: load(),
      });
    }
  }
  // throughput: tiny echo for ~1.5 s
  {
    const input = words(16);
    let n = 0;
    const t = performance.now();
    while (performance.now() - t < 1500) {
      b.run("Echo", input, "");
      n += 1;
    }
    res.tinyThroughputPerS = Math.round(n / ((performance.now() - t) / 1000));
  }
  // parallel work inside one call: Tree depth d (2^d leaves x 256 mix rounds)
  res.tree = [];
  for (const d of [8, 12, 14, 16]) {
    const want = tree(d, 1);
    const ts = timeCalls(d >= 16 ? 5 : 15, 2, () => {
      const r = b.run("Tree", W([d]), "");
      if (r.words[0] !== want) throw new Error(`Tree ${d}: ${r.words[0]} != ${want}`);
    });
    const tc = timeCalls(d >= 16 ? 5 : 15, 2, () => {
      if (b.call("tree", [d, 1]) !== want) throw new Error(`call tree ${d}`);
    });
    res.tree.push({ depth: d, ...summary(ts), call: summary(tc), load: load() });
  }
  osThreads.afterWork = threadsOf(pid);
  res.osThreads = osThreads;
  res.loadAfter = load();
  return res;
};

modes.memory = (threads = "1") => {
  const { b } = open();
  b.init({ threads: Number(threads) });
  const input = words(1024, 7);
  const want = jsSum(input);
  const trace = [];
  const t0 = performance.now();
  for (let i = 0; i <= 10000; i += 1) {
    if (i % 1000 === 0) {
      trace.push({ call: i, rssMB: Number((process.memoryUsage().rss / 1048576).toFixed(1)), osThreads: threadsOf(process.pid) });
    }
    const r = i % 2 ? b.run("Echo", input, "") : b.run("Sum", input, "");
    if (i % 2 ? r.words[1023] !== input[1023] : r.words[0] !== want) throw new Error(`call ${i} wrong`);
  }
  const ms = performance.now() - t0;
  // big payloads: does the heap hand memory back / reach a plateau?
  const big = words(262144, 9);
  const bigTrace = [];
  for (let i = 0; i <= 60; i += 1) {
    if (i % 10 === 0) bigTrace.push({ call: i, rssMB: Number((process.memoryUsage().rss / 1048576).toFixed(1)) });
    b.run("Echo", big, "");
  }
  return { mode: "memory", threads: Number(threads), calls: 10000, ms, trace, bigTrace, stats: b.stats(), load: load() };
};

modes.residency = () => {
  const { b } = open();
  b.init({ threads: 1 });
  const res = { mode: "residency", load: load(), rows: [] };
  for (const { label, bytes } of SIZES.slice(1)) {
    const input = words(bytes / 4, bytes + 3);
    const want = jsSum(input);
    const n = samplesFor(bytes, false) >> 1;
    // (a) every call ships the list
    const ship = timeCalls(n, 3, () => {
      const r = b.run("Sum", input, "");
      if (r.words[0] !== want) throw new Error("ship");
    });
    // (b) Bend-level residency: Store once, Held folds the list that never leaves the heap
    b.run("Store", input, "");
    const held = timeCalls(n, 3, () => {
      const r = b.run("Held", W([5]), "");
      if (r.words[0] !== want || r.words[1] !== 5) throw new Error("held");
    });
    b.run("Store", new Uint32Array(0), "");
    // (c) C-level residency: a handle to a result term; dup (RFC share) + consume
    const h = b.run("Echo", input, "", true);
    const viaHandle = timeCalls(n, 3, () => {
      const r = b.run("Sum", b.dup(h), "");
      if (r.words[0] !== want) throw new Error("handle");
    });
    const readBack = timeCalls(Math.max(5, n >> 2), 1, () => {
      const r = b.read(h);
      if (r.length !== input.length || r[input.length - 1] !== input[input.length - 1]) throw new Error("read");
    });
    const readOk = sameWords(b.read(h), input);
    b.drop(h);
    res.rows.push({ label, bytes, ship: summary(ship), held: summary(held), handleDupConsume: summary(viaHandle), handleRead: summary(readBack), readOk, load: load() });
  }
  // stale handle behaviour
  const h = b.run("Echo", W([1, 2, 3]), "", true);
  b.run("Sum", h, "");
  try {
    b.run("Sum", h, "");
    res.staleHandle = "accepted (BUG)";
  } catch (e) {
    res.staleHandle = `${e.code}: ${e.message}`;
  }
  res.stats = b.stats();
  return res;
};

modes.workers = (k = "4", m = "2000") => {
  const K = Number(k);
  const M = Number(m);
  const { b } = open();
  b.init({ threads: 1 });
  const input = words(1024, 11);
  // sequential reference on the main thread
  const t0 = performance.now();
  for (let i = 0; i < K * M; i += 1) b.run("Echo", input, "");
  const seqMs = performance.now() - t0;
  return new Promise((done) => {
    const t1 = performance.now();
    let left = K;
    const per = [];
    for (let w = 0; w < K; w += 1) {
      const worker = new Worker(self, { workerData: { role: "worker", M, file: join(build, "probe.node") } });
      worker.on("message", (msg) => {
        per.push(msg);
        left -= 1;
        if (left === 0) {
          const parMs = performance.now() - t1;
          done({ mode: "workers", K, M, load: load(), seqMs, parMs, perWorker: per, stats: b.stats() });
        }
      });
      worker.on("error", (e) => {
        per.push({ error: String(e) });
        left -= 1;
      });
    }
  });
};

function workerMain() {
  const { M, file } = workerData;
  const b = require(file);
  const out = { initAgain: null, bad: 0, die: null };
  try {
    b.init({ threads: 1 });
    out.initAgain = "accepted";
  } catch (e) {
    out.initAgain = `${e.code}: ${e.message}`;
  }
  const input = words(1024, 11);
  const ts = [];
  for (let i = 0; i < M; i += 1) {
    const t = performance.now();
    const r = b.run("Echo", input, "");
    ts.push(performance.now() - t);
    if (r.words[1023] !== input[1023]) out.bad += 1;
  }
  try {
    b.run("Die", W([9]), "from a worker");
  } catch (e) {
    out.die = `${e.code}: ${e.message}`;
  }
  out.lat = summary(ts);
  parentPort.postMessage(out);
}

// F32 exactness: Bits returns per word [x, x+0.0, x*1.0, -x, x*x] as F32 bits
modes.exact = () => {
  const { b } = open();
  b.init({ threads: 1 });
  const cases = {
    "+0": 0x00000000, "-0": 0x80000000, "1": 0x3f800000, "-1.5": 0xbfc00000,
    "min subnormal": 0x00000001, "max subnormal": 0x007fffff, "-min subnormal": 0x80000001,
    "min normal": 0x00800000, "max finite": 0x7f7fffff, "+inf": 0x7f800000, "-inf": 0xff800000,
    "qNaN": 0x7fc00000, "qNaN payload": 0x7fc12345, "sNaN": 0x7f800001, "-qNaN": 0xffc00000,
    "1e30": 0x7149f2ca, "1e-30": 0x0da24260, "2^-75 (x*x -> 0)": 0x1a000000, "1e-20 (x*x subnormal)": 0x1e3ce508,
    "pi": 0x40490fdb, "1/3": 0x3eaaaaab,
  };
  const names = Object.keys(cases);
  const input = W(names.map((k) => cases[k]));
  const got = b.run("Bits", input, "").words;
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  const asF = (x) => ((u[0] = x), f[0]);
  const bitsOf = (v) => ((f[0] = v), u[0]);
  const isNaNBits = (x) => (x & 0x7f800000) === 0x7f800000 && (x & 0x007fffff) !== 0;
  const rows = names.map((name, i) => {
    const x = cases[name];
    const v = asF(x);
    const ref = [x, bitsOf(v + 0), bitsOf(v * 1), bitsOf(-v), bitsOf(Math.fround(v * v))];
    const bend = [...got.slice(i * 5, i * 5 + 5)];
    const labels = ["bits", "x+0", "x*1", "-x", "x*x"];
    const diffs = labels.filter((_, j) => bend[j] !== ref[j]).map((l) => {
      const j = labels.indexOf(l);
      return { op: l, bend: bend[j].toString(16), jsRef: ref[j].toString(16), bothNaN: isNaNBits(bend[j]) && isNaNBits(ref[j]) };
    });
    return { name, in: x.toString(16), bend: bend.map((y) => y.toString(16)), diffs };
  });
  // F32x2 pairs (Real{hi, lo}) cross as two raw words: Echo must return them untouched
  const pairs = words(4096, 5);
  for (let i = 0; i < pairs.length; i += 64) pairs[i] = [0x80000000, 0x7fc12345, 0x00000001, 0xff800000][(i >> 6) & 3];
  const echoed = b.run("Echo", pairs, "").words;
  return {
    mode: "exact", load: load(), rows,
    arithmeticMismatches: rows.flatMap((r) => r.diffs.filter((d) => !d.bothNaN).map((d) => ({ name: r.name, ...d }))),
    nanDiffs: rows.flatMap((r) => r.diffs.filter((d) => d.bothNaN).map((d) => ({ name: r.name, ...d }))),
    pairsExact: sameWords(echoed, pairs),
  };
};

// failure cases, each in its own child process (see `fail` in the driver)
const failCases = {
  die: (b) => [tryRun(b, "Die", [3], "kernel said no"), tryRun(b, "Sum", [1, 2]), b.stats()],
  natOverflow: (b) => [tryRun(b, "Big", [20000000]), tryRun(b, "Sum", [1, 2]), { resetMs: b.reset() }, tryRun(b, "Sum", [1, 2])],
  opOutOfRange: (b) => [tryRun(b, 99, [1, 2])],
  opOutOfRangeRaw: (b) => [tryRun(b, 99, [1, 2], "ran op 99")],
  deepStack: (b) => {
    const t = performance.now();
    const r = tryRun(b, "Deep", [4000000000]);
    r.ms = Number((performance.now() - t).toFixed(1));
    r.rssMB = Math.round(process.memoryUsage().rss / 1048576);
    return [r, wasmTrap("after deep"), { resetMs: b.reset() }, tryRun(b, "Sum", [5])];
  },
  wasmTrap: (b) => [wasmTrap("after init"), tryRun(b, "Sum", [1, 2]), wasmTrap("after run")],
  wasmTrapNoChain: (b) => [wasmTrap("after init (stock sigaction)"), tryRun(b, "Sum", [1, 2])],
  failstopOnPool: (b) => [tryRun(b, "Big", [20000000]), { resetMs: b.reset() }, tryRun(b, "Tree", [12]), { want: tree(12, 1) }],
  failstopInFork1: (b) => [tryRun(b, "Boom", [6]), { resetMs: b.reset() }, tryRun(b, "Sum", [1, 2])],
  failstopInFork8: (b) => [tryRun(b, "Boom", [6]), { resetMs: b.reset() }, tryRun(b, "Sum", [1, 2])],
  metalOom: (b) => {
    const out = [];
    for (const n of [1000000, 10000000]) {
      const t = performance.now();
      const r = tryRun(b, "Grow", [n]);
      r.ms = Number((performance.now() - t).toFixed(1));
      out.push(r);
      if (r.error) break;
    }
    const t = performance.now();
    out.push({ resetMs: Number(b.reset().toFixed(2)), wallMs: Number((performance.now() - t).toFixed(2)) });
    out.push(tryRun(b, "Grow", [1000]), tryRun(b, "Par", [10]));
    return out;
  },
  metalInitTooSmall: null,
  // the direct-call path: same fail-stop plumbing, plus argument validation
  callDeepStack: (b) => [tryCall(b, "deep", [4000000000]), { resetMs: b.reset() }, tryCall(b, "echo", [W([1, 2])])],
  callArgs: (b) => {
    const h = b.call("echo", [W([1, 2, 3])], true);
    return [
      tryCall(b, "nosuch", []), tryCall(b, "tree", [12]), tryCall(b, "tree", ["12", 1]), tryCall(b, "deep", [-1]),
      tryCall(b, "deep", [2 ** 48]), tryCall(b, "tree", [{ handle: 1 }, 1]), tryCall(b, "echo", [[1, 2]]),
      tryCall(b, "echo", [h]), tryCall(b, "echo", [h]), b.stats(),
    ];
  },
  callFailstopInFork8: (b) => [tryCall(b, "boom", [6, 20000000]), { resetMs: b.reset() }, tryCall(b, "echo", [W([1])])],
};
function tryCall(b, name, args) {
  try {
    const r = b.call(name, args);
    return { call: name, ok: r instanceof Uint32Array ? [...r] : r };
  } catch (e) {
    return { call: name, error: e.code, message: e.message };
  }
}
function tryRun(b, op, xs, text = "") {
  try {
    const r = b.run(op, W(xs), text);
    return { op, ok: [...r.words], text: r.text };
  } catch (e) {
    return { op, error: e.code, message: e.message, exitCode: e.exitCode };
  }
}
const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 7, 1, 3, 111, 111, 98, 0, 0, 10, 13, 1, 11, 0, 65, 255, 255, 255, 255, 7, 40, 2, 0, 11]);
function wasmTrap(tag) {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes));
  try {
    inst.exports.oob();
    return { wasm: tag, trapped: false };
  } catch (e) {
    return { wasm: tag, trapped: true, error: `${e.constructor.name}: ${e.message}` };
  }
}

modes.fail = (name) => {
  const metal = name.startsWith("metal");
  const { b } = open(metal ? "metal" : "cpu");
  const pre = wasmTrap("before init");
  let info;
  try {
    info = b.init(
      name === "metalOom" ? { threads: 1, gpu: true, gpuMB: 512 }
        : name === "metalInitTooSmall" ? { threads: 1, gpu: true, gpuMB: 64 }
          : { threads: ["failstopOnPool", "failstopInFork8", "callFailstopInFork8"].includes(name) ? 8 : 1 },
    );
  } catch (e) {
    return { case: name, pre, init: { error: e.code, message: e.message } };
  }
  return { case: name, pre, info, steps: failCases[name](b) };
};

modes.metal = (quick = "0") => {
  const q = quick === "1";
  const { b, loadMs } = open("metal");
  const t0 = performance.now();
  const info = b.init({ threads: 1, gpu: true });
  const initMs = performance.now() - t0;
  const res = { mode: "metal", loadBefore: load(), loadMs, initMs, info, rows: [] };
  res.cpuFloor = summary(timeCalls(q ? 500 : 2000, 50, () => b.run("Echo", new Uint32Array(0), "")));
  for (const d of [0, 4, 8, 12, 16, 18]) {
    const want = tree(d, 1);
    const n = d <= 12 ? (q ? 50 : 200) : d === 16 ? 20 : 6;
    const par = timeCalls(n, 3, () => {
      const r = b.run("Par", W([d]), "");
      if (r.words[0] !== want) throw new Error(`Par ${d}`);
    });
    const cpu = timeCalls(d >= 16 ? 3 : Math.min(n, 50), 1, () => {
      const r = b.run("Tree", W([d]), "");
      if (r.words[0] !== want) throw new Error(`Tree ${d}`);
    });
    const parCall = timeCalls(n, 3, () => {
      if (b.call("par", [d]) !== want) throw new Error(`call par ${d}`);
    });
    res.rows.push({ depth: d, gpu: summary(par), gpuCall: summary(parCall), cpu1: summary(cpu), load: load() });
  }
  res.loadAfter = load();
  return res;
};

// Real kernel entry (scripts/native-bridge/binding-kernel.mjs): the captured
// production planarBoolean calls of the build123d planar cases, native in-process
// vs the Bend JS target in the same Node process, bit-compared word for word.
const kgen = join(root, "tmp/native-bridge/binding/kgen");
modes.kernel = async (threads = "1", jsSamples = "2", natSamples = "5") => {
  const T = Number(threads);
  const res = { mode: "kernel", threads: T, loadBefore: load(), cases: [] };
  const { ops, codecs } = await import(join(kgen, "wire.mjs"));
  const { loadKernel, array } = await import(join(root, "src/kernel.mjs"));
  const { isDeepStrictEqual } = await import("node:util");
  const { readFileSync } = await import("node:fs");
  const captured = JSON.parse(readFileSync(join(root, "out/performance/native-build123d/captured.json"), "utf8"));
  let t = performance.now();
  const b = require(join(kgen, "kernel.node"));
  res.addonLoadMs = performance.now() - t;
  t = performance.now();
  res.info = b.init({ threads: T });
  res.initMs = performance.now() - t;
  t = performance.now();
  const k = Number(jsSamples) > 0 ? await loadKernel() : null;
  res.jsKernelLoadMs = k ? performance.now() - t : null;
  const Result = codecs["ports/planar-boolean-types.bend:Result"];
  const opId = { union: 0, subtract: 1 };
  const rss = () => Number((process.memoryUsage().rss / 1048576).toFixed(1));
  for (const c of captured.cases) {
    for (const [ci, call] of c.calls.entries()) {
      const id = opId[call.operation];
      const row = { case: c.id, call: ci, operation: call.operation };
      t = performance.now();
      const words = ops[id].encode(call.args);
      row.encodeMs = performance.now() - t;
      row.inWords = words.length;
      // first native call (cold for this op in this process), then warm samples
      t = performance.now();
      const first = b.call("kcall", [id, words]);
      row.nativeFirstMs = performance.now() - t;
      const nat = timeCalls(Number(natSamples), 0, () => b.call("kcall", [id, words]));
      row.native = summary(nat);
      const again = b.call("kcall", [id, words]);
      row.repeatIdentical = sameWords(first, again);
      const viaRun = b.run(call.operation === "union" ? "Union" : "Subtract", words, "").words;
      row.bridgeIdentical = sameWords(first, viaRun);
      row.outWords = first.length;
      row.status = first[0];
      t = performance.now();
      const decoded = ops[id].decode(first);
      row.decodeMs = performance.now() - t;
      row.rssMB = rss();
      // every thread count: against the captured production result (the t=1 run
      // additionally checks that the live JS target still produces exactly that)
      const cap = Result.encode(call.result);
      row.bitExactVsCaptured = first.length === cap.length + 1 && first[0] === 0 && cap.every((w, j) => w === first[j + 1]);
      if (k) {
        t = performance.now();
        const js = k.planarBoolean[call.operation](...call.args);
        row.jsFirstMs = performance.now() - t;
        const jsTimes = timeCalls(Number(jsSamples), 0, () => k.planarBoolean[call.operation](...call.args));
        row.js = jsTimes.length ? summary(jsTimes) : null;
        const want = Result.encode(js);
        row.bitExact = first.length === want.length + 1 && first[0] === 0 && want.every((w, j) => w === first[j + 1]);
        row.decodedEqualsJs = isDeepStrictEqual(decoded, js);
        row.jsEqualsCaptured = isDeepStrictEqual(js, call.result);
        const bodies = js.$ === "Bodies" ? array(js.bodies) : [];
        row.bodies = bodies.length;
        row.faces = bodies.map((body) => array(body.solid.faces).length);
      }
      row.load = load();
      res.cases.push(row);
    }
  }
  // native-resident chain (frame-with-tab): subtract's Result never leaves the
  // Bend heap; its single body feeds union directly. Reference: the JS target
  // running the same chain on its own objects (no host B-rep roundtrip).
  const fw = captured.cases.find((c) => c.id === "frame-with-tab");
  const [c0, c1] = fw.calls;
  const cat = (...xs) => {
    const o = new Uint32Array(xs.reduce((a, x) => a + x.length, 0));
    let i = 0;
    for (const x of xs) {
      o.set(x, i);
      i += x.length;
    }
    return o;
  };
  const keepWords = cat(W([1]), ops[1].encode(c0.args));
  const rest4 = cat(W([0]), codecs["analytic.bend:Solid"].encode(c1.args[3]), codecs["List<face-classification.bend:DomainChoice>"].encode(c1.args[4]),
    codecs["real.bend:Real"].encode(c1.args[5]), codecs["intersections.bend:Tolerance"].encode(c1.args[6]));
  const chain = { samples: [] };
  let out;
  for (let i = 0; i < Math.max(2, Number(natSamples) >> 1); i += 1) {
    const s = {};
    t = performance.now();
    const h0 = b.call("keep_words", [keepWords]);
    s.keepMs = performance.now() - t;
    t = performance.now();
    const h1 = b.call("chain_words", [h0, rest4]);
    s.chainMs = performance.now() - t;
    t = performance.now();
    out = b.call("enc_held", [h1]);
    s.readMs = performance.now() - t;
    // the same two steps with the intermediate crossing to JS and back
    t = performance.now();
    const w0 = b.call("kcall", [1, ops[1].encode(c0.args)]);
    const r0 = ops[1].decode(w0);
    const body = array(r0.bodies)[0];
    const w1 = b.call("kcall", [0, ops[0].encode([body.solid, body.domains, r0.source_budget, ...c1.args.slice(3)])]);
    s.viaJsMs = performance.now() - t;
    s.viaJsIdentical = sameWords(w1, out);
    chain.samples.push(s);
  }
  chain.outWords = out.length;
  chain.status = out[0];
  if (k) {
    const r0 = k.planarBoolean.subtract(...c0.args);
    const body = array(r0.bodies)[0];
    const r1 = k.planarBoolean.union(body.solid, body.domains, r0.source_budget, ...c1.args.slice(3));
    const want = Result.encode(r1);
    chain.bitExactVsJsChain = out.length === want.length + 1 && out[0] === 0 && want.every((w, j) => w === out[j + 1]);
    chain.jsChainEqualsCapturedCall1 = isDeepStrictEqual(r1, c1.result);
  }
  {
    const want = Result.encode(c1.result);
    chain.bitExactVsCapturedCall1 = out.length === want.length + 1 && out[0] === 0 && want.every((w, j) => w === out[j + 1]);
  }
  chain.badStatuses = {
    malformed: [...b.call("enc_held", [b.call("keep_words", [W([1, 2, 3])])])],
    unknownOp: [...b.call("enc_held", [b.call("keep_words", [cat(W([7]), ops[1].encode(c0.args))])])],
    chainAfterFailedKeep: [...b.call("enc_held", [b.call("chain_words", [b.call("keep_words", [W([])]), rest4])])],
  };
  res.chain = chain;
  // stability: repeated planar-union calls, RSS and identical words
  const u = captured.cases[0].calls[0];
  const uw = ops[0].encode(u.args);
  const ref = b.call("kcall", [0, uw]);
  const trace = [];
  let same = true;
  for (let i = 1; i <= 40; i += 1) {
    same &&= sameWords(b.call("kcall", [0, uw]), ref);
    if (i % 5 === 0) trace.push({ call: i, rssMB: rss() });
  }
  res.repeat = { calls: 40, identical: same, trace };
  res.stats = b.stats();
  res.cpuUserMs = Math.round(process.cpuUsage().user / 1000);
  res.loadAfter = load();
  return res;
};

// long-run stability of one warm runtime: N planar-union calls, RSS trace,
// identical words, then reset() and RSS again
modes.kernelsoak = async (n = "300", threads = "1") => {
  const { ops } = await import(join(kgen, "wire.mjs"));
  const { readFileSync } = await import("node:fs");
  const captured = JSON.parse(readFileSync(join(root, "out/performance/native-build123d/captured.json"), "utf8"));
  const b = require(join(kgen, "kernel.node"));
  b.init({ threads: Number(threads) });
  const words = ops[0].encode(captured.cases[0].calls[0].args);
  const rss = () => Number((process.memoryUsage().rss / 1048576).toFixed(1));
  const ref = b.call("kcall", [0, words]);
  const trace = [{ call: 1, rssMB: rss() }];
  let identical = true;
  const t0 = performance.now();
  for (let i = 2; i <= Number(n); i += 1) {
    identical &&= sameWords(b.call("kcall", [0, words]), ref);
    if (i % 25 === 0) {
      globalThis.gc?.();  // with --expose-gc: separate JS garbage (result ArrayBuffers) from Bend heap growth
      trace.push({ call: i, rssMB: rss(), load: load() });
    }
  }
  const ms = performance.now() - t0;
  const resetMs = b.reset();
  const afterReset = rss();
  identical &&= sameWords(b.call("kcall", [0, words]), ref);
  return { mode: "kernelsoak", n: Number(n), threads: Number(threads), ms, identical, trace, resetMs, rssAfterResetMB: afterReset, rssAfterNextCallMB: rss(), stats: b.stats(), load: load() };
};

// ------------------------------------------------------------------ driver

async function child(mode, args) {
  if (!(mode in modes)) throw new Error(`unknown mode ${mode}`);
  const res = await modes[mode](...args);
  process.stdout.write(`\n@@RESULT@@${JSON.stringify(res)}\n`);
}

function spawnMode(mode, args, env = {}) {
  const t = performance.now();
  const r = spawnSync(process.execPath, [self, mode, ...args], {
    encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 << 20, timeout: 600000,
  });
  const marker = r.stdout.lastIndexOf("@@RESULT@@");
  const result = marker >= 0 ? JSON.parse(r.stdout.slice(marker + 10)) : null;
  return {
    mode, args, env, status: r.status, signal: r.signal, wallMs: Math.round(performance.now() - t),
    stderr: r.stderr.slice(-2000), stdoutTail: marker >= 0 ? r.stdout.slice(0, marker).slice(-1000) : r.stdout.slice(-2000), result,
  };
}

async function driver(quick) {
  mkdirSync(outDir, { recursive: true });
  const q = quick ? "1" : "0";
  const save = (name, data) => writeFileSync(join(outDir, `${name}.json`), JSON.stringify(data, null, 2));
  const log = (name, r) => console.log(name, `status=${r.status}`, `signal=${r.signal}`, `wall=${r.wallMs}ms`, `load=${load().join(",")}`);
  for (const t of ["1", "6", "18"]) {
    const r = spawnMode("latency", [t, q]);
    save(`latency-t${t}`, r);
    log(`latency t=${t}`, r);
  }
  for (const [name, args] of [["memory", ["1"]], ["residency", []], ["workers", ["4", quick ? "500" : "2000"]], ["exact", []], ["metal", [q]]]) {
    const r = spawnMode(name, args);
    save(name, r);
    log(name, r);
  }
  runFails();
  runKernel();
}

function runKernel() {
  mkdirSync(outDir, { recursive: true });
  for (const [t, js, nat] of [["1", "2", "5"], ["6", "0", "5"], ["18", "0", "3"]]) {
    const r = spawnMode("kernel", [t, js, nat]);
    writeFileSync(join(outDir, `kernel-t${t}.json`), JSON.stringify(r, null, 2));
    console.log(`kernel t=${t}`, `status=${r.status}`, `signal=${r.signal}`, `wall=${r.wallMs}ms`, `load=${load().join(",")}`);
  }
}

// every failure case in its own child; a case that kills its process is data, not an error
function runFails() {
  mkdirSync(outDir, { recursive: true });
  const fails = {};
  for (const c of Object.keys(failCases)) {
    const env = c === "wasmTrapNoChain" ? { BX_NO_CHAIN: "1" } : c === "opOutOfRangeRaw" ? { BX_RAW_OP: "1" } : {};
    fails[c] = spawnMode("fail", [c], env);
    console.log(`fail ${c}`, `status=${fails[c].status}`, `signal=${fails[c].signal}`, `wall=${fails[c].wallMs}ms`, `load=${load().join(",")}`);
  }
  writeFileSync(join(outDir, "fail.json"), JSON.stringify(fails, null, 2));
}

if (!isMainThread && workerData?.role === "worker") {
  workerMain();
} else {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "all") {
    await driver(args.includes("--quick"));
  } else if (mode === "fails") {
    runFails();
  } else if (mode === "kernels") {
    runKernel();
  } else if (mode === "soak") {
    const r = spawnMode("kernelsoak", args);
    writeFileSync(join(outDir, "kernel-soak.json"), JSON.stringify(r, null, 2));
    console.log("kernel soak", `status=${r.status}`, `wall=${r.wallMs}ms`, `load=${load().join(",")}`);
  } else {
    await child(mode, args);
  }
}
