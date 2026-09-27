import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../face-classification.bend as F
import ../intersections.bend as I
import ./types.bend as P
import ./solid-intersection.bend as S
import ./curved.bend as C
import ./curved-contact.bend as CC
import ./curved-contact-state.bend as CS

# Complete convex-tool sequences with an explicit operation-wide contact
# policy. A rejected later plane publishes no partial result solids.
type Policy is Data:
  StrictTransverse{}
  ToleratedRegularized{contact_cap: R.Real}

type Method is Data:
  Transverse{}
  RegularizedContact{strict_reason: P.Reason, policy: CS.Policy, ledger: CS.Ledger}

type Step is Data:
  Step{cut: S.FaceRef, input_component: U32, origin: G.Vec3, normal: G.Vec3,
    source_vertices: List<&2, G.Vec3>, source_faces: List<&2, S.FaceRef>, source_edges: List<&2, S.EdgeRef>,
    method: Method, components: U32}

type Attempt is Data:
  Attempt{result: P.Result, method: Method}

type Run is Data:
  Built{bodies: List<&2, S.Body>, steps: List<&2, Step>}
  Failed{reason: P.Reason, tool: U32, face: U32, steps: List<&2, Step>}

type IntersectionResult is Data:
  Bodies{bodies: List<&2, S.Body>, policy: Policy, source_budget: R.Real, steps: List<&2, Step>}
  Unresolved{reason: P.Reason, tool: U32, face: U32, policy: Policy, source_budget: R.Real, steps: List<&2, Step>}

def policy_valid(policy: Policy) -> Bool:
  match policy:
    case StrictTransverse{}:
      True{}
    case ToleratedRegularized{cap}:
      F.valid_budget(cap)

def contact_result(value: CS.Attempt, reason: P.Reason) -> Attempt:
  CS.Attempt{result, policy, ledger} = value
  Attempt{result, RegularizedContact{reason, policy, ledger}}

def contact_allowed(reason: P.Reason) -> Bool:
  match reason:
    case P.AmbiguousContact{}:
      True{}
    case P.UnsupportedArrangement{}:
      True{}
    case _:
      False{}

def contact(allowed: Bool, reason: P.Reason, solid: A.Solid, domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3,
    tolerance: I.Tolerance, source_budget: R.Real, cap: R.Real) -> Attempt:
  match allowed:
    case False{}:
      Attempt{P.Unresolved{reason}, Transverse{}}
    case True{}:
      contact_result(CC.clip(solid, domains, origin, normal, tolerance, source_budget, cap), reason)

# The regularized policy is selected before the sequence starts. The strict
# constructor's rejected arrangement is retained in the contact record; neither
# the policy nor its cap is escalated in response to a failed construction.
def choose(result: P.Result, policy: Policy, solid: A.Solid, domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3,
    tolerance: I.Tolerance, source_budget: R.Real) -> Attempt:
  match result policy:
    case P.Unresolved{+reason} ToleratedRegularized{cap}:
      contact(contact_allowed(reason), reason, solid, domains, origin, normal, tolerance, source_budget, cap)
    case _ _:
      Attempt{result, Transverse{}}

def result_count(result: P.Result) -> U32:
  match result:
    case P.Clipped{_, _, _, _}:
      1
    case P.Components{bodies}:
      U32.from_nat(List.length(&2, P.Component, bodies))
    case _:
      0

def converted(result: S.Bodies, step: Step) -> Run:
  match result:
    case S.Bodies{bodies}:
      Built{bodies, [step]}
    case S.Unresolved{reason, tool, face}:
      Failed{reason, tool, face, [step]}

def attempted(attempt: Attempt, +body: S.Body, +cut: S.FaceRef, input_component: U32, origin: G.Vec3, normal: G.Vec3) -> Run:
  Attempt{+result, method} = attempt
  S.Body{A.Solid{vertices, _, _}, _, faces, edges} = body
  step : Step = Step{cut, input_component, origin, normal, vertices, faces, edges, method, result_count(result)}
  converted(S.converted_result(result, body, cut), step)

def clip_body(+body: S.Body, plane: A.Face, cut: S.FaceRef, input_component: U32, +policy: Policy,
    +tolerance: I.Tolerance, +source_budget: R.Real) -> Run:
  match body plane:
    case S.Body{+solid, +domains, _, _} A.Face{A.Plane{+origin, normal, _}, sense, _}:
      +outward = G.scale(normal, Bool.pick(R.Real, sense, R.from_f32(1.0), R.neg(R.from_f32(1.0))))
      attempt = choose(C.clip(solid, domains, origin, outward, tolerance, source_budget), policy,
        solid, domains, origin, outward, tolerance, source_budget)
      attempted(attempt, body, cut, input_component, origin, outward)
    case _ _:
      S.FaceRef{tool, face} = cut
      Failed{P.UnsupportedSurface{}, tool, face, Nil{}}

def join(first: Run, second: Run) -> Run:
  match first second:
    case Failed{reason, tool, face, steps} _:
      Failed{reason, tool, face, steps}
    case Built{_, first_steps} Failed{reason, tool, face, steps}:
      Failed{reason, tool, face, List.append(&2, Step, first_steps, steps)}
    case Built{a, first_steps} Built{b, second_steps}:
      Built{List.append(&2, S.Body, a, b), List.append(&2, Step, first_steps, second_steps)}

def clip_bodies(bodies: List<&2, S.Body>, +plane: A.Face, +cut: S.FaceRef, +index: U32, +policy: Policy,
    +tolerance: I.Tolerance, +source_budget: R.Real) -> Run:
  match bodies:
    case Nil{}:
      Built{Nil{}, Nil{}}
    case body <> tail:
      join(clip_body(body, plane, cut, index, policy, tolerance, source_budget),
        clip_bodies(tail, plane, cut, (index + 1 : U32), policy, tolerance, source_budget))

def remember(prior: List<&2, Step>, run: Run) -> Run:
  match run:
    case Built{bodies, steps}:
      Built{bodies, List.append(&2, Step, prior, steps)}
    case Failed{reason, tool, face, steps}:
      Failed{reason, tool, face, List.append(&2, Step, prior, steps)}

def clip_faces(planes: List<&2, A.Face>, state: Run, +tool: U32, +index: U32, +policy: Policy,
    +tolerance: I.Tolerance, +source_budget: R.Real) -> Run:
  match planes state:
    case _ Failed{reason, operand, face, steps}:
      Failed{reason, operand, face, steps}
    case Nil{} Built{bodies, steps}:
      Built{bodies, steps}
    case plane <> tail Built{bodies, steps}:
      next = remember(steps, clip_bodies(bodies, plane, S.FaceRef{tool, index}, 0, policy, tolerance, source_budget))
      clip_faces(tail, next, tool, (index + 1 : U32), policy, tolerance, source_budget)

def finish(run: Run, policy: Policy, source_budget: R.Real) -> IntersectionResult:
  match run:
    case Built{bodies, steps}:
      Bodies{bodies, policy, source_budget, steps}
    case Failed{reason, tool, face, steps}:
      Unresolved{reason, tool, face, policy, source_budget, steps}

def selected(first_tool: Bool, second_tool: Bool, +first: A.Solid, ad: List<&2, F.DomainChoice>, +ab: R.Real,
    +second: A.Solid, bd: List<&2, F.DomainChoice>, +bb: R.Real, +policy: Policy, tolerance: I.Tolerance) -> IntersectionResult:
  match first_tool second_tool:
    case _ True{}:
      A.Solid{_, _, faces} = second
      finish(clip_faces(faces, Built{[S.initial(first, ad, 0)], Nil{}}, 1, 0, policy, tolerance, ab), policy, ab)
    case True{} False{}:
      A.Solid{_, _, faces} = first
      finish(clip_faces(faces, Built{[S.initial(second, bd, 1)], Nil{}}, 0, 0, policy, tolerance, bb), policy, bb)
    case _ _:
      Unresolved{P.UnsupportedArrangement{}, 0, 0, policy, R.from_f32(0.0), Nil{}}

def checked(valid: Bool, +first: A.Solid, +ad: List<&2, F.DomainChoice>, +ab: R.Real,
    +second: A.Solid, +bd: List<&2, F.DomainChoice>, +bb: R.Real, +policy: Policy, +tolerance: I.Tolerance) -> IntersectionResult:
  match valid:
    case False{}:
      Unresolved{P.InvalidInput{}, 0, 0, policy, R.from_f32(0.0), Nil{}}
    case True{}:
      selected(S.tool_valid(first, ad, ab, tolerance), S.tool_valid(second, bd, bb, tolerance),
        first, ad, ab, second, bd, bb, policy, tolerance)

def intersect(first: A.Solid, ad: List<&2, F.DomainChoice>, +ab: R.Real,
    second: A.Solid, bd: List<&2, F.DomainChoice>, +bb: R.Real, +tolerance: I.Tolerance, +policy: Policy) -> IntersectionResult:
  valid = Bool.and(F.valid_budget(ab), Bool.and(F.valid_budget(bb), Bool.and(policy_valid(policy),
    Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))))
  checked(valid, first, ad, ab, second, bd, bb, policy, tolerance)
