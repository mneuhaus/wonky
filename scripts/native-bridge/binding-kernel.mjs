#!/usr/bin/env node
// Builds a real kernel entry (the planar Boolean used by the build123d planar
// cases) into an in-process Node addon. Everything written here is generated:
//   1. gen-wire.mjs -> <out>/wire.{bend,mjs,json}   exact U32 codecs + dispatch(op, words)
//   2. <out>/kernel.bend                            entry: kcall(op, words) for direct calls,
//                                                   kkeep/kchain/kenc for native-resident results,
//                                                   plus the Bridge.next/Bridge.reply loop
//   3. binding-build.mjs <out>/kernel.bend --call kcall --call keep_words --call chain_words --call enc_held
//      (kkeep/kchain get inlined by Bend 2.0.25 and a bare KOut is unboxed into 12 slots, so
//      the bound defs take the op as the first word and carry the KOut in a one-element List)
//
// usage: node scripts/native-bridge/binding-kernel.mjs [--out DIR] [--metal] [--skip-bend]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeGenerated } from "./gen-wire.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = resolve(opt("--out", join(root, "tmp/native-bridge/binding/kgen")));
mkdirSync(out, { recursive: true });

// The op order is the wire op id: 0 union, 1 subtract.
export const KERNEL_OPS = ["ports/planar-boolean.bend:union", "ports/planar-boolean.bend:subtract"];
const wire = writeGenerated({ types: [], ops: KERNEL_OPS, outDir: out });
const arms = wire.manifest.ops.map((op) => op.name[0].toUpperCase() + op.name.slice(1));

const bridge = relative(out, join(root, "kernel/service/binding"));
const kdir = relative(out, join(root, "kernel"));

// Native-resident results. kkeep(op, words) decodes the 7 operands, runs the op
// and keeps the Result term (a KOut) in the Bend heap; kchain(op, prev, words)
// feeds the single body of a kept Result (solid, domains, source_budget) into
// the next op with the remaining 4 operands from words, never leaving the heap;
// kenc(out) encodes a kept KOut as [status] ++ Result words (same wire as kcall).
// KBad status: 1 malformed words, 2 unknown op, 3 previous op unresolved,
// 4 previous op produced no body, 5 previous op produced several bodies,
// 6 nothing kept yet (bridge state only).
const P7 = [
  ["A.Solid", "W.dec_analytic_Solid"],
  ["List<&2, F.DomainChoice>", "W.dec_L_face_classification_DomainChoice"],
  ["R.Real", "W.dec_real_Real"],
  ["A.Solid", "W.dec_analytic_Solid"],
  ["List<&2, F.DomainChoice>", "W.dec_L_face_classification_DomainChoice"],
  ["R.Real", "W.dec_real_Real"],
  ["I.Tolerance", "W.dec_intersections_Tolerance"],
];
const xs = (from, to) => Array.from({ length: to - from }, (_, i) => `x${from + i}`);
const typed = (from, to) => xs(from, to).map((x, i) => `${x}: ${P7[from + i][0]}`);
// staged decoders: <name>_s<i> receives x<from>..x<i-1> and the (x<i>, cursor) pair
// (emitted last stage first: Bend has no forward references)
function stages(name, lead, leadArgs, from, run) {
  const out = [];
  for (let i = 6; i >= from; i -= 1) {
    const params = [...lead, ...typed(from, i), `p: ${P7[i][0]} & W.Cursor`].join(", ");
    out.push(`def ${name}_s${i}(${params}) -> KOut:`, `  (x${i}, c) = p`);
    if (i < 6) {
      out.push(`  ${name}_s${i + 1}(${[...leadArgs, ...xs(from, i + 1), `${P7[i + 1][1]}(c)`].join(", ")})`);
    } else {
      out.push(`  ${run}(${["W.done(c)", ...leadArgs, ...xs(from, 7)].join(", ")})`);
    }
    out.push("");
  }
  return out;
}
const resident = [
  "type KOut is Data:",
  "  KOk{result: PT.Result}",
  "  KBad{status: U32}",
  "",
  `def kop(op: U32, ${typed(0, 7).join(", ")}) -> KOut:`,
  "  match op:",
  ...KERNEL_OPS.flatMap((o, i) => [`    case ${i}:`, `      KOk{PB.${o.split(":")[1]}(${xs(0, 7).join(", ")})}`]),
  "    case _:",
  "      KBad{2}",
  "",
  `def krun(ok: Bool, op: U32, ${typed(0, 7).join(", ")}) -> KOut:`,
  "  match ok:",
  "    case False{}:",
  "      KBad{1}",
  "    case True{}:",
  `      kop(op, ${xs(0, 7).join(", ")})`,
  "",
  ...stages("kkeep", ["op: U32"], ["op"], 0, "krun"),
  "def kkeep(op: U32, words: List<&2, U32>) -> KOut:",
  "  kkeep_s0(op, W.dec_analytic_Solid(W.start(words)))",
  "",
  "def kchain_one(op: U32, b: PT.Body, budget: R.Real, x3: A.Solid, x4: List<&2, F.DomainChoice>, x5: R.Real, x6: I.Tolerance) -> KOut:",
  "  PT.Body{solid, domains, _, _} = b",
  "  kop(op, solid, domains, budget, x3, x4, x5, x6)",
  "",
  "def kchain_rest(op: U32, b: PT.Body, more: List<&2, PT.Body>, budget: R.Real, x3: A.Solid, x4: List<&2, F.DomainChoice>, x5: R.Real, x6: I.Tolerance) -> KOut:",
  "  match more:",
  "    case Nil{}:",
  "      kchain_one(op, b, budget, x3, x4, x5, x6)",
  "    case Con{_, _}:",
  "      KBad{5}",
  "",
  "def kchain_body(op: U32, bodies: List<&2, PT.Body>, budget: R.Real, x3: A.Solid, x4: List<&2, F.DomainChoice>, x5: R.Real, x6: I.Tolerance) -> KOut:",
  "  match bodies:",
  "    case Nil{}:",
  "      KBad{4}",
  "    case Con{b, more}:",
  "      kchain_rest(op, b, more, budget, x3, x4, x5, x6)",
  "",
  "def kchain_res(op: U32, r: PT.Result, x3: A.Solid, x4: List<&2, F.DomainChoice>, x5: R.Real, x6: I.Tolerance) -> KOut:",
  "  match r:",
  "    case PT.Bodies{bodies, budget, _}:",
  "      kchain_body(op, bodies, budget, x3, x4, x5, x6)",
  "    case PT.Unresolved{_, _, _, _, _}:",
  "      KBad{3}",
  "",
  "def kchain_prev(op: U32, prev: KOut, x3: A.Solid, x4: List<&2, F.DomainChoice>, x5: R.Real, x6: I.Tolerance) -> KOut:",
  "  match prev:",
  "    case KOk{r}:",
  "      kchain_res(op, r, x3, x4, x5, x6)",
  "    case KBad{s}:",
  "      KBad{s}",
  "",
  "def kchain_run(ok: Bool, op: U32, prev: KOut, x3: A.Solid, x4: List<&2, F.DomainChoice>, x5: R.Real, x6: I.Tolerance) -> KOut:",
  "  match ok:",
  "    case False{}:",
  "      KBad{1}",
  "    case True{}:",
  "      kchain_prev(op, prev, x3, x4, x5, x6)",
  "",
  ...stages("kchain", ["op: U32", "prev: KOut"], ["op", "prev"], 3, "kchain_run"),
  "def kchain(op: U32, prev: KOut, words: List<&2, U32>) -> KOut:",
  "  kchain_s3(op, prev, W.dec_analytic_Solid(W.start(words)))",
  "",
  "def kenc(o: KOut) -> List<&2, U32>:",
  "  match o:",
  "    case KOk{r}:",
  "      0 <> W.encode_ports_planar_boolean_types_Result(r)",
  "    case KBad{s}:",
  "      [s]",
  "",
];
const entry = [
  "# GENERATED by scripts/native-bridge/binding-kernel.mjs. Do not edit.",
  "import Base",
  "import ./wire.bend as W",
  `import ${kdir}/analytic.bend as A`,
  `import ${kdir}/real.bend as R`,
  `import ${kdir}/face-classification.bend as F`,
  `import ${kdir}/intersections.bend as I`,
  `import ${kdir}/ports/planar-boolean.bend as PB`,
  `import ${kdir}/ports/planar-boolean-types.bend as PT`,
  "",
  "# Bridge ops: the stateless kernel ops (wire op id = arm index), then the",
  "# Bend-level resident state: Keep/Chain replace the held KOut, Read encodes it.",
  "# Every def bound for direct calls must be reachable from main, or Bend drops it.",
  "type Op is Data:",
  ...arms.map((a) => `  ${a}{}`),
  "  Keep{}",
  "  Chain{}",
  "  Read{}",
  "",
  "type Req is Data:",
  "  Req{op: Op, words: List<&2, U32>, text: String}",
  "",
  "type Reply is Data:",
  "  Reply{words: List<&2, U32>, text: String}",
  "",
  "def Bridge.next() -> IO(Req):",
  `  import "${bridge}/bridge.c"`,
  `  import "${bridge}/bridge.js"`,
  "",
  "def Bridge.reply(reply: Reply) -> IO(Unit):",
  `  import "${bridge}/bridge.c"`,
  `  import "${bridge}/bridge.js"`,
  "",
  "# direct-call entry: op id as in wire.json, request words -> status word + result words",
  "def kcall(op: U32, words: List<&2, U32>) -> List<&2, U32>:",
  "  W.dispatch(op, words)",
  "",
  ...resident,
  "def kstatus(o: KOut) -> U32:",
  "  match o:",
  "    case KOk{_}:",
  "      0",
  "    case KBad{s}:",
  "      s",
  "",
  "# first word of a bridge request: the wire op id; an empty request is malformed (op 2^32-1)",
  "def head_op(words: List<&2, U32>) -> U32 & List<&2, U32>:",
  "  match words:",
  "    case Nil{}:",
  "      (4294967295, Nil{})",
  "    case Con{h, t}:",
  "      (h, t)",
  "",
  "def keep_s(p: U32 & List<&2, U32>) -> KOut:",
  "  (o, rest) = p",
  "  kkeep(o, rest)",
  "",
  "# Bound for direct calls. A resident KOut travels as a one-element List: Bend",
  "# unboxes a bare KOut parameter into 12 slots, a List stays one term.",
  "def keep_words(words: List<&2, U32>) -> List<&2, KOut>:",
  "  [keep_s(head_op(words))]",
  "",
  "def chain_s(held: KOut, p: U32 & List<&2, U32>) -> KOut:",
  "  (o, rest) = p",
  "  kchain(o, held, rest)",
  "",
  "def chain_words(held: List<&2, KOut>, words: List<&2, U32>) -> List<&2, KOut>:",
  "  match held:",
  "    case Nil{}:",
  "      [KBad{6}]",
  "    case Con{k, _}:",
  "      [chain_s(k, head_op(words))]",
  "",
  "def enc_held(held: List<&2, KOut>) -> List<&2, U32>:",
  "  match held:",
  "    case Nil{}:",
  "      [6]",
  "    case Con{k, _}:",
  "      kenc(k)",
  "",
  "def status_held(held: List<&2, KOut>) -> U32:",
  "  match held:",
  "    case Nil{}:",
  "      6",
  "    case Con{k, _}:",
  "      kstatus(k)",
  "",
  "def reply_status(+k: List<&2, KOut>, text: String) -> IO(List<&2, KOut>):",
  "  do IO<List<&2, KOut>>:",
  "    Bridge.reply(Reply{[status_held(k)], text})",
  "    return k",
  "",
  "def reply_read(+k: List<&2, KOut>, text: String) -> IO(List<&2, KOut>):",
  "  do IO<List<&2, KOut>>:",
  "    Bridge.reply(Reply{enc_held(k), text})",
  "    return k",
  "",
  "def reply_call(op: U32, words: List<&2, U32>, text: String, held: List<&2, KOut>) -> IO(List<&2, KOut>):",
  "  do IO<List<&2, KOut>>:",
  "    Bridge.reply(Reply{kcall(op, words), text})",
  "    return held",
  "",
  "def handle(req: Req, held: List<&2, KOut>) -> IO(List<&2, KOut>):",
  "  match req:",
  "    case Req{op, words, text}:",
  "      match op:",
  ...arms.flatMap((a, i) => [`        case ${a}{}:`, `          reply_call(${i}, words, text, held)`]),
  "        case Keep{}:",
  "          reply_status(keep_words(words), text)",
  "        case Chain{}:",
  "          reply_status(chain_words(held, words), text)",
  "        case Read{}:",
  "          reply_read(held, text)",
  "",
  "@unsafe def serve(held: List<&2, KOut>) -> IO(Unit):",
  "  do IO<Unit>:",
  "    req : Req <- Bridge.next()",
  "    next : List<&2, KOut> <- handle(req, held)",
  "    serve(next)",
  "",
  "# nothing kept yet: the empty list (status 6)",
  "def main() -> IO(Unit):",
  "  serve(Nil{})",
  "",
].join("\n");
writeFileSync(join(out, "kernel.bend"), entry);

const build = [join(root, "scripts/native-bridge/binding-build.mjs"), join(out, "kernel.bend"), "--out", out, "--call", "kcall", "--call", "keep_words", "--call", "chain_words", "--call", "enc_held"];
if (args.includes("--metal")) build.push("--metal");
if (args.includes("--skip-bend")) build.push("--skip-bend");
const res = execFileSync(process.execPath, build, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
console.log(JSON.stringify({ wire: { adts: wire.manifest.adts.length, ops: wire.manifest.ops.map((o) => o.name), bendLines: wire.bendLines }, build: JSON.parse(res.trim().split("\n").pop()) }));
