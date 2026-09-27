import Base
import ../../hybrid/recover/main.bend as C

# Bake-off entry of the "recover" prototype. The code moved to
# kernel/hybrid/recover (docs/hybrid-boolean-plan.md section 8, step 5); this
# file keeps the harness convention (kernel/proto/<name>/main.bend exports run,
# and parse / solve / show so the JS target times the phases) and the path
# that older tools load (scripts/corpus/*, scripts/bakeoff/recover-*.mjs).
# Input and output format: the header of kernel/hybrid/recover/main.bend.

def parse(s: String) -> C.RIn:
  C.parse(s)

def solve(p: C.RIn) -> C.Res:
  C.solve(p)

def show(r: C.Res) -> String:
  C.show(r)

def run(job: String) -> String:
  C.run(job)
