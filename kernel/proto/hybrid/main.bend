import Base
import ../../hybrid/main.bend as H

# Bake-off entry of the "hybrid" prototype: the production hybrid Boolean
# kernel/hybrid/main.bend (corefine, then recover; result `exact`, `mesh` or
# `unresolved`, format in its header), run by the harness like every other
# prototype (kernel/proto/<name>/main.bend exports run, and parse / solve /
# show so the JS target times the phases). native.bend is its native driver.

def parse(+job: String) -> H.HIn:
  H.parse(job)

def solve(h: H.HIn) -> H.HOut:
  H.solve(h)

def show(o: H.HOut) -> String:
  H.show(o)

def run(job: String) -> String:
  H.run(job)
