import Base
import ../../../scripts/hardware-workload.bend as W

# Out-of-process baseline: a long-lived native Bend process that reads framed
# requests from stdin and writes framed responses to stdout. It is the
# comparison point for the in-process binding, not the preferred design.
#
# Wire format, every word a little-endian U32:
#   request  = "WKB1" op     id len payload[len]
#   response = "WKR1" status id len payload[len]
# The READY frame (status 0, id 0, payload = protocol version) is written once
# at startup; client ids start at 1.
#
# Ops: 0 ping (counters), 1 echo, 2 words (decode to U32 words and encode
# back), 3 store (keep the payload resident), 4 load (return it), 5 kernel
# (production Boolean/comparison batch from scripts/hardware-workload.bend),
# 6 replay (payload = reply length R, then U32 words; the reply is R bytes:
# the wrapping U32 sum of the words after R, then zero bytes). op 6 stands in
# for a kernel call of a given request/response size: it decodes every request
# word and builds a reply of the requested size, without kernel work.
# Status: 0 ok, 1 unknown op, 2 bad payload, 3 bad magic, 4 too large,
# 5 short header. Status 3 to 5 end the process (exit 65/67/66) because the
# stream can no longer be resynchronised. A clean EOF between frames exits 0,
# an EOF inside a frame exits 66, a failed read or write exits 74.
#
# Bend lambdas may not match and defs may not recurse mutually, so the whole
# loop is ONE def (serve) over an explicit Step; every effect result comes back
# as a Step field. serve counts down a Nat fuel, one unit per step.

def magic_req() -> U32:
  826428247

def magic_res() -> U32:
  827476823

def max_payload() -> U32:
  67108864

def version() -> U32:
  1

type Stats is Data:
  Stats{requests: U32, bytes_in: U32, bytes_out: U32, blob: List<&2, U32>}

type Want is Data:
  WantHeader{}
  WantPayload{op: U32, id: U32}

type Verdict is Data:
  Frame{op: U32, id: U32, len: U32}
  BadMagic{magic: U32}
  TooLarge{id: U32, len: U32}
  ShortHeader{}

type Reply is Data:
  Reply{status: U32, payload: List<&2, U32>, stats: Stats}

type Op is Data:
  OpPing{}
  OpEcho{}
  OpWords{}
  OpStore{}
  OpLoad{}
  OpKernel{}
  OpReplay{}
  OpUnknown{}

type Step is Type:
  Begin{inp: File, out: File}
  Reading{inp: File, out: File, want: Want, need: U32, got: U32, chunks: List<&2, List<&2, U32>>, full: Bool}
  Landed{out: File, want: Want, need: U32, got: U32, chunks: List<&2, List<&2, U32>>, r: File & Result<&1, &1, U32 & String, List<&2, U32>>}
  Ended{want: Want, clean: Bool}
  Parsed{inp: File, out: File, verdict: Verdict}
  Respond{inp: File, out: File, id: U32, reply: Reply}
  Wrote{inp: File, w: File & Result<&1, &1, U32 & String, Unit>}
  Fatal{out: File, id: U32, status: U32, exit: U32, message: String}

# Bytes and words
# ---------------

def count(xs: List<&2, U32>, n: U32) -> U32:
  match xs:
    case Nil{}:
      n
    case h <> t:
      count(t, (n + 1 : U32))

def le32(b0: U32, b1: U32, b2: U32, b3: U32) -> U32:
  (b0 .|. ((b1 << 8n) .|. ((b2 << 16n) .|. (b3 << 24n))) : U32)

def u32le(+w: U32, tail: List<&2, U32>) -> List<&2, U32>:
  (w .&. 255 : U32) <> ((w >> 8n) .&. 255 : U32) <> ((w >> 16n) .&. 255 : U32) <> (w >> 24n : U32) <> tail

def words_of(bs: List<&2, U32>) -> List<&2, U32>:
  match bs:
    case a <> b <> c <> d <> t:
      le32(a, b, c, d) <> words_of(t)
    case _:
      Nil{}

def bytes_of(ws: List<&2, U32>) -> List<&2, U32>:
  match ws:
    case Nil{}:
      Nil{}
    case w <> t:
      u32le(w, bytes_of(t))

def utf8_pick(one: Bool, two: Bool, three: Bool, +c: U32, tail: List<&2, U32>) -> List<&2, U32>:
  match one:
    case True{}:
      c <> tail
    case False{}:
      match two:
        case True{}:
          (192 .|. (c >> 6n) : U32) <> (128 .|. (c .&. 63) : U32) <> tail
        case False{}:
          match three:
            case True{}:
              (224 .|. (c >> 12n) : U32) <> (128 .|. ((c >> 6n) .&. 63) : U32) <> (128 .|. (c .&. 63) : U32) <> tail
            case False{}:
              (240 .|. (c >> 18n) : U32) <> (128 .|. ((c >> 12n) .&. 63) : U32) <> (128 .|. ((c >> 6n) .&. 63) : U32) <> (128 .|. (c .&. 63) : U32) <> tail

def utf8(s: String) -> List<&2, U32>:
  match s:
    case SNil{}:
      Nil{}
    case SCon{Chr{+c}, t}:
      utf8_pick(U32.is_lt(c, 128), U32.is_lt(c, 2048), U32.is_lt(c, 65536), c, utf8(t))

def join(chunks: List<&2, List<&2, U32>>) -> List<&2, U32>:
  List.concat(&2, U32, List.reverse(&2, List<&2, U32>, chunks))

def frame(+status: U32, +id: U32, +payload: List<&2, U32>) -> List<&2, U32>:
  u32le(magic_res(), u32le(status, u32le(id, u32le(count(payload, 0), payload))))

# Header validation
# -----------------

def verdict_pick(magic_ok: Bool, len_ok: Bool, magic: U32, op: U32, id: U32, len: U32) -> Verdict:
  match magic_ok:
    case False{}:
      BadMagic{magic}
    case True{}:
      match len_ok:
        case True{}:
          Frame{op, id, len}
        case False{}:
          TooLarge{id, len}

def verdict_of(ws: List<&2, U32>) -> Verdict:
  match ws:
    case +magic <> op <> id <> +len <> Nil{}:
      verdict_pick(U32.is_eq(magic, magic_req()), U32.is_le(len, max_payload()), magic, op, id, len)
    case _:
      ShortHeader{}

# Operations
# ----------

def op_pick(ping: Bool, echo: Bool, words: Bool, store: Bool, load: Bool, kernel: Bool, replay: Bool) -> Op:
  match ping:
    case True{}:
      OpPing{}
    case False{}:
      match echo:
        case True{}:
          OpEcho{}
        case False{}:
          match words:
            case True{}:
              OpWords{}
            case False{}:
              match store:
                case True{}:
                  OpStore{}
                case False{}:
                  match load:
                    case True{}:
                      OpLoad{}
                    case False{}:
                      match kernel:
                        case True{}:
                          OpKernel{}
                        case False{}:
                          match replay:
                            case True{}:
                              OpReplay{}
                            case False{}:
                              OpUnknown{}

def op_of(+op: U32) -> Op:
  op_pick(U32.is_eq(op, 0), U32.is_eq(op, 1), U32.is_eq(op, 2), U32.is_eq(op, 3), U32.is_eq(op, 4), U32.is_eq(op, 5), U32.is_eq(op, 6))

# Every reply updates the counters in one place.
def settle(+status: U32, +payload: List<&2, U32>, +len: U32, st: Stats, blob: List<&2, U32>) -> Reply:
  Stats{requests, bytes_in, bytes_out, old} = st
  Reply{status, payload, Stats{(requests + 1 : U32), (bytes_in + len : U32), (bytes_out + count(payload, 0) : U32), blob}}

def keep(+status: U32, +payload: List<&2, U32>, +len: U32, st: Stats) -> Reply:
  Stats{requests, bytes_in, bytes_out, +blob} = st
  settle(status, payload, len, Stats{requests, bytes_in, bytes_out, blob}, blob)

def words_reply(aligned: Bool, data: List<&2, U32>, +len: U32, st: Stats) -> Reply:
  match aligned:
    case True{}:
      keep(0, bytes_of(words_of(data)), len, st)
    case False{}:
      keep(2, utf8("words: payload length must be a multiple of 4"), len, st)

def kernel_reply(ws: List<&2, U32>, +len: U32, st: Stats) -> Reply:
  match ws:
    case kind <> depth <> count <> seed <> Nil{}:
      +evidence = W.batch(U32.to_nat(depth), U32.to_nat(count), U32.is_eq(kind, 1), seed)
      keep(0, utf8("{" ++ W.evidence_json(evidence) ++ "}"), len, st)
    case _:
      keep(2, utf8("kernel: payload must be 4 words: kind depth count seed"), len, st)

def sum_words(xs: List<&2, U32>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case w <> t:
      sum_words(t, (acc + w : U32))

def zeros(n: Nat, tail: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n:
      tail
    case 1n+p:
      zeros(p, 0 <> tail)

def replay_sized(fits: Bool, +reply: U32, +sum: U32, +len: U32, st: Stats) -> Reply:
  match fits:
    case True{}:
      keep(0, u32le(sum, zeros(U32.to_nat((reply - 4 : U32)), Nil{})), len, st)
    case False{}:
      keep(2, utf8("replay: reply length must be 4 .. " ++ U32.show(max_payload()) ++ " bytes, got " ++ U32.show(reply)), len, st)

def replay_reply(aligned: Bool, ws: List<&2, U32>, +len: U32, st: Stats) -> Reply:
  match aligned:
    case False{}:
      keep(2, utf8("replay: payload length must be a multiple of 4"), len, st)
    case True{}:
      match ws:
        case +reply <> rest:
          replay_sized(Bool.and(U32.is_ge(reply, 4), U32.is_le(reply, max_payload())), reply, sum_words(rest, 0), len, st)
        case Nil{}:
          keep(2, utf8("replay: payload must start with the reply length"), len, st)

def ping_payload(st: Stats) -> List<&2, U32>:
  Stats{requests, bytes_in, bytes_out, blob} = st
  bytes_of([requests, bytes_in, bytes_out, count(blob, 0)])

def run(op: Op, +code: U32, +data: List<&2, U32>, +len: U32, +st: Stats) -> Reply:
  match op:
    case OpPing{}:
      keep(0, ping_payload(st), len, st)
    case OpEcho{}:
      keep(0, data, len, st)
    case OpWords{}:
      words_reply(U32.is_eq((len % 4 : U32), 0), data, len, st)
    case OpStore{}:
      settle(0, bytes_of([len]), len, st, data)
    case OpLoad{}:
      Stats{requests, bytes_in, bytes_out, +blob} = st
      keep(0, blob, len, st)
    case OpKernel{}:
      kernel_reply(words_of(data), len, st)
    case OpReplay{}:
      replay_reply(U32.is_eq((len % 4 : U32), 0), words_of(data), len, st)
    case OpUnknown{}:
      keep(1, utf8("unknown op " ++ U32.show(code)), len, st)

def complete(inp: File, out: File, want: Want, chunks: List<&2, List<&2, U32>>, +got: U32, +st: Stats) -> Step:
  match want:
    case WantHeader{}:
      Parsed{inp, out, verdict_of(words_of(join(chunks)))}
    case WantPayload{+op, id}:
      Respond{inp, out, id, run(op_of(op), op, join(chunks), got, st)}

# The service loop
# ----------------

def serve(fuel: Nat, +st: Stats, step: Step) -> IO(Unit):
  match fuel:
    case 0n:
      IO.die(Unit, 70, "wonky service: step fuel exhausted")
    case 1n+p:
      match step:
        case Begin{inp, out}:
          serve(p, st, Reading{inp, out, WantHeader{}, 16, 0, Nil{}, False{}})
        case Reading{inp, out, want, +need, +got, chunks, full}:
          match full:
            case True{}:
              serve(p, st, complete(inp, out, want, chunks, got, st))
            case False{}:
              IO.bind(File & Result<&1, &1, U32 & String, List<&2, U32>>, Unit, File.read_bytes(inp, (need - got : U32)), r => serve(p, st, Landed{out, want, need, got, chunks, r}))
        case Landed{out, want, +need, +got, chunks, (inp, res)}:
          match res:
            case Fail{(code, msg)}:
              IO.die(Unit, 74, "wonky service: stdin read failed: " ++ msg)
            case Done{bytes}:
              match bytes:
                case Nil{}:
                  serve(p, st, Ended{want, U32.is_eq(got, 0)})
                case b <> +rest:
                  +next = (got + count(rest, 1) : U32)
                  serve(p, st, Reading{inp, out, want, need, next, (b <> rest) <> chunks, U32.is_ge(next, need)})
        case Ended{want, clean}:
          match want:
            case WantHeader{}:
              match clean:
                case True{}:
                  IO.pure(Unit, Unit{})
                case False{}:
                  IO.die(Unit, 66, "wonky service: stdin closed inside a frame header")
            case WantPayload{op, id}:
              IO.die(Unit, 66, "wonky service: stdin closed inside the payload of request " ++ U32.show(id))
        case Parsed{inp, out, verdict}:
          match verdict:
            case Frame{op, id, +len}:
              serve(p, st, Reading{inp, out, WantPayload{op, id}, len, 0, Nil{}, U32.is_eq(len, 0)})
            case BadMagic{magic}:
              serve(p, st, Fatal{out, 0, 3, 65, "bad request magic " ++ U32.show(magic)})
            case TooLarge{id, len}:
              serve(p, st, Fatal{out, id, 4, 67, "payload of " ++ U32.show(len) ++ " bytes exceeds the limit of " ++ U32.show(max_payload())})
            case ShortHeader{}:
              serve(p, st, Fatal{out, 0, 5, 66, "short frame header"})
        case Respond{inp, out, id, Reply{status, payload, next}}:
          IO.bind(File & Result<&1, &1, U32 & String, Unit>, Unit, File.write_bytes(out, frame(status, id, payload)), w => serve(p, next, Wrote{inp, w}))
        case Wrote{inp, (out, res)}:
          match res:
            case Fail{(code, msg)}:
              IO.die(Unit, 74, "wonky service: stdout write failed: " ++ msg)
            case Done{u}:
              serve(p, st, Begin{inp, out})
        case Fatal{out, id, status, exit, +message}:
          IO.bind(File & Result<&1, &1, U32 & String, Unit>, Unit, File.write_bytes(out, frame(status, id, utf8(message))), w => IO.die(Unit, exit, "wonky service: " ++ message))

def main() -> IO(Unit):
  do IO<Unit>:
    inp : File <- IO.try(File, File.open("/dev/stdin", "r"))
    out : File <- IO.try(File, File.open("/dev/stdout", "a"))
    +st : Stats = Stats{0, 0, 0, Nil{}}
    serve(Nat.mul(4294967295n, 65535n), st, Respond{inp, out, 0, Reply{0, bytes_of([version()]), st}})
