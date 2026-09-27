#!/usr/bin/env node
// Builds a Bend service module into a Node addon (.node) that runs the Bend
// runtime in-process. Nothing generated here is hand-edited:
//   1. bend <entry.bend> -o <out>/<name>.c        (stock Bend 2.0.25 emitter)
//   2. <out>/<name>_ops.h                         (Op arm table for the IO bridge, and the BX_CALLS
//                                                  table of directly callable defs: FID + parameter kinds)
//   3. <out>/<name>_addon.c                       (#include bx_pre.h, <name>.c, <name>_ops.h, bx_addon.c)
//   4. clang ... -bundle -undefined dynamic_lookup -> <out>/<name>[.metal].node
//
// usage: node scripts/native-bridge/binding-build.mjs <entry.bend> [--out DIR] [--metal] [--name NAME]
//          [--skip-bend] [--call DEF]...
// Two call paths, either or both:
//   * IO bridge: the entry defines `type Op is Data:` (nullary arms), Req, Reply
//     and a main that serves Bridge.next/Bridge.reply (kernel/service/binding/probe.bend).
//   * direct calls: every --call DEF names a top-level def of the entry file whose
//     parameters/result are U32, F32, Nat, List<U32|F32> or any other List (resident
//     handles only; other Data types are unboxed by Bend into several words). The def must keep its own FID in the emitted C (a def that
//     Bend inlines or turns into a loop has none): the build fails loudly otherwise.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bend = join(root, ".tools/bend-2.0.25/bin/bend");
const nodeInclude = process.env.NODE_API_INCLUDE
  ?? join(process.env.HOME, "Library/Caches/node-gyp", process.versions.node, "include/node");
if (!existsSync(join(nodeInclude, "node_api.h"))) {
  throw new Error(`node_api.h not found under ${nodeInclude}; set NODE_API_INCLUDE`);
}

const args = process.argv.slice(2);
const KNOWN = new Set(["--out", "--name", "--call", "--metal", "--skip-bend"]);
for (const [i, a] of args.entries()) {
  if (a.startsWith("--") && !KNOWN.has(a) && !["--out", "--name", "--call"].includes(args[i - 1])) {
    throw new Error(`unknown option '${a}' (known: ${[...KNOWN].join(", ")})`);
  }
}
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const entry = resolve(args.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--name", "--call"].includes(args[i - 1]))) ?? "");
if (!existsSync(entry) || !entry.endsWith(".bend")) {
  console.error("usage: binding-build.mjs <entry.bend> [--out DIR] [--metal] [--name NAME] [--skip-bend]");
  process.exit(2);
}
const name = opt("--name", basename(entry, ".bend"));
const out = resolve(opt("--out", join(root, "tmp/native-bridge/binding/build")));
const metal = flag("--metal");
const callNames = args.flatMap((a, i) => (a === "--call" ? [args[i + 1]] : []));
mkdirSync(out, { recursive: true });

const env = { ...process.env, BEND_NO_TELEMETRY: "1" };
const cFile = join(out, `${name}.c`);
const t0 = performance.now();
if (!flag("--skip-bend") || !existsSync(cFile)) {
  execFileSync(bend, [entry, "-o", cFile], { env, stdio: ["ignore", "inherit", "inherit"] });
}
const tBend = performance.now() - t0;
const emitted = readFileSync(cFile, "utf8");

const src = readFileSync(entry, "utf8").split("\n");
const cids = new Map();
for (const m of emitted.matchAll(/^#define ((?:CID|FID)_[A-Z0-9_]+) (\d+)$/gm)) {
  cids.set(m[1], Number(m[2]));
}
const hasBridge = cids.has("CID_BRIDGE_NEXT");
// Op arms: the constructors of `type Op is Data:` in the entry, in order.
const arms = [];
if (hasBridge) {
  const start = src.findIndex((l) => /^type\s+Op\s+is\s+Data\s*:/.test(l));
  if (start < 0) {
    throw new Error(`${entry}: Bridge.next without a 'type Op is Data:' block`);
  }
  for (let i = start + 1; i < src.length && /^\s+\S/.test(src[i]); i += 1) {
    const m = src[i].match(/^\s+([A-Z][A-Za-z0-9_]*)\s*\{\s*\}/);
    if (!m) {
      throw new Error(`${entry}:${i + 1}: Op arms must be nullary, got '${src[i].trim()}'`);
    }
    arms.push(m[1]);
  }
  for (const needed of ["CID_REQ", "CID_REPLY", "CID_BRIDGE_NEXT", "CID_BRIDGE_REPLY"]) {
    if (!cids.has(needed)) {
      throw new Error(`${cFile}: ${needed} missing; the entry must define Req, Reply, Bridge.next and Bridge.reply`);
    }
  }
}
if (!hasBridge && callNames.length === 0) {
  throw new Error(`${entry}: neither a Bridge.next loop nor any --call DEF: nothing to bind`);
}
// Bend 2.0.25 lowers an all-nullary Data type to a raw U32 arm index (the
// emitted match reads `u32 _req_0` and compares with 0, 1, ...), so the wire
// value of an Op is its position in the type, not a CID.
const rows = arms.map((arm, i) => [arm, i]);

// Direct calls: parse the def signature from the entry; map each type to a kind.
const splitTop = (text) => {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if ("<({[".includes(ch)) depth += 1;
    if (">)}]".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
};
const kindOf = (type) => {
  const t = type.replace(/\s+/g, "");
  if (t === "U32") return "u";
  if (t === "F32") return "f";
  if (t === "Nat") return "n";
  if (/^List<(&2,)?(U32|F32)>$/.test(t)) return "l";
  // Any other List is an opaque resident value. Non-recursive Data types are
  // unboxed by Bend 2.0.25 into several task slots / result words (a KOut
  // parameter became 12 slots, WL_RESW grew to 51), so they cannot cross the
  // boundary as one term: wrap them in a List.
  if (/^List</.test(t)) return "h";
  return null;
};
const calls = callNames.map((name) => {
  const re = new RegExp(`^(?:@\\w+\\s+)*def\\s+${name.replace(/\./g, "\\.")}\\((.*)\\)\\s*->\\s*(.+):\\s*$`);
  const line = src.findIndex((l) => re.test(l));
  if (line < 0) {
    throw new Error(`${entry}: --call ${name}: no top-level 'def ${name}(...) -> T:' on one line`);
  }
  const [, params, result] = src[line].match(re);
  const types = [...splitTop(params).map((p) => p.replace(/^\+/, "").split(":").slice(1).join(":")), result];
  const bad = types.filter((t) => kindOf(t) === null);
  if (bad.length > 0) {
    throw new Error(`${entry}:${line + 1}: --call ${name}: ${bad.join(", ")} cannot cross the binding; use U32, F32, Nat, List<U32|F32> or wrap the value in a List (Bend unboxes other Data types into several words)`);
  }
  const kinds = types.slice(0, -1).map(kindOf);
  const fidName = `FID_${name.toUpperCase().replace(/\./g, "_")}`;
  if (!cids.has(fidName)) {
    throw new Error(`${cFile}: --call ${name}: ${fidName} missing; Bend inlined the def or compiled it into a loop, so it has no entry of its own`);
  }
  const fid = cids.get(fidName);
  const arity = [...emitted.matchAll(/^CONSTV u8 FID_ARITY_T\[\] = \{([^}]*)\}/gm)][0][1].split(",").map(Number)[fid];
  if (arity !== kinds.length) {
    throw new Error(`${cFile}: --call ${name}: FID arity ${arity} but the Bend signature has ${kinds.length} parameters`);
  }
  if (kinds.length > 16) {
    throw new Error(`--call ${name}: more than 16 parameters`);
  }
  return { name, fid, params: kinds.join(""), result: kindOf(result), line: line + 1 };
});
writeFileSync(
  join(out, `${name}_ops.h`),
  `// generated by scripts/native-bridge/binding-build.mjs from ${entry.slice(root.length + 1)}\n` +
    `#define BX_MODULE_NAME ${JSON.stringify(name)}\n` +
    `#define BX_HAS_BRIDGE ${hasBridge ? 1 : 0}\n` +
    `static const struct { const char* name; u32 index; } BX_OPS[] = {\n` +
    rows.map(([arm, i]) => `  { ${JSON.stringify(arm)}, ${i} },\n`).join("") +
    `  { NULL, 0 },\n};\n#define BX_NOPS ${rows.length}\n` +
    `static const struct { const char* name; u32 fid; const char* params; char result; } BX_CALLS[] = {\n` +
    calls.map((c) => `  { ${JSON.stringify(c.name)}, ${c.fid}, ${JSON.stringify(c.params)}, '${c.result}' },  // ${entry.slice(root.length + 1)}:${c.line}\n`).join("") +
    `  { NULL, 0, "", 0 },\n};\n#define BX_NCALLS ${calls.length}\n`,
);
const nativeDir = join(root, "src/native/binding");
writeFileSync(
  join(out, `${name}_addon.c`),
  `// generated by scripts/native-bridge/binding-build.mjs\n` +
    `#include "${join(nativeDir, "bx_pre.h")}"\n` +
    `#include "${cFile}"\n` +
    `#include "${join(out, `${name}_ops.h`)}"\n` +
    `#include "${join(nativeDir, "bx_addon.c")}"\n`,
);

const target = join(out, `${name}${metal ? ".metal" : ""}.node`);
const cc = [
  ...(metal ? ["-DBEND_METAL=1", "-x", "objective-c", "-fobjc-arc", "-fmodules"] : []),
  "-std=c11", "-O3", "-fPIC", "-I", nodeInclude,
  "-Wno-unused-function", "-Wno-unused-variable",
  join(out, `${name}_addon.c`),
  "-bundle", "-undefined", "dynamic_lookup",
  ...(metal ? ["-framework", "Metal", "-framework", "Foundation"] : []),
  "-lpthread", "-lm", "-o", target,
];
const t1 = performance.now();
execFileSync("clang", cc, { env, stdio: ["ignore", "inherit", "inherit"] });
const tCc = performance.now() - t1;
// Metal: write the pipeline archive <target>.gpu, as `bend -o` does with
// `<binary> --gpu-build`; the addon resolves the path from its own file.
let gpuArchive = null;
if (metal) {
  const t2 = performance.now();
  const path = execFileSync(process.execPath, ["-e", `process.stdout.write(require(${JSON.stringify(target)}).gpuBuild())`], { env, encoding: "utf8" });
  if (path !== `${target}.gpu`) {
    throw new Error(`gpuBuild() did not write ${target}.gpu (got '${path}')`);
  }
  gpuArchive = { path, bytes: statSync(path).size, ms: Math.round(performance.now() - t2) };
}
console.log(JSON.stringify({
  target,
  bytes: statSync(target).size,
  ops: rows.map(([a]) => a),
  calls,
  bendMs: Math.round(tBend),
  clangMs: Math.round(tCc),
  metal,
  gpuArchive,
}));
