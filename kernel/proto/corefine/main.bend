import Base
import ../../hybrid/mesh.bend as M
import ../../hybrid/corefine/main.bend as C

# Bake-off entry of the "corefine" prototype. The code moved to
# kernel/hybrid/corefine (docs/hybrid-boolean-plan.md section 8, step 5); this
# file keeps the harness convention (kernel/proto/<name>/main.bend exports run,
# and parse / solve / show so the JS target times the phases) and the path
# that older tools load. native.bend next to it is the prototype's native
# driver.

def parse(job: String) -> M.JobParse:
  C.parse(job)

def solve(p: M.JobParse) -> M.Outcome:
  C.solve(p)

def show(o: M.Outcome) -> String:
  C.show(o)

def run(job: String) -> String:
  C.run(job)
