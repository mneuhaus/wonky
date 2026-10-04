//! Explicit, deviation-bounded observation of analytic WC0 carriers.
//!
//! The B-rep is never modified. EdgeId/VertexId, not coordinate proximity, own
//! mesh connectivity. Every incident face reuses the very same edge indices.
//! Supported trims are planar loops, cylindrical strips, meridian-cone bands
//! and apex fans, spherical latitude caps/bands, and untrimmed spheres/tori.
//! Other charts refuse by name.
//!
//! Angular interpolation has second derivative bounded by the transformed
//! carrier radius (R+r for a torus). A triangle in an angular cell of width h
//! has error <= radius * (2h)^2 / 8. We reserve half the supplied budget for
//! this error, and a quarter for interval-enclosed sample evaluation. The
//! caller separately reserves the binary STL quantization budget.
use crate::mesh::{triangulate_loops, Mesh, MeshEdge};
use crate::placement::Placement;
use crate::polyhedron::Refused;
use crate::rounding::expansion_ball;
use std::collections::{BTreeMap, BTreeSet};
use std::result::Result;
use wonky_contract::*;
use wonky_num::ball::{Iv, Scalar};
use wonky_num::expansion::{self as ex, Exp, Guard};

type R<T> = Result<T, Refused>;
const MAX_VERTICES: usize = 1_000_000;
const MAX_TRIANGLES: usize = 2_000_000;
const MAX_ANGULAR: usize = 16_384;
fn no(reason: &str) -> Refused {
    Refused(format!("mesh/curved/{reason}"))
}
fn xyz(v: &Vector3) -> [f64; 3] {
    v.map(|x| x.get())
}
fn uv(v: &Vector2) -> [f64; 2] {
    v.map(|x| x.get())
}
fn iv(x: f64) -> Iv {
    Iv::point(x)
}
fn finite(x: Iv) -> R<Iv> {
    if x.is_nan() || !x.lo().is_finite() || !x.hi().is_finite() {
        Err(no("numeric-range"))
    } else {
        Ok(x)
    }
}
fn abs_bound(x: Iv) -> f64 {
    x.lo().abs().max(x.hi().abs())
}
fn cross(a: [Iv; 3], b: [Iv; 3]) -> [Iv; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn exact_zero(value: &Exp, guard: &Guard) -> R<bool> {
    if !guard.exact() {
        Err(no("exact-predicate-range"))
    } else {
        Ok(ex::sign(value) == 0)
    }
}
fn dot(a: [f64; 3], b: [f64; 3], g: &mut Guard) -> Exp {
    let mut out = vec![];
    for k in 0..3 {
        out = ex::sum(&out, &ex::mul(&[a[k]], &[b[k]], g), g);
    }
    out
}
/// Largest admitted |v.v - 1| of a carrier direction, an exact dyadic rational.
const UNIT_DEFECT: f64 = 1. / (1u64 << 40) as f64;
/// Smallest ball containing `a` and the point `b`, rounded outward.
fn hull(a: Iv, b: f64) -> R<Iv> {
    let a = finite(a)?;
    let (lo, hi) = (a.lo().min(b), a.hi().max(b));
    let m = 0.5 * lo + 0.5 * hi;
    finite(Iv {
        m,
        r: (hi - m).next_up().max((m - lo).next_up()),
    })
}
/// A carrier direction with |v.v - 1| <= 2^-40, decided exactly; exactly unit
/// directions stay point balls. Otherwise every component encloses both the
/// literal value and the normalized v/|v| (WC0 makes orthogonality exact but
/// not length), so each sample's certified error in Builder::world covers
/// either reading of the carrier. The chord bound holds for the normalized
/// circle; the literal reading differs from it by at most 2^-41 of the radius,
/// far inside the unallocated quarter of the budget (the angular resource
/// limit already requires deviation >= 1e-7 of the radius). Rounded unit
/// vectors such as a sketch arc's x = (-1, 1.2246467991473532e-16, 0)
/// (x.x - 1 = 1.5e-32) only widen a ball by that relative amount.
fn unit(v: [f64; 3]) -> R<[Iv; 3]> {
    let mut g = Guard::new();
    let defect = ex::sum(&dot(v, v, &mut g), &[-1.], &mut g);
    if exact_zero(&defect, &g)? {
        return Ok(v.map(iv));
    }
    let above = ex::grow(&defect, -UNIT_DEFECT, &mut g);
    let below = ex::grow(&defect, UNIT_DEFECT, &mut g);
    if !g.exact() {
        return Err(no("exact-predicate-range"));
    }
    if ex::sign(&above) > 0 || ex::sign(&below) < 0 {
        return Err(no("nonorthonormal-carrier-basis"));
    }
    let length = finite(iv(v[0]).norm3(iv(v[1]), iv(v[2])))?;
    let mut out = [iv(0.); 3];
    for k in 0..3 {
        out[k] = hull(iv(v[k]) / length, v[k])?;
    }
    Ok(out)
}
/// Exactly orthogonal (WC0 contract), near-unit carrier axes as enclosures of
/// the orthonormal frame (x, z cross x, z).
fn basis(axis: &Vector3, x: &Vector3) -> R<([Iv; 3], [Iv; 3], [Iv; 3])> {
    let (z, x) = (xyz(axis), xyz(x));
    let mut g = Guard::new();
    if !exact_zero(&dot(x, z, &mut g), &g)? {
        return Err(no("nonorthonormal-carrier-basis"));
    }
    let (x, z) = (unit(x)?, unit(z)?);
    Ok((x, cross(z, x), z))
}
fn exact_equal(a: &[Exp; 3], b: &[Exp; 3]) -> R<bool> {
    let mut g = Guard::new();
    let mut equal = true;
    for k in 0..3 {
        equal &= ex::sign(&ex::sum(&a[k], &ex::neg(&b[k]), &mut g)) == 0;
    }
    if !g.exact() {
        return Err(no("exact-predicate-range"));
    }
    Ok(equal)
}
fn domain(d: &Domain) -> R<[f64; 2]> {
    match (&d.lower, &d.upper) {
        (
            Limit::Finite {
                value: a,
                closed: true,
            },
            Limit::Finite {
                value: b,
                closed: true,
            },
        ) if a.get() < b.get() => Ok([a.get(), b.get()]),
        _ => Err(no("edge-domain-unsupported")),
    }
}

/// WC0 input-admissibility diagnostics, not an authority for source geometry.
/// Reject malformed trim identity and declared carrier frames before source
/// replay, preserving the established named errors. Passing these checks never
/// permits a rounded cache to choose a sweep or construct a source sample.
pub(crate) fn validate_circle_inputs(body: &Body) -> R<()> {
    for edge in &body.edges {
        if matches!(body.curves[edge.curve.0 as usize].geometry,
                    CurveGeometry::Circle { arc: ArcKind::Trimmed {}, .. })
            && edge.vertices.len() == 2 && edge.vertices[0] == edge.vertices[1]
        {
            return Err(no("zero-length-arc"));
        }
    }
    for curve in &body.curves {
        match &curve.geometry {
            CurveGeometry::Circle { normal, x, .. }
            | CurveGeometry::SphereCircle { normal, x, .. } => { basis(normal, x)?; }
            _ => {}
        }
    }
    for surface in &body.surfaces {
        if let SurfaceGeometry::Cylinder { axis, x, .. } = &surface.geometry {
            basis(axis, x)?;
        }
    }
    Ok(())
}

/// Exact vertex coordinates in a carrier frame, including a separately placed
/// endpoint chart. Placement relations are rational; no inverse is rounded.
fn circle_vertex(body: &Body, frame: FrameId, vertex: &Vertex) -> R<[wonky_curve::numeric::Q; 3]> {
    use wonky_curve::numeric::q;
    let point = xyz(&vertex.point).map(q);
    if vertex.frame == frame { return Ok(point); }
    let mut frames = BTreeMap::new();
    let carrier_frame = crate::carriers::frame_placement(body, frame, &mut frames)
        .map_err(|why| no(&why))?.exact_frame()?;
    let vertex_frame = crate::carriers::frame_placement(body, vertex.frame, &mut frames)
        .map_err(|why| no(&why))?.exact_frame()?;
    Ok(carrier_frame.inverse().point(&vertex_frame.point(&point)))
}

/// Parameters of a circle whose WC0 literals are authoritative. Rounded source
/// profiles cannot reach this path: tessellate rejects them in favour of exact
/// replay. The normal chooses traversal; the serialized domain names the trim.
fn circle_turns(body: &Body, edge: &Edge, origin: &Vector3, normal: &Vector3, x: &Vector3) -> R<[Iv; 2]> {
    use wonky_curve::numeric::{q, positive_angle, pi};
    let o = xyz(origin).map(q);
    let x = xyz(x).map(q);
    let z = xyz(normal).map(q);
    let y = [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &z[i] * &x[j] - &z[j] * &x[i]);
    let mut ends = vec![];
    for v in &edge.vertices {
        let vertex = &body.vertices[v.0 as usize];
        let point = circle_vertex(body, body.curves[edge.curve.0 as usize].frame, vertex)?;
        let delta = [0, 1, 2].map(|k| &point[k] - &o[k]);
        let dot = |a: &[wonky_curve::numeric::Q; 3]| (0..3).map(|k| &delta[k] * &a[k]).sum::<wonky_curve::numeric::Q>();
        ends.push([dot(&x), dot(&y)]);
    }
    use num_traits::Zero;
    if ends.iter().any(|p| p[0].is_zero() && p[1].is_zero()) {
        return Err(no("circle-endpoint-on-axis"));
    }
    let [a, b] = [&ends[0], &ends[1]];
    let cross = &a[0] * &b[1] - &a[1] * &b[0];
    let dot = &a[0] * &b[0] + &a[1] * &b[1];
    if cross.is_zero() && dot > q(0.) { return Err(no("zero-length-arc")); }
    let angle = |x, y| positive_angle(x, y).map_err(|_| no("circle-angle-uncertified"));
    let tau = iv(2.) * pi();
    // Signed start in [-1/2, 1/2] keeps the entire sampled span inside
    // sin_cos's certified range, including an outward-rounded near-full arc.
    let start = finite(angle(&a[0], &a[1])? / tau)?;
    let start = if start.m > 0.5 { finite(start - iv(1.))? } else { start };
    let sweep = if cross.is_zero() {
        iv(0.5)
    } else if dot.is_zero() {
        iv(if cross > q(0.) { 0.25 } else { 0.75 })
    } else { finite(angle(&dot, &cross)? / tau)? };
    if sweep.lo() <= 0. {
        return Err(no("circle-angle-uncertified"));
    }
    Ok([start, sweep])
}

/// Certified sine/cosine of turns. Range reduction is an identity, not a
/// topology predicate. The degree-27/26 Taylor polynomials on |x| <= 2 have
/// omitted tails < 2^29/29! and 2^28/28!, both < 1e-21. Interval arithmetic
/// encloses every operation and the binary64 enclosure of mathematical pi.
pub(crate) fn sin_cos(t: Iv) -> R<(Iv, Iv)> {
    finite(t)?;
    if t.lo() < -2. || t.hi() > 2. {
        return Err(no("angular-range"));
    }
    let quadrant = (t.m * 4.).floor() as i32;
    let pi = Iv {
        m: std::f64::consts::PI,
        r: std::f64::consts::PI.next_up() - std::f64::consts::PI,
    };
    let a = (t - iv(quadrant as f64 / 4.)) * iv(2.) * pi;
    if abs_bound(a) > 2. {
        return Err(no("angular-precision"));
    }
    let aa = -(a * a);
    let (mut s, mut c) = (a, iv(1.));
    let (mut st, mut ct) = (a, iv(1.));
    for k in 1..14 {
        st = st * aa / iv(((2 * k) * (2 * k + 1)) as f64);
        ct = ct * aa / iv(((2 * k - 1) * (2 * k)) as f64);
        s = s + st;
        c = c + ct;
    }
    let tail = Iv { m: 0., r: 1e-21 };
    s = finite(s + tail)?;
    c = finite(c + tail)?;
    Ok(match quadrant.rem_euclid(4) {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    })
}

#[derive(Clone)]
struct Carrier {
    frame: FrameId,
    origin: [Iv; 3],
    x: [Iv; 3],
    y: [Iv; 3],
    z: [Iv; 3],
}
impl Carrier {
    fn new(frame: FrameId, origin: &Vector3, axis: &Vector3, x: &Vector3) -> R<Self> {
        let (x, y, z) = basis(axis, x)?;
        Ok(Self {
            frame,
            origin: xyz(origin).map(iv),
            x,
            y,
            z,
        })
    }
    fn radial(&self, turn: Iv, radius: Iv, height: Iv) -> R<[Iv; 3]> {
        Ok(self.at_angle(sin_cos(turn)?, radius, height))
    }
    fn at_angle(&self, (s, c): (Iv, Iv), radius: Iv, height: Iv) -> [Iv; 3] {
        [0, 1, 2]
            .map(|k| self.origin[k] + radius * (c * self.x[k] + s * self.y[k]) + height * self.z[k])
    }
}
#[derive(Clone)]
struct Samples {
    ids: Vec<usize>,
    closed: bool,
}
struct Builder<'a> {
    body: &'a Body,
    mesh: Mesh,
    /// WC0 face being meshed; tags every triangle `triangle` pushes.
    face: u32,
    frames: BTreeMap<u32, Placement>,
    edges: Vec<Samples>,
    angles: Vec<(Iv, Iv)>,
    n: usize,
    step: f64,
    point_budget: f64,
}
impl<'a> Builder<'a> {
    fn frame(&mut self, id: FrameId) -> R<Placement> {
        crate::carriers::frame_placement(self.body, id, &mut self.frames).map_err(|why| no(&why))
    }
    fn world(&mut self, frame: FrameId, point: [Iv; 3]) -> R<[f64; 3]> {
        for v in point {
            finite(v)?;
        }
        let f = self.frame(frame)?;
        let p = point.map(|v| v.m);
        let out = f.apply(p, 1000., true).map_err(|_| no("world-range"))?;
        let enclosed = self.world_enclosure(frame, point)?;
        let mut error = iv(0.);
        for k in 0..3 {
            error = error + iv(abs_bound(enclosed[k] - iv(out[k])));
        }
        if finite(error)?.hi() > self.point_budget {
            return Err(no("sample-precision-budget"));
        }
        Ok(out)
    }
    fn world_enclosure(&mut self, frame: FrameId, point: [Iv; 3]) -> R<[Iv; 3]> {
        let f = self.frame(frame)?;
        let columns = f.enclosed_columns();
        let origin = f.apply_exact([0.; 3], 1., true).map_err(|_| no("world-range"))?.map(|v| expansion_ball(&v));
        let mut out = origin;
        for k in 0..3 {
            for j in 0..3 { out[k] = out[k] + columns[j][k] * point[j]; }
            out[k] = finite(out[k] * iv(1000.))?;
        }
        Ok(out)
    }
    fn point(&mut self, frame: FrameId, point: [Iv; 3]) -> R<usize> {
        if self.mesh.vertices.len() >= MAX_VERTICES {
            return Err(no("vertex-resource-limit"));
        }
        let out = self.world(frame, point)?;
        let id = self.mesh.vertices.len();
        self.mesh.vertices.push(out);
        Ok(id)
    }
    fn triangle(&mut self, mut t: [usize; 3], reverse: bool) -> R<()> {
        if self.mesh.triangles.len() >= MAX_TRIANGLES {
            return Err(no("triangle-resource-limit"));
        }
        if t[0] == t[1] || t[1] == t[2] || t[2] == t[0] {
            return Err(no("collapsed-triangle"));
        }
        if reverse {
            t.swap(1, 2);
        }
        self.mesh.triangles.push(t);
        self.mesh.faces.push(self.face);
        Ok(())
    }
    fn reversed(&mut self, face: &Face) -> R<bool> {
        Ok(!face.forward
            ^ self
                .frame(self.body.surfaces[face.surface.0 as usize].frame)?
                .reversed()
                .map_err(|_| no("singular-frame"))?)
    }
    fn rows(&mut self, low: &[usize], high: &[usize], reverse: bool) -> R<()> {
        if low.len() != high.len() || low.len() < 2 {
            return Err(no("incompatible-edge-sampling"));
        }
        for j in 0..low.len() - 1 {
            // A pole is one index, never one coincident vertex per longitude.
            if low[j] != low[j + 1] {
                self.triangle([low[j], low[j + 1], high[j + 1]], reverse)?;
            }
            if high[j] != high[j + 1] {
                self.triangle([low[j], high[j + 1], high[j]], reverse)?;
            }
        }
        Ok(())
    }
    fn sample_edges(&mut self) -> R<()> {
        for vertex in &self.body.vertices {
            self.point(vertex.frame, xyz(&vertex.point).map(iv))?;
        }
        for edge in &self.body.edges {
            let curve = &self.body.curves[edge.curve.0 as usize];
            let d = domain(&edge.domain)?;
            let carrier_domain = domain(&curve.domain)?;
            if d != carrier_domain && !matches!(curve.geometry, CurveGeometry::Circle { .. }) {
                return Err(no("trimmed-curve-domain-unsupported"));
            }
            if d[0] < carrier_domain[0] || d[1] > carrier_domain[1] {
                return Err(no("edge-outside-carrier-domain"));
            }
            let samples = match &curve.geometry {
                CurveGeometry::Line { .. } => {
                    if d != [0., 1.]
                        || edge.vertices.len() != 2
                        || edge.vertices[0] == edge.vertices[1]
                    {
                        return Err(no("line-domain-or-endpoints"));
                    }
                    Samples {
                        ids: edge.vertices.iter().map(|v| v.0 as usize).collect(),
                        closed: false,
                    }
                }
                CurveGeometry::Circle {
                    origin,
                    normal,
                    x,
                    radius,
                    arc,
                } => {
                    let closed = match arc {
                        ArcKind::Full {} => d == [0., 1.],
                        ArcKind::Trimmed {} => false,
                    };
                    if !closed && edge.vertices.len() == 2 && edge.vertices[0] == edge.vertices[1] {
                        return Err(no("zero-length-arc"));
                    }
                    // Any positive trim up to one turn shares the same certified sampling.
                    if (closed && d != [0., 1.])
                        || (!closed && wonky_curve::numeric::q(d[1]) - wonky_curve::numeric::q(d[0]) > wonky_curve::numeric::q(1.))
                        || edge.vertices.len() != 2
                        || closed != (edge.vertices[0] == edge.vertices[1])
                    {
                        return Err(no("circle-domain-unsupported"));
                    }
                    let carrier = Carrier::new(curve.frame, origin, normal, x)?;
                    let turns = if closed { [iv(0.), iv(1.)] } else {
                        circle_turns(self.body, edge, origin, normal, x)?
                    };
                    self.circle_samples(edge, &carrier, iv(radius.get()), closed, turns)?
                }
                CurveGeometry::VectorEllipse { origin, cosine, sine, arc } => {
                    if !matches!(arc, ArcKind::Trimmed {}) || d != [0., 0.25] || edge.vertices.len() != 2 {
                        return Err(no("ellipse-domain-unsupported"));
                    }
                    // At the two cardinal parameters the exact carrier is
                    // rational. Never substitute unrelated endpoint caches.
                    use wonky_curve::numeric::q;
                    for (end, vector) in [cosine, sine].into_iter().enumerate() {
                        let vertex = &self.body.vertices[edge.vertices[end].0 as usize];
                        if vertex.frame != curve.frame || (0..3).any(|k| {
                            q(vertex.point[k].get()) != q(origin[k].get())+q(vector[k].get())
                        }) { return Err(no("ellipse-endpoint-incidence")); }
                    }
                    let count = self.n/4;
                    let mut ids = Vec::with_capacity(count+1);
                    for j in 0..=count {
                        let id = if j == 0 || j == count { edge.vertices[usize::from(j == count)].0 as usize } else {
                            let (sn, cs) = sin_cos(iv(j as f64)/iv(self.n as f64))?;
                            self.point(curve.frame, std::array::from_fn(|k| iv(origin[k].get())+iv(cosine[k].get())*cs+iv(sine[k].get())*sn))?
                        };
                        ids.push(id);
                    }
                    Samples { ids, closed: false }
                }
                CurveGeometry::SphereCircle {
                    origin,
                    normal,
                    x,
                    sphere_radius,
                    height,
                } => {
                    if d != [0., 1.] || !edge.vertices.is_empty() {
                        return Err(no("algebraic-ring-domain"));
                    }
                    let radius = finite(
                        ((iv(sphere_radius.get()) - iv(height.get()))
                            * (iv(sphere_radius.get()) + iv(height.get())))
                        .sqrt(),
                    )?;
                    let carrier = Carrier::new(curve.frame, origin, normal, x)?;
                    self.circle_samples(edge, &carrier, radius, true, [iv(0.), iv(1.)])?
                }
                _ => return Err(no("edge-curve-unsupported")),
            };
            self.edges.push(samples);
        }
        Ok(())
    }
    fn circle_samples(
        &mut self,
        edge: &Edge,
        c: &Carrier,
        r: Iv,
        closed: bool,
        d: [Iv; 2],
    ) -> R<Samples> {
        // The angle is enclosed from exact endpoint directions, rather than
        // trusting a rounded turn-domain cache. Each cell is at most 1/n
        // turns, the width certified against the transformed carrier radius.
        let span = d[1];
        let count = if closed { self.n } else if span.r == 0. && [0.25, 0.5, 0.75].contains(&span.m) {
            (self.n as f64 * span.m) as usize
        } else {
            (finite(span * iv(self.n as f64))?.hi().ceil() as usize).max(2)
        };
        if count > MAX_ANGULAR + 1 {
            return Err(no("angular-resource-limit"));
        }
        // Bind the exact ends to the evaluated circle within the same
        // world-coordinate evaluation budget reserved for interior samples.
        if !edge.vertices.is_empty() {
            for k in 0..2 {
                let turn = if k == 0 { d[0] } else { finite(d[0] + span)? };
                let evaluated = c.radial(turn, r, iv(0.))?;
                let enclosed = self.world_enclosure(c.frame, evaluated)?;
                let vertex = self.mesh.vertices[edge.vertices[k].0 as usize];
                let error = enclosed.into_iter().zip(vertex).try_fold(iv(0.), |e, (p, v)| finite(e + iv(abs_bound(p - iv(v)))))?;
                if error.hi() > self.point_budget { return Err(no("circle-endpoint-budget")); }
            }
        }
        let mut ids = Vec::with_capacity(count + 1);
        for j in 0..=count {
            let id = if j == count && closed {
                ids[0]
            } else if !edge.vertices.is_empty() && (j == 0 || j == count) {
                edge.vertices[usize::from(j == count)].0 as usize
            } else {
                let turn = d[0] + span * iv(j as f64) / iv(count as f64);
                self.point(c.frame, c.radial(turn, r, iv(0.))?)?
            };
            ids.push(id);
        }
        Ok(Samples { ids, closed })
    }
    fn planar(&mut self, face: &Face) -> R<()> {
        let surface = &self.body.surfaces[face.surface.0 as usize];
        let SurfaceGeometry::Plane { normal, x, .. } = &surface.geometry else {
            unreachable!()
        };
        // Only the plane's direction is used: the projection axis and winding
        // come from the exact cofactor below. An exact non-unit normal, such as
        // an equal-offset chamfer's (0,-1,1), needs no rounding to unit length.
        let mut g = Guard::new();
        if !exact_zero(&dot(xyz(normal), xyz(x), &mut g), &g)? {
            return Err(no("nonorthonormal-carrier-basis"));
        }
        let f = self.frame(surface.frame)?;
        // For x orthogonal to n, (A x) x (A (n x x)) = |x|^2 cof(A) n: the
        // exact cofactor image is the mapped in-plane frame's normal up to a
        // positive factor, without rounding an in-plane y into binary64.
        let normal = f
            .cofactor_exact(xyz(normal))
            .map_err(|_| no("normal-range"))?;
        // Project along the dominant exact component. The choice only
        // conditions the projection; every sign below is exact.
        let magnitude = |e: &Exp| e.iter().rev().find(|v| **v != 0.).map_or(0., |v| v.abs());
        let axis = (0..3)
            .filter(|&k| ex::sign(&normal[k]) != 0)
            .max_by(|&i, &j| magnitude(&normal[i]).total_cmp(&magnitude(&normal[j])))
            .ok_or_else(|| no("singular-plane"))?;
        let mut map = BTreeMap::new();
        let mut ids = vec![];
        let mut loops = vec![];
        let projection_reverse = (ex::sign(&normal[axis]) < 0)
            ^ !face.forward
            ^ f.reversed().map_err(|_| no("singular-frame"))?;
        for lid in &face.loops {
            let lp = &self.body.loops[lid.0 as usize];
            let mut ring = vec![];
            let mut end = None;
            let mut first = None;
            for cid in &lp.coedges {
                let co = &self.body.coedges[cid.0 as usize];
                let mut edge = self.edges[co.edge.0 as usize].ids.clone();
                if !co.forward {
                    edge.reverse();
                }
                if end.is_some_and(|e| e != edge[0]) {
                    return Err(no("unchained-planar-loop"));
                }
                first.get_or_insert(edge[0]);
                end = edge.last().copied();
                ring.extend_from_slice(&edge[..edge.len() - 1]);
            }
            if first != end || ring.len() < 3 {
                return Err(no("open-planar-loop"));
            }
            if projection_reverse {
                ring.reverse();
            }
            // The loop role is authoritative. triangulate_loops verifies its
            // exact winding; no epsilon flips an incorrectly oriented loop.
            if lp.outer {
                loops.insert(0, ring);
            } else {
                loops.push(ring);
            }
        }
        if face
            .loops
            .iter()
            .filter(|l| self.body.loops[l.0 as usize].outer)
            .count()
            != 1
        {
            return Err(no("planar-outer-loop-count"));
        }
        for ring in &mut loops {
            for id in ring {
                let next = ids.len();
                let local = *map.entry(*id).or_insert_with(|| {
                    ids.push(*id);
                    next
                });
                *id = local;
            }
        }
        let points: Vec<_> = ids
            .iter()
            .map(|&id| {
                let p = self.mesh.vertices[id];
                [p[(axis + 1) % 3], p[(axis + 2) % 3]]
            })
            .collect();
        for t in triangulate_loops(&points, &loops)? {
            self.triangle(t.map(|i| ids[i]), projection_reverse)?;
        }
        Ok(())
    }
    /// Harmonic axial boundaries of a cylinder strip, bound exactly to their
    /// vector ellipses. Connectivity comes from shared EdgeId-owned samples.
    fn harmonic_cylinder(&mut self, face: &Face) -> R<()> {
        use wonky_curve::numeric::q;
        let surface = &self.body.surfaces[face.surface.0 as usize];
        let SurfaceGeometry::Cylinder { origin, axis, x, radius } = &surface.geometry else { unreachable!() };
        if face.loops.len() != 1 { return Err(no("harmonic-cylinder-loop-count")); }
        let loop_ = &self.body.loops[face.loops[0].0 as usize];
        if loop_.coedges.len() != 4 { return Err(no("harmonic-cylinder-edge-count")); }
        let y: [wonky_curve::Q; 3] = [q(axis[1].get())*q(x[2].get())-q(axis[2].get())*q(x[1].get()),
            q(axis[2].get())*q(x[0].get())-q(axis[0].get())*q(x[2].get()),
            q(axis[0].get())*q(x[1].get())-q(axis[1].get())*q(x[0].get())];
        let mut sides = vec![];
        let mut lines = 0;
        for id in &loop_.coedges {
            let co = &self.body.coedges[id.0 as usize];
            let edge = &self.body.edges[co.edge.0 as usize];
            let curve = &self.body.curves[edge.curve.0 as usize];
            let pc = &self.body.pcurves[co.pcurve.0 as usize];
            match (&curve.geometry, &pc.geometry) {
                (CurveGeometry::VectorEllipse { origin: o, cosine: c, sine: s, .. },
                 PcurveGeometry::Harmonic { offset, linear, cosine, sine }) => {
                    if curve.frame != surface.frame || domain(&edge.domain)? != [0.,0.25]
                        || offset[0].get() != 0. || linear[0].get().abs() != 1.
                        || linear[1].get() != 0. || cosine[0].get() != 0.
                        || sine.iter().any(|v| v.get() != 0.) { return Err(no("harmonic-cylinder-chart")); }
                    for k in 0..3 {
                        if q(o[k].get()) != q(origin[k].get())+q(axis[k].get())*q(offset[1].get())
                            || q(c[k].get()) != q(radius.get())*q(x[k].get())+q(axis[k].get())*q(cosine[1].get())
                            || q(s[k].get()) != q(radius.get())*q(linear[0].get())*&y[k] { return Err(no("harmonic-cylinder-incidence")); }
                    }
                    sides.push((co, offset[1].get(), cosine[1].get(), linear[0].get()));
                }
                (CurveGeometry::Line { .. }, PcurveGeometry::Line { a, b }) if a[0] == b[0] => { lines += 1; }
                _ => return Err(no("harmonic-cylinder-boundary")),
            }
        }
        if sides.len() != 2 || lines != 2 || sides[0].3 != sides[1].3 { return Err(no("harmonic-cylinder-boundary-count")); }
        let delta = q(sides[1].1)-q(sides[0].1);
        let cosine = q(sides[1].2)-q(sides[0].2);
        if delta < q(0.) && &delta+&cosine < q(0.) { sides.swap(0,1); }
        else if delta <= q(0.) || &delta+&cosine <= q(0.) { return Err(no("harmonic-cylinder-crossed-boundaries")); }
        let reverse_parameter = sides[0].3 < 0.;
        if sides[0].0.forward != (face.forward ^ reverse_parameter) || sides[1].0.forward == (face.forward ^ reverse_parameter) { return Err(no("harmonic-cylinder-orientation")); }
        let low = self.edges[sides[0].0.edge.0 as usize].ids.clone();
        let high = self.edges[sides[1].0.edge.0 as usize].ids.clone();
        let reverse = self.reversed(face)? ^ reverse_parameter;
        self.rows(&low, &high, reverse)
    }
    fn cylindrical(&mut self, face: &Face) -> R<()> {
        let surface = &self.body.surfaces[face.surface.0 as usize];
        let SurfaceGeometry::Cylinder {
            origin,
            axis,
            x,
            radius,
        } = &surface.geometry
        else {
            unreachable!()
        };
        basis(axis, x)?;
        if face.loops.iter().any(|lp| self.body.loops[lp.0 as usize].coedges.iter().any(|co| {
            matches!(self.body.pcurves[self.body.coedges[co.0 as usize].pcurve.0 as usize].geometry, PcurveGeometry::Harmonic { .. })
        })) { return self.harmonic_cylinder(face); }
        // Source 3D curves own these trims. In particular the quarter-revolve
        // producer's diagnostic Samples pcurves use radians, not turns.
        let mut rings = vec![];
        let mut vertical = vec![];
        for lid in &face.loops {
            for cid in &self.body.loops[lid.0 as usize].coedges {
                let co = &self.body.coedges[cid.0 as usize];
                let edge = &self.body.edges[co.edge.0 as usize];
                let curve = &self.body.curves[edge.curve.0 as usize];
                match &curve.geometry {
                    CurveGeometry::Circle {
                        origin: o,
                        normal,
                        x: radial,
                        radius: r,
                        ..
                    } => {
                        if curve.frame != surface.frame || r != radius {
                            return Err(no("cylinder-ring-binding"));
                        }
                        let same = xyz(normal) == xyz(axis);
                        if !same && xyz(normal) != xyz(axis).map(|v| -v) {
                            return Err(no("cylinder-ring-axis"));
                        }
                        axis_incidence(xyz(origin), xyz(axis), xyz(o))?;
                        let mut samples = self.edges[co.edge.0 as usize].clone();
                        basis(normal, radial)?;
                        let start = if !samples.closed {
                            let v = &self.body.vertices[edge.vertices[usize::from(!same)].0 as usize];
                            let point = circle_vertex(self.body, curve.frame, v)?;
                            [0, 1, 2].map(|k| point[k].clone() - wonky_curve::numeric::q(o[k].get()))
                        } else {
                            xyz(radial).map(wonky_curve::numeric::q)
                        };
                        if !same {
                            samples.ids.reverse();
                        }
                        rings.push((xyz(o), start, co.forward ^ !same, samples));
                    }
                    CurveGeometry::Line { .. } => vertical.push(co.edge.0 as usize),
                    _ => return Err(no("cylinder-boundary-unsupported")),
                }
            }
        }
        if rings.len() != 2 {
            return Err(no("cylinder-ring-count"));
        }
        let order = axial_order(rings[0].0, rings[1].0, xyz(axis))?;
        if order == 0 {
            return Err(no("cylinder-zero-height"));
        }
        if order < 0 {
            rings.swap(0, 1);
        }
        let low = &rings[0];
        let high = &rings[1];
        if low.1 != high.1 || low.2 != face.forward || high.2 == face.forward {
            return Err(no("cylinder-trim-orientation"));
        }
        let (low, high) = (&low.3, &high.3);
        if low.closed != high.closed
            || (!low.closed && vertical.len() != 2)
            || (low.closed
                && !vertical.is_empty()
                && (vertical.len() != 2 || vertical[0] != vertical[1]))
        {
            return Err(no("cylinder-seam-topology"));
        }
        for edge in vertical {
            let ids = &self.edges[edge].ids;
            let at_start = (ids[0] == low.ids[0] && ids[1] == high.ids[0])
                || (ids[1] == low.ids[0] && ids[0] == high.ids[0]);
            let at_end = (ids[0] == *low.ids.last().unwrap()
                && ids[1] == *high.ids.last().unwrap())
                || (ids[1] == *low.ids.last().unwrap() && ids[0] == *high.ids.last().unwrap());
            if !at_start && !at_end {
                return Err(no("cylinder-seam-binding"));
            }
        }
        let reverse = self.reversed(face)?;
        self.rows(&low.ids, &high.ids, reverse)
    }
    /// A meridian cone face bounded by rings at its exact meridian points, or
    /// by one ring and the apex (the other meridian point has radius zero).
    /// Quads between equal-angle ring samples lie in the plane of two
    /// generators (all generators meet at the apex), so their deviation is the
    /// larger ring's chord sagitta, the cylinder bound. A seam pair of
    /// straight edges (present for a non-full-turn trim) must bind the two
    /// rings (or the ring and the apex) at the same chart angle, mirroring
    /// the periodic-seam check in `cylindrical` above.
    fn conical(&mut self, face: &Face) -> R<()> {
        let body = self.body;
        let surface = &body.surfaces[face.surface.0 as usize];
        let SurfaceGeometry::ConeMeridian {
            origin,
            axis,
            x,
            start,
            end,
        } = &surface.geometry
        else {
            unreachable!()
        };
        basis(axis, x)?;
        let meridian = [uv(start), uv(end)];
        let mut rings = vec![];
        let mut vertical = vec![];
        for lid in &face.loops {
            for cid in &body.loops[lid.0 as usize].coedges {
                let co = &body.coedges[cid.0 as usize];
                let edge = &body.edges[co.edge.0 as usize];
                let curve = &body.curves[edge.curve.0 as usize];
                match &curve.geometry {
                    CurveGeometry::Circle {
                        origin: o,
                        normal,
                        x: radial,
                        radius: r,
                        ..
                    } => {
                        // A ring sits at one exact meridian point: its radius names
                        // the point (the two radii differ), its centre is on the axis
                        // at that point's height, and its plane is normal to the axis.
                        let Some(point) = meridian.iter().find(|p| p[0] == r.get() && p[0] > 0.) else {
                            return Err(no("cone-ring-meridian"));
                        };
                        if curve.frame != surface.frame {
                            return Err(no("cone-ring-binding"));
                        }
                        let same = xyz(normal) == xyz(axis);
                        if !same && xyz(normal) != xyz(axis).map(|v| -v) {
                            return Err(no("cone-ring-axis"));
                        }
                        translated_equal(xyz(origin), xyz(axis), point[1], xyz(o))?;
                        let mut samples = self.edges[co.edge.0 as usize].clone();
                        basis(normal, radial)?;
                        if !same {
                            samples.ids.reverse();
                        }
                        rings.push((point[1], xyz(radial).map(|v| vec![v]), co.forward ^ !same, samples));
                    }
                    CurveGeometry::Line { .. } => vertical.push(co.edge.0 as usize),
                    _ => return Err(no("cone-boundary-unsupported")),
                }
            }
        }
        let reverse = self.reversed(face)?;
        match rings.len() {
            2 => {
                if rings[0].0 == rings[1].0 {
                    return Err(no("cone-zero-height"));
                }
                if rings[0].0 > rings[1].0 {
                    rings.swap(0, 1);
                }
                let (low, high) = (&rings[0], &rings[1]);
                if !exact_equal(&low.1, &high.1)? || low.2 != face.forward || high.2 == face.forward {
                    return Err(no("cone-trim-orientation"));
                }
                if low.3.closed != high.3.closed
                    || (!low.3.closed && vertical.len() != 2)
                    || (low.3.closed && !vertical.is_empty() && (vertical.len() != 2 || vertical[0] != vertical[1])) {
                    return Err(no("cone-seam-topology"));
                }
                for edge in vertical {
                    let ids = &self.edges[edge].ids;
                    let at_start = (ids[0] == low.3.ids[0] && ids[1] == high.3.ids[0])
                        || (ids[1] == low.3.ids[0] && ids[0] == high.3.ids[0]);
                    let at_end = (ids[0] == *low.3.ids.last().unwrap()
                        && ids[1] == *high.3.ids.last().unwrap())
                        || (ids[1] == *low.3.ids.last().unwrap() && ids[0] == *high.3.ids.last().unwrap());
                    if !at_start && !at_end {
                        return Err(no("cone-seam-binding"));
                    }
                }
                let (low, high) = (low.3.ids.clone(), high.3.ids.clone());
                self.rows(&low, &high, reverse)
            }
            1 => {
                if !vertical.is_empty() {
                    return Err(no("cone-seam-topology"));
                }
                let Some(tip) = meridian.iter().find(|p| p[0] == 0.) else {
                    return Err(no("cone-apex-missing"));
                };
                let ring = &rings[0];
                let above = tip[1] > ring.0;
                if (ring.2 == face.forward) != above {
                    return Err(no("cone-trim-orientation"));
                }
                let carrier = Carrier::new(surface.frame, origin, axis, x)?;
                let apex = self.point(surface.frame, carrier.at_angle((iv(0.), iv(1.)), iv(0.), iv(tip[1])))?;
                let ids = ring.3.ids.clone();
                let pole = vec![apex; ids.len()];
                if above {
                    self.rows(&ids, &pole, reverse)
                } else {
                    self.rows(&pole, &ids, reverse)
                }
            }
            _ => Err(no("cone-ring-count")),
        }
    }
    fn sphere_octant(&mut self, face: &Face) -> R<()> {
        let surface = &self.body.surfaces[face.surface.0 as usize];
        let SurfaceGeometry::Sphere {
            origin,
            axis,
            x,
            radius,
        } = &surface.geometry
        else {
            unreachable!()
        };
        let c = Carrier::new(surface.frame, origin, axis, x)?;
        if face.loops.len() != 1 {
            return Err(no("sphere-nonlatitude-trim"));
        }
        let lp = &self.body.loops[face.loops[0].0 as usize];
        if !lp.outer || lp.coedges.len() != 3 {
            return Err(no("sphere-nonlatitude-trim"));
        }
        let mut equator = None;
        let mut meridians = vec![];
        for cid in &lp.coedges {
            let co = &self.body.coedges[cid.0 as usize];
            let edge = &self.body.edges[co.edge.0 as usize];
            let curve = &self.body.curves[edge.curve.0 as usize];
            let CurveGeometry::Circle {
                origin: o,
                radius: r,
                ..
            } = &curve.geometry
            else {
                return Err(no("sphere-octant-edge"));
            };
            if curve.frame != surface.frame
                || xyz(o) != xyz(origin)
                || r != radius
                || domain(&edge.domain)? != [0., 0.25]
            {
                return Err(no("sphere-octant-binding"));
            }
            let pc = &self.body.pcurves[co.pcurve.0 as usize];
            let PcurveGeometry::Line { a, b } = &pc.geometry else {
                return Err(no("sphere-octant-chart"));
            };
            let (a, b) = (uv(a), uv(b));
            let mut ids = self.edges[co.edge.0 as usize].ids.clone();
            for (vertex, chart) in edge.vertices.iter().zip([a, b]) {
                let vertex = &self.body.vertices[vertex.0 as usize];
                if vertex.frame != surface.frame {
                    return Err(no("sphere-octant-vertex-frame"));
                }
                sphere_cardinal_incidence(&c, radius.get(), chart, xyz(&vertex.point))?;
            }
            if a[1] == 0. && b[1] == 0. && (b[0] - a[0]).abs() == 0.25 {
                if a[0] > b[0] {
                    ids.reverse();
                }
                if equator
                    .replace((a[0].min(b[0]), a[0].max(b[0]), ids))
                    .is_some()
                {
                    return Err(no("sphere-octant-equator-count"));
                }
            } else if a[0] == b[0] && a[1].min(b[1]) == -0.25 && a[1].max(b[1]) == 0. {
                if a[1] > b[1] {
                    ids.reverse();
                }
                meridians.push((a[0], ids));
            } else {
                return Err(no("sphere-octant-chart"));
            }
        }
        let (lo, hi, top) = equator.ok_or_else(|| no("sphere-octant-equator-count"))?;
        meridians.sort_by(|a, b| a.0.total_cmp(&b.0));
        if meridians.len() != 2 || meridians[0].0 != lo || meridians[1].0 != hi {
            return Err(no("sphere-octant-meridians"));
        }
        let (left, right) = (&meridians[0].1, &meridians[1].1);
        let count = self.n / 4;
        if left.len() != count + 1
            || right.len() != count + 1
            || top.len() != count + 1
            || left[0] != right[0]
            || left[count] != top[0]
            || right[count] != top[count]
        {
            return Err(no("sphere-octant-seam-binding"));
        }
        let reverse = self.reversed(face)?;
        let mut previous = vec![left[0]; count + 1];
        for k in 1..=count {
            let row = if k == count {
                top.clone()
            } else {
                let (s, co) = sin_cos(iv(-0.25) + iv(k as f64) / iv(self.n as f64))?;
                let mut row = Vec::with_capacity(count + 1);
                row.push(left[k]);
                for j in 1..count {
                    let angle = sin_cos(iv(lo) + iv(j as f64) / iv(self.n as f64))?;
                    row.push(self.point(
                        c.frame,
                        c.at_angle(angle, iv(radius.get()) * co, iv(radius.get()) * s),
                    )?);
                }
                row.push(right[k]);
                row
            };
            self.rows(&previous, &row, reverse)?;
            previous = row;
        }
        Ok(())
    }
    fn spherical(&mut self, face: &Face) -> R<()> {
        if face
            .loops
            .iter()
            .any(|lid| self.body.loops[lid.0 as usize].coedges.len() != 1)
        {
            return self.sphere_octant(face);
        }
        let surface = &self.body.surfaces[face.surface.0 as usize];
        let SurfaceGeometry::Sphere {
            origin,
            axis,
            x,
            radius,
        } = &surface.geometry
        else {
            unreachable!()
        };
        let carrier = Carrier::new(surface.frame, origin, axis, x)?;
        let r = radius.get();
        let mut rings = vec![];
        for lid in &face.loops {
            let lp = &self.body.loops[lid.0 as usize];
            if lp.coedges.len() != 1 {
                return Err(no("sphere-nonlatitude-trim"));
            }
            let co = &self.body.coedges[lp.coedges[0].0 as usize];
            let pc = &self.body.pcurves[co.pcurve.0 as usize];
            let height = match &pc.geometry {
                PcurveGeometry::SphereLatitude { height } => height.get(),
                PcurveGeometry::Line { a, b } if uv(a) == [0., 0.] && uv(b) == [1., 0.] => 0.,
                _ => return Err(no("sphere-chart-unsupported")),
            };
            if height <= -r || height >= r {
                return Err(no("sphere-latitude-range"));
            }
            let edge = &self.body.edges[co.edge.0 as usize];
            let curve = &self.body.curves[edge.curve.0 as usize];
            if curve.frame != surface.frame || !self.edges[co.edge.0 as usize].closed {
                return Err(no("sphere-ring-frame"));
            }
            let (eo, en, ex) = match &curve.geometry {
                CurveGeometry::Circle {
                    origin,
                    normal,
                    x,
                    radius,
                    ..
                } => {
                    radius_identity(radius.get(), height, r)?;
                    (origin, normal, x)
                }
                CurveGeometry::SphereCircle {
                    origin,
                    normal,
                    x,
                    sphere_radius,
                    height: h,
                } if sphere_radius.get() == r && h.get().abs() == height.abs() => {
                    (origin, normal, x)
                }
                _ => return Err(no("sphere-ring-binding")),
            };
            if en != axis || ex != x {
                return Err(no("sphere-ring-basis"));
            }
            translated_equal(xyz(origin), xyz(axis), height, xyz(eo))?;
            rings.push((height, co.edge.0 as usize, co.forward));
        }
        rings.sort_by(|a, b| a.0.total_cmp(&b.0));
        let (bottom, top) = match rings.as_slice() {
            [] => ((-r, None), (r, None)),
            [one] if one.2 == face.forward => ((one.0, Some(one.1)), (r, None)),
            [one] => ((-r, None), (one.0, Some(one.1))),
            [a, b] if a.0 < b.0 && a.2 == face.forward && b.2 != face.forward => {
                ((a.0, Some(a.1)), (b.0, Some(b.1)))
            }
            _ => return Err(no("sphere-latitude-topology")),
        };
        let direction = |h: f64| -> R<[Iv; 2]> {
            if h == -r {
                return Ok([iv(0.), iv(-1.)]);
            }
            if h == r {
                return Ok([iv(0.), iv(1.)]);
            }
            let z = iv(h) / iv(r);
            let radial = finite(((iv(r) - iv(h)) * (iv(r) + iv(h))).sqrt() / iv(r))?;
            Ok([radial, z])
        };
        let (a, b) = (direction(bottom.0)?, direction(top.0)?);
        let mut profile = vec![a];
        // Splitting at the equator avoids antipodal midpoint normalization.
        if bottom.0 < 0. && top.0 > 0. {
            subdivide_meridian(a, [iv(1.), iv(0.)], self.step, 0, &mut profile)?;
            subdivide_meridian([iv(1.), iv(0.)], b, self.step, 0, &mut profile)?;
        } else {
            subdivide_meridian(a, b, self.step, 0, &mut profile)?;
        }
        let reverse = self.reversed(face)?;
        let mut previous: Option<Vec<usize>> = None;
        let last = profile.len() - 1;
        for (k, d) in profile.into_iter().enumerate() {
            let boundary = if k == 0 {
                bottom.1
            } else if k == last {
                top.1
            } else {
                None
            };
            let row = if let Some(edge) = boundary {
                self.edges[edge].ids.clone()
            } else if (k == 0 && bottom.0 == -r) || (k == last && top.0 == r) {
                let pole = self.point(
                    carrier.frame,
                    [0, 1, 2].map(|j| carrier.origin[j] + iv(r) * d[1] * carrier.z[j]),
                )?;
                vec![pole; self.n + 1]
            } else {
                let mut row = Vec::with_capacity(self.n + 1);
                for j in 0..self.n {
                    row.push(self.point(
                        carrier.frame,
                        carrier.at_angle(self.angles[j], iv(r) * d[0], iv(r) * d[1]),
                    )?);
                }
                row.push(row[0]);
                row
            };
            if let Some(prev) = previous {
                self.rows(&prev, &row, reverse)?;
            }
            previous = Some(row);
        }
        Ok(())
    }
    /// A rectangular torus chart reuses all four authoritative edge runs.
    /// The same two-angle curvature bound as a full torus applies to each
    /// grid cell; sample rounding is checked by `point`, not fitted to a rim.
    fn torus_rectangle(&mut self, face: &Face, c: &Carrier, major: f64, minor: f64) -> R<()> {
        if face.loops.len() != 1 {
            return Err(no("torus-rectangular-trim-required"));
        }
        let lp = &self.body.loops[face.loops[0].0 as usize];
        if lp.coedges.len() != 4 {
            return Err(no("torus-rectangular-trim-required"));
        }
        let mut runs = vec![];
        let mut bounds = [[f64::INFINITY, f64::NEG_INFINITY]; 2];
        for cid in &lp.coedges {
            let co = &self.body.coedges[cid.0 as usize];
            let pc = &self.body.pcurves[co.pcurve.0 as usize];
            let PcurveGeometry::Line { a, b } = &pc.geometry else {
                return Err(no("torus-rectangular-trim-required"));
            };
            let (a, b) = (uv(a), uv(b));
            let varying = if a[0] == b[0] && a[1] != b[1] { 1 }
                else if a[1] == b[1] && a[0] != b[0] { 0 }
                else { return Err(no("torus-rectangular-trim-required")); };
            for k in 0..2 {
                bounds[k][0] = bounds[k][0].min(a[k]).min(b[k]);
                bounds[k][1] = bounds[k][1].max(a[k]).max(b[k]);
            }
            let mut ids = self.edges[co.edge.0 as usize].ids.clone();
            if a[varying] > b[varying] { ids.reverse(); }
            runs.push((varying, a[1-varying], a[varying].min(b[varying]), a[varying].max(b[varying]), ids));
        }
        let run = |varying: usize, side: usize| -> R<Vec<usize>> {
            let found = runs.iter().filter(|r| r.0 == varying && r.1 == bounds[1-varying][side]
                && r.2 == bounds[varying][0] && r.3 == bounds[varying][1]).collect::<Vec<_>>();
            if found.len() != 1 { return Err(no("torus-rectangular-trim-required")); }
            Ok(found[0].4.clone())
        };
        let (low, high, left, right) = (run(0,0)?, run(0,1)?, run(1,0)?, run(1,1)?);
        if low.len() != high.len() || left.len() != right.len() || low.len()<2 || left.len()<2
            || low[0]!=left[0] || *low.last().unwrap()!=right[0]
            || high[0]!=*left.last().unwrap() || *high.last().unwrap()!=*right.last().unwrap() {
            return Err(no("torus-boundary-grid-binding"));
        }
        let reverse = self.reversed(face)?;
        let mut previous = low;
        for j in 1..left.len() {
            let row = if j == left.len()-1 { high.clone() } else {
                let v = iv(bounds[1][0]) + (iv(bounds[1][1])-iv(bounds[1][0]))*iv(j as f64)/iv((left.len()-1) as f64);
                let (sv,cv) = sin_cos(v)?;
                let mut row = vec![left[j]];
                for k in 1..high.len()-1 {
                    let u = iv(bounds[0][0])+(iv(bounds[0][1])-iv(bounds[0][0]))*iv(k as f64)/iv((high.len()-1) as f64);
                    row.push(self.point(c.frame,c.radial(u,iv(major)+iv(minor)*cv,iv(minor)*sv)?)?);
                }
                row.push(right[j]);
                row
            };
            self.rows(&previous,&row,reverse)?;
            previous=row;
        }
        Ok(())
    }
    fn toroidal(&mut self, face: &Face) -> R<()> {
        let surface = &self.body.surfaces[face.surface.0 as usize];
        let SurfaceGeometry::Torus {
            origin,
            axis,
            x,
            major,
            minor,
        } = &surface.geometry
        else {
            unreachable!()
        };
        if major.get() <= minor.get() || minor.get() <= 0. {
            return Err(no("singular-torus"));
        }
        let c = Carrier::new(surface.frame, origin, axis, x)?;
        if !face.loops.is_empty() {
            return self.torus_rectangle(face, &c, major.get(), minor.get());
        }
        let reverse = self.reversed(face)?;
        let mut first: Option<Vec<usize>> = None;
        let mut previous: Option<Vec<usize>> = None;
        for k in 0..self.n {
            let (s, co) = self.angles[k];
            let radius = iv(major.get()) + iv(minor.get()) * co;
            let height = iv(minor.get()) * s;
            let mut row = Vec::with_capacity(self.n + 1);
            for j in 0..self.n {
                row.push(self.point(c.frame, c.at_angle(self.angles[j], radius, height))?);
            }
            row.push(row[0]);
            if let Some(prev) = previous {
                self.rows(&prev, &row, reverse)?;
            } else {
                first = Some(row.clone());
            }
            previous = Some(row);
        }
        self.rows(&previous.unwrap(), &first.unwrap(), reverse)
    }
}

fn axial_order(a: [f64; 3], b: [f64; 3], axis: [f64; 3]) -> R<i32> {
    let mut g = Guard::new();
    let mut value = vec![];
    for k in 0..3 {
        let d = ex::sum(&[b[k]], &[-a[k]], &mut g);
        value = ex::sum(&value, &ex::mul(&d, &[axis[k]], &mut g), &mut g);
    }
    if !g.exact() {
        return Err(no("exact-predicate-range"));
    }
    Ok(ex::sign(&value))
}
fn axis_incidence(origin: [f64; 3], axis: [f64; 3], point: [f64; 3]) -> R<()> {
    let mut g = Guard::new();
    let delta: [Exp; 3] = [0, 1, 2].map(|k| ex::sum(&[point[k]], &[-origin[k]], &mut g));
    for (i, j) in [(0, 1), (1, 2), (2, 0)] {
        let cross = ex::sum(
            &ex::mul(&delta[i], &[axis[j]], &mut g),
            &ex::neg(&ex::mul(&delta[j], &[axis[i]], &mut g)),
            &mut g,
        );
        if !exact_zero(&cross, &g)? {
            return Err(no("cylinder-axis-incidence"));
        }
    }
    Ok(())
}
fn cardinal(turn: f64) -> R<(f64, f64)> {
    match turn {
        -0.25 => Ok((-1., 0.)),
        0. => Ok((0., 1.)),
        0.25 => Ok((1., 0.)),
        0.5 => Ok((0., -1.)),
        0.75 => Ok((-1., 0.)),
        1. => Ok((0., 1.)),
        _ => Err(no("sphere-octant-noncardinal-chart")),
    }
}
fn sphere_cardinal_incidence(c: &Carrier, radius: f64, chart: [f64; 2], point: [f64; 3]) -> R<()> {
    let (su, cu) = cardinal(chart[0])?;
    let (sv, cv) = cardinal(chart[1])?;
    if c.x.iter().chain(&c.y).chain(&c.z).any(|v| v.r != 0.) {
        return Err(no("sphere-octant-basis-range"));
    }
    let mut g = Guard::new();
    for k in 0..3 {
        let mut value = vec![c.origin[k].m];
        for (coefficient, direction) in [(cv * cu, c.x[k].m), (cv * su, c.y[k].m), (sv, c.z[k].m)] {
            let term = ex::mul(&[radius], &[coefficient * direction], &mut g);
            value = ex::sum(&value, &term, &mut g);
        }
        value = ex::sum(&value, &[-point[k]], &mut g);
        if !exact_zero(&value, &g)? {
            return Err(no("sphere-octant-endpoint-incidence"));
        }
    }
    Ok(())
}
fn translated_equal(origin: [f64; 3], axis: [f64; 3], height: f64, target: [f64; 3]) -> R<()> {
    let mut g = Guard::new();
    for k in 0..3 {
        let value = ex::sum(
            &ex::sum(
                &[origin[k]],
                &ex::mul(&[axis[k]], &[height], &mut g),
                &mut g,
            ),
            &[-target[k]],
            &mut g,
        );
        if !exact_zero(&value, &g)? {
            return Err(no("ring-plane-incidence"));
        }
    }
    Ok(())
}
fn radius_identity(radial: f64, height: f64, radius: f64) -> R<()> {
    let mut g = Guard::new();
    let value = ex::sum(
        &ex::sum(
            &ex::mul(&[radial], &[radial], &mut g),
            &ex::mul(&[height], &[height], &mut g),
            &mut g,
        ),
        &ex::neg(&ex::mul(&[radius], &[radius], &mut g)),
        &mut g,
    );
    if exact_zero(&value, &g)? {
        Ok(())
    } else {
        Err(no("sphere-ring-incidence"))
    }
}
fn subdivide_meridian(
    a: [Iv; 2],
    b: [Iv; 2],
    step: f64,
    depth: usize,
    out: &mut Vec<[Iv; 2]>,
) -> R<()> {
    let chord = finite((a[0] - b[0]).norm3(a[1] - b[1], iv(0.)))?;
    // 2 asin(c/2) <= c / sqrt(1-c²/4). Outward arithmetic
    // certifies a sampling bound only; no topology is inferred from closeness.
    if chord.hi() < 1. {
        let c = iv(chord.hi());
        let arc = finite(c / (iv(1.) - c * c / iv(4.)).sqrt())?;
        if arc.hi() <= step {
            out.push(b);
            return Ok(());
        }
    }
    if depth >= 24 || out.len() >= MAX_ANGULAR {
        return Err(no("latitude-resource-or-precision-limit"));
    }
    let p = [a[0] + b[0], a[1] + b[1]];
    let length = finite(p[0].norm3(p[1], iv(0.)))?;
    if length.lo() <= 0. {
        return Err(no("antipodal-latitude"));
    }
    let middle = [finite(p[0] / length)?, finite(p[1] / length)?];
    subdivide_meridian(a, middle, step, depth + 1, out)?;
    subdivide_meridian(middle, b, step, depth + 1, out)
}

/// Tessellate only supported analytic trims. A checked input is still required
/// at the export boundary; this public observation also checks WC0 references.
pub fn tessellate(body: &Body, deviation_mm: f64) -> R<Mesh> {
    if !deviation_mm.is_finite() || deviation_mm <= 0. {
        return Err(no("positive-deviation-required"));
    }
    if body.vertices.len() > MAX_VERTICES
        || body.edges.len() > MAX_VERTICES
        || body.faces.len() > MAX_TRIANGLES
    {
        return Err(no("input-resource-limit"));
    }
    let checked = body.clone().check().map_err(|_| no("invalid-wc0"))?;
    validate_circle_inputs(body)?;
    // Source-profile carriers and split endpoints are rounded observations.
    // Even rational predicates on those caches cannot determine their sweep.
    // The export boundary routes these through the shared exact-profile mesh.
    if crate::mesh::replayed_profile(&checked)?.is_some() {
        return Err(no("exact-source-profile-required"));
    }
    // Cap-band construction admits only exactly representable centres,
    // radii, ends and normals (fillet_rim_brep::center/radius and
    // Rim::offset_band). Replay above binds those WC0 literals to source;
    // they are exact geometry, unlike a plain profile's rounded witnesses.
    let normalized = body.clone();
    // A zero-angle rigid chart is an exact local translation inside its parent
    // frame (Builder::frame composes it); only a rotated one is unsupported.
    for frame in &normalized.frames {
        if let Frame::Rigid { angle, .. } = frame {
            if angle.get() != 0. {
                return Err(no("rotated-rigid-chart-unsupported"));
            }
        }
    }
    let mut builder = Builder {
        body: &normalized,
        mesh: Mesh::default(),
        face: 0,
        frames: BTreeMap::new(),
        edges: vec![],
        angles: vec![],
        n: 16,
        step: 0.,
        point_budget: deviation_mm / 4.,
    };
    let mut world_radius = 0.0f64;
    for surface in &normalized.surfaces {
        let radius = match &surface.geometry {
            SurfaceGeometry::Plane { .. } => continue,
            SurfaceGeometry::Cylinder { radius, .. } | SurfaceGeometry::Sphere { radius, .. } => {
                iv(radius.get())
            }
            SurfaceGeometry::Torus { major, minor, .. } => iv(major.get()) + iv(minor.get()),
            // A meridian cone's chord error is bounded by its wider meridian
            // point, whether the other bound is a ring or the zero-radius apex.
            SurfaceGeometry::ConeMeridian { start, end, .. } => iv(start[0].get().max(end[0].get())),
            SurfaceGeometry::Cone { .. } | SurfaceGeometry::ConeSlope { .. } => return Err(no("cone-trims-unsupported")),
            // The curved mesher has no swept-spline chart; refuse instead of a polygon stand-in.
            SurfaceGeometry::LinearExtrusion { .. } => return Err(no("extrusion-mesh-unsupported")),
        };
        let frame = builder.frame(surface.frame)?;
        let mut square = iv(0.);
        for column in frame.enclosed_columns() {
            for v in column {
                square = square + v * v;
            }
        }
        let bound = finite(radius * square.sqrt() * iv(1000.))?;
        world_radius = world_radius.max(bound.hi());
    }
    for curve in &normalized.curves {
        if let CurveGeometry::VectorEllipse { cosine, sine, .. } = &curve.geometry {
            let frame = builder.frame(curve.frame)?;
            let mut scale2 = iv(0.);
            for column in frame.enclosed_columns() { for v in column { scale2 = scale2+v*v; } }
            let norm = |v: &Vector3| v.iter().fold(iv(0.), |s,x| s+iv(x.get())*iv(x.get())).sqrt();
            world_radius = world_radius.max(finite((norm(cosine)+norm(sine))*scale2.sqrt()*iv(1000.))?.hi());
        }
    }
    if world_radius <= 0. || !world_radius.is_finite() {
        return Err(no("curved-carrier-required"));
    }
    let tau = Iv {
        m: std::f64::consts::TAU,
        r: std::f64::consts::TAU.next_up() - std::f64::consts::TAU,
    };
    loop {
        let step = finite(tau / iv(builder.n as f64))?;
        let error = finite(iv(world_radius) * step * step / iv(2.))?;
        if error.hi() <= deviation_mm / 2. {
            builder.step = step.lo();
            break;
        }
        if builder.n >= MAX_ANGULAR {
            return Err(no("angular-resource-limit"));
        }
        builder.n *= 2;
    }
    builder.angles = (0..builder.n)
        .map(|j| sin_cos(iv(j as f64) / iv(builder.n as f64)))
        .collect::<R<_>>()?;
    builder.sample_edges()?;
    let mut face_ids = BTreeSet::new();
    for solid in &normalized.solids {
        for shell in &solid.shells {
            for face in &normalized.shells[shell.0 as usize].faces {
                if !face_ids.insert(face.0 as usize) {
                    return Err(no("repeated-shell-face"));
                }
            }
        }
    }
    if face_ids.len() != normalized.faces.len() {
        return Err(no("unowned-face"));
    }
    for id in face_ids {
        let face = &normalized.faces[id];
        builder.face = id as u32;
        match &normalized.surfaces[face.surface.0 as usize].geometry {
            SurfaceGeometry::Plane { .. } => builder.planar(face)?,
            SurfaceGeometry::Cylinder { .. } => builder.cylindrical(face)?,
            SurfaceGeometry::Sphere { .. } => builder.spherical(face)?,
            SurfaceGeometry::Torus { .. } => builder.toroidal(face)?,
            SurfaceGeometry::ConeMeridian { .. } => builder.conical(face)?,
            SurfaceGeometry::Cone { .. } | SurfaceGeometry::ConeSlope { .. } => return Err(no("cone-trims-unsupported")),
            SurfaceGeometry::LinearExtrusion { .. } => return Err(no("extrusion-mesh-unsupported")),
        }
    }
    let mut mesh = builder.mesh;
    mesh.brep_vertices = normalized.vertices.len();
    mesh.edges = builder
        .edges
        .iter()
        .map(|samples| MeshEdge {
            vertices: samples.ids.clone(),
            closed: samples.closed,
        })
        .collect();
    Ok(mesh)
}

#[cfg(test)]
#[path = "mesh_curved_tests.rs"]
mod tests;
