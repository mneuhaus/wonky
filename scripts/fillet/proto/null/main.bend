import Base

# Fillet harness baseline prototype "null" (docs/fillet/harness.md): the
# harness floor, not a fillet. It reads the job header and refuses every blend
# with the typed result `unresolved not-implemented ...`. A job whose first
# line is not the format magic is refused as `invalid-input`, so a broken
# fixture is never mistaken for a read job. It never returns geometry.
#
# Contract: run(job) -> result text; parse / solve / show are exposed so the
# JS runner can time the phases (scripts/bakeoff/js-worker.mjs).
#
# Kept under scripts/fillet/proto/ because kernel/proto/** belongs to other
# workflows while part 1 runs; part-2 prototypes live in kernel/proto/fillet-<name>/.

type Parse is Data:
  Job{id: String}
  Malformed{why: String}

def line.go(s: String, acc: String) -> String & String:
  match s:
    case SNil{}:
      (String.reverse(acc), SNil{})
    case SCon{Chr{10}, t}:
      (String.reverse(acc), t)
    case SCon{c, t}:
      line.go(t, SCon{c, acc})

# The current line without its newline, and the text after it.
def line(s: String) -> String & String:
  line.go(s, SNil{})

def word.go(s: String, acc: String) -> String:
  match s:
    case SNil{}:
      String.reverse(acc)
    case SCon{Chr{32}, t}:
      String.reverse(acc)
    case SCon{Chr{13}, t}:
      String.reverse(acc)
    case SCon{c, t}:
      word.go(t, SCon{c, acc})

# Text after the prefix "case " of the second line, up to the next blank.
def case_id(l: String) -> String:
  match l:
    case SCon{Chr{99}, SCon{Chr{97}, SCon{Chr{115}, SCon{Chr{101}, SCon{Chr{32}, t}}}}}:
      word.go(t, SNil{})
    case _:
      "?"

def parse.second(p: String & String) -> Parse:
  (second, _) = p
  Job{case_id(second)}

def parse.if(ok: Bool, rest: String) -> Parse:
  match ok:
    case True{}:
      parse.second(line(rest))
    case False{}:
      Malformed{"first line is not wonky-fillet-job 1"}

def parse.header(p: String & String) -> Parse:
  (magic, rest) = p
  parse.if(String.eq(magic, "wonky-fillet-job 1"), rest)

def parse(job: String) -> Parse:
  parse.header(line(job))

def solve(p: Parse) -> String:
  match p:
    case Job{id}:
      "unresolved not-implemented null prototype refuses every blend (case " ++ id ++ ")\nend\n"
    case Malformed{why}:
      "unresolved invalid-input " ++ why ++ "\nend\n"

def show(s: String) -> String:
  s

def run(job: String) -> String:
  show(solve(parse(job)))
