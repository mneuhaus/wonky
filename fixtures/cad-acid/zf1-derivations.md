# ZF1 — contracts frozen before geometry observation, 2026-10-02

Consumer: the CAD-Acid closed-form checker and the F1c–F5 blend stages.
These are distilled geometric classes; no source part was copied.
`scripts/acid/zf1_forms.py` contains both routes and the analytic support data.
V4 increases every radius by 1/40 mm, including the source circle/boss radii.
Only the existing standard tolerance profile applies. No exactness claim is made
for nominal radicals or tangencies after binary64 SI conversion.

- **AC118:** an equilateral triangular prism of side L=24, height h=8.
  Round the vertical edge at the origin by r=1, then chamfer the top edge on
  y=0 by w=1/2, without tangent propagation. The cylinder centre in XY is
  (sqrt(3)r,r). The rounded section has area sqrt(3)L²/4 − (sqrt(3)−pi/3)r²
  and perimeter 3L−2sqrt(3)r+2pi r/3. The chamfer removes horizontal strips
  (w−y)[L−y/sqrt(3)−sqrt(3)r+sqrt(r²−(y−r)²)]. Its plane intersects the
  fillet cylinder and the far sloped plane, creating the mitre trims.
  Route A evaluates trig antiderivatives after y=r(1−cos t); route B
  integrates horizontal strips and separately counts removed face charts.
- **AC119:** radius-10 cylindrical stock, height 8, through bore radius 2
  with a 45° countersink from z=6 to radius 4 at z=8. Chamfer the upper
  circular rim by width r=1/2 along each support. The lower chamfer ring is
  (rho,z)=(4−r/sqrt(2),8−r/sqrt(2)); the top ring is (4+r,8).
  Route A subtracts exact frusta and sums their lateral areas. Route B
  integrates the piecewise radial profile and its slope-weighted wall area.
- **AC120:** sketch a D profile: line (0,6) to (0,−6), semicircle through
  (6,0), extrude 8, fillet only the upper vertical junction with radius 1.
  Source circle radius R=6. The blend centre is (r,c), c=sqrt(R²−2Rr),
  and its contact angle is acos(r/(R−r)). The source arc runs −pi/2 to
  that angle; the blend arc runs from that angle to pi. Route A uses the
  closed Green boundary expression; route B integrates Cartesian Green
  integrands and arc speed on the two circles independently.
- **AC121:** plate (−16,−16,0)–(16,16,4), cylindrical boss radius R=4,
  height 8, concave root fillet r=1. The torus major is R+r. Added volume
  is pi[2Rr²+5r³/3−pi(R+r)r²/2]. Replace plate annulus and boss strip by
  the torus quarter. Route A uses circular-sector moments; route B uses
  radial shells with blend height r−sqrt(r²−(rho−R−r)²) and the torus chart.
- **AC122:** same prism as AC118; round all three edges at (0,0,0) in
  one equal-radius operation. Ball centre (sqrt(3)r,r,r). The two bottom
  stripe setbacks are sqrt(3)r, the vertical setback is r: project the
  centre, do not impose the orthogonal setback. For 0≤z≤r set
  t=sqrt(r²−(z−r)²), d=r−t. Section area is
  sqrt(3)(L−4d/sqrt(3))²/4−(sqrt(3)−pi/3)t². Above r it is constant.
  The sphere normal sector has solid angle 2pi/3. Far cylinder ends are
  ellipse cuts. Route A uses integral t dz=pi r²/4 and t² dz=2r³/3;
  route B integrates sections, both cylinder charts and the sphere chart.
- **AC123:** box 32×24×8; round four vertical edges r=1, then chamfer the
  complete top chain with width=r. This preserves exact construction G1
  provenance rather than assuming that three-point sketch arcs remain
  tangent after SI rounding. Inner rectangle a=32−2r,b=24−2r. At offset
  s its rounded parallel body has area ab+2(a+b)s+pi s² and perimeter
  2(a+b)+2pi s. The top chamfer sweeps s from r down to zero, ending in
  four cone apices. Route A integrates the polynomial analytically;
  route B integrates rectangle/strip/quarter-disk sections and sloped charts.

Topology is hand-derived in each zone, including ring-loop correction and
AC123's four cone singularities. Bounding boxes use analytic support extrema
on the listed points, circle/conic arcs and AC122's spherical normal cone.
A second route (`sectional_bbox`) derives horizontal sections independently
of those support elements and maximizes their directional support over height.
AC118 clips its rounded triangle by y >= w+z-h; AC122 takes the convex hull
of a disk with radius sqrt(r²-(z-r)²) and the two far offset vertices. AC123
uses the Minkowski sum of its centre rectangle and a disk of radius r below
the chamfer, then radius h-z above it. AC119 uses the surviving outer stock;
AC120 uses its two sectional circular charts; AC121 uses plate sections and
the boss/root radial profile. Endpoints and construction-band boundaries are
included. Golden-section maximization uses 250 iterations at the checker's
50-digit precision; it verifies analytic sections and does not construct or
approximate geometry. Convex-solid projection proves the sectional support
is concave; convex radial bands in AC121 attain their maximum at an endpoint.
Both routes check local and every transformed box, including V4. Volume and
area also each have two routes; V0/V4 agree within 1e-12 absolute. No geometry
engine participates in either closed-form route.

Independent OCCT twin constructions preserve the specified analytic shapes
where OCCT's blend builder cannot express the boundary operation. A selected
edge with orthogonal planar supports uses a single equal-offset half-space
cut, which cannot propagate to tangent neighbours (AC118). A convex rounded
prism top uses a parallel-body sweep: centre polygon, planar edge strips and
full circular cones/frusta, boolean-unioned with the surviving lower prism.
It accepts arbitrary convex polygons and widths up to the common rim radius,
including zero-radius cone apices (AC123). These are oracle constructions,
not production kernel paths. They independently confirm the assumed analytic
operations; live Onshape semantics remain for the maintainer to capture.
