"""Operation-faithful OCCT chamfers, checked independently of zone contracts."""
import importlib.util
import math
from pathlib import Path
import unittest
import sys
from build123d import Vector, GeomType, Solid, Plane

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('zf1_oracle',root/'fixtures/cad-acid/b3d/acid_fillet_zf1.py')
o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o)
sys.path[:0]=[str(root/'scripts/acid'),str(root/'scripts')]
from measure import canonical

class ChamferTests(unittest.TestCase):
 def test_planar_selection_does_not_propagate(self):
  for width in (.2,.5):
   stock=o.cuboid([[0,0,0],[13,9,6]])
   for plane in (Plane.XY,Plane((10,-7,5),x_dir=(1,2,0),z_dir=(2,-1,3))):
    moved=stock.moved(plane.location)
    selected=moved.edges().sort_by_distance(plane.from_local_coords(Vector(6.5,0,6)))[0]
    result=o.equal_offset_chamfer(moved,[selected],width,False)
    self.assertTrue(result.is_valid)
    self.assertAlmostEqual(result.volume,stock.volume-13*width**2/2,places=7)
    # The same selection on a G1 neighbour must expose OCCT's limitation.
    rounded=stock.fillet(.8,[stock.edges().sort_by_distance(Vector(0,0,3))[0]]).moved(plane.location)
    selected=rounded.edges().sort_by_distance(plane.from_local_coords(Vector(6.5,0,6)))[0]
    with self.assertRaisesRegex(o.UnsupportedFeatureError,'tangentPropagation=false') as caught:
     o.equal_offset_chamfer(rounded,[selected],width,False)
    self.assertTrue(caught.exception.operation_under_test)
    propagated=o.equal_offset_chamfer(rounded,[selected],width,True)
    self.assertTrue(propagated.is_valid)
    self.assertGreater(sum(f.geom_type==GeomType.CONE for f in propagated.faces()),0)

 def test_catalog_chamfers_reach_native_operation(self):
  # Real zone calls must reach the shared chamfer, with all selected edges
  # belonging to the posed body. Wrapper errors are never accepted as a
  # kernel limitation. Record arguments without replacing the operation.
  from unittest.mock import patch
  native=o.equal_offset_chamfer
  calls=[]
  def checked(body,selected,width,propagation):
   calls.append((len(selected),width,propagation))
   self.assertTrue(all(any(e.is_same(s) for e in body.edges()) for s in selected))
   return native(body,selected,width,propagation)
  for variant in ('V0','V1','V2','V3','V4'):
   with patch.object(o,'equal_offset_chamfer',checked):
    with self.assertRaisesRegex(o.UnsupportedFeatureError,'tangentPropagation=false'):
     o.build_zone('AC118',variant)
    self.assertEqual(calls[-1][0],1)
    self.assertFalse(calls[-1][2])
    # At the catalog's exact radius boundary OCCT may fail Build; only its
    # explicit failure is permitted here, never an earlier Python exception.
    try:
     bodies=o.build_zone('AC123',variant)
    except RuntimeError as exc:
     self.assertEqual(str(exc),'BRepFilletAPI_MakeChamfer: Build not done')
    else:
     self.assertEqual(len(bodies),1)
     self.assertTrue(bodies[0].is_valid)
    self.assertEqual(calls[-1][0],8)
    self.assertTrue(calls[-1][2])
  self.assertEqual(len(calls),10)

 def test_parallel_body_sweep_rectangular_and_triangular(self):
  for points in ([(0,0,0),(13,0,0),(13,9,0),(0,9,0)],[(0,0,0),(12,0,0),(6,6*math.sqrt(3),0)]):
   h=7;r=.7
   b=Solid.extrude(o.polygon(points),(0,0,h))
   b=b.fillet(r,[b.edges().sort_by_distance(Vector(x,y,h/2))[0] for x,y,_ in points])
   rim=[e for e in b.edges() if e.geom_type==GeomType.CIRCLE and abs(e.center().Z-h)<1e-7]
   centres=[e.arc_center for e in rim];cx=sum(p.X for p in centres)/len(centres);cy=sum(p.Y for p in centres)/len(centres)
   centres.sort(key=lambda p:math.atan2(p.Y-cy,p.X-cx))
   pairs=list(zip(centres,centres[1:]+centres[:1]))
   area=abs(sum(a.X*c.Y-a.Y*c.X for a,c in pairs))/2
   perimeter=sum((a-c).length for a,c in pairs)
   for width in (.3,r):
    selection=[e for e in b.edges() if abs(e.center().Z-h)<1e-7 and all(abs(v.center().Z-h)<1e-7 for v in e.vertices())]
    result=o.equal_offset_chamfer(b,selection,width,True)
    # Steiner section area A(s)=Acore+Pcore*s+pi*s², integrated
    # independently at the lower and upper disk radii.
    top=area*width+perimeter*(r*r-(r-width)**2)/2+math.pi*(r**3-(r-width)**3)/3
    expected=(h-width)*(area+perimeter*r+math.pi*r*r)+top
    self.assertTrue(result.is_valid)
    self.assertAlmostEqual(result.volume,expected,places=7)
    self.assertEqual(sum(f.geom_type==GeomType.CONE for f in result.faces()),len(points))
    topology,raw,_=canonical(result.wrapped)
    self.assertEqual(topology['genus'],0,(topology,raw))
    self.assertEqual(topology['loops'],topology['faces'],(topology,raw))
    # Shared cone/plane boundaries are real edges even if the periodic
    # supporting cone retained a pair of pcurves after the union.
    expected_edges=9*len(points) if width==r else 10*len(points)
    expected_vertices=5*len(points) if width==r else 6*len(points)
    self.assertEqual(topology['edges'],expected_edges,(topology,raw))
    self.assertEqual(topology['vertices'],expected_vertices,(topology,raw))

if __name__=='__main__':unittest.main()
