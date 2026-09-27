import Base
import ./LAWS.bend as Laws
import ../../geometry.bend as G
import ../../topology.bend as T
import ../spike/topology-spec.bend as W
import ../spike/topology-lemmas.bend as TL

def Laws.transform_keeps_edges(s, r, o):
  match s:
    case T.Solid{vs, es, fs}:
      {==}

def Laws.transform_keeps_loops(s, r, o):
  match s:
    case T.Solid{vs, es, fs}:
      TL.transform_faces_loops(fs, r, o)

def Laws.revolve_refuses_one_point(ra, ha, t, o, axis, x):
  {==}

def Laws.extrude_empty_is_ill_formed(delta):
  {==}

def Laws.extrude_two_points_is_ill_formed(a, b, delta):
  {==}

def Laws.extrude_pentagon_well_formed(a, b, c, d, e, delta):
  {==}
