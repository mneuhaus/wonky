import Base
import ../../../kernel/real.bend as R
import ../../../kernel/precise.bend as G
import ../../../kernel/analytic.bend as A
import ../../../kernel/topology.bend as T
import ../../../kernel/profile-ring.bend as PR
import ../../../kernel/polygon-prism.bend as PP
import ../../../kernel/boolean.bend as B
import ../../../kernel/intersections.bend as I
import ../../../kernel/curve-plane.bend as CP
import ../../../kernel/face-classification.bend as F
import ../../../kernel/halfspace.bend as H
import ../../../kernel/pierce.bend as P
import ../../../kernel/ports/types.bend as PTY
import ../../../kernel/ports/solid-intersection.bend as SI
import ../../../kernel/ports/planar-boolean.bend as PB
import ../../../kernel/ports/planar-boolean-types.bend as PT
import ../../../kernel/ports/curved.bend as CV
import ../../../kernel/ports/curved-validate.bend as V
import ../spike/frontend.bend as FE

# ===========================================================================
# WK/0 real-model evaluator (docs/language.md section 12): the node set the
# FeatureScript recorder (src/lang/wk/record-fs.mjs) emits for Marc's parts.
#
#   1 extrude_polygon  profile-ring.simplify, polygon-prism.extrude (F32x2)
#   2 frustum          precise.frame / lift / add / sub / dot / normalize,
#                      analytic.frustum, frustum_bounds, frustum_volume_between
#   3 transform        polygon-prism.transform or analytic.transform (+ point_transform,
#                      frustum measures, boolean.rim_bounds, halfspace.bounds)
#   4 boolean          COAXIAL boolean.coaxial; PLANAR face-classification
#                      linear_edge / max_budget, planar-boolean union/subtract,
#                      curved.audit, solid-intersection.planar_measures;
#                      PIERCE pierce.pierce / bore_depth / pierced_volume
#   5 expect_count     count speculation check
#   6 literal          a body list the host cache sends back unchanged
#
# Each op calls exactly the kernel functions that today's JS adapters call
# (src/kernel.mjs, src/analytic.mjs, src/boolean.mjs, src/planar-boolean.mjs)
# with the same arguments. Where the host adapter turns a kernel Real into a
# JS number and back between two operations (decodeAnalytic, then
# encodeAnalytic / real()), this file applies `rt`, an exact emulation of that
# binary64 round trip, so the next kernel call sees the same words. Where the
# host compares number(x) (binary64) with a constant or with another number,
# the comparison is evaluated exactly (`v64`, `sign_c`, `sign_v` below), never
# as an F32x2 comparison. The one adapter step that does genuine host binary64
# ARITHMETIC (the pierce axis and reach: Math.hypot and divisions on primitive
# coordinates; the target volume real(a.validation.volumeMm3), a binary64
# integral for a polyhedral target) is not emulated at all: the host computes
# those inputs with today's code from the decoded operands and sends them with
# the PIERCE node (real-run.mjs stages the graph at every PIERCE node).
#
# The residual checks that decodeAnalytic's validation runs in the kernel
# (analytic.curve_residual, surface_residual, cylinder_line_residual) run here;
# the purely structural checks run in the host decoder.
#
# Errors are values (VErr) carrying the node's span id: capability (1), fail
# (2), speculation / expect (3), malformed node payload (4). An error
# propagates to every dependent node. A malformed STREAM (bad token, count
# that does not match the tokens, tokens left over, a file that was not read
# completely) is not a node value: the program is rejected as a whole and
# main.bend exits with code 3 before anything is evaluated. Nothing is
# repaired or skipped.
# ===========================================================================

type Prim is Data:
  NoPrim{}
  Frus{bottom: G.Vec3, top: G.Vec3, r0: R.Real, r1: R.Real}

# Optional values are lists: budget and volume hold 0 or 1 Real, bounds 0 or
# 2 points (low, high); extra is method evidence (pierce depth; planar audit
# required, allowance, resolution, audit volume, the two input budgets and
# their maximum). cons: 0 primitive or none, 1 coaxial, 2 planar union,
# 3 planar subtraction, 4 pierce. pu is provenance the host decoder turns
# into today's construction / operation-evidence fields; the evaluator never
# reads it (planar: stats, audit validity, face and edge origins; pierce:
# none).
# Poly: an F32x2 polygon prism (kernel/polygon-prism.bend) with its incidence
# audit (required, allowance) and, for an extrusion, its profile ring merge
# record (0 or 1 ProfileRec; a rigid copy has none: the host copies the source's
# construction record, as src/kernel.mjs transformInBend does).
type ProfileRec is Data:
  ProfileRec{source: U32, kept: List<&2, U32>, merged: List<&2, PR.Merge>, tolerance: R.Real}

type Body is Data:
  Poly{solid: PP.Solid, required: R.Real, allowance: R.Real, ring: List<&2, ProfileRec>}
  Ana{solid: A.Solid, domains: List<&2, F.DomainChoice>, prim: Prim, budget: List<&2, R.Real>, volume: List<&2, R.Real>, bounds: List<&2, G.Vec3>, cons: U32, extra: List<&2, R.Real>, pu: List<&2, U32>}

type Val is Data:
  VBodies{bodies: List<&2, Body>}
  VOk{}
  VErr{code: U32, +span: U32, msg: String}

# A binary64 constant c of a host comparison, as three F32 words with
# c1 + c2 + c3 = c exactly (real-host.mjs b64Words checks the split).
type B64 is Data:
  B64{c1: F32, c2: F32, c3: F32}

# Host constants, sent as words so that no threshold is re-derived here: the
# intersection tolerance (linear real(1e-7), angular real(1e-10)) and the
# pierce linear tolerance real(1e-7), which are kernel inputs; the binary64
# thresholds of three host comparisons (the frustum height^2 floor 1e-10,
# `<=`; the coaxial normal floor 1 - 1e-6, `<`; the Real residual tolerance
# 0.0003, `>`), evaluated exactly (sign_c); the largest F32 not above 0.0003
# (an F32 residual r is above 0.0003 exactly when it is above that word) and
# zero.
type K is Data:
  K{tol: I.Tolerance, lin: R.Real, h2: B64, axis: B64, res32: F32, res: B64, zero: R.Real}

def ktol(k: K) -> I.Tolerance:
  K{tol, lin, h2, axis, res32, res, zero} = k
  tol

def klin(k: K) -> R.Real:
  K{tol, lin, h2, axis, res32, res, zero} = k
  lin

def kh2(k: K) -> B64:
  K{tol, lin, h2, axis, res32, res, zero} = k
  h2

def kaxis(k: K) -> B64:
  K{tol, lin, h2, axis, res32, res, zero} = k
  axis

def kres32(k: K) -> F32:
  K{tol, lin, h2, axis, res32, res, zero} = k
  res32

def kres(k: K) -> B64:
  K{tol, lin, h2, axis, res32, res, zero} = k
  res

def kzero(k: K) -> R.Real:
  K{tol, lin, h2, axis, res32, res, zero} = k
  zero

type WNode is Data:
  WNode{op: U32, +span: U32, key: U32, refs: List<&2, U32>, us: List<&2, U32>, rs: List<&2, R.Real>}

def node_key(n: WNode) -> U32:
  WNode{op, span, key, refs, us, rs} = n
  key

# --- stream decoding -------------------------------------------------------
#
# Strict: the file is decimal U32 tokens separated by whitespace (space, tab,
# CR, LF), nothing else; a token above 4294967295 or any other character
# rejects the stream. The first two tokens are a seal written by the host
# (real-host.mjs encodeReal): the number of tokens after them and their sum
# mod 2^32, so a stream that was cut or altered anywhere is rejected even
# where its structure would still parse. Every count (levels, nodes per
# level, refs, u32 and real payloads) must be followed by exactly that many
# tokens, and no token may be left after the last level. Any violation
# rejects the whole program (Program.ok = False with a reason); there is no
# partial decoding.

type TokState is Data:
  TokState{cur: U32, active: Bool, bad: Bool, chars: U32, n: U32, sum: U32, acc: List<&2, U32>}

type Toks is Data:
  Toks{ok: Bool, xs: List<&2, U32>, chars: U32, n: U32, sum: U32}

def tok_flush(st: TokState) -> TokState:
  TokState{+cur, active, bad, chars, n, sum, acc} = st
  match active:
    case True{}:
      TokState{0, False{}, bad, (chars + 1 : U32), (n + 1 : U32), (sum + cur : U32), cur <> acc}
    case False{}:
      TokState{0, False{}, bad, (chars + 1 : U32), n, sum, acc}

# 429496729 * 10 + 5 = 4294967295: a larger value would wrap.
def tok_digit(+d: U32, st: TokState) -> TokState:
  TokState{+cur, active, bad, chars, n, sum, acc} = st
  +over = Bool.or((cur > 429496729 : U32), Bool.and(U32.is_eq(cur, 429496729), (d > 5 : U32)))
  TokState{(cur * 10 + d : U32), True{}, Bool.or(bad, over), (chars + 1 : U32), n, sum, acc}

def tok_bad(st: TokState) -> TokState:
  TokState{cur, active, bad, chars, n, sum, acc} = st
  TokState{cur, active, True{}, (chars + 1 : U32), n, sum, acc}

def tok_space(+c: U32) -> Bool:
  Bool.or(Bool.or(U32.is_eq(c, 32), U32.is_eq(c, 10)), Bool.or(U32.is_eq(c, 9), U32.is_eq(c, 13)))

def tok_kind(digit: Bool, space: Bool, +d: U32, st: TokState) -> TokState:
  match digit:
    case True{}:
      tok_digit(d, st)
    case False{}:
      match space:
        case True{}:
          tok_flush(st)
        case False{}:
          tok_bad(st)

def tok_char(+c: U32, st: TokState) -> TokState:
  +d = (c - 48 : U32)
  tok_kind((d < 10 : U32), tok_space(c), d, st)

def tok_fin(st: TokState) -> Toks:
  TokState{+cur, active, bad, chars, n, sum, acc} = st
  match active:
    case True{}:
      Toks{Bool.not(bad), List.reverse(&2, U32, cur <> acc), chars, (n + 1 : U32), (sum + cur : U32)}
    case False{}:
      Toks{Bool.not(bad), List.reverse(&2, U32, acc), chars, n, sum}

def toks_go(s: String, st: TokState) -> Toks:
  match s:
    case SNil{}:
      tok_fin(st)
    case SCon{c, rest}:
      toks_go(rest, tok_char(Char.to_u32(c), st))

def tokens(s: String) -> Toks:
  toks_go(s, TokState{0, False{}, False{}, 0, 0, 0, Nil{}})

type US is Data:
  US{ok: Bool, xs: List<&2, U32>, rest: List<&2, U32>}

type RS is Data:
  RS{ok: Bool, xs: List<&2, R.Real>, rest: List<&2, U32>}

def take_u32(n: Nat, toks: List<&2, U32>, acc: List<&2, U32>) -> US:
  match n:
    case 0n:
      US{True{}, List.reverse(&2, U32, acc), toks}
    case 1n+p:
      match toks:
        case t <> rest:
          take_u32(p, rest, t <> acc)
        case _:
          US{False{}, Nil{}, Nil{}}

# One F32 word of the stream: (-1)^s * m * 2^(e - 200) (FE.word), plus the
# two values the host's F32 contract (Math.fround) produces that this form
# cannot express: e = 999 with m = 0 is (-1)^s * Infinity (a binary64 input
# above the F32 range), with m = 1 NaN. The kernel then computes with them
# exactly as the JS target does (IEEE-754 in both).
def inf32() -> F32:
  FE.scale(200n, 1.0, True{})

def special_word(s: U32, m: U32) -> F32:
  match m:
    case 0:
      FE.signed(s, inf32())
    case _:
      (inf32() - inf32() : F32)

def wword(s: U32, m: U32, +e: U32) -> F32:
  match e:
    case 999:
      special_word(s, m)
    case _:
      FE.word(s, m, e)

def take_real(n: Nat, toks: List<&2, U32>, acc: List<&2, R.Real>) -> RS:
  match n:
    case 0n:
      RS{True{}, List.reverse(&2, R.Real, acc), toks}
    case 1n+p:
      match toks:
        case s1 <> m1 <> e1 <> s2 <> m2 <> e2 <> rest:
          take_real(p, rest, R.Real{wword(s1, m1, e1), wword(s2, m2, e2)} <> acc)
        case _:
          RS{False{}, Nil{}, Nil{}}

# NRSeed is the loop's starting point, never a decoded node.
type NodeRes is Data:
  NRSeed{rest: List<&2, U32>}
  NROk{node: WNode, rest: List<&2, U32>}
  NRBad{}

def node_fin(op: U32, +span: U32, key: U32, refs: List<&2, U32>, us: List<&2, U32>, r: RS) -> NodeRes:
  match r:
    case RS{ok, rs, rest}:
      match ok:
        case True{}:
          NROk{WNode{op, span, key, refs, us, rs}, rest}
        case False{}:
          NRBad{}

def node_us(op: U32, +span: U32, key: U32, refs: List<&2, U32>, u: US) -> NodeRes:
  match u:
    case US{ok, us, rest}:
      match ok:
        case True{}:
          match rest:
            case nr <> more:
              node_fin(op, span, key, refs, us, take_real(U32.to_nat(nr), more, Nil{}))
            case _:
              NRBad{}
        case False{}:
          NRBad{}

def node_refs(op: U32, +span: U32, key: U32, u: US) -> NodeRes:
  match u:
    case US{ok, refs, rest}:
      match ok:
        case True{}:
          match rest:
            case nu <> more:
              node_us(op, span, key, refs, take_u32(U32.to_nat(nu), more, Nil{}))
            case _:
              NRBad{}
        case False{}:
          NRBad{}

def dec_node(toks: List<&2, U32>) -> NodeRes:
  match toks:
    case op <> span <> key <> nrefs <> rest:
      node_refs(op, span, key, take_u32(U32.to_nat(nrefs), rest, Nil{}))
    case _:
      NRBad{}

type NodesRes is Data:
  NodesRes{ok: Bool, nodes: List<&2, WNode>, rest: List<&2, U32>}

# Decodes exactly n nodes after the seed; one bad node rejects the level.
def nodes_loop(n: Nat, r: NodeRes, acc: List<&2, WNode>) -> NodesRes:
  match n:
    case 0n:
      match r:
        case NRBad{}:
          NodesRes{False{}, Nil{}, Nil{}}
        case NRSeed{rest}:
          NodesRes{True{}, List.reverse(&2, WNode, acc), rest}
        case NROk{node, rest}:
          NodesRes{True{}, List.reverse(&2, WNode, node <> acc), rest}
    case 1n+p:
      match r:
        case NRBad{}:
          NodesRes{False{}, Nil{}, Nil{}}
        case NRSeed{rest}:
          nodes_loop(p, dec_node(rest), acc)
        case NROk{node, rest}:
          nodes_loop(p, dec_node(rest), node <> acc)

def level_start(toks: List<&2, U32>) -> NodesRes:
  match toks:
    case c <> rest:
      nodes_loop(U32.to_nat(c), NRSeed{rest}, Nil{})
    case _:
      NodesRes{False{}, Nil{}, Nil{}}

type LevelsRes is Data:
  LevelsRes{ok: Bool, levels: List<&2, List<&2, WNode>>, rest: List<&2, U32>}

# The first element pushed is an empty dummy level: harmless for evaluation.
def levels_loop(n: Nat, r: NodesRes, acc: List<&2, List<&2, WNode>>) -> LevelsRes:
  match n:
    case 0n:
      match r:
        case NodesRes{ok, ns, rest}:
          match ok:
            case False{}:
              LevelsRes{False{}, Nil{}, Nil{}}
            case True{}:
              LevelsRes{True{}, List.reverse(&2, List<&2, WNode>, ns <> acc), rest}
    case 1n+p:
      match r:
        case NodesRes{ok, ns, rest}:
          match ok:
            case False{}:
              LevelsRes{False{}, Nil{}, Nil{}}
            case True{}:
              levels_loop(p, level_start(rest), ns <> acc)

type Program is Data:
  Program{k: K, levels: List<&2, List<&2, WNode>>, ok: Bool, why: String}

def bad_program(why: String) -> Program:
  +z = R.from_f32(0.0)
  +b = {B64{0.0, 0.0, 0.0} : B64}
  Program{K{I.Tolerance{z, z}, z, b, b, 0.0, b, z}, Nil{}, False{}, why}

def program_rest(k: K, lv: List<&2, List<&2, WNode>>, rest: List<&2, U32>) -> Program:
  match rest:
    case Nil{}:
      Program{k, lv, True{}, ""}
    case _:
      bad_program("tokens are left over after the last level")

def program_fin(k: K, r: LevelsRes) -> Program:
  match r:
    case LevelsRes{ok, lv, rest}:
      match ok:
        case True{}:
          program_rest(k, lv, rest)
        case False{}:
          bad_program("a level or node count does not match the tokens (truncated or inconsistent stream)")

def program_levels(k: K, rest: List<&2, U32>) -> Program:
  match rest:
    case nl <> more:
      program_fin(k, levels_loop(U32.to_nat(nl), NodesRes{True{}, Nil{}, more}, Nil{}))
    case _:
      bad_program("the level count is missing")

def f32v(r: R.Real) -> F32:
  R.Real{hi, lo} = r
  hi

def b64_of(a: R.Real, b: R.Real) -> B64:
  R.Real{c1, c2} = a
  R.Real{c3, z} = b
  B64{c1, c2, c3}

# lin ang plin h2 (2 reals) axis (2) res32 res (2) zero: a B64 travels as
# (c1, c2) and (c3, 0).
def program_consts(r: RS) -> Program:
  match r:
    case RS{ok, xs, rest}:
      match xs:
        case lin <> ang <> plin <> h2a <> h2b <> axa <> axb <> res32 <> resa <> resb <> zero <> Nil{}:
          program_levels(K{I.Tolerance{lin, ang}, plin, b64_of(h2a, h2b), b64_of(axa, axb), f32v(res32), b64_of(resa, resb), zero}, rest)
        case _:
          bad_program("the eleven host constants are missing")

def program_sealed(sealed: Bool, rest: List<&2, U32>) -> Program:
  match sealed:
    case True{}:
      program_consts(take_real(11n, rest, Nil{}))
    case False{}:
      bad_program("the seal does not match (token count or checksum): the stream was cut or altered")

# xs = count checksum rest...: count = number of tokens after the seal (n - 2),
# checksum = their sum mod 2^32 (sum - count - checksum).
def program_seal(xs: List<&2, U32>, +n: U32, +sum: U32) -> Program:
  match xs:
    case +count <> +check <> rest:
      program_sealed(Bool.and(U32.is_eq(count, (n - 2 : U32)), U32.is_eq(check, (sum - count - check : U32))), rest)
    case _:
      bad_program("the seal (token count and checksum) is missing")

def program_sized(complete: Bool, xs: List<&2, U32>, chars: U32, size: U32, n: U32, sum: U32) -> Program:
  match complete:
    case True{}:
      program_seal(xs, n, sum)
    case False{}:
      bad_program("the stream was not read completely (" ++ U32.show(chars) ++ " of " ++ U32.show(size) ++ " bytes)")

# t: the tokenizer result; size: the file size in bytes (every character of a
# valid stream is one ASCII byte, so a short read shows up as a mismatch).
def program_of(t: Toks, +size: U32) -> Program:
  match t:
    case Toks{ok, xs, +chars, n, sum}:
      match ok:
        case False{}:
          bad_program("a token is not a decimal U32 (bad character or above 4294967295)")
        case True{}:
          program_sized(U32.is_eq(chars, size), xs, chars, size, n, sum)

def program(text: String, +size: U32) -> Program:
  program_of(tokens(text), size)

# --- the host binary64 round trip -------------------------------------------
#
# JS `real(number(x))` for a normalized F32x2 x = (hi, lo): number() rounds
# hi + lo to 53 bits, real() splits it again. hi never changes; lo is rounded
# to the binary64 grid of hi + lo, which is 2^(E-52) (E = exponent of hi), or
# 2^(E-53) when hi is a power of two and lo has the opposite sign (the sum
# falls into the binade below). Rounding lo to a grid u with |lo| < 2^23 u is
# one F32 addition of C = 2^23 u (ties to even, as binary64) and C's removal;
# a lo that is not below C is already on the grid.

def pow2(k: Nat, up: Bool) -> F32:
  FE.scale(k, 1.0, up)

def rt_round(+lo: F32, +c: F32) -> F32:
  +neg = (lo < 0.0 : F32)
  +a = Bool.pick(F32, neg, F32.neg(lo), lo)
  +r = ((a + c : F32) - c : F32)
  Bool.pick(F32, (a < c : F32), Bool.pick(F32, neg, F32.neg(r), r), lo)

# 2^(eh - shift) as an F32 (flushes to zero far below the F32 range). Only
# the selected branch may build its Nat: Bool.pick evaluates both arguments.
def grid(up: Bool, +eh: U32, +shift: U32) -> F32:
  match up:
    case True{}:
      pow2(U32.to_nat((eh - shift : U32)), True{})
    case False{}:
      pow2(U32.to_nat((shift - eh : U32)), False{})

def rt_nonzero(nonzero: Bool, +hi: F32, +lo: F32) -> F32:
  match nonzero:
    case False{}:
      lo
    case True{}:
      +bh = F32.bits(hi)
      +eh = U32.and(U32.shrn(bh, 23n), 255)
      +pow = U32.is_zero(U32.and(bh, 8388607))
      +opposite = U32.is_ne(U32.shrn(bh, 31n), U32.shrn(F32.bits(lo), 31n))
      +shift = Bool.pick(U32, Bool.and(pow, opposite), 157, 156)
      rt_round(lo, grid((eh >= shift : U32), eh, shift))

def rt_lo(+hi: F32, +lo: F32) -> F32:
  rt_nonzero(Bool.not(F32.is_eq(lo, 0.0)), hi, lo)

def rt(r: R.Real) -> R.Real:
  R.Real{+hi, lo} = r
  R.Real{hi, rt_lo(hi, lo)}

def rt_vec(v: G.Vec3) -> G.Vec3:
  G.V3{x, y, z} = v
  G.V3{rt(x), rt(y), rt(z)}

def rt_vecs(vs: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match vs:
    case Nil{}:
      Nil{}
    case v <> rest:
      rt_vec(v) <> rt_vecs(rest)

# src/kernel.mjs decodePrism writes every prism word as number(x) + 0 (a -0
# becomes +0); the next kernel call (transformInBend, classificationInput)
# re-splits that binary64 with real(). So rt, with a zero folded to +0.
def rt0(r: R.Real) -> R.Real:
  R.Real{+hi, +lo} = r
  Bool.pick(R.Real, Bool.and(F32.is_eq(hi, 0.0), F32.is_eq(lo, 0.0)), R.Real{0.0, 0.0}, rt(R.Real{hi, lo}))

def rt0_vec(v: G.Vec3) -> G.Vec3:
  G.V3{x, y, z} = v
  G.V3{rt0(x), rt0(y), rt0(z)}

def rt0_vecs(vs: List<&2, G.Vec3>, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match vs:
    case Nil{}:
      List.reverse(&2, G.Vec3, acc)
    case v <> rest:
      rt0_vecs(rest, rt0_vec(v) <> acc)

def rt0_faces(fs: List<&2, PP.Face>, acc: List<&2, PP.Face>) -> List<&2, PP.Face>:
  match fs:
    case Nil{}:
      List.reverse(&2, PP.Face, acc)
    case PP.Face{o, n, x, b} <> rest:
      rt0_faces(rest, PP.Face{rt0_vec(o), rt0_vec(n), rt0_vec(x), b} <> acc)

# A prism body as the host hands it to the next kernel call (decode, then real()).
def rt0_psolid(s: PP.Solid) -> PP.Solid:
  PP.Solid{vs, es, fs} = s
  PP.Solid{rt0_vecs(vs, Nil{}), es, rt0_faces(fs, Nil{})}

def rt_curve(c: A.Curve) -> A.Curve:
  match c:
    case A.Line{o, d}:
      A.Line{rt_vec(o), rt_vec(d)}
    case A.Circle{o, n, x, r}:
      A.Circle{rt_vec(o), rt_vec(n), rt_vec(x), rt(r)}
    case A.Ellipse{o, n, x, a, b}:
      A.Ellipse{rt_vec(o), rt_vec(n), rt_vec(x), rt(a), rt(b)}

def rt_surface(s: A.Surface) -> A.Surface:
  match s:
    case A.Plane{o, n, x}:
      A.Plane{rt_vec(o), rt_vec(n), rt_vec(x)}
    case A.Cylinder{o, a, x, r}:
      A.Cylinder{rt_vec(o), rt_vec(a), rt_vec(x), rt(r)}
    case A.Cone{o, a, x, r, g}:
      A.Cone{rt_vec(o), rt_vec(a), rt_vec(x), rt(r), rt(g)}
    case A.Sphere{o, a, x, r}:
      A.Sphere{rt_vec(o), rt_vec(a), rt_vec(x), rt(r)}
    case A.Torus{o, a, x, big, small}:
      A.Torus{rt_vec(o), rt_vec(a), rt_vec(x), rt(big), rt(small)}

def rt_edges(es: List<&2, A.Edge>) -> List<&2, A.Edge>:
  match es:
    case Nil{}:
      Nil{}
    case A.Edge{s, e, c, same} <> rest:
      A.Edge{s, e, rt_curve(c), same} <> rt_edges(rest)

def rt_faces(fs: List<&2, A.Face>) -> List<&2, A.Face>:
  match fs:
    case Nil{}:
      Nil{}
    case A.Face{s, same, loops} <> rest:
      A.Face{rt_surface(s), same, loops} <> rt_faces(rest)

def rt_solid(s: A.Solid) -> A.Solid:
  A.Solid{vs, es, fs} = s
  A.Solid{rt_vecs(vs), rt_edges(es), rt_faces(fs)}

def rt_interval(d: CP.Domain) -> F.DomainChoice:
  match d:
    case CP.Untrimmed{}:
      F.GivenDomain{CP.Untrimmed{}}
    case CP.Interval{a, b}:
      F.GivenDomain{CP.Interval{rt(a), rt(b)}}

def rt_domain(d: F.DomainChoice) -> F.DomainChoice:
  match d:
    case F.AutoDomain{}:
      F.AutoDomain{}
    case F.GivenDomain{dom}:
      rt_interval(dom)

def rt_domains(ds: List<&2, F.DomainChoice>) -> List<&2, F.DomainChoice>:
  match ds:
    case Nil{}:
      Nil{}
    case d <> rest:
      rt_domain(d) <> rt_domains(rest)

# --- exact binary64 comparisons ----------------------------------------------
#
# Today's adapters test number(x) = hi + lo, rounded to binary64, against a
# binary64 constant (`Math.abs(number(dot)) < 1 - 1e-6`, `height2 <= 1e-10`,
# `residual > 0.0003`) or against another number (`range[0] >= range[1]`,
# `min >= max`, `volume <= 0`). An F32x2 comparison of the unrounded pair
# differs from that at the boundary (verifier round 3: a dot product equal to
# the F32x2 rounding of 1 - 1e-6 passed here and was refused today). So:
#   v64(x)    the binary64 value number(x), exactly, as an F32 pair: an exact
#             two-sum renormalizes (hi, lo), then rt rounds the low word to
#             the binary64 grid of the sum (the round trip above);
#   sign_c    the sign of v64(x) - c for a constant c = c1 + c2 + c3;
#   sign_v    the sign of v64(a) - v64(b);
# each the exact sign of a short sum of F32 words: a floating-point expansion
# grown by two-sums (Shewchuk 1997), whose most significant nonzero component
# carries the sign. Signs are 0 negative, 1 zero, 2 positive, 3 unordered.
# A non-finite pair compares like the JS number: NaN never compares, +-Inf by
# its sign (the F32 sum hi + lo has the same class as the binary64 sum).

type TS is Data:
  TS{sum: F32, err: F32}

def two_sum(+a: F32, +b: F32) -> TS:
  +s = (a + b : F32)
  +bb = (s - a : F32)
  TS{s, ((a - (s - bb : F32) : F32) + (b - bb : F32) : F32)}

# Adds q to a nonoverlapping expansion e (increasing magnitude): the running
# sum travels in t, the error terms collect (reversed) in acc.
def grow_go(xs: List<&2, F32>, t: TS, acc: List<&2, F32>) -> List<&2, F32>:
  match xs:
    case Nil{}:
      TS{q, h} = t
      List.reverse(&2, F32, q <> h <> acc)
    case x <> rest:
      TS{q, h} = t
      grow_go(rest, two_sum(q, x), h <> acc)

def grow(e: List<&2, F32>, +q: F32) -> List<&2, F32>:
  match e:
    case Nil{}:
      q <> Nil{}
    case x <> rest:
      grow_go(rest, two_sum(q, x), Nil{})

def exp_sign(e: List<&2, F32>, +acc: U32) -> U32:
  match e:
    case Nil{}:
      acc
    case +x <> rest:
      exp_sign(rest, Bool.pick(U32, F32.is_eq(x, 0.0), acc, Bool.pick(U32, (x < 0.0 : F32), 0, 2)))

# The exact sign of the sum of xs.
def sum_sign(xs: List<&2, F32>, e: List<&2, F32>) -> U32:
  match xs:
    case Nil{}:
      exp_sign(e, 1)
    case x <> rest:
      sum_sign(rest, grow(e, x))

def fin2(r: R.Real) -> Bool:
  R.Real{+hi, +lo} = r
  Bool.and(F32.is_eq((hi - hi : F32), 0.0), F32.is_eq((lo - lo : F32), 0.0))

def ts_real(t: TS) -> R.Real:
  TS{q, h} = t
  R.Real{q, h}

def norm2(r: R.Real) -> R.Real:
  R.Real{hi, lo} = r
  ts_real(two_sum(hi, lo))

def v64(r: R.Real) -> R.Real:
  rt(norm2(r))

# Sign of a non-finite pair's F32 sum against a finite value f.
def nf_sign(+v: F32, +f: F32) -> U32:
  Bool.pick(U32, F32.is_eq(v, v), Bool.pick(U32, (v < f : F32), 0, Bool.pick(U32, F32.is_eq(v, f), 1, 2)), 3)

def pair_sum(r: R.Real) -> F32:
  R.Real{hi, lo} = r
  (hi + lo : F32)

def sign_c_v(v: R.Real, c: B64) -> U32:
  R.Real{hi, lo} = v
  B64{c1, c2, c3} = c
  sum_sign(hi <> lo <> F32.neg(c1) <> F32.neg(c2) <> F32.neg(c3) <> Nil{}, Nil{})

def sign_c_fin(r: R.Real, c: B64) -> U32:
  sign_c_v(v64(r), c)

def sign_c_go(fin: Bool, +r: R.Real, +c: B64) -> U32:
  match fin:
    case True{}:
      sign_c_fin(r, c)
    case False{}:
      B64{c1, c2, c3} = c
      nf_sign(pair_sum(r), c1)

# sign of number(r) - c
def sign_c(+r: R.Real, +c: B64) -> U32:
  sign_c_go(fin2(r), r, c)

def sign_v_v(va: R.Real, vb: R.Real) -> U32:
  R.Real{ah, al} = va
  R.Real{bh, bl} = vb
  sum_sign(ah <> al <> F32.neg(bh) <> F32.neg(bl) <> Nil{}, Nil{})

def sign_v_fin(a: R.Real, b: R.Real) -> U32:
  sign_v_v(v64(a), v64(b))

def sign_v_go(fin: Bool, +a: R.Real, +b: R.Real) -> U32:
  match fin:
    case True{}:
      sign_v_fin(a, b)
    case False{}:
      +fb = pair_sum(b)
      Bool.pick(U32, F32.is_eq(fb, fb), nf_sign(pair_sum(a), fb), 3)

# sign of number(a) - number(b)
def sign_v(+a: R.Real, +b: R.Real) -> U32:
  sign_v_go(Bool.and(fin2(a), fin2(b)), a, b)

def lt64c(+r: R.Real, +c: B64) -> Bool:
  U32.is_eq(sign_c(r, c), 0)

def le64c(+r: R.Real, +c: B64) -> Bool:
  +s = sign_c(r, c)
  Bool.or(U32.is_eq(s, 0), U32.is_eq(s, 1))

def lt64v(+a: R.Real, +b: R.Real) -> Bool:
  U32.is_eq(sign_v(a, b), 0)

# number(r) > 0
def pos64(+r: R.Real) -> Bool:
  U32.is_eq(sign_c(r, B64{0.0, 0.0, 0.0}), 2)

# Math.abs(number(r)) as a pair (number(-r) = -number(r) exactly).
def abs64(+r: R.Real) -> R.Real:
  R.Real{+hi, +lo} = r
  Bool.pick(R.Real, U32.is_eq(sign_c(r, B64{0.0, 0.0, 0.0}), 0), R.Real{F32.neg(hi), F32.neg(lo)}, r)

# --- small helpers -------------------------------------------------------------

def autos(n: Nat) -> List<&2, F.DomainChoice>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      F.AutoDomain{} <> autos(p)

def edge_count(s: A.Solid) -> Nat:
  A.Solid{vs, es, fs} = s
  List.length(&2, A.Edge, es)

def one(b: Body) -> Val:
  VBodies{b <> Nil{}}

def bounds_list(b: A.Bounds) -> List<&2, G.Vec3>:
  A.Bounds{low, high} = b
  low <> high <> Nil{}

def or_err(m: Maybe<&2, String>, rest: Maybe<&2, String>) -> Maybe<&2, String>:
  match m:
    case Some{msg}:
      Some{msg}
    case None{}:
      rest

def guard(ok: Bool, msg: String, rest: Maybe<&2, String>) -> Maybe<&2, String>:
  match ok:
    case True{}:
      rest
    case False{}:
      Some{msg}

def finite32(+x: F32) -> Bool:
  F32.is_eq((x - x : F32), 0.0)

def finite(r: R.Real) -> Bool:
  R.Real{hi, lo} = r
  finite32(hi)

def zero_real(r: R.Real) -> Bool:
  R.Real{hi, lo} = r
  Bool.and(F32.is_eq(hi, 0.0), F32.is_eq(lo, 0.0))

# Appends a single-body (or error) value to a list value, keeping the first error.
def cons_tail(bs: List<&2, Body>, tail: Val) -> Val:
  match tail:
    case VBodies{ts}:
      VBodies{List.append(&2, Body, bs, ts)}
    case VErr{c, s, m}:
      VErr{c, s, m}
    case VOk{}:
      VBodies{bs}

def cons_val(v: Val, tail: Val) -> Val:
  match v:
    case VBodies{bs}:
      cons_tail(bs, tail)
    case VErr{c, s, m}:
      VErr{c, s, m}
    case VOk{}:
      tail

# --- validation residuals (decodeAnalytic / validateAnalytic in the kernel) -------

def res_ok32(+r: F32, t: F32) -> Bool:
  Bool.and(finite32(r), Bool.not((r > t : F32)))

# today: fail when !Number.isFinite(number(r)) || number(r) > 0.0003 (binary64)
def res_ok(+r: R.Real, +t: B64) -> Bool:
  Bool.and(fin2(r), le64c(r, t))

def edges_ok(es: List<&2, A.Edge>, +vs: List<&2, G.Vec3>, +t: F32, +i: U32) -> Maybe<&2, String>:
  match es:
    case Nil{}:
      None{}
    case A.Edge{+s, +e, +c, same} <> rest:
      +r0 = A.curve_residual(c, A.vertex_at(vs, s))
      +r1 = A.curve_residual(c, A.vertex_at(vs, e))
      guard(Bool.and(res_ok32(r0, t), res_ok32(r1, t)), "analytic body edge " ++ U32.show(i) ++ " misses its curve (residual above 0.0003 mm)", edges_ok(rest, vs, t, (i + 1 : U32)))

def edge_end(e: A.Edge, fwd: Bool) -> U32:
  A.Edge{s, t, c, same} = e
  Bool.pick(U32, fwd, t, s)

def use_end(u: T.Coedge, +es: List<&2, A.Edge>) -> U32:
  T.Use{edge, fwd} = u
  edge_end(A.edge_at(es, edge), fwd)

def uses_ok(us: List<&2, T.Coedge>, +surface: A.Surface, +es: List<&2, A.Edge>, +vs: List<&2, G.Vec3>, +t: F32) -> Bool:
  match us:
    case Nil{}:
      True{}
    case u <> rest:
      Bool.and(res_ok32(A.surface_residual(surface, A.vertex_at(vs, use_end(u, es))), t), uses_ok(rest, surface, es, vs, t))

def loops_ok(ls: List<&2, A.Loop>, +surface: A.Surface, +es: List<&2, A.Edge>, +vs: List<&2, G.Vec3>, +t: F32) -> Bool:
  match ls:
    case Nil{}:
      True{}
    case A.Loop{outer, us} <> rest:
      Bool.and(uses_ok(us, surface, es, vs, t), loops_ok(rest, surface, es, vs, t))

def faces_ok(fs: List<&2, A.Face>, +es: List<&2, A.Edge>, +vs: List<&2, G.Vec3>, +t: F32, +i: U32) -> Maybe<&2, String>:
  match fs:
    case Nil{}:
      None{}
    case A.Face{s, same, loops} <> rest:
      guard(loops_ok(loops, s, es, vs, t), "analytic boundary vertex misses face " ++ U32.show(i) ++ " (residual above 0.0003 mm)", faces_ok(rest, es, vs, t, (i + 1 : U32)))

def seen(xs: List<&2, U32>, +x: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case y <> rest:
      Bool.or(U32.is_eq(x, y), seen(rest, x))

def loop_edges(us: List<&2, T.Coedge>, +acc: List<&2, U32>) -> List<&2, U32>:
  match us:
    case Nil{}:
      acc
    case T.Use{+edge, fwd} <> rest:
      loop_edges(rest, Bool.pick(List<&2, U32>, seen(acc, edge), acc, edge <> acc))

def face_edges(ls: List<&2, A.Loop>, acc: List<&2, U32>) -> List<&2, U32>:
  match ls:
    case Nil{}:
      acc
    case A.Loop{outer, us} <> rest:
      face_edges(rest, loop_edges(us, acc))

def is_cylinder(s: A.Surface) -> Bool:
  match s:
    case A.Cylinder{o, a, x, r}:
      True{}
    case _:
      False{}

def is_line(c: A.Curve) -> Bool:
  match c:
    case A.Line{o, d}:
      True{}
    case _:
      False{}

def line_check(line: Bool, +c: A.Curve, +surface: A.Surface, +a: G.Vec3, +b: G.Vec3, +t: B64) -> Bool:
  match line:
    case True{}:
      res_ok(A.cylinder_line_residual(c, surface, a, b), t)
    case False{}:
      True{}

def line_residual_ok(e: A.Edge, +surface: A.Surface, +vs: List<&2, G.Vec3>, +t: B64) -> Bool:
  A.Edge{+s, +e2, +c, same} = e
  line_check(is_line(c), c, surface, A.vertex_at(vs, s), A.vertex_at(vs, e2), t)

def cyl_edges_ok(ids: List<&2, U32>, +surface: A.Surface, +es: List<&2, A.Edge>, +vs: List<&2, G.Vec3>, +t: B64) -> Bool:
  match ids:
    case Nil{}:
      True{}
    case id <> rest:
      Bool.and(line_residual_ok(A.edge_at(es, id), surface, vs, t), cyl_edges_ok(rest, surface, es, vs, t))

def cyl_check(cyl: Bool, +s: A.Surface, loops: List<&2, A.Loop>, +es: List<&2, A.Edge>, +vs: List<&2, G.Vec3>, +t: B64) -> Bool:
  match cyl:
    case True{}:
      cyl_edges_ok(List.reverse(&2, U32, face_edges(loops, Nil{})), s, es, vs, t)
    case False{}:
      True{}

def cyl_face_ok(f: A.Face, +es: List<&2, A.Edge>, +vs: List<&2, G.Vec3>, +t: B64) -> Bool:
  A.Face{+s, same, loops} = f
  cyl_check(is_cylinder(s), s, loops, es, vs, t)

def cyl_faces_ok(fs: List<&2, A.Face>, +es: List<&2, A.Edge>, +vs: List<&2, G.Vec3>, +t: B64) -> Bool:
  match fs:
    case Nil{}:
      True{}
    case f <> rest:
      Bool.and(cyl_face_ok(f, es, vs, t), cyl_faces_ok(rest, es, vs, t))

def validate(+k: K, s: A.Solid) -> Maybe<&2, String>:
  A.Solid{+vs, +es, +fs} = s
  or_err(edges_ok(es, vs, kres32(k), 0), or_err(faces_ok(fs, es, vs, kres32(k), 0),
    guard(cyl_faces_ok(fs, es, vs, kres(k)), "analytic line edge leaves a cylinder face (residual above 0.0003 mm)", None{})))

# --- 1 extrude_polygon (src/kernel.mjs extrudeInBend) --------------------------
#
# The profile ring merge (profile-ring.simplify; us = [the host's
# PROFILE_MERGE.allowRegularized]), then the F32x2 polygon prism on the kept
# points: polygon-prism.extrude(points, origin, normal, x, far) with
# src/kernel.mjs prismInputs (near cap origin = plane origin + start offset,
# far cap origin = + delta, both summed in binary64; x regularized within
# 1e-8 rad). Every input word is the real() split of the host binary64
# (src/real.mjs vector()), which is what the stream carries. A refusal is
# today's capability error text; its Real details (required / before /
# allowance) travel as [[R:<hi bits>:<lo bits>]] markers that the host
# formats exactly as today (number(x).toExponential(3), real-run.mjs).

def pts3(rs: List<&2, R.Real>, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match rs:
    case x <> y <> rest:
      pts3(rest, G.V3{x, y, R.Real{0.0, 0.0}} <> acc)
    case _:
      List.reverse(&2, G.Vec3, acc)

# The points at the kept indices (ascending, source order), i.e. the host's
# kept.map(index => points[index]) lifted again. pick_loop: cur starts at the
# kept index `at`; ks are the kept indices after it (it recurses on ks).
def drop_to(n: Nat, ps: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match n:
    case 0n:
      ps
    case 1n+m:
      match ps:
        case Nil{}:
          Nil{}
        case p <> rest:
          drop_to(m, rest)

def pick_loop(ks: List<&2, U32>, cur: List<&2, G.Vec3>, +at: U32, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match ks:
    case Nil{}:
      match cur:
        case Nil{}:
          List.reverse(&2, G.Vec3, acc)
        case p <> rest:
          List.reverse(&2, G.Vec3, p <> acc)
    case +k <> krest:
      match cur:
        case Nil{}:
          List.reverse(&2, G.Vec3, acc)
        case p <> rest:
          pick_loop(krest, drop_to(U32.to_nat(((k - at : U32) - 1 : U32)), rest), k, p <> acc)

def pick_kept(ps: List<&2, G.Vec3>, ks: List<&2, U32>) -> List<&2, G.Vec3>:
  match ks:
    case Nil{}:
      Nil{}
    case +k <> krest:
      pick_loop(krest, drop_to(U32.to_nat(k), ps), k, Nil{})

def at_vertex(i: U32) -> String:
  " at vertex " ++ U32.show(i)

def ring_reason(r: PR.Reason) -> String:
  match r:
    case PR.VertexCount{}:
      "VertexCount"
    case PR.InvalidPoint{i}:
      "InvalidPoint" ++ at_vertex(i)
    case PR.ShortEdge{i}:
      "ShortEdge" ++ at_vertex(i)
    case PR.Backtracking{i}:
      "Backtracking" ++ at_vertex(i)
    case PR.Sliver{i}:
      "Sliver" ++ at_vertex(i)
    case PR.NoCorner{}:
      "NoCorner"
    case PR.TooFewCorners{}:
      "TooFewCorners"

def rmark(r: R.Real) -> String:
  R.Real{hi, lo} = r
  "[[R:" ++ U32.show(F32.bits(hi)) ++ ":" ++ U32.show(F32.bits(lo)) ++ "]] mm"

def edge_detail(i: U32) -> String:
  " (profile edge " ++ U32.show(i) ++ ")"

def prism_reason(r: PP.Reason) -> String:
  match r:
    case PP.TooFewVertices{}:
      "TooFewVertices"
    case PP.InvalidInput{}:
      "InvalidInput"
    case PP.InvalidPoint{i}:
      "InvalidPoint" ++ edge_detail(i)
    case PP.InvalidFrame{}:
      "InvalidFrame"
    case PP.DegenerateSweep{}:
      "DegenerateSweep"
    case PP.ProfileOrientation{}:
      "ProfileOrientation"
    case PP.ZeroLengthEdge{i}:
      "ZeroLengthEdge" ++ edge_detail(i)
    case PP.NonRigidRotation{}:
      "NonRigidRotation"
    case PP.DanglingIndex{}:
      "DanglingIndex"
    case PP.IncidenceAudit{req, alw}:
      "IncidenceAudit (required " ++ rmark(req) ++ ", allowance " ++ rmark(alw) ++ ")"
    case PP.TransformDrift{req, bef, alw}:
      "TransformDrift (required " ++ rmark(req) ++ ", before " ++ rmark(bef) ++ ", allowance " ++ rmark(alw) ++ ")"

def ex_prism(o: PP.Outcome, +span: U32, rec: ProfileRec) -> Val:
  match o:
    case PP.Built{solid, required, allowance}:
      one(Poly{solid, required, allowance, rec <> Nil{}})
    case PP.Refused{reason}:
      VErr{1, span, "Polygon prism extrusion in Bend refused: " ++ prism_reason(reason)}

def ex_ring(r: PR.Ring, +span: U32, +points: List<&2, G.Vec3>, o: G.Vec3, n: G.Vec3, x: G.Vec3, f: G.Vec3) -> Val:
  match r:
    case PR.Refused{reason}:
      VErr{1, span, "Profile ring simplification in Bend refused the profile: " ++ ring_reason(reason)}
    case PR.Simplified{+kept, merged, tol}:
      +source = U32.from_nat(List.length(&2, G.Vec3, points))
      ex_prism(PP.extrude(pick_kept(points, kept), o, n, x, f), span, ProfileRec{source, kept, merged, tol})

def ex_args(+span: U32, allow: Bool, rs: List<&2, R.Real>) -> Val:
  match rs:
    case ox <> oy <> oz <> nx <> ny <> nz <> xx <> xy <> xz <> fx <> fy <> fz <> pts:
      +points = pts3(pts, Nil{})
      ex_ring(PR.simplify(points, allow), span, points, G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}, G.V3{fx, fy, fz})
    case _:
      VErr{4, span, "malformed extrude_polygon node"}

def op_extrude(+span: U32, us: List<&2, U32>, rs: List<&2, R.Real>) -> Val:
  match us:
    case allow <> Nil{}:
      ex_args(span, U32.is_ne(allow, 0), rs)
    case _:
      VErr{4, span, "malformed extrude_polygon node"}

# --- 2 frustum (src/analytic.mjs circularFrustumInBend) --------------------------

type Circ is Data:
  Circ{cx: R.Real, cy: R.Real, r: R.Real, o: G.Vec3, n: G.Vec3, x: G.Vec3}

type CircRes is Data:
  CircRes{c: Maybe<&2, Circ>, rest: List<&2, R.Real>}

def circ(rs: List<&2, R.Real>) -> CircRes:
  match rs:
    case cx <> cy <> r <> ox <> oy <> oz <> nx <> ny <> nz <> xx <> xy <> xz <> rest:
      CircRes{Some{Circ{cx, cy, r, G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}}}, rest}
    case _:
      CircRes{None{}, Nil{}}

def lift_circ(c: Circ, zero: R.Real) -> G.Vec3:
  Circ{cx, cy, r, o, n, x} = c
  G.lift(G.V3{cx, cy, zero}, G.frame(o, n, x))

def circ_normal(c: Circ) -> G.Vec3:
  Circ{cx, cy, r, o, n, x} = c
  n

def circ_x(c: Circ) -> G.Vec3:
  Circ{cx, cy, r, o, n, x} = c
  x

def circ_r(c: Circ) -> R.Real:
  Circ{cx, cy, r, o, n, x} = c
  r

# today: unsupported when Math.abs(number(dot(axis, n))) < 1 - 1e-6 (binary64)
def normals_ok(ns: List<&2, G.Vec3>, +axis: G.Vec3, +limit: B64) -> Bool:
  match ns:
    case Nil{}:
      True{}
    case n <> rest:
      Bool.and(Bool.not(lt64c(abs64(G.dot(axis, n)), limit)), normals_ok(rest, axis, limit))

def fr_done(m: Maybe<&2, String>, +span: U32, +solid: A.Solid, +bottom: G.Vec3, +top: G.Vec3, +r0: R.Real, +r1: R.Real) -> Val:
  match m:
    case Some{msg}:
      VErr{2, span, msg}
    case None{}:
      one(Ana{solid, autos(edge_count(solid)), Frus{rt_vec(bottom), rt_vec(top), rt(r0), rt(r1)}, Nil{}, A.frustum_volume_between(bottom, top, r0, r1) <> Nil{}, bounds_list(A.frustum_bounds(bottom, top, r0, r1)), 0, Nil{}, Nil{}})

def fr_build(+span: U32, +k: K, +bottom: G.Vec3, +top: G.Vec3, x: G.Vec3, +r0: R.Real, +r1: R.Real) -> Val:
  +solid = rt_solid(A.frustum(bottom, top, x, r0, r1))
  fr_done(validate(k, solid), span, solid, bottom, top, r0, r1)

def fr_normals(ok: Bool, +span: U32, +k: K, +bottom: G.Vec3, +top: G.Vec3, x: G.Vec3, +r0: R.Real, +r1: R.Real) -> Val:
  match ok:
    case True{}:
      fr_build(span, k, bottom, top, x, r0, r1)
    case False{}:
      VErr{1, span, "Circular loft/extrusion currently requires coaxial profiles and a normal sweep"}

def fr_height(ok: Bool, +span: U32, +k: K, +bottom: G.Vec3, +top: G.Vec3, +c1: Circ, ns: List<&2, G.Vec3>, +r1: R.Real) -> Val:
  match ok:
    case True{}:
      +axis = G.normalize(G.sub(top, bottom))
      fr_normals(normals_ok(ns, axis, kaxis(k)), span, k, bottom, top, circ_x(c1), circ_r(c1), r1)
    case False{}:
      VErr{2, span, "Circular loft/extrusion has zero or unresolved height"}

# today: fail when number(dot(d, d)) <= 1e-10 (binary64; NaN passes)
def fr_ends(+span: U32, +k: K, +bottom: G.Vec3, +top: G.Vec3, +c1: Circ, ns: List<&2, G.Vec3>, r1: R.Real) -> Val:
  +d = G.sub(top, bottom)
  fr_height(Bool.not(le64c(G.dot(d, d), kh2(k))), span, k, bottom, top, c1, ns, r1)

def fr_one(rest: List<&2, R.Real>, +span: U32, +k: K, +c1: Circ) -> Val:
  match rest:
    case dx <> dy <> dz <> fx <> fy <> fz <> Nil{}:
      +bottom = G.add(lift_circ(c1, kzero(k)), G.V3{fx, fy, fz})
      fr_ends(span, k, bottom, G.add(bottom, G.V3{dx, dy, dz}), c1, circ_normal(c1) <> Nil{}, circ_r(c1))
    case _:
      VErr{4, span, "malformed frustum node"}

def fr_two(r: CircRes, +span: U32, +k: K, +c1: Circ) -> Val:
  match r:
    case CircRes{m, rest}:
      match m:
        case Some{+c2}:
          match rest:
            case fx <> fy <> fz <> Nil{}:
              +bottom = G.add(lift_circ(c1, kzero(k)), G.V3{fx, fy, fz})
              fr_ends(span, k, bottom, lift_circ(c2, kzero(k)), c1, circ_normal(c1) <> circ_normal(c2) <> Nil{}, circ_r(c2))
            case _:
              VErr{4, span, "malformed frustum node"}
        case None{}:
          VErr{4, span, "malformed frustum node"}

def fr_first1(r: CircRes, +span: U32, +k: K) -> Val:
  match r:
    case CircRes{m, rest}:
      match m:
        case Some{c1}:
          fr_one(rest, span, k, c1)
        case None{}:
          VErr{4, span, "malformed frustum node"}

def fr_first2(r: CircRes, +span: U32, +k: K) -> Val:
  match r:
    case CircRes{m, rest}:
      match m:
        case Some{c1}:
          fr_two(circ(rest), span, k, c1)
        case None{}:
          VErr{4, span, "malformed frustum node"}

def fr_first(has_second: U32, r: CircRes, +span: U32, +k: K) -> Val:
  match has_second:
    case 0:
      fr_first1(r, span, k)
    case _:
      fr_first2(r, span, k)

def op_frustum(us: List<&2, U32>, rs: List<&2, R.Real>, +span: U32, +k: K) -> Val:
  match us:
    case has_second <> Nil{}:
      fr_first(has_second, circ(rs), span, k)
    case _:
      VErr{4, span, "malformed frustum node"}

# --- 3 transform (src/kernel.mjs transformInBend, src/analytic.mjs transformAnalytic) ---

type Tr is Data:
  Tr{pr: G.Rotation, po: G.Vec3}

# A polyhedral body: polygon-prism.transform of the body as the host hands it
# over (decodePrism, then real(): rt0_psolid), rotation columns and offset as
# the real() words the stream carries (transformInBend).
def tr_poly(o: PP.Outcome, +span: U32) -> Val:
  match o:
    case PP.Built{solid, required, allowance}:
      one(Poly{solid, required, allowance, Nil{}})
    case PP.Refused{reason}:
      VErr{1, span, "Polygon prism rigid transform in Bend refused: " ++ prism_reason(reason)}

def tr_cons(cons: U32, +res: A.Solid, domains: List<&2, F.DomainChoice>, budget: List<&2, R.Real>, volume: List<&2, R.Real>) -> Val:
  match cons:
    case 1:
      A.Solid{vs, es, fs} = res
      one(Ana{res, domains, NoPrim{}, budget, volume, bounds_list(B.rim_bounds(es)), 1, Nil{}, Nil{}})
    case 2:
      A.Solid{+vs, es, fs} = res
      +first = A.vertex_at(vs, 0)
      one(Ana{res, domains, NoPrim{}, budget, volume, bounds_list(H.bounds(vs, first, first)), 2, Nil{}, Nil{}})
    case 3:
      A.Solid{+vs, es, fs} = res
      +first = A.vertex_at(vs, 0)
      one(Ana{res, domains, NoPrim{}, budget, volume, bounds_list(H.bounds(vs, first, first)), 3, Nil{}, Nil{}})
    case 4:
      # transformAnalytic: a copied through-hole pierce keeps its exact volume, no bounds
      one(Ana{res, domains, NoPrim{}, budget, volume, Nil{}, 4, Nil{}, Nil{}})
    case _:
      one(Ana{res, domains, NoPrim{}, budget, Nil{}, Nil{}, 0, Nil{}, Nil{}})

def tr_measures(prim: Prim, +res: A.Solid, domains: List<&2, F.DomainChoice>, budget: List<&2, R.Real>, volume: List<&2, R.Real>, cons: U32, +pr: G.Rotation, +po: G.Vec3) -> Val:
  match prim:
    case Frus{b, t, +r0, +r1}:
      +b2 = A.point_transform(b, pr, po)
      +t2 = A.point_transform(t, pr, po)
      one(Ana{res, domains, Frus{rt_vec(b2), rt_vec(t2), r0, r1}, budget, A.frustum_volume_between(b2, t2, r0, r1) <> Nil{}, bounds_list(A.frustum_bounds(b2, t2, r0, r1)), cons, Nil{}, Nil{}})
    case NoPrim{}:
      tr_cons(cons, res, domains, budget, volume)

def tr_ana(m: Maybe<&2, String>, +span: U32, +res: A.Solid, domains: List<&2, F.DomainChoice>, prim: Prim, budget: List<&2, R.Real>, volume: List<&2, R.Real>, cons: U32, +pr: G.Rotation, +po: G.Vec3) -> Val:
  match m:
    case Some{msg}:
      VErr{2, span, msg}
    case None{}:
      tr_measures(prim, res, domains, budget, volume, cons, pr, po)

def tr_one(b: Body, +span: U32, +k: K, tr: Tr) -> Val:
  match b:
    case Poly{s, req, alw, ring}:
      Tr{pr, po} = tr
      tr_poly(PP.transform(rt0_psolid(s), pr, po), span)
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      Tr{+pr, +po} = tr
      +res = rt_solid(A.transform(solid, pr, po))
      tr_ana(validate(k, res), span, res, domains, prim, budget, volume, cons, pr, po)

def tr_all(bs: List<&2, Body>, +span: U32, +k: K, +tr: Tr) -> Val:
  match bs:
    case Nil{}:
      VBodies{Nil{}}
    case b <> rest:
      cons_val(tr_one(b, span, k, tr), tr_all(rest, span, k, tr))

def tr_rows(rs: List<&2, R.Real>, +span: U32, +k: K, bs: List<&2, Body>) -> Val:
  match rs:
    case +a00 <> +a01 <> +a02 <> +a10 <> +a11 <> +a12 <> +a20 <> +a21 <> +a22 <> +ox <> +oy <> +oz <> Nil{}:
      +pr = {G.Rotation{G.V3{a00, a10, a20}, G.V3{a01, a11, a21}, G.V3{a02, a12, a22}} : G.Rotation}
      tr_all(bs, span, k, Tr{pr, G.V3{ox, oy, oz}})
    case _:
      VErr{4, span, "malformed transform node"}

def tr_val(v: Val, +span: U32, +k: K, rs: List<&2, R.Real>) -> Val:
  match v:
    case VBodies{bs}:
      tr_rows(rs, span, k, bs)
    case VErr{c, s, m}:
      VErr{c, s, m}
    case VOk{}:
      VErr{4, span, "transform expects bodies"}

def op_transform(vals: List<&2, Val>, +span: U32, +k: K, rs: List<&2, R.Real>) -> Val:
  match vals:
    case v <> Nil{}:
      tr_val(v, span, k, rs)
    case _:
      VErr{4, span, "malformed transform node"}

# --- 4 boolean: today's host predicates (src/boolean.mjs booleanInBend) ---------
#
# Method codes: 1 COAXIAL, 2 PLANAR, 3 PIERCE, 5 PLANAR_INTERSECT, 6 CURVED,
# 7 NONE (no method applies). The recorded method must equal the one the
# operands actually need; otherwise the node fails (never switches).

def surf_level(s: A.Surface) -> U32:
  match s:
    case A.Plane{o, n, x}:
      0
    case A.Cylinder{o, a, x, r}:
      1
    case A.Cone{o, a, x, r, g}:
      2
    case A.Sphere{o, a, x, r}:
      3
    case A.Torus{o, a, x, big, small}:
      4

def curve_level(c: A.Curve) -> U32:
  match c:
    case A.Line{o, d}:
      0
    case A.Circle{o, n, x, r}:
      1
    case A.Ellipse{o, n, x, a, b}:
      2

def faces_max(fs: List<&2, A.Face>, acc: U32) -> U32:
  match fs:
    case Nil{}:
      acc
    case A.Face{s, same, loops} <> rest:
      faces_max(rest, U32.max(acc, surf_level(s)))

def edges_max(es: List<&2, A.Edge>, acc: U32) -> U32:
  match es:
    case Nil{}:
      acc
    case A.Edge{a, b, c, same} <> rest:
      edges_max(rest, U32.max(acc, curve_level(c)))

def all_auto(ds: List<&2, F.DomainChoice>) -> Bool:
  match ds:
    case Nil{}:
      True{}
    case d <> rest:
      match d:
        case F.AutoDomain{}:
          all_auto(rest)
        case F.GivenDomain{dom}:
          False{}

def prim_cyl(p: Prim) -> Bool:
  match p:
    case Frus{b, t, r0, r1}:
      R.equal(r0, r1)
    case NoPrim{}:
      False{}

def is_cyl(b: Body) -> Bool:
  match b:
    case Poly{s, req, alw, ring}:
      False{}
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      prim_cyl(prim)

def solid_flevel(s: A.Solid) -> U32:
  A.Solid{vs, es, fs} = s
  faces_max(fs, 0)

def solid_clevel(s: A.Solid) -> U32:
  A.Solid{vs, es, fs} = s
  edges_max(es, 0)

def solid_planar(+s: A.Solid) -> Bool:
  Bool.and(U32.is_eq(solid_flevel(s), 0), U32.is_eq(solid_clevel(s), 0))

# Surface level (0 plane, 1 cylinder, 2 cone) and curve level (0 line,
# 1 circle, 2 ellipse); a polyhedral body is planar with straight edges.
def flevel(b: Body) -> U32:
  match b:
    case Poly{s, req, alw, ring}:
      0
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      solid_flevel(solid)

def clevel(b: Body) -> U32:
  match b:
    case Poly{s, req, alw, ring}:
      0
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      solid_clevel(solid)

def no_ranges(b: Body) -> Bool:
  match b:
    case Poly{s, req, alw, ring}:
      True{}
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      all_auto(domains)

def budget_zero(b: Body) -> Bool:
  match b:
    case Poly{s, req, alw, ring}:
      True{}
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      match budget:
        case Nil{}:
          True{}
        case x <> rest:
          F32.is_eq(f32v(x), 0.0)

def planar_b(+b: Body) -> Bool:
  Bool.and(U32.is_eq(flevel(b), 0), U32.is_eq(clevel(b), 0))

def curved_b(+b: Body) -> Bool:
  Bool.and((flevel(b) <= 1 : U32), (clevel(b) <= 2 : U32))

def pierceable_b(+b: Body) -> Bool:
  Bool.and(Bool.and((flevel(b) <= 1 : U32), (clevel(b) <= 1 : U32)), no_ranges(b))

# The predicate order of src/boolean.mjs booleanInBend. op: 0 union,
# 1 intersection, 2 subtraction (its operationIndex).
def method_of(+op: U32, +a: Body, +b: Body) -> U32:
  +cb = is_cyl(b)
  +pa = Bool.and(planar_b(a), planar_b(b))
  Bool.pick(U32, Bool.and(is_cyl(a), cb), 1,
    Bool.pick(U32, Bool.and(U32.is_ne(op, 1), pa), 2,
      Bool.pick(U32, Bool.and(U32.is_eq(op, 1), Bool.and(pa, Bool.and(budget_zero(a), budget_zero(b)))), 5,
        Bool.pick(U32, Bool.and(U32.is_eq(op, 1), Bool.and(curved_b(a), curved_b(b))), 6,
          Bool.pick(U32, Bool.and(U32.is_eq(op, 2), Bool.and(pierceable_b(a), cb)), 3, 7)))))

def method_name(m: U32) -> String:
  match m:
    case 1:
      "COAXIAL"
    case 2:
      "PLANAR"
    case 3:
      "PIERCE"
    case 5:
      "PLANAR_INTERSECT"
    case 6:
      "CURVED"
    case 7:
      "NONE"
    case _:
      "UNKNOWN"

# classificationInput (src/face-classification.mjs): a polyhedral body is
# re-split from its decoded binary64 (rt0_psolid: decodePrism, then real() in
# polyhedralSolid / intersectionSurface), linear_edge per edge, one outer loop
# per plane face; analytic bodies are already round-tripped.
type Cin is Data:
  Cin{ok: Bool, solid: A.Solid, domains: List<&2, F.DomainChoice>, budget: R.Real}

def edges_checked(+vs: List<&2, G.Vec3>, es: List<&2, T.Edge>) -> Maybe<&2, List<&2, A.Edge>>:
  match es:
    case Nil{}:
      Some{Nil{}}
    case T.Edge{s, e} <> tail:
      do Maybe<&2, List<&2, A.Edge>>:
        edge : A.Edge <- F.linear_edge(vs, s, e)
        rest : List<&2, A.Edge> <- edges_checked(vs, tail)
        return edge <> rest

def poly_faces(fs: List<&2, PP.Face>) -> List<&2, A.Face>:
  match fs:
    case Nil{}:
      Nil{}
    case PP.Face{o, n, x, b} <> tail:
      A.Face{A.Plane{o, n, x}, True{}, A.Loop{True{}, b} <> Nil{}} <> poly_faces(tail)

def cin_poly(m: Maybe<&2, List<&2, A.Edge>>, vs: List<&2, G.Vec3>, fs: List<&2, PP.Face>, n: Nat, +zero: R.Real) -> Cin:
  match m:
    case Some{es}:
      Cin{True{}, A.Solid{vs, es, poly_faces(fs)}, autos(n), F.max_budget(Nil{}, zero)}
    case None{}:
      Cin{False{}, A.Solid{Nil{}, Nil{}, Nil{}}, Nil{}, zero}

def cin_psolid(s: PP.Solid, +zero: R.Real) -> Cin:
  PP.Solid{+vs, +es, fs} = s
  cin_poly(edges_checked(vs, es), vs, fs, List.length(&2, T.Edge, es), zero)

def budget_or(bs: List<&2, R.Real>, +zero: R.Real) -> R.Real:
  match bs:
    case Nil{}:
      F.max_budget(Nil{}, zero)
    case b <> rest:
      b

def cin(b: Body, +zero: R.Real) -> Cin:
  match b:
    case Poly{s, req, alw, ring}:
      cin_psolid(rt0_psolid(s), zero)
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      Cin{True{}, solid, domains, budget_or(budget, zero)}

# --- COAXIAL ---

def coax_one(m: Maybe<&2, String>, +span: U32, +rs: A.Solid, vol: R.Real, bnd: A.Bounds, tail: Val) -> Val:
  match m:
    case Some{msg}:
      VErr{2, span, msg}
    case None{}:
      A.Bounds{low, high} = bnd
      cons_val(one(Ana{rs, autos(edge_count(rs)), NoPrim{}, Nil{}, vol <> Nil{}, low <> high <> Nil{}, 1, Nil{}, Nil{}}), tail)

def coax_bodies(bs: List<&2, B.Body>, +span: U32, +k: K) -> Val:
  match bs:
    case Nil{}:
      VBodies{Nil{}}
    case B.Body{solid, volume, bounds} <> rest:
      +rs = rt_solid(solid)
      coax_one(validate(k, rs), span, rs, volume, bounds, coax_bodies(rest, span, k))

def coax_supported(ok: Bool, +span: U32, +k: K, bodies: List<&2, B.Body>) -> Val:
  match ok:
    case True{}:
      coax_bodies(bodies, span, k)
    case False{}:
      VErr{1, span, "opBoolean requires coaxial cylinders (axis tolerance 1e-9 mm) and retained radial/axial material intervals larger than 1e-7 mm"}

def coax_result(r: B.BooleanResult, +span: U32, +k: K) -> Val:
  match r:
    case B.BooleanResult{supported, void, bodies}:
      match void:
        case True{}:
          VErr{1, span, "opBoolean enclosed void shells are not implemented; through holes and open recesses are supported"}
        case False{}:
          coax_supported(supported, span, k, bodies)

def coax_b(pb: Prim, +span: U32, +k: K, op: U32, a0: G.Vec3, a1: G.Vec3, ra: R.Real) -> Val:
  match pb:
    case Frus{b0, b1, rb, rb1}:
      coax_result(B.coaxial(a0, a1, ra, b0, b1, rb, op), span, k)
    case NoPrim{}:
      VErr{4, span, "coaxial operand is not a frustum primitive"}

def coax_bb(b: Body, +span: U32, +k: K, op: U32, a0: G.Vec3, a1: G.Vec3, ra: R.Real) -> Val:
  match b:
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      coax_b(prim, span, k, op, a0, a1, ra)
    case Poly{s, req, alw, ring}:
      VErr{4, span, "coaxial operand is not a frustum primitive"}

def coax_a(pa: Prim, +span: U32, +k: K, op: U32, b: Body) -> Val:
  match pa:
    case Frus{a0, a1, ra, ra1}:
      coax_bb(b, span, k, op, a0, a1, ra)
    case NoPrim{}:
      VErr{4, span, "coaxial operand is not a frustum primitive"}

def op_coaxial(a: Body, +span: U32, +k: K, op: U32, b: Body) -> Val:
  match a:
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      coax_a(prim, span, k, op, b)
    case Poly{s, req, alw, ring}:
      VErr{4, span, "coaxial operand is not a frustum primitive"}

# --- PLANAR ---

def reason_name(r: PTY.Reason) -> String:
  match r:
    case PTY.InvalidInput{}:
      "InvalidInput"
    case PTY.InvalidTopology{}:
      "InvalidTopology"
    case PTY.UnsupportedSurface{}:
      "UnsupportedSurface"
    case PTY.UnsupportedCurve{}:
      "UnsupportedCurve"
    case PTY.UnsupportedDomain{}:
      "UnsupportedDomain"
    case PTY.SourceTolerance{}:
      "SourceTolerance"
    case PTY.AmbiguousContact{}:
      "AmbiguousContact"
    case PTY.UnsupportedArrangement{}:
      "UnsupportedArrangement"
    case PTY.ResolutionLimit{}:
      "ResolutionLimit"
    case PTY.ConstructionFailure{}:
      "ConstructionFailure"

def op_word(op: U32) -> String:
  match op:
    case 2:
      "subtraction"
    case _:
      "union"

def interval_ok(d: CP.Domain) -> Bool:
  match d:
    case CP.Untrimmed{}:
      False{}
    case CP.Interval{+a, +b}:
      Bool.and(Bool.and(fin2(a), fin2(b)), lt64v(a, b))

def intervals_ok(ds: List<&2, F.DomainChoice>) -> Bool:
  match ds:
    case Nil{}:
      True{}
    case d <> rest:
      match d:
        case F.AutoDomain{}:
          False{}
        case F.GivenDomain{dom}:
          Bool.and(interval_ok(dom), intervals_ok(rest))

# today (decodePlanarBoolean): fail when !Number.isFinite(volume) || volume <= 0
# || a bound is not finite || min >= max on an axis, all on binary64 numbers
def bound_ok(+l: R.Real, +h: R.Real) -> Bool:
  Bool.and(Bool.and(fin2(l), fin2(h)), lt64v(l, h))

def measures_ok(+zero: R.Real, +vol: R.Real, low: G.Vec3, high: G.Vec3) -> Bool:
  G.V3{lx, ly, lz} = low
  G.V3{hx, hy, hz} = high
  Bool.and(Bool.and(fin2(vol), pos64(vol)), Bool.and(bound_ok(lx, hx), Bool.and(bound_ok(ly, hy), bound_ok(lz, hz))))

# Planar provenance as words (pu); the host decoder (src/lang/wk/real-host.mjs)
# rebuilds today's construction.stats / faceOrigins / edgeOrigins and the
# operation evidence (stats, audits) from them exactly as
# src/planar-boolean.mjs decodePlanarBoolean and src/boolean.mjs publish them.
#   pu := stats(6) valid nfo (owner.operand owner.index ncontrib (operand index)*)*
#         neo (0 operand index | 1 fo fi so si | 2 n (operand index)*)*
def bool_word(b: Bool) -> U32:
  Bool.pick(U32, b, 1, 0)

def ref_words(r: PT.FaceRef, tail: List<&2, U32>) -> List<&2, U32>:
  PT.FaceRef{o, i} = r
  o <> i <> tail

def refs_words(rs: List<&2, PT.FaceRef>, tail: List<&2, U32>) -> List<&2, U32>:
  match rs:
    case Nil{}:
      tail
    case r <> rest:
      ref_words(r, refs_words(rest, tail))

def origin_words(o: PT.FaceOrigin, tail: List<&2, U32>) -> List<&2, U32>:
  PT.FaceOrigin{owner, +cs} = o
  ref_words(owner, U32.from_nat(List.length(&2, PT.FaceRef, cs)) <> refs_words(cs, tail))

def origins_words(fs: List<&2, PT.FaceOrigin>, tail: List<&2, U32>) -> List<&2, U32>:
  match fs:
    case Nil{}:
      tail
    case f <> rest:
      origin_words(f, origins_words(rest, tail))

def edge_origin_words(e: PT.EdgeOrigin, tail: List<&2, U32>) -> List<&2, U32>:
  match e:
    case PT.OriginalEdge{o, i}:
      0 <> o <> i <> tail
    case PT.FaceIntersection{a, b}:
      1 <> ref_words(a, ref_words(b, tail))
    case PT.FaceSubdivision{+fs}:
      2 <> U32.from_nat(List.length(&2, PT.FaceRef, fs)) <> refs_words(fs, tail)

def edge_origins_words(es: List<&2, PT.EdgeOrigin>, tail: List<&2, U32>) -> List<&2, U32>:
  match es:
    case Nil{}:
      tail
    case e <> rest:
      edge_origin_words(e, edge_origins_words(rest, tail))

def stats_words(s: PT.Stats, tail: List<&2, U32>) -> List<&2, U32>:
  PT.Stats{a, b, c, d, e, f} = s
  a <> b <> c <> d <> e <> f <> tail

def planar_pu(st: PT.Stats, valid: Bool, +fo: List<&2, PT.FaceOrigin>, +eo: List<&2, PT.EdgeOrigin>) -> List<&2, U32>:
  stats_words(st, bool_word(valid) <> U32.from_nat(List.length(&2, PT.FaceOrigin, fo))
    <> origins_words(fo, U32.from_nat(List.length(&2, PT.EdgeOrigin, eo)) <> edge_origins_words(eo, Nil{})))

# extra: audit required, allowance, resolution, audit volume, then the two
# classification input budgets and their maximum (evidence inputBudgets and
# sourceBudget = kernel real.max, as src/boolean.mjs computes them).
def planar_fin(m: Maybe<&2, String>, +span: U32, rs: A.Solid, domains: List<&2, F.DomainChoice>, sb: R.Real, vol: R.Real, low: G.Vec3, high: G.Vec3, cons: U32, audit: V.Audit, st: PT.Stats, fo: List<&2, PT.FaceOrigin>, eo: List<&2, PT.EdgeOrigin>, +ba: R.Real, +bb: R.Real) -> Val:
  match m:
    case Some{msg}:
      VErr{2, span, msg}
    case None{}:
      V.Audit{valid, allowance, required, resolution, avol} = audit
      one(Ana{rs, rt_domains(domains), NoPrim{}, sb <> Nil{}, vol <> Nil{}, low <> high <> Nil{}, cons,
        required <> allowance <> resolution <> avol <> ba <> bb <> R.max(ba, bb) <> Nil{}, planar_pu(st, valid, fo, eo)})

def planar_meas(meas: SI.PlanarMeasures, +span: U32, +k: K, sb: R.Real, cons: U32, +i: U32, +audit: V.Audit, +rs: A.Solid, +domains: List<&2, F.DomainChoice>, st: PT.Stats, fo: List<&2, PT.FaceOrigin>, eo: List<&2, PT.EdgeOrigin>, ba: R.Real, bb: R.Real) -> Val:
  match meas:
    case SI.PlanarMeasures{+vol, bnd}:
      A.Bounds{+low, +high} = bnd
      +ne = edge_count(rs)
      +err = guard(V.valid(audit), "Native planar arrangement component " ++ U32.show(i) ++ " failed its final audit",
        or_err(validate(k, rs),
        guard(solid_planar(rs), "Planar arrangement returned nonplanar geometry",
        guard(Bool.and(Nat.is_eq(List.length(&2, F.DomainChoice, domains), ne), intervals_ok(domains)), "Planar arrangement requires finite native line intervals",
        guard(measures_ok(kzero(k), vol, low, high), "Invalid native planar-arrangement measures", None{})))))
      planar_fin(err, span, rs, domains, sb, vol, low, high, cons, audit, st, fo, eo, ba, bb)

def planar_bodies(bs: List<&2, PT.Body>, +span: U32, +k: K, +sb: R.Real, +cons: U32, +i: U32, +st: PT.Stats, +ba: R.Real, +bb: R.Real) -> Val:
  match bs:
    case Nil{}:
      VBodies{Nil{}}
    case PT.Body{+solid, +domains, fo, eo} <> rest:
      +audit = CV.audit(solid, domains, ktol(k), sb)
      cons_val(planar_meas(SI.planar_measures(solid), span, k, sb, cons, i, audit, rt_solid(solid), domains, st, fo, eo, ba, bb), planar_bodies(rest, span, k, sb, cons, (i + 1 : U32), st, ba, bb))

def planar_budget(ok: Bool, +span: U32, +k: K, op: U32, bodies: List<&2, PT.Body>, +sb: R.Real, st: PT.Stats, ba: R.Real, bb: R.Real) -> Val:
  match ok:
    case True{}:
      planar_bodies(bodies, span, k, sb, Bool.pick(U32, U32.is_eq(op, 2), 3, 2), 0, st, ba, bb)
    case False{}:
      VErr{2, span, "Planar arrangement requires the original zero construction budget"}

def planar_result(r: PT.Result, +span: U32, +k: K, +op: U32, ba: R.Real, bb: R.Real) -> Val:
  match r:
    case PT.Unresolved{reason, stage, detail, sb, st}:
      VErr{1, span, "Native planar arrangement " ++ op_word(op) ++ " unresolved: " ++ reason_name(reason) ++ " (stage " ++ U32.show(stage) ++ ", detail " ++ U32.show(detail) ++ ")"}
    case PT.Bodies{bodies, +sb, st}:
      planar_budget(zero_real(sb), span, k, op, bodies, sb, st, ba, bb)

def planar_call(op: U32, sa: A.Solid, da: List<&2, F.DomainChoice>, ba: R.Real, sb: A.Solid, db: List<&2, F.DomainChoice>, bb: R.Real, tol: I.Tolerance) -> PT.Result:
  match op:
    case 2:
      PB.subtract(sa, da, ba, sb, db, bb, tol)
    case _:
      PB.union(sa, da, ba, sb, db, bb, tol)

def planar_ok(ok: Bool, +span: U32, +k: K, +op: U32, sa: A.Solid, da: List<&2, F.DomainChoice>, +ba: R.Real, sb: A.Solid, db: List<&2, F.DomainChoice>, +bb: R.Real) -> Val:
  match ok:
    case True{}:
      planar_result(planar_call(op, sa, da, ba, sb, db, bb, ktol(k)), span, k, op, ba, bb)
    case False{}:
      VErr{2, span, "Invalid planar Boolean topology"}

def planar_cb(cb: Cin, +span: U32, +k: K, op: U32, oka: Bool, sa: A.Solid, da: List<&2, F.DomainChoice>, ba: R.Real) -> Val:
  match cb:
    case Cin{okb, sb, db, bb}:
      planar_ok(Bool.and(oka, okb), span, k, op, sa, da, ba, sb, db, bb)

def planar_ca(ca: Cin, +span: U32, +k: K, op: U32, cb: Cin) -> Val:
  match ca:
    case Cin{oka, sa, da, ba}:
      planar_cb(cb, span, k, op, oka, sa, da, ba)

def op_planar(a: Body, +span: U32, +k: K, op: U32, b: Body) -> Val:
  planar_ca(cin(a, kzero(k)), span, k, op, cin(b, kzero(k)))

# --- PIERCE ---

def decline_msg(+r: U32) -> String:
  match r:
    case 1:
      "opBoolean through holes need an all-planar target with straight edges"
    case 2:
      "opBoolean through holes need a tool axis perpendicular to exactly two faces of the target"
    case 3:
      "opBoolean through-hole faces lie at the same height, so nothing is pierced"
    case 4:
      "opBoolean through hole does not clear a boundary edge of a face it pierces"
    case 5:
      "opBoolean through hole needs a positive radius"
    case 6:
      "opBoolean through hole needs a tool that reaches through both pierced faces; a blind pocket needs a floor this operation does not build"
    case 7:
      "opBoolean through hole must land in material; this axis misses the face it would pierce"
    case 8:
      "opBoolean through hole needs two pierced faces facing opposite ways; these two bound no material between them"
    case _:
      "opBoolean could not pierce this body (code " ++ U32.show(r) ++ ")"

# The inputs today's adapter computes in host binary64 (src/boolean.mjs): the
# tool axis (span = top - bottom, Math.hypot, span / length, real()), the
# tool's reach along it (real(min), real(max) of the binary64 projections)
# and the target volume real(a.validation.volumeMm3) (for a polyhedral
# target a binary64 integral, src/brep.mjs validateSolid). Bend has no
# binary64, so none of them is derived here: real-run.mjs evaluates the graph
# in stages, decodes the operands of every PIERCE node with today's decoders,
# runs today's code on them and sends the resulting words with the node.
# status: 0 inputs present; 1 today's `length === 0` (fail 'Pierce tool has
# no length'); 2 a real() RangeError before the kernel call; 3 a real()
# RangeError of the target volume, which today raises only after the pierce
# and the decode: the node is evaluated (tv = 0 words) and the host raises it
# after decoding (real-run.mjs). A PIERCE node without them is malformed.
type PIn is Data:
  PNone{}
  PIn{status: U32, axis: G.Vec3, lo: R.Real, hi: R.Real, tv: R.Real}

def pierce_done(m: Maybe<&2, String>, +span: U32, +rs: A.Solid, budget: R.Real, vol: R.Real, depth: R.Real) -> Val:
  match m:
    case Some{msg}:
      VErr{2, span, msg}
    case None{}:
      one(Ana{rs, autos(edge_count(rs)), NoPrim{}, budget <> Nil{}, vol <> Nil{}, Nil{}, 4, depth <> Nil{}, Nil{}})

def pierce_res(r: P.Pierced, +span: U32, +k: K, +target: A.Solid, budget: R.Real, +axis: G.Vec3, +radius: R.Real, tv: R.Real) -> Val:
  match r:
    case P.Declined{reason}:
      VErr{1, span, decline_msg(reason)}
    case P.Bored{solid}:
      +rs = rt_solid(solid)
      +depth = P.bore_depth(target, axis, klin(k))
      pierce_done(validate(k, rs), span, rs, budget, P.pierced_volume(tv, radius, depth), depth)

def pierce_bore(+span: U32, +k: K, +solid: A.Solid, budget: R.Real, bottom: G.Vec3, +radius: R.Real, +axis: G.Vec3, lo: R.Real, hi: R.Real, tv: R.Real) -> Val:
  pierce_res(P.pierce(solid, bottom, axis, radius, lo, hi, klin(k)), span, k, solid, budget, axis, radius, tv)

def pierce_status(+status: U32, +span: U32, +k: K, +solid: A.Solid, +budget: R.Real, +bottom: G.Vec3, +radius: R.Real, +axis: G.Vec3, +lo: R.Real, +hi: R.Real, +tv: R.Real) -> Val:
  match status:
    case 0:
      pierce_bore(span, k, solid, budget, bottom, radius, axis, lo, hi, tv)
    case 1:
      VErr{2, span, "Pierce tool has no length"}
    case 2:
      VErr{5, span, "Bend Real serialization requires a finite magnitude <= 1e20 without F32 exponent underflow"}
    case 3:
      pierce_bore(span, k, solid, budget, bottom, radius, axis, lo, hi, tv)
    case _:
      VErr{4, span, "malformed boolean node: unknown PIERCE host status " ++ U32.show(status)}

def pierce_in(pin: PIn, +span: U32, +k: K, +solid: A.Solid, budget: R.Real, bottom: G.Vec3, +radius: R.Real) -> Val:
  match pin:
    case PNone{}:
      VErr{4, span, "malformed boolean node: a PIERCE node needs the host inputs (axis, reach, target volume)"}
    case PIn{status, axis, lo, hi, tv}:
      pierce_status(status, span, k, solid, budget, bottom, radius, axis, lo, hi, tv)

# today: classificationInput(a) first ('Invalid pierce topology'), then the host inputs
def pierce_cin(c: Cin, +span: U32, +k: K, bottom: G.Vec3, +radius: R.Real, pin: PIn) -> Val:
  match c:
    case Cin{ok, solid, domains, budget}:
      match ok:
        case True{}:
          pierce_in(pin, span, k, solid, budget, bottom, radius)
        case False{}:
          VErr{2, span, "Invalid pierce topology"}

def pierce_tool(prim: Prim, +span: U32, +k: K, +a: Body, pin: PIn) -> Val:
  match prim:
    case Frus{bottom, top, r0, r1}:
      pierce_cin(cin(a, kzero(k)), span, k, bottom, r0, pin)
    case NoPrim{}:
      VErr{4, span, "pierce tool is not a cylinder primitive"}

def op_pierce(b: Body, +span: U32, +k: K, a: Body, pin: PIn) -> Val:
  match b:
    case Ana{solid, domains, prim, budget, volume, bounds, cons, extra, pu}:
      pierce_tool(prim, span, k, a, pin)
    case Poly{s, req, alw, ring}:
      VErr{4, span, "pierce tool is not a cylinder primitive"}

# --- dispatch, method and count checks ---

def bool_run(+method: U32, +span: U32, +k: K, op: U32, a: Body, b: Body, pin: PIn) -> Val:
  match method:
    case 1:
      op_coaxial(a, span, k, op, b)
    case 2:
      op_planar(a, span, k, op, b)
    case 3:
      op_pierce(b, span, k, a, pin)
    case 5:
      VErr{1, span, "Boolean method PLANAR_INTERSECT (native Bend planar intersection) is not in the WK native evaluator"}
    case 6:
      VErr{1, span, "Boolean method CURVED (native Bend curved convex-tool intersection) is not in the WK native evaluator"}
    case 7:
      VErr{1, span, "opBoolean supports coaxial cylinder primitives, admitted planar arrangement unions/subtractions, plane/cylinder intersections with a convex tool and a round through hole in a planar body; general trimmed-face booleans are not implemented"}
    case _:
      VErr{1, span, "unknown Boolean method code " ++ U32.show(method)}

def count_ok(ok: Bool, +span: U32, +n: U32, +expected: U32, bs: List<&2, Body>) -> Val:
  match ok:
    case True{}:
      VBodies{bs}
    case False{}:
      VErr{3, span, "count speculation failed: this Boolean produced " ++ U32.show(n) ++ " bodies, the recorded program assumed " ++ U32.show(expected)}

def count_check(v: Val, +span: U32, +expected: U32) -> Val:
  match v:
    case VBodies{+bs}:
      +n = U32.from_nat(List.length(&2, Body, bs))
      count_ok(U32.is_eq(n, expected), span, n, expected, bs)
    case VErr{c, s, m}:
      VErr{c, s, m}
    case VOk{}:
      VOk{}

def bool_check(ok: Bool, +span: U32, +k: K, +method: U32, actual: U32, op: U32, comps: U32, a: Body, b: Body, pin: PIn) -> Val:
  match ok:
    case True{}:
      count_check(bool_run(method, span, k, op, a, b, pin), span, comps)
    case False{}:
      VErr{1, span, "Boolean method speculation failed: the graph records " ++ method_name(method) ++ ", the operands need " ++ method_name(actual)}

def bool_go(+span: U32, +k: K, +method: U32, +op: U32, comps: U32, +a: Body, +b: Body, pin: PIn) -> Val:
  +actual = method_of(op, a, b)
  bool_check(U32.is_eq(actual, method), span, k, method, actual, op, comps, a, b, pin)

def bool_b(bs: List<&2, Body>, +span: U32, +k: K, method: U32, op: U32, comps: U32, a: Body, pin: PIn) -> Val:
  match bs:
    case b <> Nil{}:
      bool_go(span, k, method, op, comps, a, b, pin)
    case _:
      VErr{3, span, "count speculation failed: a Boolean operand is not exactly one body"}

def bool_a(as: List<&2, Body>, +span: U32, +k: K, method: U32, op: U32, comps: U32, bs: List<&2, Body>, pin: PIn) -> Val:
  match as:
    case a <> Nil{}:
      bool_b(bs, span, k, method, op, comps, a, pin)
    case _:
      VErr{3, span, "count speculation failed: a Boolean operand is not exactly one body"}

def bool_vb(vb: Val, +span: U32, +k: K, method: U32, op: U32, comps: U32, as: List<&2, Body>, pin: PIn) -> Val:
  match vb:
    case VBodies{bs}:
      bool_a(as, span, k, method, op, comps, bs, pin)
    case VErr{c, s, m}:
      VErr{c, s, m}
    case VOk{}:
      VErr{4, span, "Boolean expects bodies"}

def bool_va(va: Val, +span: U32, +k: K, method: U32, op: U32, comps: U32, vb: Val, pin: PIn) -> Val:
  match va:
    case VBodies{as}:
      bool_vb(vb, span, k, method, op, comps, as, pin)
    case VErr{c, s, m}:
      VErr{c, s, m}
    case VOk{}:
      VErr{4, span, "Boolean expects bodies"}

# us: method op components, plus the PIERCE host status for a PIERCE node;
# rs: nothing, or for a PIERCE node its host inputs axis (3), reach low,
# reach high and target volume (see PIn).
def bool_vals(vals: List<&2, Val>, +span: U32, +k: K, method: U32, op: U32, comps: U32, pin: PIn) -> Val:
  match vals:
    case va <> vb <> Nil{}:
      bool_va(va, span, k, method, op, comps, vb, pin)
    case _:
      VErr{4, span, "malformed boolean node"}

def bool_host(rs: List<&2, R.Real>, +span: U32, +k: K, vals: List<&2, Val>, method: U32, op: U32, comps: U32, status: U32) -> Val:
  match rs:
    case ax <> ay <> az <> lo <> hi <> tv <> Nil{}:
      bool_vals(vals, span, k, method, op, comps, PIn{status, G.V3{ax, ay, az}, lo, hi, tv})
    case _:
      VErr{4, span, "malformed boolean node"}

def bool_plain(rs: List<&2, R.Real>, +span: U32, +k: K, vals: List<&2, Val>, method: U32, op: U32, comps: U32) -> Val:
  match rs:
    case Nil{}:
      bool_vals(vals, span, k, method, op, comps, PNone{})
    case _:
      VErr{4, span, "malformed boolean node"}

def op_boolean(us: List<&2, U32>, rs: List<&2, R.Real>, vals: List<&2, Val>, +span: U32, +k: K) -> Val:
  match us:
    case method <> op <> comps <> Nil{}:
      bool_plain(rs, span, k, vals, method, op, comps)
    case method <> op <> comps <> status <> Nil{}:
      bool_host(rs, span, k, vals, method, op, comps, status)
    case _:
      VErr{4, span, "malformed boolean node"}

# --- 5 expect_count ---

def first_error(vs: List<&2, Val>) -> Maybe<&2, Val>:
  match vs:
    case Nil{}:
      None{}
    case v <> rest:
      match v:
        case VErr{c, s, m}:
          Some{VErr{c, s, m}}
        case _:
          first_error(rest)

def count_bodies(vs: List<&2, Val>, acc: U32) -> U32:
  match vs:
    case Nil{}:
      acc
    case v <> rest:
      match v:
        case VBodies{bs}:
          count_bodies(rest, (acc + U32.from_nat(List.length(&2, Body, bs)) : U32))
        case _:
          count_bodies(rest, acc)

def expect_ok(ok: Bool, +span: U32, +n: U32, +expected: U32) -> Val:
  match ok:
    case True{}:
      VOk{}
    case False{}:
      VErr{3, span, "count speculation failed: the program observed " ++ U32.show(expected) ++ " bodies here; the graph produced " ++ U32.show(n)}

def expect_go(e: Maybe<&2, Val>, +span: U32, +vals: List<&2, Val>, +expected: U32) -> Val:
  match e:
    case Some{v}:
      v
    case None{}:
      +n = count_bodies(vals, 0)
      expect_ok(U32.is_eq(n, expected), span, n, expected)

def op_expect(vals: List<&2, Val>, +span: U32, us: List<&2, U32>) -> Val:
  match us:
    case expected <> Nil{}:
      +vs = vals
      expect_go(first_error(vs), span, vs, expected)
    case _:
      VErr{4, span, "malformed expect_count node"}

# --- 6 literal: bodies from the host cache, in the output layout ---------------
#
# u stream: body := 0 nv ne (s e)* nf (nuse (edge fwd)*)* nrec
#                     [source nkept kept* nmerged (index exact)*]  polyhedral
#                 | 1 nv ne (s e ctag same)* nf (stag same nloops
#                     (outer nuse (edge fwd)*)*)* ndom dtag* ptag nbudget nvol
#                     nbounds cons nextra npu pu*                  analytic
# r stream (one F32x2 each): polyhedral vertices (3 each), faces (origin normal
#   x), required, allowance, [tolerance, deviation per merge]; analytic
#   vertices, curve params, surface params, domain bounds, primitive (bottom
#   top r0 r1), budget, volume, bounds (low high), extra. nrec is 0 or 1 (the
#   profile ring record of an extrusion).
# Every loop below is one self-recursive def over a fuel Nat whose previous
# step result arrives as a parameter (no mutual recursion in Bend).

type Cur is Data:
  Cur{us: List<&2, U32>, rs: List<&2, R.Real>}

def dead() -> Cur:
  Cur{Nil{}, Nil{}}

type U32sC is Data:
  U32sC{xs: List<&2, U32>, c: Cur}

def read_u32s(n: Nat, c: Cur, acc: List<&2, U32>) -> U32sC:
  match n:
    case 0n:
      U32sC{List.reverse(&2, U32, acc), c}
    case 1n+p:
      match c:
        case Cur{us, rs}:
          match us:
            case x <> rest:
              read_u32s(p, Cur{rest, rs}, x <> acc)
            case _:
              U32sC{Nil{}, dead()}

type VecsC is Data:
  VecsC{xs: List<&2, G.Vec3>, c: Cur}

def read_vecs(n: Nat, c: Cur, acc: List<&2, G.Vec3>) -> VecsC:
  match n:
    case 0n:
      VecsC{List.reverse(&2, G.Vec3, acc), c}
    case 1n+p:
      match c:
        case Cur{us, rs}:
          match rs:
            case x <> y <> z <> rest:
              read_vecs(p, Cur{us, rest}, G.V3{x, y, z} <> acc)
            case _:
              VecsC{Nil{}, dead()}

type RealsC is Data:
  RealsC{xs: List<&2, R.Real>, c: Cur}

def read_reals(n: Nat, c: Cur, acc: List<&2, R.Real>) -> RealsC:
  match n:
    case 0n:
      RealsC{List.reverse(&2, R.Real, acc), c}
    case 1n+p:
      match c:
        case Cur{us, rs}:
          match rs:
            case x <> rest:
              read_reals(p, Cur{us, rest}, x <> acc)
            case _:
              RealsC{Nil{}, dead()}

type UsesC is Data:
  UsesC{xs: List<&2, T.Coedge>, c: Cur}

def read_uses(n: Nat, c: Cur, acc: List<&2, T.Coedge>) -> UsesC:
  match n:
    case 0n:
      UsesC{List.reverse(&2, T.Coedge, acc), c}
    case 1n+p:
      match c:
        case Cur{us, rs}:
          match us:
            case e <> f <> rest:
              read_uses(p, Cur{rest, rs}, T.Use{e, U32.is_ne(f, 0)} <> acc)
            case _:
              UsesC{Nil{}, dead()}

type PEdgesC is Data:
  PEdgesC{xs: List<&2, T.Edge>, c: Cur}

def read_pedges(n: Nat, c: Cur, acc: List<&2, T.Edge>) -> PEdgesC:
  match n:
    case 0n:
      PEdgesC{List.reverse(&2, T.Edge, acc), c}
    case 1n+p:
      match c:
        case Cur{us, rs}:
          match us:
            case s <> e <> rest:
              read_pedges(p, Cur{rest, rs}, T.Edge{s, e} <> acc)
            case _:
              PEdgesC{Nil{}, dead()}

type PFaceC is Data:
  PFaceC{f: Maybe<&2, PP.Face>, c: Cur}

def pface_fin(o: G.Vec3, n: G.Vec3, x: G.Vec3, r: UsesC) -> PFaceC:
  match r:
    case UsesC{uses, c}:
      PFaceC{Some{PP.Face{o, n, x, uses}}, c}

def read_pface(c: Cur) -> PFaceC:
  match c:
    case Cur{us, rs}:
      match us:
        case nu <> urest:
          match rs:
            case ox <> oy <> oz <> nx <> ny <> nz <> xx <> xy <> xz <> rrest:
              pface_fin(G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}, read_uses(U32.to_nat(nu), Cur{urest, rrest}, Nil{}))
            case _:
              PFaceC{None{}, dead()}
        case _:
          PFaceC{None{}, dead()}

def push_pface(m: Maybe<&2, PP.Face>, acc: List<&2, PP.Face>) -> List<&2, PP.Face>:
  match m:
    case Some{f}:
      f <> acc
    case None{}:
      acc

type PFacesC is Data:
  PFacesC{xs: List<&2, PP.Face>, c: Cur}

def pfaces_loop(n: Nat, r: PFaceC, acc: List<&2, PP.Face>) -> PFacesC:
  match n:
    case 0n:
      match r:
        case PFaceC{m, c}:
          PFacesC{List.reverse(&2, PP.Face, push_pface(m, acc)), c}
    case 1n+p:
      match r:
        case PFaceC{m, c}:
          pfaces_loop(p, read_pface(c), push_pface(m, acc))

type BodyC is Data:
  BodyC{b: Maybe<&2, Body>, c: Cur}

type MergesC is Data:
  MergesC{xs: List<&2, PR.Merge>, c: Cur}

def read_merges(n: Nat, c: Cur, acc: List<&2, PR.Merge>) -> MergesC:
  match n:
    case 0n:
      MergesC{List.reverse(&2, PR.Merge, acc), c}
    case 1n+p:
      match c:
        case Cur{us, rs}:
          match us:
            case i <> e <> urest:
              match rs:
                case d <> rrest:
                  read_merges(p, Cur{urest, rrest}, PR.Merge{i, d, U32.is_ne(e, 0)} <> acc)
                case _:
                  MergesC{Nil{}, dead()}
            case _:
              MergesC{Nil{}, dead()}

def poly_merged(s: PP.Solid, req: R.Real, alw: R.Real, source: U32, tol: R.Real, kept: List<&2, U32>, r: MergesC) -> BodyC:
  match r:
    case MergesC{ms, c}:
      BodyC{Some{Poly{s, req, alw, ProfileRec{source, kept, ms, tol} <> Nil{}}}, c}

def poly_kept(s: PP.Solid, req: R.Real, alw: R.Real, source: U32, tol: R.Real, r: U32sC) -> BodyC:
  match r:
    case U32sC{kept, c}:
      match c:
        case Cur{us, rs}:
          match us:
            case nm <> urest:
              poly_merged(s, req, alw, source, tol, kept, read_merges(U32.to_nat(nm), Cur{urest, rs}, Nil{}))
            case _:
              BodyC{None{}, dead()}

def poly_rec(s: PP.Solid, req: R.Real, alw: R.Real, c: Cur) -> BodyC:
  match c:
    case Cur{us, rs}:
      match us:
        case source <> nkept <> urest:
          match rs:
            case tol <> rrest:
              poly_kept(s, req, alw, source, tol, read_u32s(U32.to_nat(nkept), Cur{urest, rrest}, Nil{}))
            case _:
              BodyC{None{}, dead()}
        case _:
          BodyC{None{}, dead()}

def poly_nrec(nrec: U32, s: PP.Solid, req: R.Real, alw: R.Real, c: Cur) -> BodyC:
  match nrec:
    case 0:
      BodyC{Some{Poly{s, req, alw, Nil{}}}, c}
    case 1:
      poly_rec(s, req, alw, c)
    case _:
      BodyC{None{}, dead()}

def poly_audit(s: PP.Solid, c: Cur) -> BodyC:
  match c:
    case Cur{us, rs}:
      match us:
        case nrec <> urest:
          match rs:
            case req <> alw <> rrest:
              poly_nrec(nrec, s, req, alw, Cur{urest, rrest})
            case _:
              BodyC{None{}, dead()}
        case _:
          BodyC{None{}, dead()}

def poly_fin(vs: List<&2, G.Vec3>, es: List<&2, T.Edge>, r: PFacesC) -> BodyC:
  match r:
    case PFacesC{fs, c}:
      poly_audit(PP.Solid{vs, es, fs}, c)

def poly_faces_c(vs: List<&2, G.Vec3>, r: PEdgesC) -> BodyC:
  match r:
    case PEdgesC{es, c}:
      match c:
        case Cur{us, rs}:
          match us:
            case nf <> rest:
              poly_fin(vs, es, pfaces_loop(U32.to_nat(nf), PFaceC{None{}, Cur{rest, rs}}, Nil{}))
            case _:
              BodyC{None{}, dead()}

def poly_edges_c(r: VecsC, ne: U32) -> BodyC:
  match r:
    case VecsC{vs, c}:
      poly_faces_c(vs, read_pedges(U32.to_nat(ne), c, Nil{}))

# analytic parts

type CurveC is Data:
  CurveC{x: Maybe<&2, A.Curve>, c: Cur}

def read_curve(tag: U32, c: Cur) -> CurveC:
  match tag:
    case 0:
      match c:
        case Cur{us, rs}:
          match rs:
            case a <> b <> d <> e <> f <> g <> rest:
              CurveC{Some{A.Line{G.V3{a, b, d}, G.V3{e, f, g}}}, Cur{us, rest}}
            case _:
              CurveC{None{}, dead()}
    case 1:
      match c:
        case Cur{us, rs}:
          match rs:
            case a <> b <> d <> e <> f <> g <> h <> i <> j <> r <> rest:
              CurveC{Some{A.Circle{G.V3{a, b, d}, G.V3{e, f, g}, G.V3{h, i, j}, r}}, Cur{us, rest}}
            case _:
              CurveC{None{}, dead()}
    case _:
      match c:
        case Cur{us, rs}:
          match rs:
            case a <> b <> d <> e <> f <> g <> h <> i <> j <> r1 <> r2 <> rest:
              CurveC{Some{A.Ellipse{G.V3{a, b, d}, G.V3{e, f, g}, G.V3{h, i, j}, r1, r2}}, Cur{us, rest}}
            case _:
              CurveC{None{}, dead()}

type SurfC is Data:
  SurfC{x: Maybe<&2, A.Surface>, c: Cur}

def read_surface(tag: U32, c: Cur) -> SurfC:
  match tag:
    case 0:
      match c:
        case Cur{us, rs}:
          match rs:
            case a <> b <> d <> e <> f <> g <> h <> i <> j <> rest:
              SurfC{Some{A.Plane{G.V3{a, b, d}, G.V3{e, f, g}, G.V3{h, i, j}}}, Cur{us, rest}}
            case _:
              SurfC{None{}, dead()}
    case 1:
      match c:
        case Cur{us, rs}:
          match rs:
            case a <> b <> d <> e <> f <> g <> h <> i <> j <> r <> rest:
              SurfC{Some{A.Cylinder{G.V3{a, b, d}, G.V3{e, f, g}, G.V3{h, i, j}, r}}, Cur{us, rest}}
            case _:
              SurfC{None{}, dead()}
    case _:
      match c:
        case Cur{us, rs}:
          match rs:
            case a <> b <> d <> e <> f <> g <> h <> i <> j <> r <> ang <> rest:
              SurfC{Some{A.Cone{G.V3{a, b, d}, G.V3{e, f, g}, G.V3{h, i, j}, r, ang}}, Cur{us, rest}}
            case _:
              SurfC{None{}, dead()}

type EdgeStep is Data:
  EdgeStep{e: Maybe<&2, A.Edge>, c: Cur}

def edge_mk(s: U32, e: U32, same: U32, r: CurveC) -> EdgeStep:
  match r:
    case CurveC{m, c}:
      match m:
        case Some{curve}:
          EdgeStep{Some{A.Edge{s, e, curve, U32.is_ne(same, 0)}}, c}
        case None{}:
          EdgeStep{None{}, dead()}

def edge_step(c: Cur) -> EdgeStep:
  match c:
    case Cur{us, rs}:
      match us:
        case s <> e <> tag <> same <> rest:
          edge_mk(s, e, same, read_curve(tag, Cur{rest, rs}))
        case _:
          EdgeStep{None{}, dead()}

def push_edge(m: Maybe<&2, A.Edge>, acc: List<&2, A.Edge>) -> List<&2, A.Edge>:
  match m:
    case Some{x}:
      x <> acc
    case None{}:
      acc

type AEdgesC is Data:
  AEdgesC{xs: List<&2, A.Edge>, c: Cur}

def aedges_loop(n: Nat, r: EdgeStep, acc: List<&2, A.Edge>) -> AEdgesC:
  match n:
    case 0n:
      match r:
        case EdgeStep{m, c}:
          AEdgesC{List.reverse(&2, A.Edge, push_edge(m, acc)), c}
    case 1n+p:
      match r:
        case EdgeStep{m, c}:
          aedges_loop(p, edge_step(c), push_edge(m, acc))

type LoopStep is Data:
  LoopStep{l: Maybe<&2, A.Loop>, c: Cur}

def loop_mk(outer: U32, r: UsesC) -> LoopStep:
  match r:
    case UsesC{uses, c}:
      LoopStep{Some{A.Loop{U32.is_ne(outer, 0), uses}}, c}

def loop_step(c: Cur) -> LoopStep:
  match c:
    case Cur{us, rs}:
      match us:
        case outer <> nu <> rest:
          loop_mk(outer, read_uses(U32.to_nat(nu), Cur{rest, rs}, Nil{}))
        case _:
          LoopStep{None{}, dead()}

def push_loop(m: Maybe<&2, A.Loop>, acc: List<&2, A.Loop>) -> List<&2, A.Loop>:
  match m:
    case Some{x}:
      x <> acc
    case None{}:
      acc

type LoopsC is Data:
  LoopsC{xs: List<&2, A.Loop>, c: Cur}

def loops_loop(n: Nat, r: LoopStep, acc: List<&2, A.Loop>) -> LoopsC:
  match n:
    case 0n:
      match r:
        case LoopStep{m, c}:
          LoopsC{List.reverse(&2, A.Loop, push_loop(m, acc)), c}
    case 1n+p:
      match r:
        case LoopStep{m, c}:
          loops_loop(p, loop_step(c), push_loop(m, acc))

type FaceStep is Data:
  FaceStep{f: Maybe<&2, A.Face>, c: Cur}

def face_mk2(s: A.Surface, same: U32, r: LoopsC) -> FaceStep:
  match r:
    case LoopsC{ls, c}:
      FaceStep{Some{A.Face{s, U32.is_ne(same, 0), ls}}, c}

def face_mk(same: U32, nl: U32, r: SurfC) -> FaceStep:
  match r:
    case SurfC{m, c}:
      match m:
        case Some{s}:
          face_mk2(s, same, loops_loop(U32.to_nat(nl), LoopStep{None{}, c}, Nil{}))
        case None{}:
          FaceStep{None{}, dead()}

def face_step(c: Cur) -> FaceStep:
  match c:
    case Cur{us, rs}:
      match us:
        case stag <> same <> nl <> rest:
          face_mk(same, nl, read_surface(stag, Cur{rest, rs}))
        case _:
          FaceStep{None{}, dead()}

def push_face(m: Maybe<&2, A.Face>, acc: List<&2, A.Face>) -> List<&2, A.Face>:
  match m:
    case Some{x}:
      x <> acc
    case None{}:
      acc

type AFacesC is Data:
  AFacesC{xs: List<&2, A.Face>, c: Cur}

def afaces_loop(n: Nat, r: FaceStep, acc: List<&2, A.Face>) -> AFacesC:
  match n:
    case 0n:
      match r:
        case FaceStep{m, c}:
          AFacesC{List.reverse(&2, A.Face, push_face(m, acc)), c}
    case 1n+p:
      match r:
        case FaceStep{m, c}:
          afaces_loop(p, face_step(c), push_face(m, acc))

type DomStep is Data:
  DomStep{d: Maybe<&2, F.DomainChoice>, c: Cur}

def dom_given(rs: List<&2, R.Real>, us: List<&2, U32>) -> DomStep:
  match rs:
    case a <> b <> rest:
      DomStep{Some{F.GivenDomain{CP.Interval{a, b}}}, Cur{us, rest}}
    case _:
      DomStep{None{}, dead()}

def dom_tag(tag: U32, us: List<&2, U32>, rs: List<&2, R.Real>) -> DomStep:
  match tag:
    case 0:
      DomStep{Some{F.AutoDomain{}}, Cur{us, rs}}
    case 1:
      dom_given(rs, us)
    case _:
      DomStep{Some{F.GivenDomain{CP.Untrimmed{}}}, Cur{us, rs}}

def dom_step(c: Cur) -> DomStep:
  match c:
    case Cur{us, rs}:
      match us:
        case tag <> rest:
          dom_tag(tag, rest, rs)
        case _:
          DomStep{None{}, dead()}

def push_dom(m: Maybe<&2, F.DomainChoice>, acc: List<&2, F.DomainChoice>) -> List<&2, F.DomainChoice>:
  match m:
    case Some{x}:
      x <> acc
    case None{}:
      acc

type DomsC is Data:
  DomsC{xs: List<&2, F.DomainChoice>, c: Cur}

def doms_loop(n: Nat, r: DomStep, acc: List<&2, F.DomainChoice>) -> DomsC:
  match n:
    case 0n:
      match r:
        case DomStep{m, c}:
          DomsC{List.reverse(&2, F.DomainChoice, push_dom(m, acc)), c}
    case 1n+p:
      match r:
        case DomStep{m, c}:
          doms_loop(p, dom_step(c), push_dom(m, acc))

type PrimC is Data:
  PrimC{p: Prim, c: Cur}

def prim_frus(rs: List<&2, R.Real>, us: List<&2, U32>) -> PrimC:
  match rs:
    case a <> b <> d <> e <> f <> g <> r0 <> r1 <> rest:
      PrimC{Frus{G.V3{a, b, d}, G.V3{e, f, g}, r0, r1}, Cur{us, rest}}
    case _:
      PrimC{NoPrim{}, dead()}

def prim_tag(tag: U32, us: List<&2, U32>, rs: List<&2, R.Real>) -> PrimC:
  match tag:
    case 0:
      PrimC{NoPrim{}, Cur{us, rs}}
    case _:
      prim_frus(rs, us)

def read_prim(c: Cur) -> PrimC:
  match c:
    case Cur{us, rs}:
      match us:
        case tag <> rest:
          prim_tag(tag, rest, rs)
        case _:
          PrimC{NoPrim{}, dead()}

# Tail of an analytic body: nbudget nvol nbounds cons nextra (u) and their reals.
type TailC is Data:
  TailC{budget: List<&2, R.Real>, volume: List<&2, R.Real>, bounds: List<&2, G.Vec3>, cons: U32, extra: List<&2, R.Real>, pu: List<&2, U32>, c: Cur}

def tail_extra(budget: List<&2, R.Real>, volume: List<&2, R.Real>, bounds: List<&2, G.Vec3>, cons: U32, pu: List<&2, U32>, r: RealsC) -> TailC:
  match r:
    case RealsC{extra, c}:
      TailC{budget, volume, bounds, cons, extra, pu, c}

def tail_bounds(budget: List<&2, R.Real>, volume: List<&2, R.Real>, cons: U32, nextra: U32, pu: List<&2, U32>, r: VecsC) -> TailC:
  match r:
    case VecsC{bounds, c}:
      tail_extra(budget, volume, bounds, cons, pu, read_reals(U32.to_nat(nextra), c, Nil{}))

def tail_volume(budget: List<&2, R.Real>, nbounds: U32, cons: U32, nextra: U32, pu: List<&2, U32>, r: RealsC) -> TailC:
  match r:
    case RealsC{volume, c}:
      tail_bounds(budget, volume, cons, nextra, pu, read_vecs(U32.to_nat(nbounds), c, Nil{}))

def tail_budget(nvol: U32, nbounds: U32, cons: U32, nextra: U32, pu: List<&2, U32>, r: RealsC) -> TailC:
  match r:
    case RealsC{budget, c}:
      tail_volume(budget, nbounds, cons, nextra, pu, read_reals(U32.to_nat(nvol), c, Nil{}))

def tail_pu(nbudget: U32, nvol: U32, nbounds: U32, cons: U32, nextra: U32, r: U32sC) -> TailC:
  match r:
    case U32sC{pu, c}:
      tail_budget(nvol, nbounds, cons, nextra, pu, read_reals(U32.to_nat(nbudget), c, Nil{}))

# u: nbudget nvol nbounds cons nextra npu pu*; r: budget volume bounds extra.
def read_tail(c: Cur) -> TailC:
  match c:
    case Cur{us, rs}:
      match us:
        case nbudget <> nvol <> nbounds <> cons <> nextra <> npu <> rest:
          tail_pu(nbudget, nvol, nbounds, cons, nextra, read_u32s(U32.to_nat(npu), Cur{rest, rs}, Nil{}))
        case _:
          TailC{Nil{}, Nil{}, Nil{}, 0, Nil{}, Nil{}, dead()}

def ana_tail(s: A.Solid, ds: List<&2, F.DomainChoice>, p: Prim, r: TailC) -> BodyC:
  match r:
    case TailC{budget, volume, bounds, cons, extra, pu, c}:
      BodyC{Some{Ana{s, ds, p, budget, volume, bounds, cons, extra, pu}}, c}

def ana_prim(s: A.Solid, ds: List<&2, F.DomainChoice>, r: PrimC) -> BodyC:
  match r:
    case PrimC{p, c}:
      ana_tail(s, ds, p, read_tail(c))

def ana_doms(s: A.Solid, r: DomsC) -> BodyC:
  match r:
    case DomsC{ds, c}:
      ana_prim(s, ds, read_prim(c))

def ana_faces(vs: List<&2, G.Vec3>, es: List<&2, A.Edge>, r: AFacesC) -> BodyC:
  match r:
    case AFacesC{fs, c}:
      match c:
        case Cur{us, rs}:
          match us:
            case nd <> rest:
              ana_doms(A.Solid{vs, es, fs}, doms_loop(U32.to_nat(nd), DomStep{None{}, Cur{rest, rs}}, Nil{}))
            case _:
              BodyC{None{}, dead()}

def ana_edges(vs: List<&2, G.Vec3>, r: AEdgesC) -> BodyC:
  match r:
    case AEdgesC{es, c}:
      match c:
        case Cur{us, rs}:
          match us:
            case nf <> rest:
              ana_faces(vs, es, afaces_loop(U32.to_nat(nf), FaceStep{None{}, Cur{rest, rs}}, Nil{}))
            case _:
              BodyC{None{}, dead()}

def ana_vertices(r: VecsC, ne: U32) -> BodyC:
  match r:
    case VecsC{vs, c}:
      ana_edges(vs, aedges_loop(U32.to_nat(ne), EdgeStep{None{}, c}, Nil{}))

def body_kind(kind: U32, nv: U32, ne: U32, c: Cur) -> BodyC:
  match kind:
    case 0:
      poly_edges_c(read_vecs(U32.to_nat(nv), c, Nil{}), ne)
    case _:
      ana_vertices(read_vecs(U32.to_nat(nv), c, Nil{}), ne)

def body_step(c: Cur) -> BodyC:
  match c:
    case Cur{us, rs}:
      match us:
        case kind <> nv <> ne <> rest:
          body_kind(kind, nv, ne, Cur{rest, rs})
        case _:
          BodyC{None{}, dead()}

def push_body(m: Maybe<&2, Body>, acc: List<&2, Body>) -> List<&2, Body>:
  match m:
    case Some{x}:
      x <> acc
    case None{}:
      acc

def cur_empty(c: Cur) -> Bool:
  match c:
    case Cur{us, rs}:
      match us:
        case Nil{}:
          match rs:
            case Nil{}:
              True{}
            case _:
              False{}
        case _:
          False{}

type BodiesC is Data:
  BodiesC{bs: List<&2, Body>, consumed: Bool}

# consumed: every u and r word of the literal was read (nothing left over).
def bodies_loop(n: Nat, r: BodyC, acc: List<&2, Body>) -> BodiesC:
  match n:
    case 0n:
      match r:
        case BodyC{m, c}:
          BodiesC{List.reverse(&2, Body, push_body(m, acc)), cur_empty(c)}
    case 1n+p:
      match r:
        case BodyC{m, c}:
          bodies_loop(p, body_step(c), push_body(m, acc))

def lit_check(ok: Bool, +span: U32, bs: List<&2, Body>) -> Val:
  match ok:
    case True{}:
      VBodies{bs}
    case False{}:
      VErr{4, span, "malformed literal node (host cache)"}

def lit_fin(r: BodiesC, +span: U32, +n: U32) -> Val:
  match r:
    case BodiesC{+bs, consumed}:
      lit_check(Bool.and(consumed, U32.is_eq(U32.from_nat(List.length(&2, Body, bs)), n)), span, bs)

def op_literal(us: List<&2, U32>, rs: List<&2, R.Real>, +span: U32) -> Val:
  match us:
    case nb <> rest:
      +n = nb
      lit_fin(bodies_loop(U32.to_nat(n), BodyC{None{}, Cur{rest, rs}}, Nil{}), span, n)
    case _:
      VErr{4, span, "malformed literal node (host cache)"}

# --- evaluation --------------------------------------------------------------------

def lookup(env: List<&2, Val>, i: U32) -> Val:
  match env:
    case Nil{}:
      VErr{4, 0, "WK reference outside the evaluated graph"}
    case h <> t:
      match i:
        case 0:
          h
        case _:
          lookup(t, (i - 1 : U32))

def ref_vals(refs: List<&2, U32>, +env: List<&2, Val>) -> List<&2, Val>:
  match refs:
    case Nil{}:
      Nil{}
    case r <> rest:
      lookup(env, r) <> ref_vals(rest, env)

def run_op(+op: U32, +span: U32, +k: K, vals: List<&2, Val>, us: List<&2, U32>, rs: List<&2, R.Real>) -> Val:
  match op:
    case 1:
      op_extrude(span, us, rs)
    case 2:
      op_frustum(us, rs, span, k)
    case 3:
      op_transform(vals, span, k, rs)
    case 4:
      op_boolean(us, rs, vals, span, k)
    case 5:
      op_expect(vals, span, us)
    case 6:
      op_literal(us, rs, span)
    case _:
      VErr{1, span, "WK op code " ++ U32.show(op) ++ " is not in the native evaluator"}

def eval_node(+k: K, node: WNode, +env: List<&2, Val>) -> Val:
  WNode{op, span, key, refs, us, rs} = node
  run_op(op, span, k, ref_vals(refs, env), us, rs)

def take_nodes(xs: List<&2, WNode>, n: U32) -> List<&2, WNode>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> rest:
      match n:
        case 0:
          Nil{}
        case _:
          x <> take_nodes(rest, (n - 1 : U32))

def drop_nodes(xs: List<&2, WNode>, n: U32) -> List<&2, WNode>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> rest:
      match n:
        case 0:
          x <> rest
        case _:
          drop_nodes(rest, (n - 1 : U32))

type Tree is Data:
  TEmpty{}
  TLeaf{node: WNode}
  TFork{a: Tree, b: Tree}

# A balanced binary tree over the independent nodes of one level; the fork
# below happens on its FIELDS (proposal-core-ir.md section 7.4: forking on
# computed take/drop results ran only 2-way; forking over a pre-built tree
# scaled).
def tree_of(fuel: Nat, +n: U32, +ns: List<&2, WNode>) -> Tree:
  match fuel:
    case 0n:
      TEmpty{}
    case 1n+ +f:
      match n:
        case 0:
          TEmpty{}
        case 1:
          match ns:
            case Nil{}:
              TEmpty{}
            case x <> rest:
              TLeaf{x}
        case _:
          +h = (n / 2 : U32)
          TFork{tree_of(f, h, take_nodes(ns, h)), tree_of(f, (n - h : U32), drop_nodes(ns, h))}

def run_tree(t: Tree, +k: K, +env: List<&2, Val>) -> List<&2, Val>:
  match t:
    case TEmpty{}:
      Nil{}
    case TLeaf{node}:
      eval_node(k, node, env) <> Nil{}
    case TFork{a, b}:
      x y = run_tree(a, k, env) run_tree(b, k, env)
      List.append(&2, Val, x, y)

# Serial mode: the same nodes, one after another, no fork.
def run_seq(ns: List<&2, WNode>, +k: K, +env: List<&2, Val>) -> List<&2, Val>:
  match ns:
    case Nil{}:
      Nil{}
    case n <> rest:
      eval_node(k, n, env) <> run_seq(rest, k, env)

def run_level(fork: Bool, l: List<&2, WNode>, +k: K, +env: List<&2, Val>) -> List<&2, Val>:
  match fork:
    case True{}:
      +ns = l
      run_tree(tree_of(64n, U32.from_nat(List.length(&2, WNode, ns)), ns), k, env)
    case False{}:
      run_seq(l, k, env)

def prepend_all(vals: List<&2, Val>, env: List<&2, Val>) -> List<&2, Val>:
  match vals:
    case Nil{}:
      env
    case v <> rest:
      prepend_all(rest, v <> env)

# All values of a graph, most recent first (the reference order of the stream).
def run_levels(levels: List<&2, List<&2, WNode>>, +fork: Bool, +k: K, env: List<&2, Val>) -> List<&2, Val>:
  match levels:
    case Nil{}:
      env
    case l <> rest:
      +e = env
      run_levels(rest, fork, k, prepend_all(run_level(fork, l, k, e), e))

def flat_nodes(levels: List<&2, List<&2, WNode>>) -> List<&2, WNode>:
  match levels:
    case Nil{}:
      Nil{}
    case l <> rest:
      List.append(&2, WNode, l, flat_nodes(rest))

# A cheap digest so a repeated evaluation is certainly performed and used.
def val_digest(v: Val) -> U32:
  match v:
    case VBodies{bs}:
      (1 + U32.from_nat(List.length(&2, Body, bs)) : U32)
    case VOk{}:
      1
    case VErr{c, s, m}:
      (100 + c : U32)

def digest(vs: List<&2, Val>, acc: U32) -> U32:
  match vs:
    case Nil{}:
      acc
    case v <> rest:
      digest(rest, (acc * 31 + val_digest(v) : U32))

# --- output encoding (the literal layout above; F32 words as their bit patterns) ---

def su(x: U32) -> String:
  U32.show(x) ++ " "

def sf(x: F32) -> String:
  U32.show(F32.bits(x)) ++ " "

def sr(r: R.Real) -> String:
  R.Real{hi, lo} = r
  sf(hi) ++ sf(lo)

def sv(v: G.Vec3) -> String:
  G.V3{x, y, z} = v
  sr(x) ++ sr(y) ++ sr(z)

def bit(b: Bool) -> U32:
  Bool.pick(U32, b, 1, 0)

def nlen(n: Nat) -> String:
  su(U32.from_nat(n))

def enc_vs(vs: List<&2, G.Vec3>) -> String:
  match vs:
    case Nil{}:
      ""
    case v <> rest:
      sv(v) ++ enc_vs(rest)

def enc_rs(rs: List<&2, R.Real>) -> String:
  match rs:
    case Nil{}:
      ""
    case r <> rest:
      sr(r) ++ enc_rs(rest)

def enc_uses(us: List<&2, T.Coedge>) -> String:
  match us:
    case Nil{}:
      ""
    case T.Use{e, f} <> rest:
      su(e) ++ su(bit(f)) ++ enc_uses(rest)

def enc_pedges(es: List<&2, T.Edge>) -> String:
  match es:
    case Nil{}:
      ""
    case T.Edge{s, e} <> rest:
      su(s) ++ su(e) ++ enc_pedges(rest)

def enc_pfaces_u(fs: List<&2, PP.Face>) -> String:
  match fs:
    case Nil{}:
      ""
    case PP.Face{o, n, x, +b} <> rest:
      nlen(List.length(&2, T.Coedge, b)) ++ enc_uses(b) ++ enc_pfaces_u(rest)

def enc_pfaces_f(fs: List<&2, PP.Face>) -> String:
  match fs:
    case Nil{}:
      ""
    case PP.Face{o, n, x, b} <> rest:
      sv(o) ++ sv(n) ++ sv(x) ++ enc_pfaces_f(rest)

def enc_u32s(xs: List<&2, U32>) -> String:
  match xs:
    case Nil{}:
      ""
    case x <> rest:
      su(x) ++ enc_u32s(rest)

def enc_merges_u(ms: List<&2, PR.Merge>) -> String:
  match ms:
    case Nil{}:
      ""
    case PR.Merge{i, d, e} <> rest:
      su(i) ++ su(bit(e)) ++ enc_merges_u(rest)

def enc_merges_f(ms: List<&2, PR.Merge>) -> String:
  match ms:
    case Nil{}:
      ""
    case PR.Merge{i, d, e} <> rest:
      sr(d) ++ enc_merges_f(rest)

def enc_rec_u(rs: List<&2, ProfileRec>) -> String:
  match rs:
    case Nil{}:
      ""
    case ProfileRec{src, +kept, +ms, tol} <> rest:
      su(src) ++ nlen(List.length(&2, U32, kept)) ++ enc_u32s(kept) ++ nlen(List.length(&2, PR.Merge, ms)) ++ enc_merges_u(ms) ++ enc_rec_u(rest)

def enc_rec_f(rs: List<&2, ProfileRec>) -> String:
  match rs:
    case Nil{}:
      ""
    case ProfileRec{src, kept, ms, tol} <> rest:
      sr(tol) ++ enc_merges_f(ms) ++ enc_rec_f(rest)

def curve_tag(c: A.Curve) -> U32:
  curve_level(c)

def curve_rs(c: A.Curve) -> String:
  match c:
    case A.Line{o, d}:
      sv(o) ++ sv(d)
    case A.Circle{o, n, x, r}:
      sv(o) ++ sv(n) ++ sv(x) ++ sr(r)
    case A.Ellipse{o, n, x, a, b}:
      sv(o) ++ sv(n) ++ sv(x) ++ sr(a) ++ sr(b)

def surface_rs(s: A.Surface) -> String:
  match s:
    case A.Plane{o, n, x}:
      sv(o) ++ sv(n) ++ sv(x)
    case A.Cylinder{o, a, x, r}:
      sv(o) ++ sv(a) ++ sv(x) ++ sr(r)
    case A.Cone{o, a, x, r, g}:
      sv(o) ++ sv(a) ++ sv(x) ++ sr(r) ++ sr(g)
    case A.Sphere{o, a, x, r}:
      sv(o) ++ sv(a) ++ sv(x) ++ sr(r)
    case A.Torus{o, a, x, big, small}:
      sv(o) ++ sv(a) ++ sv(x) ++ sr(big) ++ sr(small)

def enc_aedges_u(es: List<&2, A.Edge>) -> String:
  match es:
    case Nil{}:
      ""
    case A.Edge{s, e, c, same} <> rest:
      su(s) ++ su(e) ++ su(curve_level(c)) ++ su(bit(same)) ++ enc_aedges_u(rest)

def enc_aedges_f(es: List<&2, A.Edge>) -> String:
  match es:
    case Nil{}:
      ""
    case A.Edge{s, e, c, same} <> rest:
      curve_rs(c) ++ enc_aedges_f(rest)

def enc_loops(ls: List<&2, A.Loop>) -> String:
  match ls:
    case Nil{}:
      ""
    case A.Loop{outer, +us} <> rest:
      su(bit(outer)) ++ nlen(List.length(&2, T.Coedge, us)) ++ enc_uses(us) ++ enc_loops(rest)

def enc_afaces_u(fs: List<&2, A.Face>) -> String:
  match fs:
    case Nil{}:
      ""
    case A.Face{s, same, +ls} <> rest:
      su(surf_level(s)) ++ su(bit(same)) ++ nlen(List.length(&2, A.Loop, ls)) ++ enc_loops(ls) ++ enc_afaces_u(rest)

def enc_afaces_f(fs: List<&2, A.Face>) -> String:
  match fs:
    case Nil{}:
      ""
    case A.Face{s, same, ls} <> rest:
      surface_rs(s) ++ enc_afaces_f(rest)

def dom_tag_of(d: CP.Domain) -> U32:
  match d:
    case CP.Untrimmed{}:
      2
    case CP.Interval{a, b}:
      1

def dom_rs_of(d: CP.Domain) -> String:
  match d:
    case CP.Untrimmed{}:
      ""
    case CP.Interval{a, b}:
      sr(a) ++ sr(b)

def enc_doms_u(ds: List<&2, F.DomainChoice>) -> String:
  match ds:
    case Nil{}:
      ""
    case d <> rest:
      match d:
        case F.AutoDomain{}:
          "0 " ++ enc_doms_u(rest)
        case F.GivenDomain{dom}:
          su(dom_tag_of(dom)) ++ enc_doms_u(rest)

def enc_doms_f(ds: List<&2, F.DomainChoice>) -> String:
  match ds:
    case Nil{}:
      ""
    case d <> rest:
      match d:
        case F.AutoDomain{}:
          enc_doms_f(rest)
        case F.GivenDomain{dom}:
          dom_rs_of(dom) ++ enc_doms_f(rest)

def prim_u(p: Prim) -> String:
  match p:
    case NoPrim{}:
      "0 "
    case Frus{b, t, r0, r1}:
      "1 "

def prim_f(p: Prim) -> String:
  match p:
    case NoPrim{}:
      ""
    case Frus{b, t, r0, r1}:
      sv(b) ++ sv(t) ++ sr(r0) ++ sr(r1)

type Enc is Data:
  Enc{u: String, f: String}

def enc_body(b: Body) -> Enc:
  match b:
    case Poly{s, req, alw, +ring}:
      PP.Solid{+vs, +es, +fs} = s
      Enc{"0 " ++ nlen(List.length(&2, G.Vec3, vs)) ++ nlen(List.length(&2, T.Edge, es)) ++ enc_pedges(es) ++ nlen(List.length(&2, PP.Face, fs)) ++ enc_pfaces_u(fs)
          ++ nlen(List.length(&2, ProfileRec, ring)) ++ enc_rec_u(ring),
        enc_vs(vs) ++ enc_pfaces_f(fs) ++ sr(req) ++ sr(alw) ++ enc_rec_f(ring)}
    case Ana{s, +ds, +p, +budget, +volume, +bounds, cons, +extra, +pu}:
      A.Solid{+vs, +es, +fs} = s
      Enc{"1 " ++ nlen(List.length(&2, G.Vec3, vs)) ++ nlen(List.length(&2, A.Edge, es)) ++ enc_aedges_u(es) ++ nlen(List.length(&2, A.Face, fs)) ++ enc_afaces_u(fs)
          ++ nlen(List.length(&2, F.DomainChoice, ds)) ++ enc_doms_u(ds) ++ prim_u(p) ++ nlen(List.length(&2, R.Real, budget)) ++ nlen(List.length(&2, R.Real, volume))
          ++ nlen(List.length(&2, G.Vec3, bounds)) ++ su(cons) ++ nlen(List.length(&2, R.Real, extra)) ++ nlen(List.length(&2, U32, pu)) ++ enc_u32s(pu),
        enc_vs(vs) ++ enc_aedges_f(es) ++ enc_afaces_f(fs) ++ enc_doms_f(ds) ++ prim_f(p) ++ enc_rs(budget) ++ enc_rs(volume) ++ enc_vs(bounds) ++ enc_rs(extra)}

def enc_join(a: Enc, b: Enc) -> Enc:
  Enc{au, af} = a
  Enc{bu, bf} = b
  Enc{au ++ bu, af ++ bf}

def enc_bodies(bs: List<&2, Body>) -> Enc:
  match bs:
    case Nil{}:
      Enc{"", ""}
    case b <> rest:
      enc_join(enc_body(b), enc_bodies(rest))

def enc_text(n: Nat, e: Enc) -> String:
  Enc{u, f} = e
  "B " ++ nlen(n) ++ "U " ++ u ++ "F " ++ f

def enc_val(v: Val) -> String:
  match v:
    case VBodies{+bs}:
      enc_text(List.length(&2, Body, bs), enc_bodies(bs))
    case VOk{}:
      "K"
    case VErr{c, s, m}:
      "E " ++ su(c) ++ su(s) ++ m

def node_line(key: U32, v: Val) -> String:
  "N " ++ su(key) ++ enc_val(v) ++ "\n"
