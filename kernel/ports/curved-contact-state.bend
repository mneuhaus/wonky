import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../intersections.bend as I
import ../halfspace.bend as H
import ../junction.bend as J
import ../curve-band.bend as CB
import ../face-bounds.bend as FB
import ../robust-predicates.bend as Exact
import ./types.bend as P
import ./curved-validate.bend as V

type Policy is Data:
  ToleratedRegularized{contact_cap: R.Real, source_budget: R.Real, tolerance: I.Tolerance}

type VertexRecord is Data:
  VertexRecord{vertex: U32, exact: Exact.Decision, distance: R.Real, kind: U32, association: Maybe<&2, J.Association>}

type BandRecord is Data:
  BandRecord{edge: U32, result: CB.BandResult}

type FaceRecord is Data:
  FaceRecord{face: U32, bounds: FB.Bounds, mode: U32}

type ComponentRecord is Data:
  ComponentRecord{vertices: List<&2, H.VertexMap>, edges: List<&2, H.VertexMap>, audit: V.Audit, vertex_links: Bool}

type Ledger is Data:
  Ledger{version: U32, stage: U32, vertices: List<&2, VertexRecord>, bands: List<&2, BandRecord>, faces: List<&2, FaceRecord>, components: List<&2, ComponentRecord>}

type Attempt is Data:
  Attempt{result: P.Result, policy: Policy, ledger: Ledger}

def empty() -> Ledger:
  Ledger{1, 0, Nil{}, Nil{}, Nil{}, Nil{}}

def cap(policy: Policy) -> R.Real:
  ToleratedRegularized{cap, _, _} = policy
  cap

def budget(policy: Policy) -> R.Real:
  ToleratedRegularized{_, budget, _} = policy
  budget

def tolerance(policy: Policy) -> I.Tolerance:
  ToleratedRegularized{_, _, tolerance} = policy
  tolerance

def stage(stage: U32, ledger: Ledger) -> Ledger:
  Ledger{version, _, vertices, bands, faces, components} = ledger
  Ledger{version, stage, vertices, bands, faces, components}

def reject(reason: P.Reason, policy: Policy, ledger: Ledger) -> Attempt:
  Attempt{P.Unresolved{reason}, policy, ledger}
