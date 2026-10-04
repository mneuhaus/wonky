//! Carrier-fragment Boolean evaluation for checked latitude-bounded Models.
//! Both operands use the same arrangement/classification/selection/sewing
//! mechanism. There is no operation or fixture family dispatch. Open angular
//! trims refuse until the Model auditor can admit their charts.
use crate::{a1, keep, periodic, sphere, Class, Op, Side};
use num_traits::{Signed, ToPrimitive, Zero};
use std::collections::BTreeMap;
use wonky_curve::{Carrier, Cycle, ExactPoint, Trimmed};
use wonky_curve::radical::Radical;
use wonky_geom::model::algebraic::{self, RPoint, RadicalPlane3};
use wonky_geom::model::curved::Patch;
use wonky_geom::model::extrusion::{strip_chart, strip_point};
use wonky_geom::{cross, dot, frame::Frame, model::*, sub, Point, Refused, Result, Q};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn err(s: &'static str) -> Refused {
    Refused(s)
}
fn curve<T>(v: std::result::Result<T, wonky_curve::Refusal>) -> Result<T> {
    v.map_err(|e| err(e.name()))
}
fn rat(r: &wonky_curve::radical::Radical) -> Result<Q> {
    r.rational()
        .ok_or(err("boolean/ssi-row-unavailable:quadratic/ring-emission"))
}
fn image_frame(f: &Frame, p: &Point) -> Result<Frame> {
    Frame::new(p.clone(), f.columns().clone())
}
fn ring(frame: &Frame, height: Q, radius: Q) -> Result<Circle3> {
    Circle3::new(
        image_frame(frame, &frame.point(&[q(0), q(0), height]))?,
        &radius * &radius,
    )
}
fn plane_ring(c: &Circle3, p: &Plane3, ccw: bool) -> Result<Trimmed> {
    let frame = c.frame()?;
    let center = p.chart(frame.origin())?;
    let axis = |i: usize| -> Result<[Q; 2]> {
        let at: Point = std::array::from_fn(|k| &frame.origin()[k] + &frame.columns()[i][k]);
        let uv = p.chart(&at)?;
        Ok(std::array::from_fn(|k| &uv[k] - &center[k]))
    };
    let (x, y) = (axis(0)?, axis(1)?);
    let norm = |a: &[Q; 2]| &a[0] * &a[0] + &a[1] * &a[1];
    if !(&x[0] * &y[0] + &x[1] * &y[1]).is_zero() || norm(&x) != norm(&y) {
        return Err(err(
            "boolean/ssi-row-unavailable:circle/elliptic-plane-chart",
        ));
    }
    let anchor = ExactPoint::from_rational(p.chart(&c.point(curved::Patch::First, &q(0))?)?);
    curve(Trimmed::ring(center, c.radius2() * norm(&x), anchor, ccw))
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum EdgeKey {
    Line([Point; 2]),
    Ring([Q; 4], [Q; 10]),
    /// A line segment with an irrational end, its ends in key order.
    Segment([VertexKey; 2]),
    /// A partial circle: the canonical circle and its ends in the canonical
    /// sense, so the two arcs between the same ends stay distinct.
    Arc([Q; 4], [Q; 10], [VertexKey; 2]),
    /// An arc of a circle with Q(√d) data: its canonical key and its ends in
    /// the canonical sense (counter-clockwise about the canonical normal).
    RArc(CurveKey, [VertexKey; 2]),
    /// A ring of a circle with Q(√d) data.
    RRing(CurveKey),
}
fn vkey(p: &RPoint) -> VertexKey {
    match algebraic::rational(p) {
        Some(r) => VertexKey::Rational(r),
        None => VertexKey::Real(p.clone()),
    }
}
impl EdgeKey {
    /// The two ends of a bounded edge in key order (`None` for a ring).
    fn ends(&self) -> Option<[VertexKey; 2]> {
        match self {
            Self::Line(p) => Some(p.clone().map(VertexKey::Rational)),
            Self::Segment(v) | Self::Arc(_, _, v) | Self::RArc(_, v) => Some(v.clone()),
            Self::Ring(..) | Self::RRing(_) => None,
        }
    }
}
/// The chart pieces of one use, in its traversal order: one plane-chart
/// piece, or a sphere face's stereographic atlas trim.
type Chart = Vec<(Patch, Trimmed)>;
#[derive(Clone, Debug)]
struct Use {
    key: EdgeKey,
    geometry: Curve3,
    sense: bool,
    chart: Option<Chart>,
}
impl Use {
    fn circle(c: Circle3, ccw: bool) -> Result<Self> {
        let (p, v, flipped) = c.canonical_data()?;
        Ok(Self {
            key: EdgeKey::Ring(p, v),
            geometry: Curve3::Circle(c),
            sense: ccw != flipped,
            chart: None,
        })
    }
    fn line(a: Point, b: Point) -> Self {
        let sense = a < b;
        let ends = if sense { [a, b] } else { [b, a] };
        Self {
            geometry: Curve3::Line {
                p: ends[0].clone(),
                d: sub(&ends[1], &ends[0]),
            },
            key: EdgeKey::Line(ends),
            sense,
            chart: None,
        }
    }
    /// A straight edge between exact points; rational ends keep `line`.
    fn segment(a: &RPoint, b: &RPoint) -> Self {
        if let (Some(a), Some(b)) = (algebraic::rational(a), algebraic::rational(b)) {
            return Self::line(a, b);
        }
        let sense = vkey(a) < vkey(b);
        let ends = if sense { [a.clone(), b.clone()] } else { [b.clone(), a.clone()] };
        Self {
            geometry: Curve3::RadicalLine {
                d: algebraic::sub(&ends[1], &ends[0]),
                p: ends[0].clone(),
            },
            key: EdgeKey::Segment(ends.map(|p| vkey(&p))),
            sense,
            chart: None,
        }
    }
    /// The arc of `c` from `a` to `b`, counter-clockwise in `c`'s frame
    /// when `ccw`.
    fn arc(c: Circle3, ccw: bool, a: &RPoint, b: &RPoint) -> Result<Self> {
        let (p, v, flipped) = c.canonical_data()?;
        let (a, b) = (vkey(a), vkey(b));
        if a == b {
            return Err(err("boolean/contract-violation:sewing/closed-arc"));
        }
        let sense = ccw != flipped;
        let ends = if sense { [a, b] } else { [b, a] };
        Ok(Self {
            key: EdgeKey::Arc(p, v, ends),
            geometry: Curve3::Circle(c),
            sense,
            chart: None,
        })
    }
    /// A circle use traversed counter-clockwise about the curve frame's
    /// normal iff `ccw`: a ring (`ends` None) or the arc between `ends`,
    /// carrying its chart pieces. A rational circle keys as `circle`/`arc`,
    /// so every face it bounds sews to one edge.
    fn circle_use(geometry: Curve3, ends: Option<[RPoint; 2]>, ccw: bool, chart: Chart) -> Result<Self> {
        let mut u = match (&geometry, ends) {
            (Curve3::Circle(c), None) if !c.is_radical() => Self::circle(c.clone(), ccw)?,
            (Curve3::Circle(c), Some([a, b])) if !c.is_radical() => Self::arc(c.clone(), ccw, &a, &b)?,
            (_, ends) => {
                let (key, flipped) = curve_key(&geometry)?;
                let canonical = ccw != flipped;
                let key = match ends {
                    None => EdgeKey::RRing(key),
                    Some([a, b]) => {
                        let (a, b) = (vkey(&a), vkey(&b));
                        if a == b {
                            return Err(err("boolean/contract-violation:sewing/closed-arc"));
                        }
                        EdgeKey::RArc(key, if canonical { [a, b] } else { [b, a] })
                    }
                };
                Self { key, geometry, sense: canonical, chart: None }
            }
        };
        u.chart = Some(chart);
        Ok(u)
    }
    /// The ends in traversal order (`None` for a ring).
    fn ends(&self) -> Option<[VertexKey; 2]> {
        self.key.ends().map(|[a, b]| if self.sense { [a, b] } else { [b, a] })
    }
    fn reverse(&mut self) {
        self.sense = !self.sense;
        if let Some(chart) = &mut self.chart {
            chart.reverse();
            for (_, piece) in chart.iter_mut() {
                *piece = piece.reversed();
            }
        }
    }
}
fn radical<T>(f: impl FnOnce() -> T) -> Result<T> {
    wonky_curve::radical::guard(f).map_err(|_| err("boolean/budget-exceeded:sewing-arithmetic"))
}
/// Canonical key and frame flip of a circle of either class.
fn curve_key(c: &Curve3) -> Result<(CurveKey, bool)> {
    match c {
        Curve3::Circle(k) => Ok(k.canonical_key()),
        Curve3::RadicalCircle(k) => {
            let (normal, centre, r2, flipped) = k.canonical_data()?;
            Ok((CurveKey::RadicalCircle { normal, centre, r2 }, flipped))
        }
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => Err(err("boolean/contract-violation:sewing/curve-key")),
        Curve3::TranslatedCircle(_) => Err(err("boolean/ssi-row-unavailable:translated-circle/curved-sewing")),
    }
}
/// The circle of radius `r` at height `h` on the third column of `frame`:
/// rational data give a `Circle3`, Q(√d) data a `RadicalCircle3`. Every
/// producer of a section circle goes through here, so one point set is one
/// curve class on both faces it bounds.
fn circle_curve(frame: &Frame, h: &Radical, r: &Radical) -> Result<Curve3> {
    match (h.rational(), r.rational()) {
        (Some(h), Some(r)) => Ok(Curve3::Circle(ring(frame, h, r)?)),
        _ => Ok(Curve3::RadicalCircle(RadicalCircle3::new(frame.clone(), h.clone(), r.clone())?)),
    }
}
/// The height of a Q(√d) latitude's centre on the third column of `frame`.
fn band_height(frame: &Frame, r: &RadicalCircle3) -> Result<Radical> {
    let centre = r.center()?;
    let inv = frame.inverse();
    radical(|| (0..3).fold(Radical::from(inv.origin()[2].clone()), |v, j| v + &centre[j] * &inv.columns()[j][2]))
}
/// The exact square root of a chart radius squared, rational or in one
/// quadratic field.
fn root2(r2: &Radical) -> Result<Radical> {
    let x = r2.rational().ok_or(err("boolean/ssi-row-unavailable:circle/radius-class"))?;
    if let Some(r) = wonky_curve::numeric::exact_root(&x) {
        return Ok(r.into());
    }
    curve(Radical::quadratic(Q::zero(), Q::from_integer(1.into()), x))
}
/// A section circle in a plane chart: its centre must be rational there,
/// and the chart must be isometric on the circle's plane.
fn plane_circle(frame: &Frame, height: &Radical, radius: &Radical, p: &Plane3) -> Result<Trimmed> {
    let h = height.rational().ok_or(err("boolean/ssi-row-unavailable:circle/radical-centre-plane"))?;
    let centre3 = frame.point(&[q(0), q(0), h]);
    let centre = p.chart(&centre3)?;
    let axis = |i: usize| -> Result<[Q; 2]> {
        let at: Point = std::array::from_fn(|k| &centre3[k] + &frame.columns()[i][k]);
        let uv = p.chart(&at)?;
        Ok(std::array::from_fn(|k| &uv[k] - &centre[k]))
    };
    let (x, y) = (axis(0)?, axis(1)?);
    let norm = |a: &[Q; 2]| &a[0] * &a[0] + &a[1] * &a[1];
    if !(&x[0] * &y[0] + &x[1] * &y[1]).is_zero() || norm(&x) != norm(&y) {
        return Err(err("boolean/ssi-row-unavailable:circle/elliptic-plane-chart"));
    }
    let r2 = radical(|| radius * radius * norm(&x))?;
    curve(Trimmed::circle(centre, r2, true))
}
#[derive(Clone, Debug)]
struct FaceSpec {
    carrier: Carrier3,
    forward: bool,
    loops: Vec<Vec<Use>>,
}
fn reverse(face: &mut FaceSpec) {
    face.forward = !face.forward;
    for lp in &mut face.loops {
        lp.reverse();
        for u in lp {
            u.reverse();
        }
    }
}

// Rational outward boxes of complete trims/bands. A circle uses |x_i|+|y_i|
// as a support bound, which also encloses affine images. Boxes prove only
// strict disjointness. Equal/touching boxes always reach exact SSI.
fn bounds(m: &Model, fi: FaceId) -> Result<[[Q; 3]; 2]> {
    let d = m.draft();
    let f = &d.faces[fi.index()];
    let mut points = vec![];
    for lp in &f.loops {
        for co in &d.loops[lp.index()].coedges {
            let e = &d.edges[d.coedges[co.index()].edge.index()];
            // An arc bulges beyond its ends: it adds its circle's support box.
            match (&e.bounds, &d.curves[e.curve.index()].geometry) {
                (Bounds::Segment(_), Curve3::Circle(c)) => points.extend(circle_box(c)?),
                (Bounds::Segment(_), Curve3::RadicalCircle(c)) => points.extend(radical_circle_box(c)?),
                _ => (),
            }
            match &e.bounds {
                Bounds::Segment(vs) => {
                    for v in vs {
                        points.extend(outward(&m.key(*v).coordinates())?);
                    }
                }
                Bounds::Ring => match &d.curves[e.curve.index()].geometry {
                    Curve3::Circle(c) => points.extend(circle_box(c)?),
                    Curve3::RadicalCircle(c) => points.extend(radical_circle_box(c)?),
                    _ => return Err(err("model/g4-ring-on-open-curve")),
                },
            }
        }
    }
    // A sphere face lies in its sphere's box.
    if let Carrier3::Sphere(sp) = &d.surfaces[f.surface.index()].carrier {
        let cols = sp.frame.columns();
        for sg in [q(-1), q(1)] {
            points.push(std::array::from_fn(|i| {
                &sp.frame.origin()[i] + &sg * sp.radius() * (cols[0][i].abs() + cols[1][i].abs() + cols[2][i].abs())
            }));
        }
    }
    if points.is_empty() {
        return Err(err("boolean/ssi-row-unavailable:face/empty-bound"));
    }
    Ok(std::array::from_fn(|end| {
        std::array::from_fn(|i| {
            if end == 0 {
                points.iter().map(|p| p[i].clone()).min().unwrap()
            } else {
                points.iter().map(|p| p[i].clone()).max().unwrap()
            }
        })
    }))
}
/// The support box of a circle (see `bounds`).
fn circle_box(c: &Circle3) -> Result<[Point; 2]> {
    let r = wonky_curve::numeric::exact_root(&c.radius2())
        .ok_or(err("boolean/ssi-row-unavailable:circle/rational-bound"))?;
    let frame = c.frame()?;
    let delta: Point = std::array::from_fn(|i| &r * (frame.columns()[0][i].abs() + frame.columns()[1][i].abs()));
    Ok([
        std::array::from_fn(|i| &frame.origin()[i] - &delta[i]),
        std::array::from_fn(|i| &frame.origin()[i] + &delta[i]),
    ])
}
/// The support box of a circle with Q(√d) data, outward rounded.
fn radical_circle_box(c: &RadicalCircle3) -> Result<[Point; 2]> {
    let centre: RPoint = radical(|| {
        std::array::from_fn(|i| Radical::from(c.frame.origin()[i].clone()) + c.height() * &c.frame.columns()[2][i])
    })?;
    let r = bound(c.radius(), true)?;
    let cols = c.frame.columns();
    let corner = |end: bool| -> Result<Point> {
        let p = radical_bound(&centre, end)?;
        let s = if end { r.clone() } else { -r.clone() };
        Ok(std::array::from_fn(|i| &p[i] + &s * (cols[0][i].abs() + cols[1][i].abs())))
    };
    Ok([corner(false)?, corner(true)?])
}
/// A rational outer bound of an exact coordinate (`upper` or lower).
fn bound(x: &Radical, upper: bool) -> Result<Q> {
    if let Some(r) = x.rational() {
        return Ok(r);
    }
    let e = x.enclosure().map_err(|_| err("boolean/budget-exceeded:face-bound"))?;
    let v = if upper { e.m + e.r } else { e.m - e.r };
    let v = if upper { v.next_up() } else { v.next_down() };
    Q::from_float(v).ok_or(err("boolean/budget-exceeded:face-bound"))
}
fn radical_bound(p: &RPoint, upper: bool) -> Result<Point> {
    let b = p.iter().map(|x| bound(x, upper)).collect::<Result<Vec<_>>>()?;
    Ok([b[0].clone(), b[1].clone(), b[2].clone()])
}
/// Rational points enclosing an exact point: itself when rational, else the
/// two corners of its certified binary64 enclosure (outward rounded).
fn outward(p: &RPoint) -> Result<Vec<Point>> {
    if let Some(r) = algebraic::rational(p) {
        return Ok(vec![r]);
    }
    let mut lo = vec![];
    let mut hi = vec![];
    for x in p {
        let iv = x.enclosure().map_err(|e| err(e.name()))?;
        let f = |v: f64| Q::from_float(v).ok_or(err("boolean/ssi-row-unavailable:radical/bound-range"));
        lo.push(f(iv.lo().next_down())?);
        hi.push(f(iv.hi().next_up())?);
    }
    Ok(vec![
        std::array::from_fn(|k| lo[k].clone()),
        std::array::from_fn(|k| hi[k].clone()),
    ])
}
/// A rational strictly between two exact reals `a < b`, from their
/// certified enclosures; inseparable enclosures refuse by name.
fn between(a: &Radical, b: &Radical) -> Result<Q> {
    if let (Some(a), Some(b)) = (a.rational(), b.rational()) {
        return Ok((a + b) / q(2));
    }
    let (ia, ib) = (a.enclosure().map_err(|e| err(e.name()))?, b.enclosure().map_err(|e| err(e.name()))?);
    let f = |v: f64| Q::from_float(v).ok_or(err("boolean/ssi-row-unavailable:radical/bound-range"));
    let (x, y) = (f(ia.hi())?, f(ib.lo())?);
    let m = (x + y) / q(2);
    if !(a < &Radical::from(m.clone()) && &Radical::from(m.clone()) < b) {
        return Err(err("boolean/ssi-row-unavailable:radical/separation"));
    }
    Ok(m)
}
fn disjoint(a: &[[Q; 3]; 2], b: &[[Q; 3]; 2]) -> bool {
    (0..3).any(|i| a[1][i] < b[0][i] || b[1][i] < a[0][i])
}
/// Exact finite section segments of transverse planar face pairs (3D, in
/// the common frame), per side and face.
type Segments = [Vec<Vec<[RPoint; 2]>>; 2];
/// Per side and face: the other operand's faces on the same plane.
type Coplanar = [Vec<Vec<FaceId>>; 2];
/// An isolated touch point of two faces: (face of A, face of B, point).
type Touch = (usize, usize, RPoint);
fn sections(a: &Model, b: &Model) -> Result<([Vec<Vec<a1::SectionBranch>>; 2], Segments, Coplanar, Vec<Touch>)> {
    if a.draft()
        .faces
        .len()
        .checked_mul(b.draft().faces.len())
        .is_none_or(|n| n > 65_536)
    {
        return Err(err("boolean/budget-exceeded:curved-face-pairs"));
    }
    let mut cuts = [
        vec![vec![]; a.draft().faces.len()],
        vec![vec![]; b.draft().faces.len()],
    ];
    let mut segments: Segments = [
        vec![vec![]; a.draft().faces.len()],
        vec![vec![]; b.draft().faces.len()],
    ];
    let mut touches = vec![];
    let mut coplanar: Coplanar = [
        vec![vec![]; a.draft().faces.len()],
        vec![vec![]; b.draft().faces.len()],
    ];
    let boxes = [
        (0..a.draft().faces.len())
            .map(|i| bounds(a, FaceId(i as u32)))
            .collect::<Result<Vec<_>>>()?,
        (0..b.draft().faces.len())
            .map(|i| bounds(b, FaceId(i as u32)))
            .collect::<Result<Vec<_>>>()?,
    ];
    for (i, fa) in a.draft().faces.iter().enumerate() {
        for (j, fb) in b.draft().faces.iter().enumerate() {
            if disjoint(&boxes[0][i], &boxes[1][j]) {
                continue;
            }
            let ca = &a.draft().surfaces[fa.surface.index()].carrier;
            let cb = &b.draft().surfaces[fb.surface.index()].carrier;
            if let (Carrier3::Plane(pa), Carrier3::Plane(pb)) = (ca, cb) {
                let dir = cross(&pa.n, &pb.n);
                if dir.iter().all(Zero::is_zero) {
                    // Coincident planes imprint each other's trims.
                    if pb.side(&pa.o).is_zero() {
                        coplanar[0][i].push(FaceId(j as u32));
                        coplanar[1][j].push(FaceId(i as u32));
                    }
                    continue;
                }
                // Transverse planes meet in one rational line; the section is
                // its part inside both trimmed faces.
                let [on_a, on_b] = common_segments([(a, FaceId(i as u32), pa), (b, FaceId(j as u32), pb)], dir)?;
                segments[0][i].extend(on_a);
                segments[1][j].extend(on_b);
                continue;
            }
            match a1::intersect(ca, cb, wonky_alg::Limits::default())? {
                a1::Intersection::Coincident => (),
                a1::Intersection::Section { branches, .. } => {
                    // A sphere's isolated touch point (G14); other rows keep
                    // their landed handling of point branches.
                    let sphere = matches!(ca, Carrier3::Sphere(_)) || matches!(cb, Carrier3::Sphere(_));
                    for b in branches.iter().filter(|_| sphere) {
                        if let a1::Branch::Point(p) = &b.curve {
                            touches.push((i, j, p.clone()));
                        }
                    }
                    for branch in branches {
                        if ruling_meets_strip(b, FaceId(j as u32), &branch.curve)? {
                            cuts[0][i].push(branch.clone());
                        }
                        if ruling_meets_strip(a, FaceId(i as u32), &branch.curve)? {
                            cuts[1][j].push(branch);
                        }
                    }
                }
            }
        }
    }
    Ok((cuts, segments, coplanar, touches))
}
/// Whether a section line can meet face `fi` of `m`: for a strip (a partial
/// cylinder of a line/arc extrusion, see `strip`) a ruling meets it only if
/// its exact half-angle chart parameter lies in the strip's closed chart
/// range; the ruling through the chart pole lies on no strip. A ruling off
/// the strip touches no point of the face, so it splits nothing on the other
/// operand's face (the tea box's pocket corners: the outer corner cylinder's
/// carrier meets them 4e-16 inside their arc ends, far outside the outer
/// corner face). Every other face and branch is kept.
fn ruling_meets_strip(m: &Model, fi: FaceId, branch: &a1::Branch) -> Result<bool> {
    let a1::Branch::Line { p, d: dir } = branch else { return Ok(true) };
    let d = m.draft();
    let f = &d.faces[fi.index()];
    let Carrier3::Cylinder(cy) = &d.surfaces[f.surface.index()].carrier else { return Ok(true) };
    if m.revolution_band(fi)?.is_some() {
        return Ok(true);
    }
    let old = loops_of(d, f);
    if old.iter().flatten().any(|t| !matches!(t.carrier(), Carrier::Line)) {
        return Ok(true);
    }
    let v = cy.linear(dir);
    if !v[0].is_zero() || !v[1].is_zero() {
        return Ok(true);
    }
    let Some(r) = wonky_curve::numeric::exact_root(&cy.radius2()) else { return Ok(true) };
    let l = cy.local(p);
    let pole = &l[0] + &Radical::from(r);
    if pole.is_zero() {
        return Ok(false);
    }
    let t = &l[1] / &pole;
    let us = old.iter().flatten().flat_map(|piece| piece.ends().iter().map(|e| e.coordinates()[0].clone())).collect::<Vec<_>>();
    Ok(match (us.iter().min(), us.iter().max()) {
        (Some(lo), Some(hi)) => *lo <= t && t <= *hi,
        _ => true,
    })
}
/// The part of the line of two transverse planes inside both trimmed faces,
/// as exact 3D segments to add to each face. With `d = na x nb`, the point
/// `p = (ha (nb x d) + hb (d x na)) / |d|^2` lies on both planes and the
/// line is `p + t d`. Each face's trims are cut exactly along the line, in
/// that face's chart, and mapped back to `t` (a trim lying on the line
/// contributes its two ends). Between consecutive cuts the midpoint is
/// inside, on a trim, or outside each face. The section is where neither
/// face is outside; it is added to a face only where it is strictly inside
/// (a face whose trim it runs along already has that edge). Every segment
/// end is therefore a trim contact, never a dangling end. A contact with an
/// irrational chart point is ordered exactly; the status of each piece is
/// read at a rational point strictly inside it (`between`).
fn common_segments(faces: [(&Model, FaceId, &Plane3); 2], d: Point) -> Result<[Vec<[RPoint; 2]>; 2]> {
    let [(_, _, pa), (_, _, pb)] = faces;
    let (ha, hb) = (dot(&pa.n, &pa.o), dot(&pb.n, &pb.o));
    let (u, v) = (cross(&pb.n, &d), cross(&d, &pa.n));
    let dd = dot(&d, &d);
    let p: Point = std::array::from_fn(|k| (&ha * &u[k] + &hb * &v[k]) / &dd);
    let at = |t: &Q| -> Point { std::array::from_fn(|k| &p[k] + t * &d[k]) };
    let exact_at = |t: &Radical| -> RPoint { std::array::from_fn(|k| t * &d[k] + &p[k]) };
    let param = |x: &RPoint| -> Radical {
        algebraic::dot(&algebraic::sub(x, &algebraic::lift(&p)), &algebraic::lift(&d)) / &dd
    };
    // The line's t-range inside both faces' certified boxes, widened by one.
    let (mut t0, mut t1): (Option<Q>, Option<Q>) = (None, None);
    for (m, fi, _) in faces {
        let b = bounds(m, fi)?;
        for k in 0..3 {
            if d[k].is_zero() {
                if p[k] < &b[0][k] - q(1) || p[k] > &b[1][k] + q(1) {
                    return Ok([vec![], vec![]]);
                }
                continue;
            }
            let (x, y) = ((&b[0][k] - q(1) - &p[k]) / &d[k], (&b[1][k] + q(1) - &p[k]) / &d[k]);
            let (x, y) = if x < y { (x, y) } else { (y, x) };
            t0 = Some(t0.map_or(x.clone(), |t| t.max(x)));
            t1 = Some(t1.map_or(y.clone(), |t| t.min(y)));
        }
    }
    let (Some(t0), Some(t1)) = (t0, t1) else { return Err(err("boolean/contract-violation:split/zero-section-direction")) };
    if t0 >= t1 {
        return Ok([vec![], vec![]]);
    }
    let mut cuts = vec![Radical::from(t0.clone()), Radical::from(t1.clone())];
    let mut charts = vec![];
    for (m, fi, plane) in faces {
        let dr = m.draft();
        let f = &dr.faces[fi.index()];
        let old = f.loops.iter().map(|lp| dr.loops[lp.index()].coedges.iter().map(|c| dr.coedges[c.index()].pcurve.clone()).collect::<Vec<_>>()).collect::<Vec<_>>();
        let ends = [plane.chart(&at(&t0))?, plane.chart(&at(&t1))?].map(ExactPoint::from_rational);
        let segment = curve(Trimmed::new(ends, Carrier::Line))?;
        for piece in old.iter().flatten() {
            let contacts = match segment.contacts(piece) {
                Ok(c) => c,
                // A trim on the line: its ends bound the shared part.
                Err(wonky_curve::Refusal::OverlappingLines) => piece.ends().to_vec(),
                Err(e) => return Err(err(e.name())),
            };
            for c in contacts {
                cuts.push(param(&RadicalPlane3::from(plane).point(&c.coordinates())));
            }
        }
        charts.push((plane, old));
    }
    cuts.sort();
    cuts.dedup();
    let mut out = [vec![], vec![]];
    for w in cuts.windows(2) {
        let mid = between(&w[0], &w[1])?;
        // 1 strictly inside, 0 on a trim, -1 outside.
        let mut status = [0i8; 2];
        for (k, (plane, old)) in charts.iter().enumerate() {
            let point = ExactPoint::from_rational(plane.chart(&at(&mid))?);
            let mut on = false;
            for piece in old.iter().flatten() {
                on |= curve(piece.contains(&point))?;
            }
            status[k] = if on {
                0
            } else {
                let wind = old.iter().map(|c| curve(Cycle::new(c.clone()).winding(&point))).collect::<Result<Vec<_>>>()?.iter().sum::<i32>();
                if wind != 0 { 1 } else { -1 }
            };
        }
        if status.iter().all(|&s| s >= 0) {
            for k in 0..2 {
                if status[k] == 1 {
                    out[k].push([exact_at(&w[0]), exact_at(&w[1])]);
                }
            }
        }
    }
    Ok(out)
}
fn gradient(c: &Carrier3, p: &Point) -> Result<Point> {
    let im = c.implicit()?;
    Ok(std::array::from_fn(|i| {
        let mut a = p.clone();
        let mut b = p.clone();
        a[i] += q(1);
        b[i] -= q(1);
        (im.evaluate(&a) - im.evaluate(&b)) / q(2)
    }))
}
fn class_at(
    own: &Carrier3,
    forward: bool,
    other: &Model,
    p: &Point,
    reverse: bool,
) -> Result<Class> {
    Ok(match other.membership(p, reverse)? {
        Membership::Inside => Class::In,
        Membership::Outside => Class::Out,
        Membership::Boundary(fi) => {
            let f = &other.draft().faces[fi.index()];
            let c = &other.draft().surfaces[f.surface.index()].carrier;
            let align = dot(&gradient(own, p)?, &gradient(c, p)?);
            if align.is_zero() {
                return Err(err("boolean/contract-violation:classify/on-normal"));
            }
            if align.is_positive() == (forward == f.forward) {
                Class::OnSame
            } else {
                Class::OnOpposite
            }
        }
    })
}
// Restrict a closed SSI circle to the source face before arranging. Every
// contact is enumerated exactly and the open arcs between them have constant
// face winding. Tangency outside a face therefore introduces no split.
fn ring_meets_interior(pc: &Trimmed, old: &[Vec<Trimmed>]) -> Result<bool> {
    let mut contacts = vec![];
    for piece in old.iter().flatten() {
        if let (Carrier::Circle(a), Carrier::Circle(b)) = (pc.carrier(), piece.carrier()) {
            if a.c == b.c && a.r2 == b.r2 && piece.is_ring() {
                return Ok(false);
            }
        }
        contacts.extend(curve(pc.contacts(piece))?);
    }
    let profiles = old.iter().cloned().map(Cycle::new).collect::<Vec<_>>();
    let cuts = curve(pc.sorted_cuts(contacts))?;
    for arc in curve(pc.split(cuts))? {
        let point = curve(arc.interior_point())?;
        let wind = profiles
            .iter()
            .map(|c| curve(c.winding(&point)))
            .collect::<Result<Vec<_>>>()?
            .iter()
            .sum::<i32>();
        if wind != 0 {
            return Ok(true);
        }
    }
    Ok(false)
}
/// The pieces of `piece` strictly inside a face with trims `old`: split at
/// every exact contact (a trim on the same carrier contributes its ends),
/// dropping the parts on a trim and the parts of zero face winding. Every
/// kept end therefore lies on a trim or continues inside; no part dangles
/// outside the face.
fn clip_to_face(piece: &Trimmed, old: &[Vec<Trimmed>]) -> Result<Vec<Trimmed>> {
    let mut contacts = vec![];
    for t in old.iter().flatten() {
        match piece.contacts(t) {
            Ok(c) => contacts.extend(c),
            Err(wonky_curve::Refusal::OverlappingLines | wonky_curve::Refusal::OverlappingArcs) => {
                for e in t.ends() {
                    if curve(piece.contains(e))? {
                        contacts.push(e.clone());
                    }
                }
            }
            Err(e) => return Err(err(e.name())),
        }
    }
    let cuts = curve(piece.sorted_cuts(contacts))?;
    let profiles = old.iter().cloned().map(Cycle::new).collect::<Vec<_>>();
    let mut out = vec![];
    for part in curve(piece.split(cuts))? {
        let m = curve(part.exact_interior_point())?;
        let mut on = false;
        for t in old.iter().flatten() {
            on |= curve(t.contains(&m))?;
        }
        if on {
            continue;
        }
        let wind = profiles.iter().map(|c| curve(c.winding(&m))).collect::<Result<Vec<_>>>()?.iter().sum::<i32>();
        if wind != 0 {
            out.push(part);
        }
    }
    Ok(out)
}
/// Section pieces added to one face: exact duplicates are dropped and
/// overlapping pieces of one line are joined into maximal segments, so the
/// arrangement never sees two copies of one curve.
fn normalize(pieces: Vec<Trimmed>) -> Result<Vec<Trimmed>> {
    let mut lines: Vec<Vec<Trimmed>> = vec![];
    let mut out: Vec<Trimmed> = vec![];
    for p in pieces {
        match p.carrier() {
            Carrier::Line => {
                let mut placed = false;
                for g in &mut lines {
                    if curve(g[0].coincident_with(&p))? {
                        g.push(p.clone());
                        placed = true;
                        break;
                    }
                }
                if !placed {
                    lines.push(vec![p]);
                }
            }
            _ => {
                let same = |q: &Trimmed| {
                    q.key() == p.key()
                        && (q.ends() == p.ends() || q.reversed().ends() == p.ends())
                };
                if !out.iter().any(same) {
                    out.push(p);
                }
            }
        }
    }
    for g in lines {
        let base = g[0].ends()[0].clone();
        let dir = g[0].ends()[1].difference(&base);
        let s = |x: &ExactPoint| {
            let v = x.difference(&base);
            &v[0] * &dir[0] + &v[1] * &dir[1]
        };
        let mut spans = g
            .iter()
            .map(|p| {
                let (a, b) = (p.ends()[0].clone(), p.ends()[1].clone());
                if s(&a) <= s(&b) { (s(&a), a, s(&b), b) } else { (s(&b), b, s(&a), a) }
            })
            .collect::<Vec<_>>();
        spans.sort_by(|x, y| x.0.cmp(&y.0));
        let mut merged: Vec<(Radical, ExactPoint, Radical, ExactPoint)> = vec![];
        for sp in spans {
            match merged.last_mut() {
                Some(last) if sp.0 <= last.2 => {
                    if sp.2 > last.2 {
                        last.2 = sp.2;
                        last.3 = sp.3;
                    }
                }
                _ => merged.push(sp),
            }
        }
        for (_, a, _, b) in merged {
            out.push(curve(Trimmed::new([a, b], Carrier::Line))?);
        }
    }
    Ok(out)
}
/// A rational chart box enclosing the trims, widened by one.
fn chart_box(old: &[Vec<Trimmed>]) -> Result<[[Q; 2]; 2]> {
    let f = |v: f64| Q::from_float(v).ok_or(err("boolean/ssi-row-unavailable:radical/bound-range"));
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    let mut grow = |c: &[Radical; 2], r: f64| -> Result<()> {
        for k in 0..2 {
            let iv = c[k].enclosure().map_err(|e| err(e.name()))?;
            lo[k] = lo[k].min(iv.lo() - r);
            hi[k] = hi[k].max(iv.hi() + r);
        }
        Ok(())
    };
    for t in old.iter().flatten() {
        for e in t.ends() {
            grow(&e.coordinates(), 0.)?;
        }
        if let Carrier::Circle(c) = t.carrier() {
            let r2 = c.r2.enclosure().map_err(|e| err(e.name()))?.hi();
            grow(&c.c.coordinates(), r2.sqrt() * 1.001 + 1.)?;
        }
    }
    Ok([[f(lo[0] - 1.)?, f(lo[1] - 1.)?], [f(hi[0] + 1.)?, f(hi[1] + 1.)?]])
}
/// The chart line through `a` with direction `d` (exact), as a segment
/// whose ends lie outside the chart box: the parameter range covers the
/// box's projection with margin, so no part of the box is missed.
fn box_line(a: &[Radical; 2], d: &[Radical; 2], b: &[[Q; 2]; 2]) -> Result<Trimmed> {
    let fl = |x: &Radical| x.enclosure().map(|i| (i.lo() + i.hi()) / 2.).map_err(|e| err(e.name()));
    let (ax, ay, dx, dy) = (fl(&a[0])?, fl(&a[1])?, fl(&d[0])?, fl(&d[1])?);
    let corners = [[&b[0][0], &b[0][1]], [&b[1][0], &b[0][1]], [&b[0][0], &b[1][1]], [&b[1][0], &b[1][1]]];
    let dd = dx * dx + dy * dy;
    if !(dd > 0.) {
        return Err(err("boolean/contract-violation:split/zero-section-direction"));
    }
    let mut s = 0f64;
    for c in corners {
        let (cx, cy) = (c[0].to_f64().unwrap_or(f64::MAX), c[1].to_f64().unwrap_or(f64::MAX));
        s = s.max((((cx - ax) * dx + (cy - ay) * dy) / dd).abs());
    }
    let s = Q::from_float((2. * s + 1.).ceil()).ok_or(err("boolean/ssi-row-unavailable:radical/bound-range"))?;
    let end = |k: Q| -> Result<ExactPoint> {
        curve(ExactPoint::from_exact_coordinates(std::array::from_fn(|i| &d[i] * &k + &a[i])))
    };
    curve(Trimmed::new([end(-s.clone())?, end(s)?], Carrier::Line))
}
fn has_radical(pieces: &[Vec<Trimmed>]) -> bool {
    pieces.iter().flatten().any(|t| {
        t.ends().iter().any(|e| e.rat().is_err())
            || matches!(t.carrier(), Carrier::Circle(c) if c.c.rat().is_err())
    })
}
fn loops_of(d: &Draft, f: &Face) -> Vec<Vec<Trimmed>> {
    f.loops
        .iter()
        .map(|lp| d.loops[lp.index()].coedges.iter().map(|c| d.coedges[c.index()].pcurve.clone()).collect::<Vec<_>>())
        .collect()
}
/// Arrange a face's trims with its section pieces and keep the selected
/// cells: `chart_point` lifts a rational chart witness to the model frame,
/// `edge` turns an oriented cell piece into a sewing use. Witnesses avoid
/// the isolated touch points `touch`; a kept cell whose closure holds one
/// marks it kept on this side.
#[allow(clippy::too_many_arguments)]
fn select_cells(
    carrier: &Carrier3,
    forward: bool,
    old: Vec<Vec<Trimmed>>,
    rings: Vec<Trimmed>,
    added: Vec<Trimmed>,
    other: &Model,
    op: Op,
    side: Side,
    chart_point: &dyn Fn(&[Q; 2]) -> Result<Point>,
    edge: &dyn Fn(&Trimmed) -> Result<Use>,
    touch: &[(usize, ExactPoint)],
    kept: &mut [[bool; 2]],
) -> Result<Vec<FaceSpec>> {
    let mut sets = old.clone();
    sets.extend(rings.into_iter().map(|r| vec![r]));
    for piece in normalize(added)? {
        sets.push(vec![piece]);
    }
    let quadratic = has_radical(&sets);
    let refs = sets.iter().map(Vec::as_slice).collect::<Vec<_>>();
    let arr = curve(wonky_curve::arrange_faces(&refs, crate::split::BUDGET, quadratic))?;
    let profiles = old.into_iter().map(Cycle::new).collect::<Vec<_>>();
    let mut out = vec![];
    let avoid = touch.iter().map(|(_, x)| x.clone()).collect::<Vec<_>>();
    for (ci, cell) in arr.cells.iter().enumerate() {
        let witness = if quadratic { curve(arr.witness_exact(ci, &[], &avoid))? } else { curve(arr.witness(ci, &[], &avoid))? };
        let winding = profiles
            .iter()
            .map(|c| curve(c.winding(&witness)))
            .collect::<Result<Vec<_>>>()?
            .iter()
            .sum::<i32>();
        if winding == 0 {
            continue;
        }
        let at = chart_point(curve(witness.rat())?)?;
        let class = class_at(carrier, forward, other, &at, false)?;
        if class_at(carrier, forward, other, &at, true)? != class {
            return Err(err("boolean/contract-violation:classify/second-opinion"));
        }
        let Some(flip) = keep(op, side, class) else {
            continue;
        };
        for (k, x) in touch {
            if closure_contains(&arr, ci, x)? {
                kept[*k][side.index()] = true;
            }
        }
        let mut loops = vec![];
        for cyc in &cell.cycles {
            loops.push(cyc.iter().map(|h| edge(&arr.oriented(*h))).collect::<Result<Vec<_>>>()?);
        }
        let mut face = FaceSpec {
            carrier: carrier.clone(),
            forward: true,
            loops,
        };
        if !forward {
            reverse(&mut face);
        } // arrangements orient about the chart normal
        if flip {
            reverse(&mut face);
        }
        out.push(face);
    }
    Ok(out)
}
#[allow(clippy::too_many_arguments)]
fn planar(
    m: &Model,
    fi: FaceId,
    other: &Model,
    cuts: &[a1::SectionBranch],
    segments: &[[RPoint; 2]],
    coplanar: &[FaceId],
    op: Op,
    side: Side,
    touch: &[(usize, RPoint)],
    kept: &mut [[bool; 2]],
) -> Result<Vec<FaceSpec>> {
    let d = m.draft();
    let f = &d.faces[fi.index()];
    let carrier = &d.surfaces[f.surface.index()].carrier;
    let p = carrier.plane()?;
    let rp = RadicalPlane3::from(p);
    let touch = touch.iter().map(|(k, x)| Ok((*k, rp.chart(x)?))).collect::<Result<Vec<_>>>()?;
    let old = loops_of(d, f);
    let mut rings = vec![];
    let mut added = vec![];
    let mut boxed = None;
    for cut in cuts {
        match &cut.curve {
            a1::Branch::Circle {
                frame,
                height,
                radius,
            } => {
                let pc = match (height.rational(), radius.rational()) {
                    (Some(h), Some(r)) => plane_ring(&ring(frame, h, r)?, p, true)?,
                    _ => plane_circle(frame, height, radius, p)?,
                };
                if ring_meets_interior(&pc, &old)? {
                    rings.push(pc);
                }
            }
            // An even branch is tangent: it changes no open cell on this plane.
            a1::Branch::Line { .. } if cut.multiplicity % 2 == 0 => (),
            a1::Branch::Point(_) => (),
            a1::Branch::Line { p: lp, d: ld } => {
                // A transverse line on this plane (a quadric ruling): its
                // chart line clipped to the face.
                let a = rp.chart_coordinates(lp)?;
                let b = rp.chart_coordinates(&std::array::from_fn(|k| &lp[k] + &ld[k]))?;
                let dir = [&b[0] - &a[0], &b[1] - &a[1]];
                let bx = match &boxed {
                    Some(b) => b,
                    None => boxed.insert(chart_box(&old)?),
                };
                added.extend(clip_to_face(&box_line(&a, &dir, bx)?, &old)?);
            }
        }
    }
    for [a, b] in segments {
        added.push(curve(Trimmed::new([rp.chart(a)?, rp.chart(b)?], Carrier::Line))?);
    }
    // The other operand's faces on this plane imprint their trims.
    for &oj in coplanar {
        let od = other.draft();
        let of = &od.faces[oj.index()];
        let op_ = od.surfaces[of.surface.index()].carrier.plane()?;
        let image = |uv: &[Q; 2]| p.chart(&op_.point(uv));
        let o = image(&[q(0), q(0)])?;
        let ex = image(&[q(1), q(0)])?;
        let ey = image(&[q(0), q(1)])?;
        let map = wonky_curve::PlaneMap::affine(
            o.clone(),
            [&ex[0] - &o[0], &ex[1] - &o[1]],
            [&ey[0] - &o[0], &ey[1] - &o[1]],
        )
        .ok_or(err("boolean/contract-violation:coplanar/degenerate-chart"))?;
        for piece in loops_of(od, of).iter().flatten() {
            let mapped = curve(piece.mapped(&map))?;
            added.extend(clip_to_face(&mapped, &old)?);
        }
    }
    let lift = |uv: &[Q; 2]| Ok(p.point(uv));
    let edge = |pc: &Trimmed| -> Result<Use> {
        let ends = pc.ends();
        let a = rp.point(&ends[0].coordinates());
        let b = rp.point(&ends[1].coordinates());
        match pc.carrier() {
            Carrier::Line => Ok(Use::segment(&a, &b)),
            Carrier::Circle(c) => {
                let centre = c.c.rat().map_err(|_| err("boolean/ssi-row-unavailable:circle/radical-centre-sewing"))?;
                let cf = Frame::new(p.point(centre), [p.x.clone(), p.y(), p.n.clone()])?;
                let r2 = c.r2.rational().ok_or(Refused("boolean/ssi-row-unavailable:circle/radius-class"))?;
                if wonky_curve::numeric::exact_root(&r2).is_none() {
                    // A Q(√d) radius (a sphere section): a Q(√d) circle
                    // carrying its plane chart piece. Chart counter-clockwise
                    // is counter-clockwise about n, the circle frame's third
                    // column.
                    let geometry = circle_curve(&cf, &Radical::default(), &root2(&c.r2)?)?;
                    let ends = if pc.is_ring() { None } else { Some([a, b]) };
                    return Use::circle_use(geometry, ends, c.ccw, vec![(Patch::First, pc.clone())]);
                }
                let circle = Circle3::new(cf, r2)?;
                if pc.is_ring() {
                    Use::circle(circle, c.ccw)
                } else {
                    Use::arc(circle, c.ccw, &a, &b)
                }
            }
            Carrier::BSpline(_) => Err(err("boolean/ssi-row-unavailable:spline/curved-assembly")),
        }
    };
    // Full section rings are closed sets of their own; they enter as owners
    // like the trims, the clipped section pieces are normalized.
    select_cells(carrier, f.forward, old, rings, added, other, op, side, &lift, &edge, &touch, kept)
}
/// A cylinder face without a band (a strip of a line/arc extrusion) is split
/// in its half-angle chart (t = y/(r+x), z), where latitudes (planes ⟂ the
/// axis) and rulings (planes ∥ the axis) are chart lines. Any other section
/// on a strip refuses by name.
fn strip(
    m: &Model,
    fi: FaceId,
    other: &Model,
    cuts: &[a1::SectionBranch],
    op: Op,
    side: Side,
) -> Result<Vec<FaceSpec>> {
    let d = m.draft();
    let f = &d.faces[fi.index()];
    let carrier = &d.surfaces[f.surface.index()].carrier;
    let Carrier3::Cylinder(cy) = carrier else {
        return Err(err("boolean/ssi-row-unavailable:cone/partial-strip"));
    };
    let old = loops_of(d, f);
    if old.iter().flatten().any(|t| !matches!(t.carrier(), Carrier::Line)) {
        return Err(err("boolean/ssi-row-unavailable:cylinder/partial-strip"));
    }
    let r = wonky_curve::numeric::exact_root(&cy.radius2()).ok_or(err("boolean/ssi-row-unavailable:chart/quadratic-radius"))?;
    let bx = chart_box(&old)?;
    let mut added = vec![];
    for cut in cuts {
        match &cut.curve {
            a1::Branch::Point(_) => (),
            a1::Branch::Line { .. } if cut.multiplicity % 2 == 0 => (),
            a1::Branch::Circle { frame, height, radius } => {
                let centre: RPoint = std::array::from_fn(|k| height * &frame.columns()[2][k] + &frame.origin()[k]);
                let c = cy.local(&centre);
                let n = cy.linear(&algebraic::lift(&frame.columns()[2]));
                if !c[0].is_zero() || !c[1].is_zero() || !n[0].is_zero() || !n[1].is_zero() || radius * radius != Radical::from(cy.radius2()) {
                    return Err(err("boolean/ssi-row-unavailable:cylinder/strip-oblique-circle"));
                }
                let z = c[2].clone();
                let piece = curve(Trimmed::new(
                    [
                        curve(ExactPoint::from_exact_coordinates([Radical::from(bx[0][0].clone()), z.clone()]))?,
                        curve(ExactPoint::from_exact_coordinates([Radical::from(bx[1][0].clone()), z]))?,
                    ],
                    Carrier::Line,
                ))?;
                added.extend(clip_to_face(&piece, &old)?);
            }
            a1::Branch::Line { p, d: dir } => {
                let v = cy.linear(dir);
                if !v[0].is_zero() || !v[1].is_zero() {
                    return Err(err("boolean/ssi-row-unavailable:cylinder/strip-oblique-line"));
                }
                let l = cy.local(p);
                let pole = &l[0] + &Radical::from(r.clone());
                // The ruling through the chart pole lies on no strip.
                if pole.is_zero() {
                    continue;
                }
                let t = &l[1] / &pole;
                let piece = curve(Trimmed::new(
                    [
                        curve(ExactPoint::from_exact_coordinates([t.clone(), Radical::from(bx[0][1].clone())]))?,
                        curve(ExactPoint::from_exact_coordinates([t, Radical::from(bx[1][1].clone())]))?,
                    ],
                    Carrier::Line,
                ))?;
                added.extend(clip_to_face(&piece, &old)?);
            }
        }
    }
    let lift = |uv: &[Q; 2]| {
        algebraic::rational(&strip_point(cy, &uv.clone().map(Radical::from)))
            .ok_or(err("boolean/contract-violation:strip/irrational-witness"))
    };
    let edge = |pc: &Trimmed| -> Result<Use> {
        let [a, b] = [0, 1].map(|k| pc.ends()[k].coordinates());
        let (pa, pb) = (strip_point(cy, &a), strip_point(cy, &b));
        if a[1] == b[1] {
            // A latitude arc, counter-clockwise where t grows.
            let h = a[1].rational().ok_or(err("boolean/ssi-row-unavailable:cylinder/strip-radical-latitude"))?;
            Use::arc(ring(cy.frame()?, h, r.clone())?, b[0] > a[0], &pa, &pb)
        } else if a[0] == b[0] {
            Ok(Use::segment(&pa, &pb))
        } else {
            Err(err("boolean/contract-violation:strip/oblique-chart-edge"))
        }
    };
    select_cells(carrier, f.forward, old, vec![], added, other, op, side, &lift, &edge, &[], &mut [])
}
fn revolution(
    m: &Model,
    fi: FaceId,
    other: &Model,
    cuts: &[a1::SectionBranch],
    op: Op,
    side: Side,
) -> Result<Vec<FaceSpec>> {
    let f = &m.draft().faces[fi.index()];
    let carrier = &m.draft().surfaces[f.surface.index()].carrier;
    // A cylinder face without a band is a partial-cylinder strip of a
    // line/arc profile extrusion: it splits in its own chart.
    let Some(band) = m.revolution_band(fi)? else {
        return strip(m, fi, other, cuts, op, side);
    };
    let radius_at = |h: &Q| &band.radius[0] + &band.radius[1] * h;
    if radius_at(&band.lo).is_zero() || radius_at(&band.hi).is_zero() {
        return apex_band(m, fi, &band, other, cuts, op, side);
    }
    let split = periodic::split_face(m, fi, cuts, crate::split::BUDGET)?;
    let classes = periodic::classify(m, fi, &split, other)?;
    let mut out = vec![];
    for flip in [false, true] {
        let selected = classes
            .iter()
            .map(|c| keep(op, side, *c) == Some(flip))
            .collect::<Vec<_>>();
        for cell in periodic::merge(&split, &selected)? {
            let mut loops = vec![];
            for lp in cell.loops {
                if lp.len() != 1 || lp[0].ends.is_some() {
                    return Err(err(
                        "boolean/ssi-row-unavailable:revolution/open-result-trim",
                    ));
                }
                let periodic::Source::Ring(k) = lp[0].source else {
                    return Err(err(
                        "boolean/ssi-row-unavailable:revolution/generator-emission",
                    ));
                };
                let ccw = lp[0].winding_delta > 0;
                match split.rings[k].rational() {
                    Some(h) => {
                        let radius = &band.radius[0] + &band.radius[1] * &h;
                        loops.push(vec![Use::circle(ring(&band.frame, h, radius)?, ccw == f.forward)?]);
                    }
                    // A ring at a Q(√d) height (a coaxial sphere section):
                    // a Q(√d) latitude, charted at emission.
                    None => {
                        let h = split.rings[k].clone();
                        let radius = radical(|| Radical::from(band.radius[0].clone()) + &h * &band.radius[1])?;
                        let mut u = Use::circle_use(circle_curve(&band.frame, &h, &radius)?, None, ccw == f.forward, vec![])?;
                        u.chart = None;
                        loops.push(vec![u]);
                    }
                }
            }
            let mut face = FaceSpec {
                carrier: carrier.clone(),
                forward: f.forward,
                loops,
            };
            if flip {
                reverse(&mut face);
            }
            out.push(face);
        }
    }
    Ok(out)
}
/// A band with an apex (a collapsed latitude) has no periodic chart split.
/// Latitude sections still cut it into sub-bands, the height intervals
/// between them, each classified at a point of its middle latitude. A ruling
/// through the apex, or a kept cell ending at the apex, refuses by name.
fn apex_band(
    m: &Model,
    fi: FaceId,
    band: &RevolutionBand,
    other: &Model,
    cuts: &[a1::SectionBranch],
    op: Op,
    side: Side,
) -> Result<Vec<FaceSpec>> {
    let f = &m.draft().faces[fi.index()];
    let carrier = &m.draft().surfaces[f.surface.index()].carrier;
    let inverse = band.frame.inverse();
    let mut heights = vec![band.lo.clone(), band.hi.clone()];
    for cut in cuts {
        match &cut.curve {
            a1::Branch::Point(_) => (),
            a1::Branch::Line { .. } => return Err(err("boolean/chart-singularity:apex")),
            a1::Branch::Circle { frame, height, .. } => {
                let centre: Point = inverse.point(&frame.point(&[q(0), q(0), rat(height)?]));
                let axis = band.frame.relation_from(frame).map;
                if !centre[0].is_zero() || !centre[1].is_zero() || !axis.columns()[0][2].is_zero() || !axis.columns()[1][2].is_zero() {
                    return Err(err("boolean/ssi-row-unavailable:circle/non-latitude-chart"));
                }
                if centre[2] > band.lo && centre[2] < band.hi {
                    heights.push(centre[2].clone());
                }
            }
        }
    }
    heights.sort();
    heights.dedup();
    let radius_at = |h: &Q| &band.radius[0] + &band.radius[1] * h;
    let mut out = vec![];
    for w in heights.windows(2) {
        let mid = (&w[0] + &w[1]) / q(2);
        let at = band.frame.point(&[radius_at(&mid), q(0), mid]);
        let class = class_at(carrier, f.forward, other, &at, false)?;
        if class_at(carrier, f.forward, other, &at, true)? != class {
            return Err(err("boolean/contract-violation:classify/second-opinion"));
        }
        let Some(flip) = keep(op, side, class) else {
            continue;
        };
        let mut loops = vec![];
        // The lower latitude runs counter-clockwise about the band axis.
        for (h, ccw) in [(&w[0], true), (&w[1], false)] {
            let radius = radius_at(h);
            if radius.is_zero() {
                return Err(err("boolean/chart-singularity:apex"));
            }
            loops.push(vec![Use::circle(ring(&band.frame, h.clone(), radius)?, ccw == f.forward)?]);
        }
        let mut face = FaceSpec {
            carrier: carrier.clone(),
            forward: f.forward,
            loops,
        };
        if flip {
            reverse(&mut face);
        }
        out.push(face);
    }
    Ok(out)
}
/// Whether a chart point lies in the closure of an arrangement cell.
pub(crate) fn closure_contains(arr: &wonky_curve::Arrangement, ci: usize, x: &ExactPoint) -> Result<bool> {
    let cell = &arr.cells[ci];
    let mut winding = 0;
    for cyc in &cell.cycles {
        let profile = arr.cycle_profile(cyc);
        for piece in profile.pieces() {
            if curve(piece.contains(x))? {
                return Ok(true);
            }
        }
        winding += curve(profile.winding(x))?;
    }
    Ok(winding != 0)
}
/// G14: one sphere face, split in its stereographic atlas (`sphere`).
fn spherical(
    m: &Model,
    fi: FaceId,
    other: &Model,
    cuts: &[a1::SectionBranch],
    op: Op,
    side: Side,
    touch: &[(usize, RPoint)],
    kept: &mut [[bool; 2]],
) -> Result<Vec<FaceSpec>> {
    let f = &m.draft().faces[fi.index()];
    let carrier = &m.draft().surfaces[f.surface.index()].carrier;
    let Carrier3::Sphere(s) = carrier else {
        return Err(err("boolean/contract-violation:sphere/carrier"));
    };
    let mut lats = vec![];
    for cut in cuts {
        match &cut.curve {
            a1::Branch::Circle { frame, height, .. } => {
                if cut.multiplicity % 2 == 0 {
                    return Err(err("boolean/tangent-contact-undecided"));
                }
                lats.push(sphere::latitude(s, frame, height)?);
            }
            // An isolated touch point splits nothing on the sphere.
            a1::Branch::Point(_) => (),
            a1::Branch::Line { .. } => return Err(err("boolean/contract-violation:sphere/line-branch")),
        }
    }
    let mut touched = vec![];
    let regions = sphere::split(
        m,
        fi,
        &lats,
        crate::split::BUDGET,
        &mut |at| {
            let class = class_at(carrier, f.forward, other, at, false)?;
            if class_at(carrier, f.forward, other, at, true)? != class {
                return Err(err("boolean/contract-violation:classify/second-opinion"));
            }
            Ok(keep(op, side, class))
        },
        touch,
        &mut |k| touched.push(k),
    )?;
    for k in touched {
        kept[k][side.index()] = true;
    }
    let mut out = vec![];
    for r in regions {
        // A region bounded by rings about one frame column is a tube band of
        // the sphere re-framed about that column (the per-face revolution
        // chart): every band consumer reads it. Anything else keeps the
        // stereographic atlas of the face's own carrier.
        let axes = r.loops.iter().map(|lp| match &lp[..] {
            [e] if e.ends.is_none() => Some(e.circle.axis),
            _ => None,
        }).collect::<Vec<_>>();
        let band = match axes.first() {
            Some(Some(k)) if axes.iter().all(|a| *a == Some(*k)) && axes.len() <= 2 => Some(*k),
            _ => None,
        };
        let face_carrier = match band {
            Some(k) => {
                let cols = s.frame.columns();
                Carrier3::Sphere(Sphere3::new(
                    Frame::new(s.frame.origin().clone(), [cols[(k + 1) % 3].clone(), cols[(k + 2) % 3].clone(), cols[k].clone()])?,
                    s.radius2(),
                )?)
            }
            None => carrier.clone(),
        };
        let mut loops = vec![];
        for lp in r.loops {
            let mut uses = vec![];
            for e in lp {
                let k = e.circle.axis;
                let cols = s.frame.columns();
                let frame = Frame::new(
                    s.frame.origin().clone(),
                    [cols[(k + 1) % 3].clone(), cols[(k + 2) % 3].clone(), cols[k].clone()],
                )?;
                let radius = wonky_geom::model::stereo::circle_radius(s.radius(), &e.circle.h)?
                    .ok_or(err("boolean/contract-violation:sphere/degenerate-edge"))?;
                let mut u = Use::circle_use(circle_curve(&frame, &e.circle.h, &radius)?, e.ends, e.ccw, e.pieces)?;
                if band.is_some() {
                    // Charted at emission from the coedge's sense.
                    u.chart = None;
                }
                uses.push(u);
            }
            loops.push(uses);
        }
        // Region loops have the region on their left seen from outside.
        let mut face = FaceSpec { carrier: face_carrier, forward: true, loops };
        if !f.forward {
            reverse(&mut face);
        }
        if r.flip {
            reverse(&mut face);
        }
        out.push(face);
    }
    Ok(out)
}
fn carrier_key(c: &Carrier3, forward: bool) -> Result<(CarrierKey, bool)> {
    Ok(match c {
        Carrier3::Plane(p) => {
            let pivot =
                p.n.iter()
                    .find(|x| !x.is_zero())
                    .ok_or(err("model/g1-plane-degenerate"))?;
            let n = p.n.clone().map(|x| x / pivot);
            (
                CarrierKey::Plane {
                    offset: dot(&n, &p.o),
                    normal: n,
                },
                forward != pivot.is_negative(),
            )
        }
        Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) => {
            let cs = c.implicit()?.coefficients();
            let pivot = cs.iter().find(|x| !x.is_zero()).unwrap();
            (
                CarrierKey::Quadric(cs.clone().map(|x| x / pivot)),
                forward != pivot.is_negative(),
            )
        }
        _ => return Err(err("boolean/ssi-row-unavailable:carrier/curved-merge")),
    })
}
// Merge only edge-connected fragments with proved-identical oriented carriers.
// Cancellation uses exact point-set edge identities; proximity never enters.
fn merge(mut fs: Vec<FaceSpec>) -> Result<Vec<FaceSpec>> {
    loop {
        let mut pair = None;
        for i in 0..fs.len() {
            for j in i + 1..fs.len() {
                if carrier_key(&fs[i].carrier, fs[i].forward)?
                    != carrier_key(&fs[j].carrier, fs[j].forward)?
                {
                    continue;
                }
                if fs[i].loops.iter().flatten().any(|a| {
                    fs[j]
                        .loops
                        .iter()
                        .flatten()
                        .any(|b| a.key == b.key && a.sense != b.sense)
                }) {
                    pair = Some((i, j));
                    break;
                }
            }
            if pair.is_some() {
                break;
            }
        }
        let Some((i, j)) = pair else {
            break;
        };
        let removed = fs.remove(j);
        let mut boundary = BTreeMap::<EdgeKey, Use>::new();
        for u in fs[i]
            .loops
            .iter()
            .flatten()
            .chain(removed.loops.iter().flatten())
        {
            if let Some(old) = boundary.remove(&u.key) {
                if old.sense == u.sense {
                    return Err(err("boolean/contract-violation:merge/orientation"));
                }
            } else {
                boundary.insert(u.key.clone(), u.clone());
            }
        }
        fs[i].loops = link(boundary.into_values().collect())?;
    }
    Ok(fs)
}
/// Complete rings are loops themselves. Bounded edges (lines and arcs) are
/// linked by exact endpoint identity, retaining their traversal and chart
/// orientation.
fn link(uses: Vec<Use>) -> Result<Vec<Vec<Use>>> {
    let mut loops = vec![];
    let mut open = vec![];
    for u in uses {
        match u.ends() {
            None => loops.push(vec![u]),
            Some(_) => open.push(u),
        }
    }
    while let Some(first) = open.pop() {
        let ends = |u: &Use| u.ends().expect("bounded edge");
        let start = ends(&first)[0].clone();
        let mut tail = ends(&first)[1].clone();
        let mut lp = vec![first];
        while tail != start {
            let k = open
                .iter()
                .position(|u| ends(u)[0] == tail)
                .ok_or(err("boolean/contract-violation:merge/open-boundary"))?;
            let next = open.remove(k);
            tail = ends(&next)[1].clone();
            lp.push(next);
        }
        loops.push(lp);
    }
    Ok(loops)
}
/// Remove the vertices that the arrangement put on one curve and that no
/// third edge uses: a vertex with exactly two incident edges on the same line
/// or the same circle joins them in every loop (an arc closing on itself
/// becomes a ring). Fragment merges leave such vertices behind, e.g. where a
/// section split a face whose fragments were joined again; a vertex any
/// third edge ends at is kept.
fn heal(mut fs: Vec<FaceSpec>) -> Result<Vec<FaceSpec>> {
    loop {
        let mut incident = BTreeMap::<VertexKey, Vec<EdgeKey>>::new();
        for u in fs.iter().flat_map(|f| f.loops.iter().flatten()) {
            if let Some(ends) = u.key.ends() {
                for v in ends {
                    let list = incident.entry(v).or_default();
                    if !list.contains(&u.key) {
                        list.push(u.key.clone());
                    }
                }
            }
        }
        // A use carrying chart pieces (G14 sphere and Q(√d) circle uses) is
        // sewn as split: joining it would drop its chart.
        let charted = fs
            .iter()
            .flat_map(|f| f.loops.iter().flatten())
            .filter(|u| u.chart.is_some())
            .map(|u| u.key.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let mut target = None;
        for (v, keys) in &incident {
            if keys.len() == 2 && !keys.iter().any(|k| charted.contains(k)) && same_curve(&keys[0], &keys[1], &fs)? {
                target = Some(v.clone());
                break;
            }
        }
        let Some(v) = target else {
            return Ok(fs);
        };
        for f in &mut fs {
            for lp in &mut f.loops {
                let Some(k) = lp.iter().position(|u| u.ends().is_some_and(|e| e[1] == v)) else {
                    continue;
                };
                let n = (k + 1) % lp.len();
                let (a, b) = (lp[k].clone(), lp[n].clone());
                if b.ends().is_none_or(|e| e[0] != v) {
                    return Err(err("boolean/contract-violation:heal/loop-order"));
                }
                let joined = join(&a, &b)?;
                if n == 0 {
                    lp.remove(k);
                    lp[0] = joined;
                } else {
                    lp[k] = joined;
                    lp.remove(n);
                }
            }
        }
    }
}
/// The geometry of an edge key, read from one of its uses.
fn geometry_of<'a>(key: &EdgeKey, fs: &'a [FaceSpec]) -> Option<&'a Curve3> {
    fs.iter().flat_map(|f| f.loops.iter().flatten()).find(|u| &u.key == key).map(|u| &u.geometry)
}
fn same_curve(a: &EdgeKey, b: &EdgeKey, fs: &[FaceSpec]) -> Result<bool> {
    Ok(match (a, b) {
        (EdgeKey::Arc(pa, va, _), EdgeKey::Arc(pb, vb, _)) => pa == pb && va == vb,
        (EdgeKey::Line(_) | EdgeKey::Segment(_), EdgeKey::Line(_) | EdgeKey::Segment(_)) => {
            let (Some([a0, a1]), Some([b0, _])) = (a.ends(), b.ends()) else {
                return Ok(false);
            };
            let (Some(_), Some(_)) = (geometry_of(a, fs), geometry_of(b, fs)) else {
                return Ok(false);
            };
            let d = algebraic::sub(&a1.coordinates(), &a0.coordinates());
            let e = algebraic::sub(&b0.coordinates(), &a0.coordinates());
            let [b0, b1] = b.ends().expect("bounded");
            let f = algebraic::sub(&b1.coordinates(), &b0.coordinates());
            algebraic::zero(&algebraic::cross(&d, &f)) && algebraic::zero(&algebraic::cross(&d, &e))
        }
        _ => false,
    })
}
/// Join two consecutive uses `a` (ending at v) and `b` (starting at v) of
/// one curve into one use from a's start to b's end.
fn join(a: &Use, b: &Use) -> Result<Use> {
    let [s, _] = a.ends().expect("bounded");
    let [_, e] = b.ends().expect("bounded");
    match (&a.key, &a.geometry) {
        (EdgeKey::Arc(..), Curve3::Circle(c)) => {
            // `a`'s traversal sense in its own circle frame.
            let flipped = c.canonical_data()?.2;
            let ccw = a.sense != flipped;
            if s == e {
                Use::circle(c.clone(), ccw)
            } else {
                Use::arc(c.clone(), ccw, &s.coordinates(), &e.coordinates())
            }
        }
        (EdgeKey::Line(_) | EdgeKey::Segment(_), _) => Ok(Use::segment(&s.coordinates(), &e.coordinates())),
        (EdgeKey::Arc(..) | EdgeKey::Ring(..) | EdgeKey::RArc(..) | EdgeKey::RRing(_), _) => {
            Err(err("boolean/contract-violation:heal/join-kind"))
        }
    }
}
fn provenance(node: u32, index: usize) -> Provenance {
    Provenance {
        node,
        slot: index as u32,
    }
}
#[cfg(feature = "plant_periodic_weld")]
fn proximity_box(face: &FaceSpec) -> Result<[[Q; 3]; 2]> {
    let mut points = vec![];
    for u in face.loops.iter().flatten() {
        match &u.key {
            EdgeKey::Line(p) => points.extend(p.clone()),
            EdgeKey::Segment(v) => {
                for p in v {
                    points.extend(outward(&p.coordinates())?);
                }
            }
            EdgeKey::Arc(..) => {
                let Curve3::Circle(c) = &u.geometry else {
                    unreachable!()
                };
                points.extend(circle_box(c)?);
            }
            EdgeKey::Ring(..) => {
                let Curve3::Circle(c) = &u.geometry else {
                    unreachable!()
                };
                let r = wonky_curve::numeric::exact_root(&c.radius2())
                    .ok_or(err("boolean/ssi-row-unavailable:circle/rational-bound"))?;
                let frame = c.frame()?;
                let delta: Point = std::array::from_fn(|i| {
                    &r * (frame.columns()[0][i].abs() + frame.columns()[1][i].abs())
                });
                points.push(std::array::from_fn(|i| &frame.origin()[i] - &delta[i]));
                points.push(std::array::from_fn(|i| &frame.origin()[i] + &delta[i]));
            }
            EdgeKey::RArc(..) | EdgeKey::RRing(_) => {
                let Curve3::RadicalCircle(c) = &u.geometry else {
                    unreachable!()
                };
                points.extend(radical_circle_box(c)?);
            }
        }
    }
    Ok(std::array::from_fn(|end| {
        std::array::from_fn(|i| {
            if end == 0 {
                points.iter().map(|p| p[i].clone()).min().unwrap()
            } else {
                points.iter().map(|p| p[i].clone()).max().unwrap()
            }
        })
    }))
}
fn sewing_curve_flip(geometry: &Curve3) -> Result<bool> {
    match geometry {
        Curve3::Circle(c) => Ok(c.canonical_data()?.2),
        Curve3::TranslatedCircle(c) => Ok(c.canonical_data().2),
        // Segment keys are ordered like the line's own direction.
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => Ok(false),
        Curve3::RadicalCircle(c) => Ok(c.canonical_data()?.3),
    }
}

fn emit(fs: &[FaceSpec], placement: &Frame, label: Label, node: u32) -> Result<Vec<Model>> {
    if fs.is_empty() {
        return Err(err("boolean/empty-result"));
    }
    let mut edges = BTreeMap::<EdgeKey, Vec<usize>>::new();
    for (i, f) in fs.iter().enumerate() {
        for u in f.loops.iter().flatten() {
            edges.entry(u.key.clone()).or_default().push(i);
        }
    }
    if edges.values().any(|v| v.len() != 2) {
        return Err(err("boolean/non-manifold-result"));
    }
    let mut parent = (0..fs.len()).collect::<Vec<_>>();
    fn root(p: &[usize], mut i: usize) -> usize {
        while p[i] != i {
            i = p[i];
        }
        i
    }
    for ids in edges.values() {
        let a = root(&parent, ids[0]);
        let b = root(&parent, ids[1]);
        parent[b] = a;
    }
    // Planted defect: treat near boundary boxes as shared topology. This is
    // the same forbidden proximity identity as the chart weld mutant, now at
    // inter-operand sewing so a radial gap is exercised by the live path too.
    #[cfg(feature = "plant_periodic_weld")]
    {
        let tolerance = Q::new(1.into(), 1_000_000_000.into());
        let boxes = fs.iter().map(proximity_box).collect::<Result<Vec<_>>>()?;
        for i in 0..fs.len() {
            for j in i + 1..fs.len() {
                if (0..3).all(|k| {
                    &boxes[i][0][k] - &boxes[j][1][k] <= tolerance
                        && &boxes[j][0][k] - &boxes[i][1][k] <= tolerance
                }) {
                    let a = root(&parent, i);
                    let b = root(&parent, j);
                    parent[b] = a;
                }
            }
        }
    }
    let mut shells = BTreeMap::<usize, Vec<usize>>::new();
    for i in 0..fs.len() {
        shells.entry(root(&parent, i)).or_default().push(i);
    }
    let mut out = vec![];
    for faces in shells.into_values() {
        let mut d = Draft {
            placement: placement.clone(),
            label,
            surfaces: vec![],
            curves: vec![],
            vertices: vec![],
            edges: vec![],
            coedges: vec![],
            loops: vec![],
            faces: vec![],
            shells: vec![],
            solids: vec![],
        };
        let mut registry = BTreeMap::<EdgeKey, (EdgeId, bool)>::new();
        let mut vertices = BTreeMap::<VertexKey, VertexId>::new();
        for fi in faces {
            let spec = &fs[fi];
            let surface = SurfaceId(d.surfaces.len() as u32);
            d.surfaces.push(Surface {
                carrier: spec.carrier.clone(),
                provenance: provenance(node, surface.index()),
            });
            let mut loops = vec![];
            for lp in &spec.loops {
                let mut coedges = vec![];
                for u in lp {
                    let (edge, geo_flip) = if let Some(pair) = registry.get(&u.key) {
                        *pair
                    } else {
                        let geometry = u.geometry.clone();
                        let flip = sewing_curve_flip(&geometry)?;
                        let curve = CurveId(d.curves.len() as u32);
                        d.curves.push(Curve {
                            geometry,
                            provenance: provenance(node, curve.index()),
                        });
                        let bounds = match u.key.ends() {
                            None => Bounds::Ring,
                            Some(ps) => {
                                let mut ids = vec![];
                                for p in ps {
                                    let id = if let Some(v) = vertices.get(&p) {
                                        *v
                                    } else {
                                        let id = VertexId(d.vertices.len() as u32);
                                        let def = match &p {
                                            VertexKey::Rational(r) => VertexDef::Rational(r.clone()),
                                            other => VertexDef::Radical(other.coordinates()),
                                        };
                                        d.vertices.push(Vertex {
                                            def,
                                            provenance: provenance(node, id.index()),
                                        });
                                        vertices.insert(p.clone(), id);
                                        id
                                    };
                                    ids.push(id);
                                }
                                // Bounds run along the geometry's own sense.
                                if flip {
                                    Bounds::Segment([ids[1], ids[0]])
                                } else {
                                    Bounds::Segment([ids[0], ids[1]])
                                }
                            }
                        };
                        let edge = EdgeId(d.edges.len() as u32);
                        d.edges.push(Edge {
                            curve,
                            bounds,
                            provenance: provenance(node, edge.index()),
                        });
                        registry.insert(u.key.clone(), (edge, flip));
                        (edge, flip)
                    };
                    let forward = u.sense != geo_flip;
                    let geometry = &d.curves[d.edges[edge.index()].curve.index()].geometry;
                    let strip = matches!(spec.carrier, Carrier3::Cylinder(_))
                        && spec.loops.iter().flatten().any(|u| u.key.ends().is_some());
                    let traversal = u.ends();
                    let (pcurve, atlas) = match (&spec.carrier, geometry, &u.chart) {
                        (Carrier3::Sphere(_), _, Some(chart)) => {
                            let pieces = chart
                                .iter()
                                .map(|(patch, piece)| AtlasPiece { patch: *patch, piece: piece.clone(), winding_delta: 0 })
                                .collect::<Vec<_>>();
                            (chart[0].1.clone(), Some(AtlasTrim { pieces }))
                        }
                        (Carrier3::Sphere(s), Curve3::Circle(_) | Curve3::RadicalCircle(_), None) => {
                            let a = sphere_ring_trim(s, geometry, forward)?;
                            (a.pieces[0].piece.clone(), Some(a))
                        }
                        (Carrier3::Plane(_), _, Some(chart)) => match &chart[..] {
                            [(Patch::First, piece)] => (piece.clone(), None),
                            _ => return Err(err("boolean/contract-violation:sewing/plane-chart")),
                        },
                        (Carrier3::Cylinder(_), _, _) if strip => {
                            let [a, b] = traversal.clone().ok_or(err("boolean/ssi-row-unavailable:cylinder/strip-ring"))?;
                            let chart = |v: &VertexKey| strip_chart(&spec.carrier, &v.coordinates());
                            (curve(Trimmed::new([chart(&a)?, chart(&b)?], Carrier::Line))?, None)
                        }
                        (Carrier3::Plane(p), Curve3::Circle(c), None) if traversal.is_some() => {
                            let [a, b] = traversal.clone().expect("bounded");
                            let ccw = forward
                                == dot(&cross(&c.columns()[0], &c.columns()[1]), &p.n)
                                    .is_positive();
                            let rp = RadicalPlane3::from(p);
                            (curve(plane_ring(c, p, ccw)?.trim(rp.chart(&a.coordinates())?, rp.chart(&b.coordinates())?))?, None)
                        }
                        (Carrier3::Plane(p), Curve3::RadicalLine { .. }, None) => {
                            let [a, b] = traversal.clone().expect("bounded");
                            let rp = RadicalPlane3::from(p);
                            (curve(Trimmed::new([rp.chart(&a.coordinates())?, rp.chart(&b.coordinates())?], Carrier::Line))?, None)
                        }
                        (Carrier3::Plane(p), Curve3::Circle(c), None) => {
                            let ccw = forward
                                == dot(&cross(&c.columns()[0], &c.columns()[1]), &p.n)
                                    .is_positive();
                            (plane_ring(c, p, ccw)?, None)
                        }
                        (Carrier3::Plane(p), Curve3::Line { .. }, None) => {
                            let EdgeKey::Line(ps) = &u.key else {
                                unreachable!()
                            };
                            let ps = if u.sense {
                                ps.clone()
                            } else {
                                [ps[1].clone(), ps[0].clone()]
                            };
                            (
                                curve(Trimmed::new(
                                    [
                                        ExactPoint::from_rational(p.chart(&ps[0])?),
                                        ExactPoint::from_rational(p.chart(&ps[1])?),
                                    ],
                                    Carrier::Line,
                                ))?,
                                None,
                            )
                        }
                        (Carrier3::Cylinder(_) | Carrier3::Cone(_), Curve3::RadicalCircle(r), _) => {
                            let cf = match &spec.carrier {
                                Carrier3::Cylinder(c) => c.frame()?.clone(),
                                Carrier3::Cone(c) => c.frame.clone(),
                                _ => return Err(err("boolean/contract-violation:sewing/band-carrier")),
                            };
                            let h = band_height(&cf, r)?;
                            let sense = forward
                                == dot(&cross(&r.frame.columns()[0], &r.frame.columns()[1]), &cross(&cf.columns()[0], &cf.columns()[1]))
                                    .is_positive();
                            let a = AtlasTrim::radical_ring(h, sense)?;
                            (a.pieces[0].piece.clone(), Some(a))
                        }
                        (Carrier3::Cylinder(c), Curve3::Circle(r), _) => {
                            let h = c.frame()?.inverse().point(r.frame()?.origin())[2].clone();
                            let sense = forward
                                == dot(
                                    &cross(&r.columns()[0], &r.columns()[1]),
                                    &cross(&c.columns()[0], &c.columns()[1]),
                                )
                                .is_positive();
                            let a = AtlasTrim::ring(h, sense)?;
                            (a.pieces[0].piece.clone(), Some(a))
                        }
                        (Carrier3::Cone(c), Curve3::Circle(r), _) => {
                            let h = c.frame.inverse().point(r.frame()?.origin())[2].clone();
                            let sense = forward
                                == dot(
                                    &cross(&r.columns()[0], &r.columns()[1]),
                                    &cross(&c.frame.columns()[0], &c.frame.columns()[1]),
                                )
                                .is_positive();
                            let a = AtlasTrim::ring(h, sense)?;
                            (a.pieces[0].piece.clone(), Some(a))
                        }
                        _ => return Err(err("boolean/ssi-row-unavailable:curve/curved-emission")),
                    };
                    let co = CoedgeId(d.coedges.len() as u32);
                    d.coedges.push(Coedge {
                        edge,
                        forward,
                        pcurve,
                        atlas,
                        provenance: provenance(node, co.index()),
                    });
                    coedges.push(co);
                }
                let id = LoopId(d.loops.len() as u32);
                d.loops.push(Loop {
                    coedges,
                    provenance: provenance(node, id.index()),
                });
                loops.push(id);
            }
            // Ring/line cancellation can reorder loops. Put the unique outer
            // planar loop first; bands use increasing axial heights.
            match &spec.carrier {
                Carrier3::Plane(_) => {
                    let mut outer = vec![];
                    let mut holes = vec![];
                    for lp in loops {
                        let pcs = d.loops[lp.index()]
                            .coedges
                            .iter()
                            .map(|c| d.coedges[c.index()].pcurve.clone())
                            .collect();
                        let sign = curve(Cycle::new(pcs).orientation())?;
                        if sign == spec.forward {
                            outer.push(lp)
                        } else {
                            holes.push(lp)
                        }
                    }
                    if outer.len() != 1 {
                        return Err(err("boolean/ssi-row-unavailable:plane/disconnected-result"));
                    }
                    outer.extend(holes);
                    loops = outer;
                }
                Carrier3::Cylinder(_) if spec.loops.iter().flatten().any(|u| u.key.ends().is_some()) => {
                    // A strip is one chart polygon; a strip with a hole has
                    // no audited chart row.
                    if loops.len() != 1 {
                        return Err(err("boolean/ssi-row-unavailable:cylinder/strip-loops"));
                    }
                }
                Carrier3::Cylinder(c) => {
                    // Latitudes are read first: a radical-centre ring refuses.
                    let inverse = c.frame()?.inverse();
                    let mut keyed = loops
                        .iter()
                        .map(|lp| {
                            let co = &d.coedges[d.loops[lp.index()].coedges[0].index()];
                            let h = match &d.curves[d.edges[co.edge.index()].curve.index()].geometry {
                                Curve3::Circle(r) => Radical::from(inverse.point(r.frame()?.origin())[2].clone()),
                                Curve3::RadicalCircle(r) => band_height(&inverse.inverse(), r)?,
                                Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                                    return Err(err("boolean/contract-violation:sewing/band-loop"))
                                }
                                Curve3::TranslatedCircle(_) => {
                                    return Err(err("boolean/ssi-row-unavailable:translated-circle/band-loop"))
                                }
                            };
                            Ok((h, *lp))
                        })
                        .collect::<Result<Vec<_>>>()?;
                    keyed.sort_by(|a, b| a.0.cmp(&b.0));
                    loops = keyed.into_iter().map(|k| k.1).collect();
                }
                Carrier3::Cone(c) => {
                    // Latitudes are read first: a radical-centre ring refuses.
                    let inverse = &c.frame.inverse();
                    let mut keyed = loops
                        .iter()
                        .map(|lp| {
                            let co = &d.coedges[d.loops[lp.index()].coedges[0].index()];
                            let h = match &d.curves[d.edges[co.edge.index()].curve.index()].geometry {
                                Curve3::Circle(r) => Radical::from(inverse.point(r.frame()?.origin())[2].clone()),
                                Curve3::RadicalCircle(r) => band_height(&inverse.inverse(), r)?,
                                Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                                    return Err(err("boolean/contract-violation:sewing/band-loop"))
                                }
                                Curve3::TranslatedCircle(_) => {
                                    return Err(err("boolean/ssi-row-unavailable:translated-circle/band-loop"))
                                }
                            };
                            Ok((h, *lp))
                        })
                        .collect::<Result<Vec<_>>>()?;
                    keyed.sort_by(|a, b| a.0.cmp(&b.0));
                    loops = keyed.into_iter().map(|k| k.1).collect();
                }
                // A sphere tube band (rings about its frame's third column)
                // lists its rings by increasing height, as bands do; a
                // stereographic patch has no outer loop.
                Carrier3::Sphere(s) => {
                    let inverse = s.frame.inverse();
                    let heights = loops
                        .iter()
                        .map(|lp| {
                            let lp = &d.loops[lp.index()];
                            let [co] = lp.coedges[..] else { return Ok(None) };
                            let e = &d.edges[d.coedges[co.index()].edge.index()];
                            if !matches!(e.bounds, Bounds::Ring) {
                                return Ok(None);
                            }
                            Ok(match &d.curves[e.curve.index()].geometry {
                                Curve3::Circle(r) => Some(Radical::from(inverse.point(r.frame()?.origin())[2].clone())),
                                Curve3::RadicalCircle(r) => Some(band_height(&s.frame, r)?),
                                Curve3::Line { .. } | Curve3::RadicalLine { .. } => None,
                                Curve3::TranslatedCircle(_) => {
                                    return Err(err("boolean/ssi-row-unavailable:translated-circle/band-loop"))
                                }
                            })
                        })
                        .collect::<Result<Vec<_>>>()?;
                    if heights.iter().all(Option::is_some) {
                        let mut keyed = heights.into_iter().zip(loops.iter().copied()).collect::<Vec<_>>();
                        keyed.sort_by(|a, b| a.0.cmp(&b.0));
                        loops = keyed.into_iter().map(|k| k.1).collect();
                    }
                }
                _ => return Err(err("boolean/ssi-row-unavailable:carrier/curved-emission")),
            }
            let face = FaceId(d.faces.len() as u32);
            d.faces.push(Face {
                surface,
                forward: spec.forward,
                loops,
                provenance: provenance(node, face.index()),
            });
        }
        d.shells.push(Shell {
            faces: (0..d.faces.len()).map(|i| FaceId(i as u32)).collect(),
            provenance: provenance(node, 0),
        });
        d.solids.push(Solid {
            shells: vec![ShellId(0)],
            provenance: provenance(node, 0),
        });
        // A negative shell needs exact void nesting, not a fabricated solid.
        // Draft::check rejects it (G8) until that mechanism is admitted here.
        out.push(d.check().map_err(|e| if e.0 == "model/g8-volume" { err("boolean/void-shell-unsupported") } else { e })?);
    }
    Ok(out)
}
/// Evaluate two operands through SSI, planar/periodic splits, double checked
/// classification, common selection, exact same-carrier merge and G1-G8.
pub fn boolean(a: &Model, b: &Model, op: Op, node: u32) -> Result<Vec<Model>> {
    let b = b.reframed(&a.draft().placement)?;
    let (cuts, segments, coplanar, touches) = sections(a, &b)?;
    let mut kept = vec![[false; 2]; touches.len()];
    let mut faces = vec![];
    for (side, own, other) in [(Side::A, a, &b), (Side::B, &b, a)] {
        for (i, f) in own.draft().faces.iter().enumerate() {
            let id = FaceId(i as u32);
            let touch = touches
                .iter()
                .enumerate()
                .filter(|(_, t)| if side == Side::A { t.0 == i } else { t.1 == i })
                .map(|(k, t)| (k, t.2.clone()))
                .collect::<Vec<_>>();
            match &own.draft().surfaces[f.surface.index()].carrier {
                Carrier3::Plane(_) => faces.extend(planar(
                    own,
                    id,
                    other,
                    &cuts[side.index()][i],
                    &segments[side.index()][i],
                    &coplanar[side.index()][i],
                    op,
                    side,
                    &touch,
                    &mut kept,
                )?),
                Carrier3::Cylinder(_) | Carrier3::Cone(_) if !touch.is_empty() => {
                    return Err(err("boolean/tangent-contact-undecided"))
                }
                Carrier3::Cylinder(_) | Carrier3::Cone(_) => faces.extend(revolution(
                    own,
                    id,
                    other,
                    &cuts[side.index()][i],
                    op,
                    side,
                )?),
                Carrier3::Sphere(_) => {
                    faces.extend(spherical(own, id, other, &cuts[side.index()][i], op, side, &touch, &mut kept)?)
                }
                _ => return Err(err("boolean/ssi-row-unavailable:carrier/curved-boolean")),
            }
        }
    }
    // An isolated touch point inside kept fragments of both operands is a
    // non-manifold vertex (the AC12 convention); kept on one side or none it
    // changes nothing.
    if kept.iter().any(|k| k[0] && k[1]) {
        return Err(err("non-manifold-result"));
    }
    emit(
        // Healing first makes both sides of a shared boundary agree on its
        // subdivision (an arrangement may return two half arcs as one ring).
        &heal(merge(heal(faces)?)?)?,
        &a.draft().placement,
        a.draft().label.max(b.draft().label),
        node,
    )
}

#[cfg(test)]
mod sewing_tests {
    use super::*;

    #[test]
    fn sewing_orientation_refuses_unadmitted_curve_kinds() {
        let p = [q(0), q(0), q(0)];
        let d = [q(1), q(0), q(0)];
        assert!(!sewing_curve_flip(&Curve3::Line {
            p: p.clone(),
            d: d.clone()
        })
        .unwrap());
        let circle = ring(&Frame::identity(), q(0), q(2)).unwrap();
        assert_eq!(
            sewing_curve_flip(&Curve3::Circle(circle.clone())).unwrap(),
            circle.canonical_data().unwrap().2
        );
        // A radical segment is keyed in its own direction (boolean3d G12b).
        let radical = Curve3::RadicalLine {
            p: algebraic::lift(&p),
            d: algebraic::lift(&d),
        };
        assert!(!sewing_curve_flip(&radical).unwrap());
        // G14 sews Q(√d) circles: one flips exactly as its canonical normal
        // says.
        let r12 = Radical::quadratic(q(0), q(1), q(12)).unwrap();
        for z in [q(1), q(-1)] {
            let f = Frame::new([q(0), q(0), q(0)], [[q(1), q(0), q(0)], [q(0), z.clone(), q(0)], [q(0), q(0), z.clone()]]).unwrap();
            let c = RadicalCircle3::new(f, Radical::default(), r12.clone()).unwrap();
            let flip = c.canonical_data().unwrap().3;
            assert_eq!(flip, z.is_negative());
            assert_eq!(sewing_curve_flip(&Curve3::RadicalCircle(c)).unwrap(), flip);
        }
    }
}
