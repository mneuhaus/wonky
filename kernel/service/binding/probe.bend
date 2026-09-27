import Base

# Minimal in-process binding probe (docs/native-bridge/binding.md).
# The wrapper parks this IO loop inside Bridge.next; each JS run(op, words, text)
# resumes it with a Req and reads the Reply handed to Bridge.reply.

type Op is Data:
  Echo{}
  Sum{}
  Mix{}
  Bits{}
  Text{}
  Store{}
  Held{}
  Die{}
  Deep{}
  Grow{}
  Big{}
  Tree{}
  Par{}
  Boom{}

type Req is Data:
  Req{op: Op, words: List<&2, U32>, text: String}

type Reply is Data:
  Reply{words: List<&2, U32>, text: String}

def Bridge.next() -> IO(Req):
  import "./bridge.c"
  import "./bridge.js"

def Bridge.reply(reply: Reply) -> IO(Unit):
  import "./bridge.c"
  import "./bridge.js"

def f32_of_bits(x: U32) -> F32:
  U32{w} = x
  F32{w}

def echo(xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      h <> echo(t)

def sum(xs: List<&2, U32>, +acc: U32, +n: U32) -> List<&2, U32>:
  match xs:
    case Nil{}:
      [acc, n]
    case Con{h, t}:
      sum(t, (acc + h : U32), (n + 1 : U32))

def mix_one(+x: U32) -> U32:
  U32.xor((x * 2654435761 : U32), (x / 65536 : U32))

def mix(xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      mix_one(h) <> mix(t)

# per input word x (F32 bits): bits(x), bits(x + 0.0), bits(x * 1.0), bits(-x), bits(x * x)
def bits(xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      +v = f32_of_bits(h)
      F32.bits(v) <> F32.bits((v + 0.0 : F32)) <> F32.bits((v * 1.0 : F32)) <> F32.bits(F32.neg(v)) <> F32.bits((v * v : F32)) <> bits(t)

def total(xs: List<&2, U32>, +acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case Con{h, t}:
      total(t, (acc + h : U32))

# non-tail recursion with depth n: deep(n) = n + deep(n - 1)
def deep(n: Nat) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      (1 + deep(p) : U32)

def grow(n: Nat, acc: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n:
      acc
    case 1n+p:
      grow(p, 7 <> acc)

def square(+n: Nat) -> U32:
  U32.from_nat((n * n : Nat))

# balanced fork-join work: 2^n leaves, each 256 rounds of mix_one; the parallel
# call (a b = f() f()) is what the CPU pool and a `!` (GPU) launch split.
def spin(k: Nat, +s: U32) -> U32:
  match k:
    case 0n:
      s
    case 1n+p:
      spin(p, mix_one(s))

def tree(+n: Nat, +s: U32) -> U32:
  match n:
    case 0n:
      spin(256n, s)
    case 1n+p:
      a b = tree(p, (s * 2 : U32)) tree(p, (s * 2 + 1 : U32))
      (U32.xor(a, b) + 1 : U32)

# the same tree shipped to the GPU (a `!` call); bound for direct calls as well
def par(n: Nat) -> U32:
  tree!(n, 1)

# fork-join whose leaves overflow Nat: the fail-stop fires on whichever pool
# thread runs a leaf, not necessarily the JS thread.
def boom(+d: Nat, +n: Nat) -> U32:
  match d:
    case 0n:
      square(n)
    case 1n+p:
      a b = boom(p, n) boom(p, n)
      U32.xor(a, b)

def first(xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}:
      0
    case Con{h, t}:
      h

def len(xs: List<&2, U32>, +n: U32) -> U32:
  match xs:
    case Nil{}:
      n
    case Con{h, t}:
      len(t, (n + 1 : U32))

# held: a List<&2, U32> that stays in the runtime heap between calls (Store sets it,
# Held folds it without it ever crossing the boundary). handle answers the next held.
def handle(req: Req, +held: List<&2, U32>) -> IO(List<&2, U32>):
  match req:
    case Req{op, words, text}:
      match op:
        case Echo{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{echo(words), text})
            return held
        case Sum{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{sum(words, 0, 0), text})
            return held
        case Mix{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{mix(words), text})
            return held
        case Bits{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{bits(words), text})
            return held
        case Text{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{words, text ++ "|ok"})
            return held
        case Store{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{[len(held, 0)], text})
            return words
        case Held{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{[total(held, 0), total(words, 0)], text})
            return held
        case Deep{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{[deep(U32.to_nat(first(words)))], text})
            return held
        case Grow{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{[len(grow(U32.to_nat(first(words)), Nil{}), 0)], text})
            return held
        case Big{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{[square(U32.to_nat(first(words)))], text})
            return held
        case Tree{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{[tree(U32.to_nat(first(words)), 1)], text})
            return held
        case Par{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{[par(U32.to_nat(first(words)))], text})
            return held
        case Boom{}:
          do IO<List<&2, U32>>:
            Bridge.reply(Reply{[boom(U32.to_nat(first(words)), 20000000n)], text})
            return held
        case Die{}:
          IO.die(List<&2, U32>, first(words), text)

@unsafe def serve(held: List<&2, U32>) -> IO(Unit):
  do IO<Unit>:
    req : Req <- Bridge.next()
    next : List<&2, U32> <- handle(req, held)
    serve(next)

def main() -> IO(Unit):
  serve(Nil{})
