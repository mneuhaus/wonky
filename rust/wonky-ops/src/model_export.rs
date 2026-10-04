//! Outputs of the general Boolean's exact `Model` (boolean3d plan, strand
//! G11): AP214 STEP through the shared writer of `step.rs` (the preamble,
//! entity and rounding conventions S7's `step_carrier.rs` also uses) and a
//! chart-domain STL mesh.
//!
//! **Tube bands** (F2 rim blends): a torus band is written as
//! `TOROIDAL_SURFACE`, a sphere band or cap as `SPHERICAL_SURFACE`; its seam
//! is the exact meridian `CIRCLE` (tube radius, centred on the tube centre
//! circle) from the lower ring's vertex to the upper ring's vertex or the
//! pole. Its budget term is the disc term at the outer tube radius plus both
//! radii's rounding and the axial column's off-axis part times the tube
//! radius. The mesh samples the band in its (azimuth, tube angle) chart.
//!
//! **Partial patches** (F2 chains): a cylinder or torus chart rectangle
//! (`Model::rev_patch`) is written as its `CYLINDRICAL_SURFACE` or
//! `TOROIDAL_SURFACE` with its four bounded edges; a bounded circle edge is a
//! `CIRCLE` from its first to its second vertex. The budget term is the
//! band's (patch) or the ring's (arc). The mesh samples every bounded arc
//! once at equal angles and fills a patch with the chart grid spanned by
//! its edge samples, so neighbours share boundary vertices.
//!
//! **STEP.** Every carrier is written as its analytic entity: `PLANE`,
//! `CYLINDRICAL_SURFACE`, `CONICAL_SURFACE`, `LINE` and `CIRCLE`. Nothing is
//! converted to a polygon or a B-spline. A vertex-free ring (`Bounds::Ring`)
//! becomes a closed `EDGE_CURVE` on one `VERTEX_POINT` at the circle's chart
//! angle 0. A revolution band is written as one loop: its lower ring, an
//! exact seam `LINE` along the generator from that ring's vertex to the other
//! ring's vertex (or to the apex), the other ring, and the seam back. The
//! Onshape reference exports (fixtures/cad-acid/onshape) leave the seam out
//! (two one-edge bounds); OCCT 8.0 then builds its own seam as a B-spline
//! with a 1e-5 mm tolerance, an approximation this writer does not hand to
//! a reader. The seam exists only when both ring vertices lie on one
//! generator (decided exactly in the band frame); a ring charted elsewhere
//! (in a cutting plane's axes) is re-charted onto that generator when it is
//! provably the same circle (`ring_charts`); otherwise the export refuses
//! `export/model/seam-off-generator`. No pcurves and no
//! `SEAM_CURVE` are written: the 3D carriers are the only geometry, so there
//! is no second, rounded representation to disagree with them.
//!
//! **Export budget** (mm, stated in the header and the uncertainty measure).
//! Every written number is the correct rounding of an exact world value, or a
//! binary64 expression of such values whose error is bounded here:
//!
//! - vertices and carrier origins: half the binary64 gap per coordinate;
//! - a plane: its origin, plus the reach of the body times the normal's
//!   rounding (`DIRECTION_ERROR`);
//! - a circle with exact world radial images `r u`, `r v` written as
//!   `R (cos t x + sin t y)`: `|r u - R x| + |r v - R y|` plus the origin. This
//!   is the distance at every parameter, and it also covers a near-rigid
//!   placement (a binary64 rotation), whose exact image is an ellipse;
//! - a band: the circle term at its largest radius, the axial column's
//!   component off the written axis times the largest height, and for a cone
//!   the rounding of its semi-angle times its axial extent.
//!
//! The differences are evaluated in binary64 on correctly rounded exact values
//! and carry an explicit relative slack (`SLACK`): an observation bound in the
//! sense of `step_carrier`, never a decision. A placement whose radial images
//! are not orthogonal and equal within `NEAR_RIGID` refuses
//! `export/model/non-isometric-curved-image`; an ellipse is not written as a
//! circle.
//!
//! **STL.** Each ring is sampled once, on the written circle, with `N` points
//! chosen so that `R_max (1 - cos(2 pi / N)) <= deviation / 2`; a zipper
//! triangle of a band spans at most two sample gaps, so its distance from the
//! carrier is at most that bound. The other half of the deviation is the STL
//! float32 rounding checked by `mesh::binary_stl`. Planar faces are
//! triangulated in their chart with the ring samples of their boundary, so
//! shared rings and segments share mesh vertices and the result is checked
//! watertight (`mesh::check_watertight`).
use crate::mesh::{check_watertight, Mesh, MeshEdge};
use crate::polyhedron::Refused;
use crate::step::{begin, finish, normalized, real, text, Writer};
use num_traits::{Signed, Zero};
use wonky_curve::numeric::exact_root;
use wonky_curve::radical::Radical;
use wonky_geom::frame::Frame;
use wonky_geom::model::algebraic::{lift, observe, RPoint};
use wonky_geom::model::curved::Patch;
use wonky_geom::model::{AtanSum, Bounds, Carrier3, Curve3, FaceId, Model, PiValue, Profile, SurdPiValue, RadicalTubeBand, RevPatch, VertexId, VertexKey};
use wonky_geom::{cross, dot, Point, Q};

type R<T> = std::result::Result<T, Refused>;
fn no<T>(what: &str) -> R<T> {
    Err(Refused(format!("export/model/{what}")))
}
fn geom(e: wonky_geom::Refused) -> Refused {
    Refused(e.0.into())
}

/// Error of a written unit direction (normalised from a correctly rounded
/// vector, then printed with round-trip digits), as a length per unit.
pub const DIRECTION_ERROR: f64 = 8.0 * f64::EPSILON;
/// Relative slack on every binary64-evaluated budget term.
const SLACK: f64 = 1.0 + 1e-9;
/// Largest admitted defect of the radial images from a similarity, relative
/// to their length (a binary64 rotation has a few ulps).
pub const NEAR_RIGID: f64 = 1e-9;

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn obs(p: &Point) -> R<[f64; 3]> {
    observe(&lift(p)).map_err(geom)
}
fn obs1(x: &Q) -> R<f64> {
    Ok(obs(&[x.clone(), Q::zero(), Q::zero()])?[0])
}
/// The correctly rounded binary64 of a number in a quadratic field.
fn obsr(x: &Radical) -> R<f64> {
    Ok(observe(&[x.clone(), Radical::default(), Radical::default()]).map_err(geom)?[0])
}
fn rguard<T>(f: impl FnOnce() -> T) -> R<T> {
    wonky_curve::radical::guard(f).map_err(|_| Refused("export/model/radical-budget".into()))
}
/// `frame.point([a, b, c])` with coordinates in a quadratic field.
fn rframe_point(frame: &Frame, local: &RPoint) -> R<RPoint> {
    rguard(|| {
        std::array::from_fn(|i| {
            (0..3).fold(Radical::from(frame.origin()[i].clone()), |v, j| v + &local[j] * &frame.columns()[j][i])
        })
    })
}
fn scale(p: &Point, s: &Q) -> Point {
    p.clone().map(|x| x * s)
}
fn fsub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn fdot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn fcross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn fscale(a: [f64; 3], s: f64) -> [f64; 3] {
    a.map(|x| x * s)
}
fn fadd(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn norm(a: [f64; 3]) -> f64 {
    fdot(a, a).sqrt()
}
/// Bound on `|round(x) - x|` for each coordinate, as a length.
fn rounding(p: [f64; 3]) -> f64 {
    let gap = |r: f64| 0.5 * (r.next_up() - r).max(r - r.next_down());
    p.iter().map(|&x| gap(x)).fold(0.0, f64::hypot)
}

/// The exact map from the model frame to world millimetres.
struct World {
    mm: Frame,
    reflect: bool,
}
impl World {
    fn of(m: &Model) -> R<Self> {
        let p = &m.draft().placement;
        let k = q(1000);
        let mm = Frame::new(scale(p.origin(), &k), p.columns().clone().map(|c| scale(&c, &k))).map_err(geom)?;
        let [x, y, z] = p.columns();
        Ok(Self { mm, reflect: dot(x, &cross(y, z)).is_negative() })
    }
    fn vertex(&self, key: &VertexKey) -> R<[f64; 3]> {
        match key {
            VertexKey::Rational(p) => obs(&self.mm.point(p)),
            VertexKey::Quadratic(p) => observe(p.mapped(&self.mm).map_err(geom)?.coordinates()).map_err(geom),
            VertexKey::Real(p)=>observe(&wonky_geom::model::algebraic::mapped(p,&self.mm)).map_err(geom),
        }
    }
    fn rvector(&self, v: &RPoint) -> RPoint {
        let c = self.mm.columns();
        std::array::from_fn(|i| (0..3).fold(Radical::default(), |s, j| s + v[j].clone() * &c[j][i]))
    }
    fn rpoint(&self, p: &RPoint) -> RPoint {
        let v = self.rvector(p);
        std::array::from_fn(|i| v[i].clone() + &self.mm.origin()[i])
    }
}

/// A written circular cross-section: the circle of `frame` (model frame)
/// with radius `r`, in world millimetres.
struct Disc {
    center: [f64; 3],
    z: [f64; 3],
    x: [f64; 3],
    y: [f64; 3],
    /// World length of the frame's radial unit, `|u|`.
    unit: f64,
    /// Bound on the radial frame error per unit radius (dimensionless).
    radial: f64,
    /// Bound on the written centre's error.
    center_error: f64,
    /// The world image of the third column, and its part off `z`.
    w: [f64; 3],
    w_off: f64,
}
impl Disc {
    fn of(world: &World, frame: &Frame) -> R<Self> {
        Self::lifted(world, frame, &Radical::default())
    }
    /// The disc of the circle of `frame` lifted to local height `height`
    /// (a Q(√d) latitude ring); the centre is observed from its exact value.
    fn lifted(world: &World, frame: &Frame, height: &Radical) -> R<Self> {
        let [c0, c1, c2] = frame.columns();
        let (u, v, w) = (world.mm.vector(c0), world.mm.vector(c1), world.mm.vector(c2));
        let center = world.rpoint(&rframe_point(frame, &[Radical::default(), Radical::default(), height.clone()])?);
        let (uu, vv, uv) = (dot(&u, &u), dot(&v, &v), dot(&u, &v));
        let uu_f = obs1(&uu)?;
        let unit = uu_f.sqrt();
        // A similarity within NEAR_RIGID, or an ellipse that is refused.
        let defect = (obs1(&(&vv - &uu))?.abs() + 2.0 * obs1(&uv)?.abs()) / uu_f;
        if !(defect <= NEAR_RIGID) {
            return no("non-isometric-curved-image");
        }
        let z = normalized(obs(&cross(&u, &v))?)?;
        let x = normalized(obs(&u)?)?;
        let y = fcross(z, x);
        let (uf, vf, wf) = (obs(&u)?, obs(&v)?, obs(&w)?);
        let radial = (norm(fsub(fscale(uf, 1.0 / unit), x)) + norm(fsub(fscale(vf, 1.0 / unit), y)) + 4.0 * DIRECTION_ERROR) * SLACK;
        let center_f = observe(&center).map_err(geom)?;
        let w_par = fdot(wf, z);
        let w_off = (norm(fsub(wf, fscale(z, w_par))) + norm(wf) * DIRECTION_ERROR) * SLACK;
        Ok(Self { center: center_f, z, x, y, unit, radial, center_error: rounding(center_f), w: wf, w_off })
    }
    /// The written radius of carrier radius `r` (correctly rounded square
    /// root of the correctly rounded `r^2 |u|^2`), and its error bound.
    fn radius_q(&self, world: &World, frame: &Frame, r: &Q) -> R<(f64, f64)> {
        self.radius(world, frame, &Radical::from(r.clone()))
    }
    fn radius(&self, world: &World, frame: &Frame, r: &Radical) -> R<(f64, f64)> {
        let u = world.mm.vector(&frame.columns()[0]);
        let r2 = rguard(|| r * r * dot(&u, &u))?;
        let radius = obsr(&r2)?.sqrt();
        Ok((radius, 2.0 * f64::EPSILON * radius))
    }
    /// The point at chart angle `t` of the written circle of radius `radius`.
    fn at(&self, radius: f64, t: f64) -> [f64; 3] {
        fadd(self.center, fadd(fscale(self.x, radius * t.cos()), fscale(self.y, radius * t.sin())))
    }
}

/// The exact ring vertex: the circle point at chart angle 0, `O + r c0`.
fn ring_vertex(world: &World, frame: &Frame, height: &Radical, r: &Radical) -> R<[f64; 3]> {
    observe(&world.rpoint(&rframe_point(frame, &[r.clone(), Radical::default(), height.clone()])?)).map_err(geom)
}

/// A ring's frame, local height and radius (rational, or in one quadratic
/// field for a cone-rim spring).
fn circle_of(c: &Curve3) -> R<(&Frame, Radical, Radical)> {
    match c {
        Curve3::TranslatedCircle(_) => no("translated-circle-ring-unsupported"),
        Curve3::Circle(c) => Ok((
            c.frame().map_err(geom)?,
            Radical::default(),
            Radical::from(exact_root(&c.radius2()).ok_or_else(|| Refused("export/model/circle-radius".into()))?),
        )),
        Curve3::RadicalCircle(c) => Ok((&c.frame, c.height().clone(), c.radius().clone())),
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => no("ring-on-open-curve"),
    }
}

/// A revolution band as written: the carrier frame's disc, the meridian
/// `rho(h) = m0 + m1 h` (carrier units) and the height range.
struct Band {
    disc: Disc,
    m: [Radical; 2],
    lo: Radical,
    hi: Radical,
    forward: bool,
    /// Written radius at `lo` and `hi`, mm.
    radii: [f64; 2],
    /// d rho / d t along `disc.z` (world), and the error bound of the band.
    slope: f64,
    error: f64,
}
fn is_tube(m: &Model, face: FaceId) -> bool {
    let d = m.draft();
    matches!(d.surfaces[d.faces[face.index()].surface.index()].carrier, Carrier3::Torus(_) | Carrier3::Sphere(_))
}
fn band(world: &World, m: &Model, face: FaceId) -> R<Option<Band>> {
    if is_tube(m, face) {
        return Ok(None);
    }
    let Some(b) = m.radical_band(face).map_err(geom)? else { return Ok(None) };
    let disc = Disc::of(world, &b.frame)?;
    let [m0, m1] = b.radius.clone();
    let rho = |h: &Radical| rguard(|| &m0 + &(&m1 * h));
    let (r_lo, e_lo) = disc.radius(world, &b.frame, &rho(&b.lo)?)?;
    let (r_hi, e_hi) = disc.radius(world, &b.frame, &rho(&b.hi)?)?;
    let w_par = fdot(disc.w, disc.z);
    if w_par == 0.0 {
        return no("band-axis");
    }
    let slope = obsr(&m1)? * disc.unit / w_par;
    let extent = (obsr(&rguard(|| &b.hi - &b.lo)?)? * w_par).abs();
    let reach = obsr(&b.lo)?.abs().max(obsr(&b.hi)?.abs());
    let r_max = r_lo.max(r_hi);
    let angle = if m1.is_zero() {
        0.0
    } else {
        // atan and its printing: a few ulps of the angle; tan' = 1 + tan^2.
        let a = slope.abs().atan();
        extent * (1.0 + slope * slope) * 8.0 * f64::EPSILON * a.max(1.0)
    };
    let error = (disc.center_error + r_max * disc.radial + e_lo.max(e_hi) + reach * disc.w_off + angle) * SLACK;
    Ok(Some(Band { disc, m: [m0, m1], lo: b.lo, hi: b.hi, forward: b.forward, radii: [r_lo, r_hi], slope, error }))
}

/// A tube band as written: the carrier disc, both radii (mm) and the exact
/// band, with its error bound.
struct Tube {
    disc: Disc,
    band: RadicalTubeBand,
    major: f64,
    minor: f64,
    /// Tube angles of the band ends (radians, observation only).
    theta: [f64; 2],
    /// Written seam circle centre and the pole, when a cap ends at one.
    seam_center: [f64; 3],
    pole: Option<[f64; 3]>,
    error: f64,
}
fn tube(world: &World, m: &Model, face: FaceId) -> R<Option<Tube>> {
    let Some(b) = m.radical_tube_band(face).map_err(geom)? else { return Ok(None) };
    let disc = Disc::of(world, &b.frame)?;
    let (major, e_major) = if b.major.is_zero() { (0.0, 0.0) } else { disc.radius(world, &b.frame, &b.major)? };
    let (minor, e_minor) = disc.radius_q(world, &b.frame, &b.minor)?;
    let base = match b.patch {
        Patch::First => 0.0,
        Patch::Second => std::f64::consts::PI,
    };
    let theta = [obsr(&b.lo)?, obsr(&b.hi)?].map(|t| base + 2.0 * t.atan());
    let seam_center = observe(&world.rpoint(&rframe_point(&b.frame, &[b.major.clone(), Radical::default(), Radical::default()])?)).map_err(geom)?;
    let d = m.draft();
    let pole = if d.faces[face.index()].loops.len() == 1 {
        let z = if b.hi == Q::from_integer(1.into()) { b.minor.clone() } else { -b.minor.clone() };
        Some(obs(&world.mm.point(&b.frame.point(&[Q::zero(), Q::zero(), z])))?)
    } else {
        None
    };
    let error = (disc.center_error + (major + minor) * disc.radial + e_major + e_minor + minor * disc.w_off) * SLACK;
    Ok(Some(Tube { disc, band: b, major, minor, theta, seam_center, pole, error }))
}
/// A partial revolution patch as written: the carrier disc, its radii (mm;
/// the cylinder radius, the torus major and minor, or the cone radii at the
/// patch's lower and upper chart heights) and the error bound of a band with
/// the same reach.
struct PatchW {
    disc: Disc,
    patch: RevPatch,
    radii: [f64; 2],
    /// d rho / d t along `disc.z` (world) on a cone; 0 otherwise.
    slope: f64,
    error: f64,
}
fn patch(world: &World, m: &Model, face: FaceId) -> R<Option<PatchW>> {
    let Some(p) = m.rev_patch(face).map_err(geom)? else { return Ok(None) };
    let disc = Disc::of(world, &p.frame)?;
    let mut slope = 0.0;
    let (radii, error) = match &p.profile {
        Profile::Cylinder { radius } => {
            let (r, e) = disc.radius_q(world, &p.frame, radius)?;
            let reach = obs1(&p.v[0])?.abs().max(obs1(&p.v[1])?.abs());
            ([r, 0.0], disc.center_error + r * disc.radial + e + reach * disc.w_off)
        }
        Profile::Torus { major, minor } => {
            let (a, ea) = disc.radius_q(world, &p.frame, major)?;
            let (b, eb) = disc.radius_q(world, &p.frame, minor)?;
            ([a, b], disc.center_error + (a + b) * disc.radial + ea + eb + b * disc.w_off)
        }
        Profile::Cone { radius, slope: k } => {
            // As a band of the same reach (see `band`).
            let rho = |h: &Q| radius + k * h;
            let (lo, e_lo) = disc.radius_q(world, &p.frame, &rho(&p.v[0]))?;
            let (hi, e_hi) = disc.radius_q(world, &p.frame, &rho(&p.v[1]))?;
            let w_par = fdot(disc.w, disc.z);
            if w_par == 0.0 {
                return no("band-axis");
            }
            slope = obs1(k)? * disc.unit / w_par;
            let extent = (obs1(&(&p.v[1] - &p.v[0]))? * w_par).abs();
            let reach = obs1(&p.v[0])?.abs().max(obs1(&p.v[1])?.abs());
            let angle = extent * (1.0 + slope * slope) * 8.0 * f64::EPSILON * slope.abs().atan().max(1.0);
            ([lo, hi], disc.center_error + lo.max(hi) * disc.radial + e_lo.max(e_hi) + reach * disc.w_off + angle)
        }
    };
    Ok(Some(PatchW { disc, patch: p, radii, slope, error: error * SLACK }))
}
/// A strip face (a cylinder face bounded by rulings and latitude arcs in
/// its half-angle chart, boolean3d G12b), written on its cylinder.
struct StripW {
    disc: Disc,
    radius: f64,
    error: f64,
}
fn strip(world: &World, m: &Model, face: FaceId) -> R<Option<StripW>> {
    let d = m.draft();
    let f = &d.faces[face.index()];
    let Carrier3::Cylinder(c) = &d.surfaces[f.surface.index()].carrier else { return Ok(None) };
    if !m.is_strip(face) || m.rev_patch(face).map_err(geom)?.is_some() {
        return Ok(None);
    }
    let frame = c.frame().map_err(geom)?;
    let disc = Disc::of(world, frame)?;
    let r = exact_root(&c.radius2()).ok_or_else(|| Refused("export/model/strip-radius".into()))?;
    let (radius, e) = disc.radius_q(world, frame, &r)?;
    // The chart heights of the loop bound the axial reach.
    let mut reach = 0.0f64;
    for l in &f.loops {
        for co in &d.loops[l.index()].coedges {
            for end in d.coedges[co.index()].pcurve.ends() {
                reach = reach.max(obsr(&end.coordinates()[1])?.abs());
            }
        }
    }
    let error = (disc.center_error + radius * disc.radial + e + reach * disc.w_off) * SLACK;
    Ok(Some(StripW { disc, radius, error }))
}
/// Angle (radians, observation only) of a half-angle chart value.
fn chart_angle(patch: Patch, t: &Q) -> R<f64> {
    let base = match patch {
        Patch::First => 0.0,
        Patch::Second => std::f64::consts::PI,
    };
    Ok(base + 2.0 * obs1(t)?.atan())
}

/// The tube-angle chart value of a ring of a tube face, from its loop.
fn tube_ring_lo(m: &Model, t: &Tube, edge: usize) -> R<bool> {
    let d = m.draft();
    let (frame, height, _) = circle_of(&d.curves[d.edges[edge].curve.index()].geometry)?;
    // The ring centre's local height, and the band ends' heights a·sin θ.
    let center = rframe_point(frame, &[Radical::default(), Radical::default(), height])?;
    let h = rframe_point(&t.band.frame.inverse(), &center)?[2].clone();
    let sign = match t.band.patch {
        Patch::First => q(1),
        Patch::Second => q(-1),
    };
    let sin = |t: &Radical| rguard(|| t * &(q(2) * &sign) / &(Radical::from(Q::from_integer(1.into())) + t * t));
    let (z_lo, z_hi) = (rguard(|| sin(&t.band.lo).map(|s| &s * &t.band.minor))??, rguard(|| sin(&t.band.hi).map(|s| &s * &t.band.minor))??);
    if h == z_lo && h != z_hi {
        Ok(true)
    } else if h == z_hi && h != z_lo {
        Ok(false)
    } else {
        no("tube-ring-end")
    }
}

/// One written ring: its vertex, the circle and the error bound.
struct Ring {
    vertex: [f64; 3],
    disc: Disc,
    radius: f64,
    error: f64,
}
fn ring(world: &World, c: &Chart) -> R<Ring> {
    let disc = Disc::lifted(world, &c.frame, &c.height)?;
    let (radius, e) = disc.radius(world, &c.frame, &c.r)?;
    let error = (disc.center_error + radius * disc.radial + e) * SLACK;
    Ok(Ring { vertex: ring_vertex(world, &c.frame, &c.height, &c.r)?, disc, radius, error })
}

/// Everything the writer and the mesher read, with the declared budget.
struct Plan {
    world: World,
    vertices: Vec<[f64; 3]>,
    rings: Vec<Option<Ring>>,
    bands: Vec<Option<Band>>,
    tubes: Vec<Option<Tube>>,
    patches: Vec<Option<PatchW>>,
    strips: Vec<Option<StripW>>,
    /// Bounded circle edges, written like rings.
    arcs: Vec<Option<Ring>>,
    /// Per band face: the seam from ring edge `from` to `to`.
    seams: Vec<Option<Seam>>,
    budget: f64,
}

/// A band's seam: a generator from the vertex of ring edge `from` to the
/// vertex of ring edge `to`, or to the cone's apex.
struct Seam {
    from: usize,
    to: SeamEnd,
}
enum SeamEnd {
    Ring(usize),
    Apex([f64; 3]),
}

/// A ring's chart: its circle's frame, local height and radius (rational,
/// or in one quadratic field for a cone-rim spring).
#[derive(Clone, Debug)]
struct Chart {
    frame: Frame,
    height: Radical,
    r: Radical,
}
impl Chart {
    fn of(c: &Curve3) -> R<Self> {
        let (frame, height, r) = circle_of(c)?;
        Ok(Self { frame: frame.clone(), height, r })
    }
    /// The ring vertex (chart angle 0) in the model frame, exactly.
    fn point(&self) -> R<RPoint> {
        rframe_point(&self.frame, &[self.r.clone(), Radical::default(), self.height.clone()])
    }
}
fn rational_point(p: &RPoint) -> Option<Point> {
    Some([p[0].rational()?, p[1].rational()?, p[2].rational()?])
}
fn ring_edges(m: &Model, fi: usize) -> Vec<usize> {
    let d = m.draft();
    d.faces[fi].loops.iter().map(|l| d.coedges[d.loops[l.index()].coedges[0].index()].edge.index()).collect()
}
/// Both chart points on one generator of a band (`local`: its inverse
/// frame): their radial parts in the band frame are positively parallel.
fn one_generator(local: &Frame, a: &RPoint, c: &RPoint) -> R<bool> {
    let (pa, pc) = (rframe_point(local, a)?, rframe_point(local, c)?);
    let (cross, along) = rguard(|| (&pa[0] * &pc[1] - &pa[1] * &pc[0], &pa[0] * &pc[0] + &pa[1] * &pc[1]))?;
    Ok(cross.is_zero() && along.is_positive())
}
/// The chart each ring edge is written in: its circle's own frame, unless a
/// revolution band's two rings put their chart-angle-0 points on different
/// generators (a ring cut by a plane is charted in that plane's axes). Then
/// one ring not yet bound to another band is re-charted onto the generator
/// through the other's point: the band's radial axes rotated to that
/// direction, with the ring's own centre and sense. The re-chart is admitted
/// only when it is exactly the same circle (a similarity image of its radial
/// axes with a rational radius whose chart points lie on it); otherwise the
/// seam refuses as before. Rings already on one generator keep their chart.
fn ring_charts(m: &Model) -> R<Vec<Option<Chart>>> {
    let d = m.draft();
    let mut charts = d.edges.iter().map(|e| match e.bounds {
        Bounds::Ring => Chart::of(&d.curves[e.curve.index()].geometry).map(Some),
        Bounds::Segment(_) => Ok(None),
    }).collect::<R<Vec<_>>>()?;
    // A tube face writes its seam from its rings' own chart points: never move them.
    let mut bound = vec![false; d.edges.len()];
    for fi in (0..d.faces.len()).filter(|&fi| is_tube(m, FaceId(fi as u32))) {
        for e in ring_edges(m, fi) {
            bound[e] = true;
        }
    }
    for fi in 0..d.faces.len() {
        if is_tube(m, FaceId(fi as u32)) {
            continue;
        }
        let Some(b) = m.radical_band(FaceId(fi as u32)).map_err(geom)? else { continue };
        let [a, c] = ring_edges(m, fi)[..] else { continue };
        let (Some(ca), Some(cc)) = (&charts[a], &charts[c]) else { continue };
        let local = b.frame.inverse();
        if !one_generator(&local, &ca.point()?, &cc.point()?)? {
            let (keep, moved) = match (bound[a], bound[c]) {
                (_, false) => (a, c),
                (false, true) => (c, a),
                (true, true) => return no("seam-off-generator"),
            };
            let toward = rframe_point(&local, &charts[keep].as_ref().expect("ring chart").point()?)?;
            charts[moved] = Some(rechart(&b.frame, &toward, charts[moved].as_ref().expect("ring chart"))?);
        }
        bound[a] = true;
        bound[c] = true;
    }
    Ok(charts)
}
/// The circle `old` charted on the band's radial axes turned toward the band
/// point `toward` (band coordinates), exactly the same point set and sense.
/// Only rational charts (rational height and radius, toward a rational
/// point) are re-charted; a ring with Q(√d) data refuses as an unmovable
/// seam.
fn rechart(band: &Frame, toward: &RPoint, old: &Chart) -> R<Chart> {
    let off = || Refused("export/model/seam-off-generator".into());
    let toward = rational_point(toward).ok_or_else(off)?;
    let (old_r, height) = (old.r.rational().ok_or_else(off)?, old.height.rational().ok_or_else(off)?);
    let local = band.inverse();
    let at = local.point(&old.frame.point(&[old_r.clone(), Q::zero(), height.clone()]));
    let center = old.frame.point(&[Q::zero(), Q::zero(), height.clone()]);
    let (px, py) = (&toward[0], &toward[1]);
    let keep2 = px * px + py * py;
    if keep2.is_zero() || local.point(&center)[..2].iter().any(|v| !v.is_zero()) {
        return Err(off());
    }
    let r = exact_root(&((&at[0] * &at[0] + &at[1] * &at[1]) / &keep2)).ok_or_else(off)?;
    let x = band.vector(&[px.clone(), py.clone(), Q::zero()]);
    let mut y = band.vector(&[-py.clone(), px.clone(), Q::zero()]);
    let mut z = band.columns()[2].clone();
    // Keep the circle's sense: the old chart's x -> y turn.
    let inverse = old.frame.inverse();
    let turn = |x: &Point, y: &Point| {
        let (u, v) = (inverse.vector(x), inverse.vector(y));
        &u[0] * &v[1] - &u[1] * &v[0]
    };
    if turn(&x, &y).is_negative() {
        y = y.map(|v| -v);
        z = z.map(|v| -v);
    }
    let (u, v) = (inverse.vector(&x), inverse.vector(&y));
    let similar = u[2].is_zero() && v[2].is_zero()
        && (&u[0] * &v[0] + &u[1] * &v[1]).is_zero()
        && &u[0] * &u[0] + &u[1] * &u[1] == &v[0] * &v[0] + &v[1] * &v[1]
        && turn(&x, &y).is_positive();
    let frame = Frame::new(center, [x, y, z]).map_err(|_| off())?;
    let on_circle = [[r.clone(), Q::zero(), Q::zero()], [Q::zero(), r.clone(), Q::zero()]].iter().all(|p| {
        let l = inverse.point(&frame.point(p));
        l[2] == height && &l[0] * &l[0] + &l[1] * &l[1] == &old_r * &old_r
    });
    if !similar || !on_circle {
        return Err(off());
    }
    Ok(Chart { frame, height: Radical::default(), r: Radical::from(r) })
}

fn seam(world: &World, m: &Model, fi: usize, charts: &[Option<Chart>]) -> R<Option<Seam>> {
    if is_tube(m, FaceId(fi as u32)) {
        return Ok(None);
    }
    let Some(b) = m.radical_band(FaceId(fi as u32)).map_err(geom)? else { return Ok(None) };
    let d = m.draft();
    let ring_edge = |l: &wonky_geom::model::LoopId| d.coedges[d.loops[l.index()].coedges[0].index()].edge.index();
    match &d.faces[fi].loops[..] {
        [a] => {
            if b.radius[1].is_zero() {
                return no("band-loops");
            }
            let apex = rguard(|| -(&b.radius[0] / &b.radius[1]))?;
            let point = observe(&world.rpoint(&rframe_point(&b.frame, &[Radical::default(), Radical::default(), apex])?)).map_err(geom)?;
            Ok(Some(Seam { from: ring_edge(a), to: SeamEnd::Apex(point) }))
        }
        [a, c] => {
            let (a, c) = (ring_edge(a), ring_edge(c));
            let point = |e: usize| charts[e].as_ref().ok_or_else(|| Refused("export/model/edge-plan".into()))?.point();
            if !one_generator(&b.frame.inverse(), &point(a)?, &point(c)?)? {
                return no("seam-off-generator");
            }
            Ok(Some(Seam { from: a, to: SeamEnd::Ring(c) }))
        }
        _ => no("band-loops"),
    }
}
fn f_index(d: &wonky_geom::model::Draft, f: &wonky_geom::model::Face) -> u32 {
    d.faces.iter().position(|g| std::ptr::eq(g, f)).expect("face of this draft") as u32
}
fn plan(m: &Model) -> R<Plan> {
    let d = m.draft();
    let world = World::of(m)?;
    let vertices = (0..d.vertices.len()).map(|i| world.vertex(m.key(VertexId(i as u32)))).collect::<R<Vec<_>>>()?;
    let charts = ring_charts(m)?;
    let rings = charts.iter().map(|c| c.as_ref().map(|c| ring(&world, c)).transpose()).collect::<R<Vec<_>>>()?;
    let mut arcs = Vec::with_capacity(d.edges.len());
    for e in &d.edges {
        arcs.push(match (e.bounds, &d.curves[e.curve.index()].geometry) {
            (Bounds::Segment(_), Curve3::Circle(_) | Curve3::RadicalCircle(_)) => Some(ring(&world, &Chart::of(&d.curves[e.curve.index()].geometry)?)?),
            _ => None,
        });
    }
    let bands = (0..d.faces.len()).map(|f| band(&world, m, FaceId(f as u32))).collect::<R<Vec<_>>>()?;
    let tubes = (0..d.faces.len()).map(|f| tube(&world, m, FaceId(f as u32))).collect::<R<Vec<_>>>()?;
    let patches = (0..d.faces.len()).map(|f| patch(&world, m, FaceId(f as u32))).collect::<R<Vec<_>>>()?;
    let strips = (0..d.faces.len()).map(|f| strip(&world, m, FaceId(f as u32))).collect::<R<Vec<_>>>()?;
    for ((((f, b), t), pw), sw) in d.faces.iter().zip(&bands).zip(&tubes).zip(&patches).zip(&strips) {
        if b.is_none() && pw.is_none() && sw.is_none() {
            match &d.surfaces[f.surface.index()].carrier {
        Carrier3::TranslatedCylinder(_) => return no("translated-cylinder-export-unsupported"),
                Carrier3::Plane(_) | Carrier3::RadicalPlane(_) => {}
                Carrier3::Cylinder(_) | Carrier3::Cone(_) => return no("band-missing"),
                Carrier3::Rotated(_) => return no("rotated-unsupported"),
                Carrier3::Sphere(_) | Carrier3::Torus(_) => {
                    if t.is_none() && !m.is_sphere_patch(FaceId(f_index(d, f))) {
                        return no("tube-missing");
                    }
                }
            }
        }
    }
    let seams = (0..d.faces.len()).map(|f| seam(&world, m, f, &charts)).collect::<R<Vec<_>>>()?;
    let apexes = seams.iter().flatten().filter_map(|s| match &s.to {
        SeamEnd::Apex(p) => Some(p),
        SeamEnd::Ring(_) => None,
    });
    let poles = tubes.iter().flatten().filter_map(|t| t.pole.as_ref());
    let points = vertices.iter().chain(rings.iter().flatten().map(|r| &r.vertex)).chain(apexes).chain(poles);
    let reach = points.clone().flatten().fold(0.0f64, |a, &x| a.max(x.abs()));
    let vertex = points.map(|&p| rounding(p)).fold(0.0f64, f64::max);
    let planar = vertex + reach * DIRECTION_ERROR * 2.0;
    let curved = rings
        .iter()
        .flatten()
        .map(|r| r.error)
        .chain(bands.iter().flatten().map(|b| b.error))
        .chain(tubes.iter().flatten().map(|t| t.error))
        .chain(patches.iter().flatten().map(|t| t.error))
        .chain(strips.iter().flatten().map(|t| t.error))
        .chain(arcs.iter().flatten().map(|r| r.error))
        .fold(0.0f64, f64::max);
    let budget = (2.0 * (reach.next_up() - reach)).max(planar).max(curved).max(f64::MIN_POSITIVE);
    if !budget.is_finite() {
        return no("budget-range");
    }
    Ok(Plan { world, vertices, rings, bands, tubes, patches, strips, arcs, seams, budget })
}

/// The declared export budget (mm) of a Model.
pub fn budget_mm(m: &Model) -> R<f64> {
    Ok(plan(m)?.budget)
}

fn plane_frame(world: &World, carrier: &Carrier3) -> R<([f64; 3], [f64; 3], [f64; 3])> {
    let (o, x, n) = match carrier {
        Carrier3::Plane(p) => (lift(&p.o), lift(&p.x), lift(&p.n)),
        Carrier3::Rotated(_) => return no("rotated-unsupported"),
        Carrier3::RadicalPlane(p) => (p.o.clone(), p.x.clone(), p.n.clone()),
        Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => return no("plane-expected"),
    };
    use wonky_geom::model::algebraic::cross as rcross;
    let y = rcross(&n, &x);
    let (wx, wy) = (world.rvector(&x), world.rvector(&y));
    let normal = observe(&rcross(&wx, &wy)).map_err(geom)?;
    let origin = observe(&world.rpoint(&o)).map_err(geom)?;
    Ok((origin, normalized(normal)?, normalized(observe(&wx).map_err(geom)?)?))
}

/// Coedge uses of one loop in written order: (edge, orientation). A
/// reflecting placement reverses every loop (a reflection reverses the
/// sense of each boundary about its outward normal).
fn uses(m: &Model, world: &World, l: wonky_geom::model::LoopId) -> Vec<(usize, bool)> {
    let d = m.draft();
    let mut u: Vec<_> = d.loops[l.index()].coedges.iter().map(|c| {
        let c = &d.coedges[c.index()];
        (c.edge.index(), c.forward != world.reflect)
    }).collect();
    if world.reflect {
        u.reverse();
    }
    u
}

#[cfg(not(feature = "plant_step_model_circle_bspline"))]
fn emit_circle(w: &mut Writer, r: &Ring) -> String {
    let place = w.placement(r.disc.center, r.disc.z, r.disc.x);
    w.entity(format!("CIRCLE('',{place},{})", real(r.radius)))
}
/// PLANTED NEGATIVE (wrong on purpose): the circle as an unlabelled
/// rational quadratic B-spline (nine controls, the exact circle). The point
/// set is the same; a reader no longer sees a circle, which the OCCT and
/// FreeCAD curve-type assertions must catch.
#[cfg(feature = "plant_step_model_circle_bspline")]
fn emit_circle(w: &mut Writer, r: &Ring) -> String {
    let s = std::f64::consts::FRAC_1_SQRT_2;
    let corners = [(1., 0.), (1., 1.), (0., 1.), (-1., 1.), (-1., 0.), (-1., -1.), (0., -1.), (1., -1.), (1., 0.)];
    let points: Vec<String> = corners
        .iter()
        .map(|&(a, b)| w.point(fadd(r.disc.center, fadd(fscale(r.disc.x, a * r.radius), fscale(r.disc.y, b * r.radius)))))
        .collect();
    let weights: Vec<String> = (0..9).map(|i| real(if i % 2 == 1 { s } else { 1.0 })).collect();
    w.entity(format!(
        "(BOUNDED_CURVE() B_SPLINE_CURVE(2,({}),.UNSPECIFIED.,.F.,.F.) B_SPLINE_CURVE_WITH_KNOTS((3,2,2,2,3),(0.,0.25,0.5,0.75,1.),.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_CURVE(({})) REPRESENTATION_ITEM(''))",
        points.join(","),
        weights.join(",")
    ))
}

fn append(w: &mut Writer, id: &str, m: &Model, p: &Plan) -> R<Vec<String>> {
    let d = m.draft();
    let vertices: Vec<String> = p.vertices.iter().map(|&v| {
        let point = w.point(v);
        w.entity(format!("VERTEX_POINT('',{point})"))
    }).collect();
    // Sphere patch faces: their written surface and iso-line chart come
    // first, so that every arc on them carries its exact LINE pcurve.
    let mut patch_surfaces: Vec<Option<(String, IsoChart)>> = vec![];
    for (fi, f) in d.faces.iter().enumerate() {
        if !m.is_sphere_patch(FaceId(fi as u32)) {
            patch_surfaces.push(None);
            continue;
        }
        let Carrier3::Sphere(s) = &d.surfaces[f.surface.index()].carrier else { return no("sphere-carrier") };
        let disc = Disc::of(&p.world, &s.frame)?;
        let radius = obs1(s.radius())? * disc.unit;
        let (k, z, x) = sphere_iso_chart(m, fi, s)?;
        let dir = |v: &Point| -> R<[f64; 3]> { normalized(obs(&p.world.mm.vector(&s.frame.vector(v)))?) };
        let (zw, xw) = (dir(&z)?, dir(&x)?);
        let place = w.placement(disc.center, zw, xw);
        let surface = w.entity(format!("SPHERICAL_SURFACE('',{place},{})", real(radius)));
        let poles = [1i64, -1].map(|sg| -> R<[f64; 3]> {
            let l: Point = std::array::from_fn(|c| &z[c] * s.radius() * q(sg));
            obs(&p.world.mm.point(&s.frame.point(&l)))
        });
        let chart = IsoChart { center: disc.center, radius, x: xw, y: fcross(zw, xw), z: zw, axis: k, poles: [poles[0].clone()?, poles[1].clone()?], sphere: s.clone() };
        patch_surfaces.push(Some((surface, chart)));
    }
    let mut edge_faces = vec![vec![]; d.edges.len()];
    for (fi, f) in d.faces.iter().enumerate() {
        for &l in &f.loops {
            for c in &d.loops[l.index()].coedges {
                edge_faces[d.coedges[c.index()].edge.index()].push(fi);
            }
        }
    }
    let ctx = if patch_surfaces.iter().any(Option::is_some) {
        w.entity("(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','surface parameters'))".into())
    } else {
        String::new()
    };
    // Pole vertices of split meridian arcs, shared by world point.
    let mut pole_vertices: Vec<([f64; 3], String)> = vec![];
    let mut edges = Vec::with_capacity(d.edges.len());
    // A meridian arc through a chart pole is written as pieces (smooth split
    // vertices at the poles); `tails` holds the pieces after the first.
    let mut tails: Vec<Vec<String>> = vec![vec![]; d.edges.len()];
    let mut ring_vertices = vec![None; d.edges.len()];
    for (i, e) in d.edges.iter().enumerate() {
        if let (Bounds::Segment([a, b]), Some(arc)) = (e.bounds, &p.arcs[i]) {
            if p.vertices[a.index()] == p.vertices[b.index()] {
                return no("edge-below-binary64-resolution");
            }
            let circle = emit_circle(w, arc);
            let on_patch = edge_faces[i].iter().filter_map(|&f| patch_surfaces[f].as_ref()).collect::<Vec<_>>();
            if on_patch.is_empty() {
                edges.push(w.entity(format!("EDGE_CURVE('',{},{},{circle},.T.)", vertices[a.index()], vertices[b.index()])));
                continue;
            }
            let angle = |v: [f64; 3]| {
                let v = fsub(v, arc.disc.center);
                fdot(v, arc.disc.y).atan2(fdot(v, arc.disc.x))
            };
            let (t0, mut t1) = (angle(p.vertices[a.index()]), angle(p.vertices[b.index()]));
            while t1 <= t0 {
                t1 += 2.0 * std::f64::consts::PI;
            }
            // Split points: chart poles strictly inside the arc (a pole that is
            // an end vertex is exactly one of its keys).
            let curve = &d.curves[e.curve.index()].geometry;
            let mut cuts: Vec<(f64, [f64; 3])> = vec![];
            for (_, chart) in &on_patch {
                let (axis, _, _) = wonky_geom::model::stereo::latitude_of(&chart.sphere, curve).map_err(geom)?;
                if axis == chart.axis {
                    continue;
                }
                for pole in chart.poles {
                    let ends = [p.vertices[a.index()], p.vertices[b.index()]];
                    if ends.iter().any(|v| norm(fsub(*v, pole)) <= 1e-9 * (1.0 + norm(pole))) {
                        continue;
                    }
                    let mut tp = angle(pole);
                    while tp <= t0 {
                        tp += 2.0 * std::f64::consts::PI;
                    }
                    if tp < t1 && !cuts.iter().any(|c| (c.0 - tp).abs() < 1e-12) {
                        cuts.push((tp, pole));
                    }
                }
            }
            cuts.sort_by(|x, y| x.0.total_cmp(&y.0));
            let mut stops = vec![(t0, vertices[a.index()].clone())];
            for (tp, pole) in &cuts {
                let vertex = match pole_vertices.iter().find(|(q2, _)| norm(fsub(*q2, *pole)) <= 1e-9 * (1.0 + norm(*pole))) {
                    Some((_, v)) => v.clone(),
                    None => {
                        let at = w.point(*pole);
                        let v = w.entity(format!("VERTEX_POINT('',{at})"));
                        pole_vertices.push((*pole, v.clone()));
                        v
                    }
                };
                stops.push((*tp, vertex));
            }
            stops.push((t1, vertices[b.index()].clone()));
            let mut pieces = vec![];
            for k in 0..stops.len() - 1 {
                let (ta, tb) = (stops[k].0, stops[k + 1].0);
                let mut pcurves = vec![];
                for (surface, chart) in &on_patch {
                    let (axis, _, _) = wonky_geom::model::stereo::latitude_of(&chart.sphere, curve).map_err(geom)?;
                    pcurves.push(iso_pcurve(w, surface, &ctx, chart, arc, axis == chart.axis, ta, tb)?);
                }
                let curve = w.entity(format!("SURFACE_CURVE('',{circle},({}),.CURVE_3D.)", pcurves.join(",")));
                pieces.push(w.entity(format!("EDGE_CURVE('',{},{},{curve},.T.)", stops[k].1, stops[k + 1].1)));
            }
            edges.push(pieces[0].clone());
            tails[i] = pieces[1..].to_vec();
            continue;
        }
        if matches!(e.bounds, Bounds::Ring) && edge_faces[i].iter().any(|&f| patch_surfaces[f].is_some()) {
            return no("sphere-patch-ring-pcurve");
        }
        edges.push(match (e.bounds, &p.rings[i]) {
            (Bounds::Segment([a, b]), None) => {
                match &d.curves[e.curve.index()].geometry {
                    Curve3::Line { .. } | Curve3::RadicalLine { .. } => {}
                    Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => return no("circle-arc"),
                }
                let (s, t) = (p.vertices[a.index()], p.vertices[b.index()]);
                if s == t {
                    return no("edge-below-binary64-resolution");
                }
                let origin = w.point(s);
                let dir = w.direction(normalized(fsub(t, s))?);
                let vector = w.entity(format!("VECTOR('',{dir},1.)"));
                let line = w.entity(format!("LINE('',{origin},{vector})"));
                w.entity(format!("EDGE_CURVE('',{},{},{line},.T.)", vertices[a.index()], vertices[b.index()]))
            }
            (Bounds::Ring, Some(r)) => {
                let point = w.point(r.vertex);
                let vertex = w.entity(format!("VERTEX_POINT('',{point})"));
                ring_vertices[i] = Some((vertex.clone(), r.vertex));
                let circle = emit_circle(w, r);
                w.entity(format!("EDGE_CURVE('',{vertex},{vertex},{circle},.T.)"))
            }
            (Bounds::Segment(_), Some(_)) | (Bounds::Ring, None) => return no("edge-plan"),
        });
    }
    let flag = |b: bool| if b { ".T." } else { ".F." };
    let mut faces = Vec::with_capacity(d.faces.len());
    for (fi, f) in d.faces.iter().enumerate() {
        if let Some(t) = &p.tubes[fi] {
            faces.push(tube_face_step(w, m, p, fi, t, &edges, &ring_vertices)?);
            continue;
        }
        let (surface, same, planar) = match (&p.patches[fi], &p.bands[fi]) {
            // A sphere's outward normal is intrinsic: a reflecting placement
            // does not flip the face sense. The written chart's poles and
            // seam meridian avoid the face (a plain domain of the surface).
            _ if patch_surfaces[fi].is_some() => {
                (patch_surfaces[fi].as_ref().map(|s| s.0.clone()).unwrap_or_default(), f.forward, false)
            }
            // A strip: its cylinder; the carrier normal is the radial
            // outward one (positive chart frame), as STEP's.
            (None, None) if p.strips[fi].is_some() => {
                let sw = p.strips[fi].as_ref().expect("strip");
                let place = w.placement(sw.disc.center, sw.disc.z, sw.disc.x);
                (w.entity(format!("CYLINDRICAL_SURFACE('',{place},{})", real(sw.radius))), f.forward, false)
            }
            (Some(pw), _) => {
                let surface = match pw.patch.profile {
                    Profile::Cylinder { .. } => {
                        let place = w.placement(pw.disc.center, pw.disc.z, pw.disc.x);
                        w.entity(format!("CYLINDRICAL_SURFACE('',{place},{})", real(pw.radii[0])))
                    }
                    Profile::Torus { .. } => {
                        let place = w.placement(pw.disc.center, pw.disc.z, pw.disc.x);
                        w.entity(format!("TOROIDAL_SURFACE('',{place},{},{})", real(pw.radii[0]), real(pw.radii[1])))
                    }
                    Profile::Cone { .. } => {
                        // Positioned at the patch's lower chart height, opening
                        // along the axis direction in which the radius grows.
                        let rp = &pw.patch;
                        let base = obs(&p.world.mm.point(&rp.frame.point(&[Q::zero(), Q::zero(), rp.v[0].clone()])))?;
                        let axis = if pw.slope > 0.0 { pw.disc.z } else { fscale(pw.disc.z, -1.0) };
                        let place = w.placement(base, axis, pw.disc.x);
                        w.entity(format!("CONICAL_SURFACE('',{place},{},{})", real(pw.radii[0]), real(pw.slope.abs().atan())))
                    }
                };
                (surface, f.forward, false)
            }
            (None, None) => {
                let (o, z, x) = plane_frame(&p.world, &d.surfaces[f.surface.index()].carrier)?;
                let place = w.placement(o, z, x);
                (w.entity(format!("PLANE('',{place})")), f.forward != p.world.reflect, true)
            }
            (None, Some(b)) if b.m[1].is_zero() => {
                let place = w.placement(b.disc.center, b.disc.z, b.disc.x);
                (w.entity(format!("CYLINDRICAL_SURFACE('',{place},{})", real(b.radii[0]))), b.forward, false)
            }
            (None, Some(b)) => {
                // Positioned at `lo`, opening along the axis direction in
                // which the radius grows.
                let base = observe(&p.world.rpoint(&m_point(m, fi, &b.lo)?)).map_err(geom)?;
                let axis = if b.slope > 0.0 { b.disc.z } else { fscale(b.disc.z, -1.0) };
                let place = w.placement(base, axis, b.disc.x);
                (w.entity(format!("CONICAL_SURFACE('',{place},{},{})", real(b.radii[0]), real(b.slope.abs().atan()))), b.forward, false)
            }
        };
        let mut bounds = Vec::with_capacity(f.loops.len());
        if let Some(s) = &p.seams[fi] {
            let oriented = |w: &mut Writer, e: &str, o: bool| w.entity(format!("ORIENTED_EDGE('',*,*,{e},{})", flag(o)));
            let ring_use = |l: usize| uses(m, &p.world, f.loops[l])[0];
            let (from, start) = ring_vertices[s.from].clone().ok_or_else(|| Refused("export/model/edge-plan".into()))?;
            let (to, end) = match s.to {
                SeamEnd::Ring(e) => ring_vertices[e].clone().ok_or_else(|| Refused("export/model/edge-plan".into()))?,
                SeamEnd::Apex(point) => {
                    let at = w.point(point);
                    (w.entity(format!("VERTEX_POINT('',{at})")), point)
                }
            };
            if start == end {
                return no("edge-below-binary64-resolution");
            }
            let origin = w.point(start);
            let dir = w.direction(normalized(fsub(end, start))?);
            let vector = w.entity(format!("VECTOR('',{dir},1.)"));
            let line = w.entity(format!("LINE('',{origin},{vector})"));
            let seam = w.entity(format!("EDGE_CURVE('',{from},{to},{line},.T.)"));
            // Each ring is closed on its own vertex, so the loop is the ring
            // at `from`, the seam out, the other ring, the seam back, in
            // either orientation of the rings.
            let (e, o) = ring_use(0);
            let mut lp = vec![oriented(w, &edges[e], o), oriented(w, &seam, true)];
            if let SeamEnd::Ring(_) = s.to {
                let (e, o) = ring_use(1);
                lp.push(oriented(w, &edges[e], o));
            }
            lp.push(oriented(w, &seam, false));
            let lp = w.entity(format!("EDGE_LOOP('',({}))", lp.join(",")));
            bounds.push(w.entity(format!("FACE_BOUND('',{lp},.T.)")));
        }
        for (k, &l) in f.loops.iter().enumerate().filter(|_| p.seams[fi].is_none()) {
            let oriented: Vec<String> = uses(m, &p.world, l)
                .into_iter()
                .flat_map(|(e, o)| {
                    // A split arc: its pieces in the use's direction.
                    let mut pieces = vec![edges[e].clone()];
                    pieces.extend(tails[e].iter().cloned());
                    if !o {
                        pieces.reverse();
                    }
                    pieces.into_iter().map(move |piece| (piece, o))
                })
                .map(|(piece, o)| w.entity(format!("ORIENTED_EDGE('',*,*,{},{})", piece, flag(o))))
                .collect();
            let lp = w.entity(format!("EDGE_LOOP('',({}))", oriented.join(",")));
            let kind = if planar && k == 0 { "FACE_OUTER_BOUND" } else { "FACE_BOUND" };
            bounds.push(w.entity(format!("{kind}('',{lp},.T.)")));
        }
        faces.push(w.entity(format!("ADVANCED_FACE('',({}),{surface},{})", bounds.join(","), flag(same))));
    }
    let mut solids = Vec::with_capacity(d.solids.len());
    for (k, s) in d.solids.iter().enumerate() {
        let [shell] = s.shells[..] else { return Err(Refused("boolean/void-shell-unsupported".into())) };
        let shell = w.entity(format!(
            "CLOSED_SHELL('',({}))",
            d.shells[shell.index()].faces.iter().map(|f| faces[f.index()].clone()).collect::<Vec<_>>().join(",")
        ));
        let name = if d.solids.len() == 1 { id.to_string() } else { format!("{id}/{k}") };
        solids.push(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{shell})", text(&name))));
    }
    Ok(solids)
}

/// A tube band face: its surface, and one loop of the rings and the seam
/// meridian circle (lower ring, seam up, upper ring or pole, seam down).
fn tube_face_step(
    w: &mut Writer,
    m: &Model,
    p: &Plan,
    fi: usize,
    t: &Tube,
    edges: &[String],
    ring_vertices: &[Option<(String, [f64; 3])>],
) -> R<String> {
    let d = m.draft();
    let f = &d.faces[fi];
    let flag = |b: bool| if b { ".T." } else { ".F." };
    let place = w.placement(t.disc.center, t.disc.z, t.disc.x);
    let surface = if t.band.major.is_zero() {
        w.entity(format!("SPHERICAL_SURFACE('',{place},{})", real(t.minor)))
    } else {
        w.entity(format!("TOROIDAL_SURFACE('',{place},{},{})", real(t.major), real(t.minor)))
    };
    // Rings of the face with their end (lower or upper) and written use.
    let mut ends = Vec::new();
    for &l in &f.loops {
        let (e, o) = uses(m, &p.world, l)[0];
        let (vertex, at) = ring_vertices[e].clone().ok_or_else(|| Refused("export/model/edge-plan".into()))?;
        ends.push((tube_ring_lo(m, t, e)?, e, o, vertex, at));
    }
    ends.sort_by_key(|e| !e.0);
    let (lo, hi) = match (&ends[..], t.pole) {
        ([a, b], None) if a.0 && !b.0 => ((a.3.clone(), a.4), (b.3.clone(), b.4)),
        ([a], Some(pole)) => {
            let at = w.point(pole);
            let v = w.entity(format!("VERTEX_POINT('',{at})"));
            if a.0 { ((a.3.clone(), a.4), (v, pole)) } else { ((v, pole), (a.3.clone(), a.4)) }
        }
        _ => return no("tube-loops"),
    };
    if lo.1 == hi.1 {
        return no("edge-below-binary64-resolution");
    }
    // θ grows from the lower to the upper end, counter-clockwise about -y.
    let seam_place = w.placement(t.seam_center, fscale(t.disc.y, -1.0), t.disc.x);
    let circle = w.entity(format!("CIRCLE('',{seam_place},{})", real(t.minor)));
    let seam = w.entity(format!("EDGE_CURVE('',{},{},{circle},.T.)", lo.0, hi.0));
    let oriented = |w: &mut Writer, e: &str, o: bool| w.entity(format!("ORIENTED_EDGE('',*,*,{e},{})", flag(o)));
    let first_lo = ends[0].0;
    let mut lp = vec![oriented(w, &edges[ends[0].1], ends[0].2), oriented(w, &seam, first_lo)];
    if let Some(b) = ends.get(1) {
        lp.push(oriented(w, &edges[b.1], b.2));
    }
    lp.push(oriented(w, &seam, !first_lo));
    let lp = w.entity(format!("EDGE_LOOP('',({}))", lp.join(",")));
    let bound = w.entity(format!("FACE_BOUND('',{lp},.T.)"));
    Ok(w.entity(format!("ADVANCED_FACE('',({bound}),{surface},{})", flag(t.band.forward))))
}

/// The model-frame point on the axis of band face `fi` at carrier height `h`.
fn m_point(m: &Model, fi: usize, h: &Radical) -> R<RPoint> {
    let b = m.radical_band(FaceId(fi as u32)).map_err(geom)?.ok_or_else(|| Refused("export/model/band-missing".into()))?;
    rframe_point(&b.frame, &[Radical::default(), Radical::default(), h.clone()])
}

/// One Model's solids into a shared writer (`step::write_solids`).
pub(crate) fn append_model(w: &mut Writer, id: &str, m: &Model) -> R<Vec<String>> {
    let p = plan(m)?;
    append(w, id, m, &p)
}

/// The AP214 file for named Models.
pub fn step(models: &[(String, &Model)], name: &str) -> R<String> {
    let plans = models.iter().map(|(_, m)| plan(m)).collect::<R<Vec<_>>>()?;
    let budget = plans.iter().fold(0.0f64, |a, p| a.max(p.budget));
    let (mut w, head) = begin(
        name,
        budget,
        "export rounding of exact general-Boolean Model geometry; analytic planes, cylinders, cones, lines and circles",
    );
    let mut solids = Vec::new();
    for ((id, m), p) in models.iter().zip(&plans) {
        solids.extend(append(&mut w, id, m, p)?);
    }
    let description = format!(
        "wonky-kernel Rust general-Boolean Model B-rep; exact model geometry, analytic carriers and vertices correctly rounded; export budget {} mm",
        real(budget)
    );
    Ok(finish(w, head, name, &description, solids))
}

/// Samples per ring for the deviation (see the module comment).
fn samples(r_max: f64, deviation_mm: f64) -> R<usize> {
    let half = 0.5 * deviation_mm;
    let n = if r_max <= half { 8 } else { (std::f64::consts::TAU / (1.0 - half / r_max).acos()).ceil() as usize };
    let n = n.max(8);
    let mut n = n;
    // acos and the division round; step up until the bound holds.
    while r_max * (1.0 - (std::f64::consts::TAU / n as f64).cos()) > half {
        n += 1;
        if n > 1 << 16 {
            return Err(Refused("export/stl/sampling-limit".into()));
        }
    }
    if n > 1 << 16 {
        return Err(Refused("export/stl/sampling-limit".into()));
    }
    Ok(n)
}

/// The chart-domain mesh of a Model in world millimetres (module comment).
pub fn tessellate(m: &Model, deviation_mm: f64) -> R<Mesh> {
    if !deviation_mm.is_finite() || deviation_mm <= 0. {
        return Err(Refused("export/stl/invalid-deviation".into()));
    }
    let d = m.draft();
    let p = plan(m)?;
    let r_max = p.rings.iter().flatten().map(|r| r.radius)
        .chain(p.arcs.iter().flatten().map(|r| r.radius))
        .chain(p.patches.iter().flatten().map(|t| t.radii[0] + t.radii[1]))
        .chain(p.bands.iter().flatten().flat_map(|b| b.radii))
        .chain(p.tubes.iter().flatten().map(|t| t.major + t.minor))
        .fold(0.0f64, f64::max);
    let n = samples(r_max, deviation_mm)?;
    let mut mesh = Mesh { vertices: p.vertices.clone(), brep_vertices: p.vertices.len(), ..Default::default() };
    // Ring samples in the circle's sense, starting at the ring vertex.
    let mut ring_samples: Vec<Vec<usize>> = vec![Vec::new(); d.edges.len()];
    for (i, r) in p.rings.iter().enumerate() {
        let Some(r) = r else { continue };
        let start = mesh.vertices.len();
        mesh.vertices.push(r.vertex);
        for k in 1..n {
            mesh.vertices.push(r.disc.at(r.radius, std::f64::consts::TAU * k as f64 / n as f64));
        }
        ring_samples[i] = (start..start + n).collect();
    }
    // Bounded arcs: interior samples at equal angles, counter-clockwise
    // about the circle's axis from the first vertex to the second.
    for (i, e) in d.edges.iter().enumerate() {
        let (Bounds::Segment([a, b]), Some(r)) = (e.bounds, &p.arcs[i]) else { continue };
        let tau = std::f64::consts::TAU;
        let angle = |v: [f64; 3]| {
            let v = fsub(v, r.disc.center);
            fdot(v, r.disc.y).atan2(fdot(v, r.disc.x))
        };
        let (ta, mut tb) = (angle(p.vertices[a.index()]), angle(p.vertices[b.index()]));
        while tb <= ta {
            tb += tau;
        }
        let k = (((tb - ta) / tau) * n as f64).ceil().max(1.0) as usize;
        let start = mesh.vertices.len();
        for s in 1..k {
            mesh.vertices.push(r.disc.at(r.radius, ta + (tb - ta) * s as f64 / k as f64));
        }
        ring_samples[i] = (start..start + k - 1).collect();
    }
    mesh.edges = d.edges.iter().enumerate().map(|(i, e)| match e.bounds {
        Bounds::Segment([a, b]) => MeshEdge {
            vertices: std::iter::once(a.index()).chain(ring_samples[i].iter().copied()).chain([b.index()]).collect(),
            closed: false,
        },
        Bounds::Ring => MeshEdge { vertices: ring_samples[i].clone(), closed: true },
    }).collect();
    for fi in 0..d.faces.len() {
        if p.strips[fi].is_some() {
            return no("strip-mesh");
        }
        let triangles = match (&p.bands[fi], &p.tubes[fi]) {
            _ if p.patches[fi].is_some() => {
                patch_face(m, &p, fi, p.patches[fi].as_ref().expect("patch"), &ring_samples, &mut mesh.vertices)?
            }
            (_, Some(t)) => tube_face(m, fi, t, deviation_mm, &ring_samples, &mut mesh.vertices)?,
            (None, None) => planar_face(m, &p, fi, &ring_samples, &mesh.vertices)?,
            (Some(b), None) => band_face(m, &p, fi, b, &ring_samples, &mut mesh.vertices)?,
        };
        mesh.faces.extend(std::iter::repeat(fi as u32).take(triangles.len()));
        mesh.triangles.extend(triangles);
    }
    check_watertight(&mesh)?;
    Ok(mesh)
}

/// One loop of a face as mesh vertex indices in traversal order.
fn loop_vertices(m: &Model, l: wonky_geom::model::LoopId, rings: &[Vec<usize>]) -> R<Vec<usize>> {
    let d = m.draft();
    let mut out = Vec::new();
    for c in &d.loops[l.index()].coedges {
        let c = &d.coedges[c.index()];
        match d.edges[c.edge.index()].bounds {
            Bounds::Segment([a, b]) => {
                let s = &rings[c.edge.index()];
                if c.forward {
                    out.push(a.index());
                    out.extend(s.iter().copied());
                } else {
                    out.push(b.index());
                    out.extend(s.iter().rev().copied());
                }
            }
            Bounds::Ring => {
                let s = &rings[c.edge.index()];
                if c.forward {
                    out.extend(s.iter().copied());
                } else {
                    out.extend(s.iter().rev().copied());
                }
            }
        }
    }
    Ok(out)
}

/// The chart grid of a partial patch: its edge samples are the grid's
/// boundary rows and columns, interior points lie on the written carrier at
/// equal chart angles (equal heights on a cylinder generator).
fn patch_face(m: &Model, p: &Plan, fi: usize, pw: &PatchW, rings: &[Vec<usize>], vertices: &mut Vec<[f64; 3]>) -> R<Vec<[usize; 3]>> {
    let d = m.draft();
    let f = &d.faces[fi];
    let rp = &pw.patch;
    let inverse = rp.frame.inverse();
    let chart = |v: wonky_geom::model::VertexId| -> R<[Q; 2]> {
        let point = d.vertices[v.index()].def.key().map_err(geom)?.rational().map_err(geom)?.clone();
        rp.profile.chart(rp.pu, rp.pv, &inverse.point(&point)).ok_or_else(|| Refused("export/stl/patch-chart".into()))
    };
    // Sides by chart value: [v = v0, v = v1, u = u0, u = u1], each in
    // increasing chart order.
    let mut sides: [Option<Vec<usize>>; 4] = [None, None, None, None];
    for c in &d.loops[f.loops[0].index()].coedges {
        let co = &d.coedges[c.index()];
        let Bounds::Segment([a, b]) = d.edges[co.edge.index()].bounds else { return no("patch-ring") };
        let (ca, cb) = (chart(a)?, chart(b)?);
        let mut run: Vec<usize> = std::iter::once(a.index()).chain(rings[co.edge.index()].iter().copied()).chain([b.index()]).collect();
        let (side, increasing) = if ca[1] == cb[1] {
            (if ca[1] == rp.v[0] { 0 } else { 1 }, cb[0] > ca[0])
        } else {
            (if ca[0] == rp.u[0] { 2 } else { 3 }, cb[1] > ca[1])
        };
        if !increasing {
            run.reverse();
        }
        sides[side] = Some(run);
    }
    let [Some(bottom), Some(top), Some(left), Some(right)] = sides else { return no("patch-sides") };
    let (nu, nv) = (bottom.len() - 1, left.len() - 1);
    if top.len() != bottom.len() || right.len() != left.len() {
        return no("patch-sampling-mismatch");
    }
    let phi = [chart_angle(rp.pu, &rp.u[0])?, chart_angle(rp.pu, &rp.u[1])?];
    let at = |i: usize, j: usize| -> R<[f64; 3]> {
        let a = phi[0] + (phi[1] - phi[0]) * i as f64 / nu as f64;
        let radial = fadd(fscale(pw.disc.x, a.cos()), fscale(pw.disc.y, a.sin()));
        Ok(match rp.profile {
            Profile::Cylinder { .. } => {
                let h = obs1(&rp.v[0])? + (obs1(&rp.v[1])? - obs1(&rp.v[0])?) * j as f64 / nv as f64;
                fadd(pw.disc.center, fadd(fscale(radial, pw.radii[0]), fscale(pw.disc.w, h)))
            }
            Profile::Cone { .. } => {
                let f = j as f64 / nv as f64;
                let h = obs1(&rp.v[0])? + (obs1(&rp.v[1])? - obs1(&rp.v[0])?) * f;
                let rho = pw.radii[0] + (pw.radii[1] - pw.radii[0]) * f;
                fadd(pw.disc.center, fadd(fscale(radial, rho), fscale(pw.disc.w, h)))
            }
            Profile::Torus { .. } => {
                let (t0, t1) = (chart_angle(rp.pv, &rp.v[0])?, chart_angle(rp.pv, &rp.v[1])?);
                let t = t0 + (t1 - t0) * j as f64 / nv as f64;
                let rho = pw.radii[0] + pw.radii[1] * t.cos();
                fadd(pw.disc.center, fadd(fscale(radial, rho), fscale(pw.disc.z, pw.radii[1] * t.sin())))
            }
        })
    };
    let mut grid = vec![vec![0usize; nu + 1]; nv + 1];
    for j in 0..=nv {
        for i in 0..=nu {
            grid[j][i] = if j == 0 {
                bottom[i]
            } else if j == nv {
                top[i]
            } else if i == 0 {
                left[j]
            } else if i == nu {
                right[j]
            } else {
                vertices.push(at(i, j)?);
                vertices.len() - 1
            };
        }
    }
    let cols = rp.frame.columns();
    let right_handed = dot(&cols[0], &cross(&cols[1], &cols[2])).is_positive();
    let ccw = (f.forward == right_handed) != p.world.reflect;
    let mut out = Vec::with_capacity(2 * nu * nv);
    for j in 0..nv {
        for i in 0..nu {
            let (a, b, c, e) = (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
            if ccw {
                out.push([a, b, c]);
                out.push([a, c, e]);
            } else {
                out.push([a, c, b]);
                out.push([a, e, c]);
            }
        }
    }
    Ok(out)
}

fn planar_face(m: &Model, p: &Plan, fi: usize, rings: &[Vec<usize>], vertices: &[[f64; 3]]) -> R<Vec<[usize; 3]>> {
    let d = m.draft();
    let f = &d.faces[fi];
    let (_, normal, _) = plane_frame(&p.world, &d.surfaces[f.surface.index()].carrier)?;
    // The written normal is the image of x times the image of n x x; the
    // outward normal is its sign times the face sense, reversed by a reflection.
    let outward = if f.forward != p.world.reflect { normal } else { fscale(normal, -1.0) };
    let axis = (0..3).max_by(|&a, &b| outward[a].abs().total_cmp(&outward[b].abs())).expect("three axes");
    let (i, j) = ((axis + 1) % 3, (axis + 2) % 3);
    let loops = f.loops.iter().map(|&l| loop_vertices(m, l, rings)).collect::<R<Vec<_>>>()?;
    // Compact the indices used by this face for the 2D triangulator.
    let mut used: Vec<usize> = loops.iter().flatten().copied().collect();
    used.sort_unstable();
    used.dedup();
    let local = |v: usize| used.binary_search(&v).expect("used vertex");
    let points: Vec<[f64; 2]> = used.iter().map(|&v| [vertices[v][i], vertices[v][j]]).collect();
    let contours: Vec<Vec<usize>> = loops.iter().map(|l| l.iter().map(|&v| local(v)).collect()).collect();
    let mut triangles = crate::mesh::triangulate_loops(&points, &contours)?;
    for t in &mut triangles {
        if outward[axis] < 0.0 {
            t.swap(1, 2);
        }
        *t = t.map(|k| used[k]);
    }
    Ok(triangles)
}

fn band_face(m: &Model, p: &Plan, fi: usize, b: &Band, rings: &[Vec<usize>], vertices: &mut Vec<[f64; 3]>) -> R<Vec<[usize; 3]>> {
    let d = m.draft();
    let f = &d.faces[fi];
    let disc = &b.disc;
    let tau = std::f64::consts::TAU;
    let angle = |v: [f64; 3]| {
        let r = fsub(v, disc.center);
        fdot(r, disc.y).atan2(fdot(r, disc.x)).rem_euclid(tau)
    };
    // Each ring, sorted by chart angle, with its axial position.
    let mut sides: Vec<(f64, Vec<(f64, usize)>)> = Vec::new();
    for &l in &f.loops {
        let [c] = d.loops[l.index()].coedges[..] else { return no("band-loop") };
        let e = d.coedges[c.index()].edge.index();
        let mut s: Vec<(f64, usize)> = rings[e].iter().map(|&v| (angle(vertices[v]), v)).collect();
        if s.is_empty() {
            return no("band-ring");
        }
        s.sort_by(|a, b| a.0.total_cmp(&b.0));
        let t = fdot(fsub(vertices[s[0].1], disc.center), disc.z);
        sides.push((t, s));
    }
    sides.sort_by(|a, b| a.0.total_cmp(&b.0));
    let outward = |c: [f64; 3]| {
        let r = fsub(c, disc.center);
        let radial = normalized(fsub(r, fscale(disc.z, fdot(r, disc.z)))).unwrap_or([0.0; 3]);
        let n = fsub(radial, fscale(disc.z, b.slope));
        if b.forward { n } else { fscale(n, -1.0) }
    };
    let mut triangles = Vec::new();
    let mut push = |t: [usize; 3], vertices: &Vec<[f64; 3]>| -> R<()> {
        let [a, bb, c] = t.map(|k| vertices[k]);
        let normal = fcross(fsub(bb, a), fsub(c, a));
        let centroid = fscale(fadd(fadd(a, bb), c), 1.0 / 3.0);
        let s = fdot(normal, outward(centroid));
        if !(s.abs() > 0.0) {
            return no("band-triangle-orientation");
        }
        triangles.push(if s > 0.0 { t } else { [t[0], t[2], t[1]] });
        Ok(())
    };
    match &sides[..] {
        [(_, ring)] => {
            // One ring and the apex of a cone.
            if b.m[1].is_zero() {
                return no("band-apex");
            }
            let apex = rguard(|| -(&b.m[0] / &b.m[1]))?;
            let point = observe(&p.world.rpoint(&m_point(m, fi, &apex)?)).map_err(geom)?;
            let apex = vertices.len();
            vertices.push(point);
            for k in 0..ring.len() {
                push([ring[k].1, ring[(k + 1) % ring.len()].1, apex], vertices)?;
            }
        }
        [(_, lower), (_, upper)] => {
            // Zipper by chart angle, unwrapped from the smaller start angle.
            let start = lower[0].0.min(upper[0].0);
            let unwrap = |s: &Vec<(f64, usize)>| -> Vec<(f64, usize)> {
                let mut v: Vec<(f64, usize)> = s.iter().map(|&(a, k)| (if a < start { a + tau } else { a }, k)).collect();
                v.sort_by(|a, b| a.0.total_cmp(&b.0));
                let first = v[0];
                v.push((first.0 + tau, first.1));
                v
            };
            let (a, c) = (unwrap(lower), unwrap(upper));
            let (mut i, mut j) = (0, 0);
            while i + 1 < a.len() || j + 1 < c.len() {
                let advance_lower = j + 1 >= c.len() || (i + 1 < a.len() && a[i + 1].0 <= c[j + 1].0);
                if advance_lower {
                    push([a[i].1, a[i + 1].1, c[j].1], vertices)?;
                    i += 1;
                } else {
                    push([a[i].1, c[j + 1].1, c[j].1], vertices)?;
                    j += 1;
                }
            }
        }
        _ => return no("band-loops"),
    }
    Ok(triangles)
}

/// A tube band sampled in its (azimuth, tube angle) chart: rows of the
/// lower ring's azimuths at tube-angle steps with chord error at most half
/// the deviation, zipped between consecutive rows; a pole closes a cap.
fn tube_face(m: &Model, fi: usize, t: &Tube, deviation_mm: f64, rings: &[Vec<usize>], vertices: &mut Vec<[f64; 3]>) -> R<Vec<[usize; 3]>> {
    let d = m.draft();
    let f = &d.faces[fi];
    let disc = &t.disc;
    let tau = std::f64::consts::TAU;
    let angle = |v: [f64; 3]| {
        let r = fsub(v, disc.center);
        fdot(r, disc.y).atan2(fdot(r, disc.x)).rem_euclid(tau)
    };
    let mut lower: Option<Vec<(f64, usize)>> = None;
    let mut upper: Option<Vec<(f64, usize)>> = None;
    for &l in &f.loops {
        let [c] = d.loops[l.index()].coedges[..] else { return no("tube-loop") };
        let e = d.coedges[c.index()].edge.index();
        let mut s: Vec<(f64, usize)> = rings[e].iter().map(|&v| (angle(vertices[v]), v)).collect();
        if s.is_empty() {
            return no("tube-ring");
        }
        s.sort_by(|a, b| a.0.total_cmp(&b.0));
        if tube_ring_lo(m, t, e)? { lower = Some(s) } else { upper = Some(s) }
    }
    let azimuths: Vec<f64> = lower.as_ref().or(upper.as_ref()).ok_or_else(|| Refused("export/model/tube-loops".into()))?.iter().map(|a| a.0).collect();
    let span = (t.theta[1] - t.theta[0]).abs();
    let steps = ((span / tau) * samples(t.minor, deviation_mm)? as f64).ceil().max(1.0) as usize;
    let at = |phi: f64, theta: f64| {
        let rho = t.major + t.minor * theta.cos();
        fadd(disc.center, fadd(fadd(fscale(disc.x, rho * phi.cos()), fscale(disc.y, rho * phi.sin())), fscale(disc.z, t.minor * theta.sin())))
    };
    let mut rows: Vec<Vec<(f64, usize)>> = Vec::new();
    for k in 0..=steps {
        let row = if k == 0 && lower.is_some() {
            lower.clone().unwrap()
        } else if k == steps && upper.is_some() {
            upper.clone().unwrap()
        } else if (k == 0 || k == steps) && t.pole.is_some() {
            let v = vertices.len();
            vertices.push(t.pole.unwrap());
            vec![(0.0, v)]
        } else {
            let theta = t.theta[0] + (t.theta[1] - t.theta[0]) * k as f64 / steps as f64;
            azimuths
                .iter()
                .map(|&phi| {
                    vertices.push(at(phi, theta));
                    (phi, vertices.len() - 1)
                })
                .collect()
        };
        rows.push(row);
    }
    let outward = |c: [f64; 3]| {
        let r = fsub(c, disc.center);
        let h = fdot(r, disc.z);
        let radial = normalized(fsub(r, fscale(disc.z, h))).unwrap_or([0.0; 3]);
        let n = fsub(r, fscale(radial, t.major));
        if t.band.forward { n } else { fscale(n, -1.0) }
    };
    let mut triangles = Vec::new();
    let mut push = |tri: [usize; 3], vertices: &Vec<[f64; 3]>| -> R<()> {
        let [a, b, c] = tri.map(|k| vertices[k]);
        let normal = fcross(fsub(b, a), fsub(c, a));
        let s = fdot(normal, outward(fscale(fadd(fadd(a, b), c), 1.0 / 3.0)));
        if !(s.abs() > 0.0) {
            return no("tube-triangle-orientation");
        }
        triangles.push(if s > 0.0 { tri } else { [tri[0], tri[2], tri[1]] });
        Ok(())
    };
    for pair in rows.windows(2) {
        let (a, c) = (&pair[0], &pair[1]);
        if a.len() == 1 || c.len() == 1 {
            let (apex, ring) = if a.len() == 1 { (a[0].1, c) } else { (c[0].1, a) };
            for k in 0..ring.len() {
                push([ring[k].1, ring[(k + 1) % ring.len()].1, apex], vertices)?;
            }
            continue;
        }
        let start = a[0].0.min(c[0].0);
        let unwrap = |s: &Vec<(f64, usize)>| -> Vec<(f64, usize)> {
            let mut v: Vec<(f64, usize)> = s.iter().map(|&(x, k)| (if x < start { x + tau } else { x }, k)).collect();
            v.sort_by(|x, y| x.0.total_cmp(&y.0));
            let first = v[0];
            v.push((first.0 + tau, first.1));
            v
        };
        let (a, c) = (unwrap(a), unwrap(c));
        let (mut i, mut j) = (0, 0);
        while i + 1 < a.len() || j + 1 < c.len() {
            let advance = j + 1 >= c.len() || (i + 1 < a.len() && a[i + 1].0 <= c[j + 1].0);
            if advance {
                push([a[i].1, a[i + 1].1, c[j].1], vertices)?;
                i += 1;
            } else {
                push([a[i].1, c[j + 1].1, c[j].1], vertices)?;
                j += 1;
            }
        }
    }
    Ok(triangles)
}

/// The world volume (mm^3) of each solid: the Model's exact volume
/// (`Model::volume6_pi`, six times the model-frame volume)
/// times the placement's determinant, observed as the midpoint of a pi
/// enclosure far below binary64 resolution.
pub fn volumes_mm3(m: &Model) -> R<Vec<f64>> {
    let world = World::of(m)?;
    let [x, y, z] = world.mm.columns();
    if has_patch(m) {
        // Sphere patches: certified enclosures (arc sweeps and turning
        // angles leave Q(√d)[π]); the printed value lies in the enclosure.
        let det = obs1(&(dot(x, &cross(y, z)).abs() / q(6)))?;
        return m.patch_measures().map_err(geom)?.iter().map(|(v6, _)| Ok(v6.m * det)).collect();
    }
    let six = m.volume6_surd().map_err(geom)?;
    let det = dot(x, &cross(y, z)).abs() / q(6);
    six.iter()
        .map(|v| {
            let (lo, hi) = v.enclosure(64).map_err(geom)?;
            obs1(&((lo + hi) / q(2) * &det))
        })
        .collect()
}

/// The world points of each sphere face where its sphere is extreme
/// along the world functional `row` and which lie in the face: the model
/// direction is `u = Aᵀ row`, the extremes `c ± a u / |u|` (one radicand
/// `|u|²`; patch measures require an orthonormal own frame), each kept
/// only if the exact containment test admits it.
fn sphere_extremes(m: &Model, world: &World, row: [f64; 3]) -> R<Vec<[f64; 3]>> {
    let d = m.draft();
    let mut out = vec![];
    for fi in 0..d.faces.len() {
        // Every sphere face: a cap bounded by rings reaches its pole too.
        let Carrier3::Sphere(s) = &d.surfaces[d.faces[fi].surface.index()].carrier else { continue };
        let cols = world.mm.columns();
        let r: Point = [q_f(row[0])?, q_f(row[1])?, q_f(row[2])?];
        let u: Point = std::array::from_fn(|j| dot(&cols[j], &r));
        let u2 = dot(&u, &u);
        if u2.is_zero() {
            continue;
        }
        let root = rguard(|| Radical::quadratic(Q::zero(), q(1), u2.clone()))?.map_err(|e| Refused(e.name().into()))?;
        for sign in [q(1), q(-1)] {
            let k = &sign * s.radius() / &u2;
            let x: RPoint = rguard(|| std::array::from_fn(|i| Radical::from(s.frame.origin()[i].clone()) + &root * &(&k * &u[i])))?;
            if m.sphere_face_contains(FaceId(fi as u32), &x).map_err(geom)? {
                out.push(observe(&world.rpoint(&x)).map_err(geom)?);
            }
        }
    }
    Ok(out)
}
/// The written chart of a sphere patch face (world mm): `u` about `z` from
/// `x`, `v` the latitude; `axis` is its own frame column.
struct IsoChart {
    center: [f64; 3],
    radius: f64,
    x: [f64; 3],
    y: [f64; 3],
    z: [f64; 3],
    axis: usize,
    poles: [[f64; 3]; 2],
    sphere: wonky_geom::model::Sphere3,
}
/// The exact LINE pcurve of an arc piece `θ ∈ [ta, tb]` of a written
/// circle that is a latitude (u linear in θ) or a meridian piece without a
/// pole inside (v linear in θ) of the chart; the line's parameter is θ.
#[allow(clippy::too_many_arguments)]
fn iso_pcurve(w: &mut Writer, surface: &str, ctx: &str, c: &IsoChart, arc: &Ring, latitude: bool, ta: f64, tb: f64) -> R<String> {
    let tau = 2.0 * std::f64::consts::PI;
    let at = |t: f64| arc.disc.at(arc.radius, t);
    let lon = |p: [f64; 3]| {
        let d = fsub(p, c.center);
        let u = fdot(d, c.y).atan2(fdot(d, c.x));
        if u < 0.0 { u + tau } else { u }
    };
    let lat = |p: [f64; 3]| (fdot(fsub(p, c.center), c.z) / c.radius).clamp(-1.0, 1.0).asin();
    let mid = 0.5 * (ta + tb);
    let (point, direction) = if latitude {
        let s = if fdot(arc.disc.z, c.z) > 0.0 { 1.0 } else { -1.0 };
        let u0 = lon(at(ta));
        let u1 = u0 + s * (tb - ta);
        if !(0.0..=tau).contains(&u1) {
            return no("sphere-pcurve-seam");
        }
        ([u0 - s * ta, lat(at(mid))], [s, 0.0])
    } else {
        let tangent = fadd(fscale(arc.disc.x, -mid.sin()), fscale(arc.disc.y, mid.cos()));
        let s = if fdot(tangent, c.z) > 0.0 { 1.0 } else { -1.0 };
        ([lon(at(mid)), lat(at(mid)) - s * mid], [0.0, s])
    };
    Ok(w.pcurve(surface, ctx, point, direction))
}
/// The written iso-line chart of sphere patch face `fi`: an own frame
/// column `k` (either sense) for which every trim of the face is a latitude
/// (plane ⟂ e_k) or a meridian (plane through the centre containing e_k),
/// and a seam direction whose half-meridian (poles excluded, sampled at
/// exact rational points) misses the closed face. Every pcurve is then an
/// exact LINE and the face a parameter domain without seam or pole inside.
/// A face without such a chart refuses by name.
fn sphere_iso_chart(m: &Model, fi: usize, s: &wonky_geom::model::Sphere3) -> R<(usize, Point, Point)> {
    let d = m.draft();
    let mut trims = vec![];
    for &l in &d.faces[fi].loops {
        for c in &d.loops[l.index()].coedges {
            let e = &d.edges[d.coedges[c.index()].edge.index()];
            trims.push(wonky_geom::model::stereo::latitude_of(s, &d.curves[e.curve.index()].geometry).map_err(geom)?);
        }
    }
    let a = s.radius();
    let out_of_face = |l: Point| -> R<bool> {
        let x = s.frame.point(&l).map(Radical::from);
        Ok(!m.sphere_face_contains(FaceId(fi as u32), &x).map_err(geom)?)
    };
    for k in 0..3 {
        if !trims.iter().all(|(axis, h, _)| *axis == k || h.is_zero()) {
            continue;
        }
        for sign in [1i64, -1] {
            let mut z = [Q::zero(), Q::zero(), Q::zero()];
            z[k] = q(sign);
            'x: for x in unit_directions() {
                if !dot(&z, &x).is_zero() {
                    continue;
                }
                for t in -7i64..=7 {
                    let tq = Q::new(t.into(), 8.into());
                    let den = q(1) + &tq * &tq;
                    let (c, sn) = ((q(1) - &tq * &tq) / &den, q(2) * &tq / &den);
                    let l: Point = std::array::from_fn(|i| a * (&c * &x[i] + &sn * &z[i]));
                    if !out_of_face(l)? {
                        continue 'x;
                    }
                }
                return Ok((k, z, x));
            }
        }
    }
    no("sphere-patch-chart-unavailable")
}
/// Rational unit directions (own frame) for a written sphere chart.
fn unit_directions() -> Vec<Point> {
    let mut out = vec![];
    for k in 0..3 {
        for sg in [1, -1] {
            let mut v = [Q::zero(), Q::zero(), Q::zero()];
            v[k] = q(sg);
            out.push(v);
        }
    }
    for (i, j) in [(0, 1), (0, 2), (1, 2)] {
        for (a, b) in [(3, 4), (4, 3)] {
            for (sa, sb) in [(1, 1), (1, -1), (-1, 1), (-1, -1)] {
                let mut v = [Q::zero(), Q::zero(), Q::zero()];
                v[i] = Q::new((sa * a).into(), 5.into());
                v[j] = Q::new((sb * b).into(), 5.into());
                out.push(v);
            }
        }
    }
    for perm in [[2, 2, 1], [2, 1, 2], [1, 2, 2]] {
        for signs in 0..8 {
            out.push(std::array::from_fn(|k| Q::new((if signs >> k & 1 == 1 { -perm[k] } else { perm[k] }).into(), 3.into())));
        }
    }
    out
}
fn q_f(x: f64) -> R<Q> {
    wonky_geom::binary64(x).map_err(geom)
}
/// Models measured by certified enclosures (a sphere face; planar and
/// sphere faces only), not by the exact Q(√d)[π] route.
fn has_patch(m: &Model) -> bool {
    m.sphere_measured()
}
/// The written topology of each solid and its exact volume, in the schema
/// `scripts/validate-step.py` reads beside a `.step` (`<prefix>.brep.json`):
/// per solid its faces (loops of edge uses), edges and vertices as the
/// STEP file carries them (a ring adds its one vertex, a band its seam and a
/// cone band its apex vertex), the declared budget
/// as `validation.toleranceMm` and the exact volume.
pub fn summary_json(models: &[(String, &Model)]) -> R<String> {
    let mut bodies = Vec::new();
    for (id, m) in models {
        let d = m.draft();
        let p = plan(m)?;
        let volumes = volumes_mm3(m)?;
        for (k, s) in d.solids.iter().enumerate() {
            let faces: Vec<usize> = s.shells.iter().flat_map(|sh| d.shells[sh.index()].faces.iter().map(|f| f.index())).collect();
            let mut edges: Vec<usize> = faces.iter().flat_map(|&f| d.faces[f].loops.iter()).flat_map(|l| d.loops[l.index()].coedges.iter()).map(|c| d.coedges[c.index()].edge.index()).collect();
            edges.sort_unstable();
            edges.dedup();
            let mut segment_vertices = std::collections::BTreeSet::new();
            let mut vertices: Vec<String> = Vec::new();
            for &e in &edges {
                match d.edges[e].bounds {
                    Bounds::Segment([a, b]) => {
                        for v in [a, b] {
                            if segment_vertices.insert(v.index()) {
                                vertices.push(format!("{:?}", p.vertices[v.index()]));
                            }
                        }
                    }
                    Bounds::Ring => vertices.push(format!("{:?}", p.rings[e].as_ref().expect("ring plan").vertex)),
                }
            }
            // A band's seam is one more edge after the Model's edges, used
            // once in each direction in the band's single loop.
            let seamed: Vec<usize> = faces.iter().copied().filter(|&f| p.seams[f].is_some() || p.tubes[f].is_some()).collect();
            for &f in &seamed {
                if let Some(Seam { to: SeamEnd::Apex(point), .. }) = &p.seams[f] {
                    vertices.push(format!("{point:?}"));
                }
                if let Some(Tube { pole: Some(point), .. }) = &p.tubes[f] {
                    vertices.push(format!("{point:?}"));
                }
            }
            let edge_use = |(e, o): (usize, bool)| format!("{{\"edge\":{},\"forward\":{o}}}", edges.binary_search(&e).expect("solid edge"));
            let face_json: Vec<String> = faces.iter().map(|&f| {
                let loops: Vec<String> = match (&p.seams[f], &p.tubes[f]) {
                    (_, Some(t)) => {
                        // As written: lower ring first, the seam from the
                        // lower end to the upper end, then back.
                        let seam = edges.len() + seamed.binary_search(&f).expect("seamed face");
                        let mut ends = d.faces[f]
                            .loops
                            .iter()
                            .map(|&l| {
                                let u = uses(m, &p.world, l)[0];
                                tube_ring_lo(m, t, u.0).map(|lo| (lo, u))
                            })
                            .collect::<R<Vec<_>>>()?;
                        ends.sort_by_key(|e| !e.0);
                        let first_lo = ends[0].0;
                        let mut u = vec![edge_use(ends[0].1), format!("{{\"edge\":{seam},\"forward\":{first_lo}}}")];
                        if let Some(e) = ends.get(1) {
                            u.push(edge_use(e.1));
                        }
                        u.push(format!("{{\"edge\":{seam},\"forward\":{}}}", !first_lo));
                        vec![format!("[{}]", u.join(","))]
                    }
                    (Some(s), None) => {
                        let seam = edges.len() + seamed.binary_search(&f).expect("seamed face");
                        let ls = &d.faces[f].loops;
                        let mut u = vec![edge_use(uses(m, &p.world, ls[0])[0]), format!("{{\"edge\":{seam},\"forward\":true}}")];
                        if let SeamEnd::Ring(_) = s.to {
                            u.push(edge_use(uses(m, &p.world, ls[1])[0]));
                        }
                        u.push(format!("{{\"edge\":{seam},\"forward\":false}}"));
                        vec![format!("[{}]", u.join(","))]
                    }
                    (None, None) => d.faces[f].loops.iter().map(|&l| {
                        let u: Vec<String> = uses(m, &p.world, l).into_iter().map(edge_use).collect();
                        format!("[{}]", u.join(","))
                    }).collect(),
                };
                Ok(format!("{{\"loops\":[{}]}}", loops.join(",")))
            }).collect::<R<_>>()?;
            let (areas, perimeters): (Vec<f64>, Vec<f64>) = faces.iter().map(|&f| face_measures(m, &p, f)).collect::<R<Vec<_>>>()?.into_iter().unzip();
            let list = |v: &[f64]| v.iter().map(|x| format!("{x:?}")).collect::<Vec<_>>().join(",");
            let reference = format!(
                "\"referenceMeasurements\":{{\"basis\":\"binary64 evaluation of the exact Model faces (planar: ring discs and Newell polygons of the rounded vertices; bands: 2 pi R L, pi (R0 + R1) slant)\",\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{}],\"faceTolerancesMm\":[{}]}}",
                list(&areas),
                list(&perimeters),
                list(&vec![p.budget; faces.len()])
            );
            let name = if d.solids.len() == 1 { id.clone() } else { format!("{id}/{k}") };
            bodies.push(format!(
                "{{\"id\":\"{}\",\"faces\":[{}],\"edges\":[{}],\"vertices\":[{}],{reference},\"validation\":{{\"toleranceMm\":{},\"volumeMm3\":{}}}}}",
                text(&name),
                face_json.join(","),
                edges.iter().map(|&e| format!("{{\"edge\":{e}}}")).chain(seamed.iter().map(|f| format!("{{\"seam\":{f}}}"))).collect::<Vec<_>>().join(","),
                vertices.join(","),
                p.budget,
                volumes[k]
            ));
        }
    }
    Ok(format!("{{\"schema\":\"wonky/model-export-brep/1\",\"bodies\":[{}]}}\n", bodies.join(",")))
}

/// The area (mm^2) and perimeter (mm) of face `fi` as written, in binary64:
/// a reference for the reader's per-face measures, not an exact value.
fn face_measures(m: &Model, p: &Plan, fi: usize) -> R<(f64, f64)> {
    let d = m.draft();
    let patch_area = if has_patch(m) {
        let c0 = &p.world.mm.columns()[0];
        Some(m.patch_face_measure(FaceId(fi as u32)).map_err(geom)?.0.m * obs1(&dot(c0, c0))?)
    } else {
        None
    };
    let pi = std::f64::consts::PI;
    let mut perimeter = 0.0;
    let mut has_arc = false;
    let mut loops = Vec::new();
    for &l in &d.faces[fi].loops {
        let mut ring = None;
        let mut points = Vec::new();
        for c in &d.loops[l.index()].coedges {
            let c = &d.coedges[c.index()];
            match d.edges[c.edge.index()].bounds {
                Bounds::Segment([a, b]) => {
                    let (s, t) = (p.vertices[a.index()], p.vertices[b.index()]);
                    perimeter += match &p.arcs[c.edge.index()] {
                        // Arc length: radius times the counter-clockwise sweep.
                        Some(r) => {
                            let angle = |v: [f64; 3]| {
                                let v = fsub(v, r.disc.center);
                                fdot(v, r.disc.y).atan2(fdot(v, r.disc.x))
                            };
                            let (ta, mut tb) = (angle(s), angle(t));
                            while tb <= ta {
                                tb += 2.0 * pi;
                            }
                            r.radius * (tb - ta)
                        }
                        None => norm(fsub(t, s)),
                    };
                    has_arc |= p.arcs[c.edge.index()].is_some();
                    points.push(if c.forward { s } else { t });
                }
                Bounds::Ring => {
                    let r = p.rings[c.edge.index()].as_ref().ok_or_else(|| Refused("export/model/edge-plan".into()))?;
                    perimeter += 2.0 * pi * r.radius;
                    ring = Some(r.radius);
                }
            }
        }
        loops.push(match ring {
            Some(r) => pi * r * r,
            None => {
                let mut n = [0.0; 3];
                for k in 0..points.len() {
                    n = fadd(n, fcross(points[k], points[(k + 1) % points.len()]));
                }
                0.5 * norm(n)
            }
        });
    }
    if let Some(area) = patch_area {
        return Ok((area, perimeter));
    }
    if let Some(pw) = p.patches[fi].as_ref().filter(|pw| matches!(pw.patch.profile, Profile::Cone { .. })) {
        // ρ√(1 + k²) leaves Q + Qπ (√2 at 45°): the written frustum's area,
        // an observation as a band's.
        let rp = &pw.patch;
        let sweep = (chart_angle(rp.pu, &rp.u[1])? - chart_angle(rp.pu, &rp.u[0])?).abs();
        let rise = (obs1(&(&rp.v[1] - &rp.v[0]))? * fdot(pw.disc.w, pw.disc.z)).abs();
        let slant = (rise * rise + (pw.radii[1] - pw.radii[0]).powi(2)).sqrt();
        return Ok((sweep * (pw.radii[0] + pw.radii[1]) / 2.0 * slant, perimeter));
    }
    if p.patches[fi].is_some() || p.strips[fi].is_some() || has_arc {
        // Exact face area (patch chart rectangle, strip, or a planar face
        // trimmed by arcs; atan terms enclosed) in model units, scaled to
        // world mm² by the similarity.
        let (lo, hi) = m.face_area_enclosure(FaceId(fi as u32), 64).map_err(geom)?;
        let c0 = &p.world.mm.columns()[0];
        let area = obs1(&((lo + hi) / q(2) * dot(c0, c0)))?.abs();
        return Ok((area, perimeter));
    }
    if let Some(t) = &p.tubes[fi] {
        // 2 pi a (R |dtheta| + a |sin theta1 - sin theta0|) of the written tube.
        let [t0, t1] = t.theta;
        let area = 2.0 * pi * t.minor * (t.major * (t1 - t0).abs() + t.minor * (t1.sin() - t0.sin()) * (t1 - t0).signum());
        return Ok((area, perimeter));
    }
    let area = match &p.bands[fi] {
        None => loops[0] - loops[1..].iter().sum::<f64>(),
        Some(b) => {
            let [r0, r1] = b.radii;
            let length = if b.slope == 0.0 {
                // A cylinder: the axial distance between its two rings.
                let [l0, l1] = &d.faces[fi].loops[..] else { return no("band-loops") };
                let centre = |l: &wonky_geom::model::LoopId| -> R<[f64; 3]> {
                    let c = d.loops[l.index()].coedges[0];
                    Ok(p.rings[d.coedges[c.index()].edge.index()].as_ref().ok_or_else(|| Refused("export/model/edge-plan".into()))?.disc.center)
                };
                fdot(fsub(centre(l1)?, centre(l0)?), b.disc.z).abs()
            } else {
                (r1 - r0).abs() / b.slope.abs()
            };
            if b.slope == 0.0 { 2.0 * pi * r0 * length } else { pi * (r0 + r1) * ((r1 - r0).powi(2) + length * length).sqrt() }
        }
    };
    Ok((area, perimeter))
}

/// The centroid (world mm) of a Model and a per-coordinate bound on its
/// error. The placement `x -> o + A x` maps the centroid exactly to
/// `o + A M / V` with the exact model-frame first moments `M` and volume
/// `V`; the quadratic radical parts are enclosed by `Radical::enclosure`, the
/// multiples of pi and the volume by Machin bounds, and the quotient in Q.
/// The printed binary64 value lies in that enclosure and the bound covers
/// its distance to both ends, so the true centroid is within it.
fn centroid_mm(m: &Model, world: &World) -> R<([f64; 3], [f64; 3])> {
    if has_patch(m) {
        // Enclosures of the model-frame moments and volume, mapped exactly
        // as `o + A M / V`; the bound covers the enclosure widths.
        let parts = m.patch_moments().map_err(geom)?;
        let (mut mm, mut v) = ([wonky_num::Iv::point(0.); 3], wonky_num::Iv::point(0.));
        for (mk, vk) in &parts {
            for k in 0..3 {
                mm[k] = mm[k] + mk[k];
            }
            v = v + *vk;
        }
        if !(v.lo() > 0.) {
            return no("centroid-volume");
        }
        let cols = world.mm.columns();
        let origin = world.mm.origin();
        let (mut centroid, mut bound) = ([0.0; 3], [0.0; 3]);
        for i in 0..3 {
            let mut x = wonky_num::Iv::point(obs1(&origin[i])?);
            for j in 0..3 {
                x = x + wonky_num::Iv::point(obs1(&cols[j][i])?) * mm[j] / v;
            }
            centroid[i] = x.m;
            bound[i] = (x.r + rounding([x.m, 0.0, 0.0])).next_up();
        }
        return Ok((centroid, bound));
    }
    let curve = |e: wonky_curve::Refusal| Refused(e.name().into());
    let parts = m.moments_pi().map_err(geom)?;
    let cols = world.mm.columns();
    let origin = world.mm.origin();
    let mut six = SurdPiValue::default();
    for (_, v) in &parts {
        six.add(v).map_err(geom)?;
    }
    // Six times the model volume; positive for a Model (G8).
    let (v_lo, v_hi) = six.enclosure(64).map_err(geom)?;
    if !v_lo.is_positive() {
        return no("centroid-volume");
    }
    let (mut centroid, mut bound) = ([0.0; 3], [0.0; 3]);
    for i in 0..3 {
        // N = (A M)_i: a radical plus a rational multiple of pi.
        let (rational, pi, atans) = wonky_curve::radical::guard(|| {
            let mut rational = Radical::default();
            let mut pi = Q::zero();
            let mut atans = AtanSum::default();
            for (mo, _) in &parts {
                for j in 0..3 {
                    rational = rational + &mo[j].rational * &cols[j][i];
                    pi += &mo[j].pi * &cols[j][i];
                    atans.add(&mo[j].atans.scaled(&Radical::from(cols[j][i].clone())).map_err(geom)?).map_err(geom)?;
                }
            }
            Ok::<_, Refused>((rational, pi, atans))
        })
        .map_err(curve)??;
        let (r_lo, r_hi) = match rational.rational() {
            Some(r) => (r.clone(), r),
            None => {
                let iv = rational.enclosure().map_err(curve)?;
                let exact = |x: f64| Q::from_float(x).ok_or_else(|| Refused("export/model/centroid-range".into()));
                (exact(iv.lo())?, exact(iv.hi())?)
            }
        };
        let (p_lo, p_hi) = PiValue { rational: Q::zero(), pi, pi2: Q::zero() }.enclosure(64).map_err(geom)?;
        // Sweeps off the quarter grid (strips, planar arcs): atan bounds.
        let (a_lo, a_hi) = atans.bounds(64).map_err(geom)?;
        let (n_lo, n_hi) = ((r_lo + p_lo + a_lo) * q(6), (r_hi + p_hi + a_hi) * q(6));
        let lo = std::cmp::min(&n_lo / &v_lo, &n_lo / &v_hi) + &origin[i];
        let hi = std::cmp::max(&n_hi / &v_lo, &n_hi / &v_hi) + &origin[i];
        let value = obs1(&((&lo + &hi) / q(2)))?;
        let printed = Q::from_float(value).ok_or_else(|| Refused("export/model/centroid-range".into()))?;
        let error = std::cmp::max(&printed - &lo, &hi - &printed);
        // The correctly rounded error is within half an ulp; one step up covers it.
        (centroid[i], bound[i]) = (value, obs1(&error)?.next_up());
    }
    Ok((centroid, bound))
}

/// Host measurement of a curved general-Boolean Model (boolean3d G12), in the
/// schema of `host::measure_json`.
///
/// * volume: the exact Model volume (`volumes_mm3`);
/// * area: the closed-form Model area (`Model::area_enclosure`) times the
///   placement's area scale; a near-rigid binary64 placement adds its
///   orthonormality defect to `areaRelBound`;
/// * centroid: the exact first moments of the Model (`Model::moments_pi`),
///   mapped exactly to the world and enclosed (`centroid_mm`); the bound
///   (`centroidBoundMm`) covers the distance of the printed value to both
///   ends of the enclosure. The divergence volume of the written geometry
///   (polygon fans, discs, and revolution bands integrated in angle
///   analytically and in height by 3-point Gauss) must agree with the exact
///   volume, else `observe/model-moment-check`;
/// * bbox: vertices and ring extents (a band's extremes lie on its rings);
/// * probes: refused by name (no exact Model distance yet);
/// * projection: the STEP topology (`summary_json`): Model vertices, then one
///   vertex per ring, then cone apexes; Model edges, then band seams.
pub fn measure_json(m: &Model, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
    let d = m.draft();
    let p = plan(m)?;
    let world = &p.world;
    let volume: f64 = volumes_mm3(m)?.iter().sum();
    // Area scale of the placement: |c0|^2 (mm^2 per model unit^2), exact for
    // a similarity; otherwise the defect bounds the relative error.
    let [c0, c1, c2] = world.mm.columns();
    let s2 = dot(c0, c0);
    let s2f = obs1(&s2)?;
    let defect = [dot(c1, c1) - &s2, dot(c2, c2) - &s2, dot(c0, c1), dot(c0, c2), dot(c1, c2)]
        .iter().map(|x| obs1(x).map(|v| v.abs() / s2f)).collect::<R<Vec<_>>>()?.into_iter().fold(0.0, f64::max);
    let area_model = if has_patch(m) {
        m.patch_measures().map_err(geom)?.iter().map(|(_, a)| a.m).sum::<f64>()
    } else {
        m.area_enclosure(64).map_err(geom)?.into_iter().map(|(lo, hi)| {
            obs1(&((lo + hi) / q(2)))
        }).collect::<R<Vec<_>>>()?.into_iter().sum::<f64>()
    };
    let area = area_model * s2f;
    // Relative bounds: the exact forms print within 4 ulp; a Model with a
    // sphere patch publishes its enclosure widths (scaled like the values).
    let (volume_rel, area_rel) = if has_patch(m) {
        let [x, y, z] = world.mm.columns();
        let det = obs1(&(dot(x, &cross(y, z)).abs() / q(6)))?;
        let parts = m.patch_measures().map_err(geom)?;
        let vr: f64 = parts.iter().map(|(v6, _)| v6.r * det).sum();
        let ar: f64 = parts.iter().map(|(_, a)| a.r * s2f).sum();
        (((vr / volume.abs()) * (1.0 + 4.0 * f64::EPSILON) + 4.0 * f64::EPSILON).next_up(),
         ((ar / area.abs()) * (1.0 + 4.0 * f64::EPSILON) + 8.0 * f64::EPSILON + 3.0 * defect).next_up())
    } else {
        (4.0 * f64::EPSILON, (8.0 * f64::EPSILON + 3.0 * defect).next_up())
    };
    let (faces, perimeters): (Vec<f64>, Vec<f64>) = (0..d.faces.len()).map(|f| face_measures(m, &p, f)).collect::<R<Vec<_>>>()?.into_iter().unzip();
    // The divergence volume of the written geometry.
    let sign = if world.reflect { -1.0 } else { 1.0 };
    let mut vdiv = 0.0f64;
    let add_fan = |pts: &[[f64; 3]], vdiv: &mut f64| {
        for k in 1..pts.len().saturating_sub(1) {
            let (a, b, c) = (pts[0], pts[k], pts[k + 1]);
            let av = fscale(fcross(fsub(b, a), fsub(c, a)), 0.5 * sign);
            *vdiv += fdot(av, fscale(fadd(fadd(a, b), c), 1.0 / 3.0)) / 3.0;
        }
    };
    for (fi, f) in d.faces.iter().enumerate() {
        // A written sphere zone (latitudes θ0 < θ1, h = a sin θ): outward
        // flux a·2πa(h1 − h0) + (c·z) π (h1² − h0²).
        if let Some(t) = p.tubes[fi].as_ref().filter(|t| t.major == 0.0) {
            let (h0, h1) = (t.minor * t.theta[0].sin(), t.minor * t.theta[1].sin());
            let pi = std::f64::consts::PI;
            // The world image of the own axis is `disc.z`, reversed by a
            // reflecting placement; the outward normal is intrinsic.
            let flux = t.minor * 2.0 * pi * t.minor * (h1 - h0) + sign * fdot(t.disc.center, t.disc.z) * pi * (h1 * h1 - h0 * h0);
            let s = if t.band.forward { 1.0 } else { -1.0 };
            vdiv += s * flux / 3.0;
            continue;
        }
        // A cylinder or cone face bounded by rulings and latitudes (a strip,
        // or a chart rectangle) on its written disc; the angle branch keeps
        // the chart's pole (θ = π, or θ = 0 in the second azimuth patch) off
        // the face. ρ(h) = ρ0 + ρ'·(h − h0), h along z from the disc centre.
        let ruled = match (&p.strips[fi], &p.patches[fi]) {
            (Some(sw), _) => Some((&sw.disc, sw.radius, 0.0, 0.0, false)),
            (None, Some(pw)) if matches!(pw.patch.profile, Profile::Cylinder { .. }) => Some((&pw.disc, pw.radii[0], 0.0, 0.0, pw.patch.pu == Patch::Second)),
            (None, Some(pw)) if matches!(pw.patch.profile, Profile::Cone { .. }) => {
                let h0 = obs1(&pw.patch.v[0])? * fdot(pw.disc.w, pw.disc.z);
                Some((&pw.disc, pw.radii[0], pw.slope, h0, pw.patch.pu == Patch::Second))
            }
            _ => None,
        };
        if let Some((disc, rho0, slope, h0, second)) = ruled {
            // On P = C + h z + ρ(cos θ x + sin θ y), N = P_θ × P_h = ρ(e − ρ' z)
            // and P·N = ρ(C·x cos θ + C·y sin θ + ρ − ρ'(C·z + h)); Green in
            // (θ, h) leaves the rulings: ∫ G(θ, h) dh with G = ρ(C·x sin θ −
            // C·y cos θ + (ρ − ρ'(C·z + h)) θ), cubic in h, so two-point
            // Gauss-Legendre is exact (a cylinder: F(θ) Δh). A reflecting
            // placement reverses the chart sense (`sign`).
            let c = disc.center;
            let (cx, cy, cz) = (fdot(c, disc.x), fdot(c, disc.y), fdot(c, disc.z));
            for l in &f.loops {
                for co in &d.loops[l.index()].coedges {
                    let co = &d.coedges[co.index()];
                    let e = &d.edges[co.edge.index()];
                    let (Bounds::Segment(v), Curve3::Line { .. } | Curve3::RadicalLine { .. }) = (e.bounds, &d.curves[e.curve.index()].geometry) else { continue };
                    let (s, t) = if co.forward { (v[0], v[1]) } else { (v[1], v[0]) };
                    let (s, t) = (fsub(p.vertices[s.index()], c), fsub(p.vertices[t.index()], c));
                    // The written angle, on the branch of the exact chart
                    // parameter t of the ruling (θ = 2 atan t, + π in the
                    // second azimuth patch): a vertex next to the pole may
                    // observe across ±π.
                    let tau = std::f64::consts::TAU;
                    let chart = 2.0 * obsr(&co.pcurve.ends()[0].coordinates()[0])?.atan() + if second { std::f64::consts::PI } else { 0.0 };
                    let angle = |v: [f64; 3]| {
                        let a = fdot(v, disc.y).atan2(fdot(v, disc.x));
                        a + tau * ((chart - a) / tau).round()
                    };
                    let theta = 0.5 * (angle(s) + angle(t));
                    let g = |h: f64| {
                        let rho = rho0 + slope * (h - h0);
                        rho * (cx * theta.sin() - cy * theta.cos() + (rho - slope * (cz + h)) * theta)
                    };
                    let (hs, ht) = (fdot(s, disc.z), fdot(t, disc.z));
                    let (mid, half) = (0.5 * (hs + ht), 0.5 * (ht - hs));
                    let node = half / 3f64.sqrt();
                    vdiv += sign * half * (g(mid - node) + g(mid + node)) / 3.0;
                }
            }
            continue;
        }
        match &p.bands[fi] {
            Some(b) => {
                let w_par = fdot(b.disc.w, b.disc.z);
                let (t0, t1) = (obsr(&b.lo)? * w_par, obsr(&b.hi)? * w_par);
                let (t0, t1) = (t0.min(t1), t0.max(t1));
                let rho0 = obsr(&b.m[0])? * b.disc.unit;
                let (c, z) = (b.disc.center, b.disc.z);
                let s = if b.forward { 1.0 } else { -1.0 };
                let pi = std::f64::consts::PI;
                // 3-point Gauss-Legendre on [t0, t1].
                let g = [(-(0.6f64).sqrt(), 5.0 / 9.0), (0.0, 8.0 / 9.0), ((0.6f64).sqrt(), 5.0 / 9.0)];
                for (x, wgt) in g {
                    let t = 0.5 * (t0 + t1) + 0.5 * (t1 - t0) * x;
                    let wt = 0.5 * (t1 - t0) * wgt * s;
                    let rho = rho0 + b.slope * t;
                    vdiv += wt * 2.0 * pi * (rho * rho - rho * b.slope * (fdot(c, z) + t)) / 3.0;
                }
            }
            None => {
                for l in &f.loops {
                    let mut pts = Vec::new();
                    for c in &d.loops[l.index()].coedges {
                        let co = &d.coedges[c.index()];
                        match d.edges[co.edge.index()].bounds {
                            Bounds::Segment(v) => {
                                pts.push(p.vertices[v[usize::from(!co.forward)].index()]);
                                if let Some(r) = &p.arcs[co.edge.index()] {
                                    // The circular segment between the chord
                                    // and the arc (counter-clockwise about
                                    // the disc from v0 to v1): area vector
                                    // ±R²(φ − sin φ)/2 · z.
                                    let angle = |x: [f64; 3]| {
                                        let x = fsub(x, r.disc.center);
                                        fdot(x, r.disc.y).atan2(fdot(x, r.disc.x))
                                    };
                                    let phi = (angle(p.vertices[v[1].index()]) - angle(p.vertices[v[0].index()])).rem_euclid(std::f64::consts::TAU);
                                    let segment = 0.5 * r.radius * r.radius * (phi - phi.sin());
                                    let s = sign * if co.forward { 1.0 } else { -1.0 };
                                    vdiv += s * segment * fdot(r.disc.z, r.disc.center) / 3.0;
                                }
                            }
                            Bounds::Ring => {
                                let r = p.rings[co.edge.index()].as_ref().ok_or_else(|| Refused("export/model/edge-plan".into()))?;
                                let s = sign * if co.forward { 1.0 } else { -1.0 };
                                let (cc, z, rr) = (r.disc.center, r.disc.z, r.radius);
                                let pa = std::f64::consts::PI * rr * rr;
                                vdiv += s * pa * fdot(z, cc) / 3.0;
                            }
                        }
                    }
                    if !pts.is_empty() {
                        add_fan(&pts, &mut vdiv);
                    }
                }
            }
        }
    }
    let disagreement = (vdiv - volume).abs();
    // The written fan of a sphere patch is no divergence route: Models with
    // patches have the one certified enclosure route (stereo measures).
    let stereo_patch = (0..d.faces.len()).any(|f| m.is_sphere_patch(FaceId(f as u32)));
    if !stereo_patch && !(disagreement <= 1e-9 * volume.abs().max(1.0)) {
        return Err(Refused(format!("observe/model-moment-check(divergence {vdiv:e}, exact {volume:e})")));
    }
    let (centroid, centroid_bound) = centroid_mm(m, world)?;
    // Extents along an affine functional (row, offset): vertices, rings,
    // arcs and sphere patches.
    let extent = |row: [f64; 3], offset: f64| -> R<(f64, f64)> {
        let mut lo = f64::INFINITY;
        let mut hi = f64::NEG_INFINITY;
        for v in &p.vertices {
            let x = fdot(row, *v) + offset;
            lo = lo.min(x);
            hi = hi.max(x);
        }
        for r in p.rings.iter().flatten() {
            let c = fdot(row, r.disc.center) + offset;
            let h = r.radius * fdot(row, r.disc.x).hypot(fdot(row, r.disc.y));
            lo = lo.min(c - h);
            hi = hi.max(c + h);
        }
        // A bounded arc runs counter-clockwise about its disc from its first
        // vertex to its second; its circle's extremes count where they lie
        // inside that sweep (its ends are vertices already).
        let tau = std::f64::consts::TAU;
        for (i, e) in d.edges.iter().enumerate() {
            let (Bounds::Segment([a, b]), Some(r)) = (e.bounds, &p.arcs[i]) else { continue };
            let angle = |v: [f64; 3]| {
                let v = fsub(v, r.disc.center);
                fdot(v, r.disc.y).atan2(fdot(v, r.disc.x))
            };
            let ta = angle(p.vertices[a.index()]);
            let span = (angle(p.vertices[b.index()]) - ta).rem_euclid(tau);
            let (gx, gy) = (fdot(row, r.disc.x), fdot(row, r.disc.y));
            let c = fdot(row, r.disc.center) + offset;
            let h = r.radius * gx.hypot(gy);
            let top = gy.atan2(gx);
            if (top - ta).rem_euclid(tau) <= span {
                hi = hi.max(c + h);
            }
            if (top + std::f64::consts::PI - ta).rem_euclid(tau) <= span {
                lo = lo.min(c - h);
            }
        }
        for x in sphere_extremes(m, world, row)? {
            let v = fdot(row, x) + offset;
            lo = lo.min(v);
            hi = hi.max(v);
        }
        Ok((lo, hi))
    };
    let bbox = |rows: [[f64; 4]; 3]| -> R<([f64; 3], [f64; 3])> {
        let e: [(f64, f64); 3] = [
            extent([rows[0][0], rows[0][1], rows[0][2]], rows[0][3])?,
            extent([rows[1][0], rows[1][1], rows[1][2]], rows[1][3])?,
            extent([rows[2][0], rows[2][1], rows[2][2]], rows[2][3])?,
        ];
        if e.iter().any(|(l, h)| !l.is_finite() || !h.is_finite()) {
            return no("bbox-empty");
        }
        Ok((e.map(|x| x.0), e.map(|x| x.1)))
    };
    let (lo, hi) = bbox([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]])?;
    let mapped = match map {
        Some(rows) => {
            let (l, h) = bbox(rows)?;
            format!("{{\"min\":{},\"max\":{}}}", f3(l), f3(h))
        }
        None => "null".into(),
    };
    // Topology in the CAD-Acid convention: ring edges, no seam vertices; a
    // ring counts as one vertex in the Euler-Poincare genus.
    let rings = d.edges.iter().filter(|e| matches!(e.bounds, Bounds::Ring)).count();
    let apexes = p.seams.iter().flatten().filter(|s| matches!(s.to, SeamEnd::Apex(_))).count();
    let (nv, ne, nf, nl, ns) = (d.vertices.len(), d.edges.len(), d.faces.len(), d.loops.len(), d.shells.len());
    let chi = (nv + rings) as i64 - ne as i64 + 2 * nf as i64 - nl as i64;
    if chi % 2 != 0 {
        return no("euler-poincare");
    }
    let genus = ns as i64 - chi / 2;
    // The projection (vertices, edges, face loops) as the STEP file carries it.
    let mut vertices = p.vertices.clone();
    let mut ring_vertex = vec![None; d.edges.len()];
    for (e, r) in p.rings.iter().enumerate() {
        if let Some(r) = r {
            ring_vertex[e] = Some(vertices.len());
            vertices.push(r.vertex);
        }
    }
    let mut edges: Vec<[usize; 2]> = d.edges.iter().enumerate().map(|(e, x)| match x.bounds {
        Bounds::Segment([a, b]) => [a.index(), b.index()],
        Bounds::Ring => [ring_vertex[e].unwrap(); 2],
    }).collect();
    let mut faces_json = Vec::new();
    for (fi, f) in d.faces.iter().enumerate() {
        let edge_use = |(e, o): (usize, bool)| format!("[{e},{o}]");
        let loops: Vec<String> = match (&p.seams[fi], &p.tubes[fi]) {
            // As written (and as `summary_json` lists it): lower ring first,
            // the seam from the lower end to the upper end (a cap's pole is
            // one end), then back.
            (_, Some(t)) => {
                let seam = edges.len();
                let plan_error = || Refused("export/model/edge-plan".into());
                let mut ends = f
                    .loops
                    .iter()
                    .map(|&l| {
                        let u = uses(m, world, l)[0];
                        tube_ring_lo(m, t, u.0).map(|lo| (lo, u))
                    })
                    .collect::<R<Vec<_>>>()?;
                ends.sort_by_key(|e| !e.0);
                let ring = |e: usize| ring_vertex[e].ok_or_else(plan_error);
                let [lower, upper] = match &ends[..] {
                    [a, b] => [ring(a.1 .0)?, ring(b.1 .0)?],
                    [a] => {
                        vertices.push(t.pole.ok_or_else(plan_error)?);
                        let pole = vertices.len() - 1;
                        if a.0 { [ring(a.1 .0)?, pole] } else { [pole, ring(a.1 .0)?] }
                    }
                    _ => return Err(plan_error()),
                };
                edges.push([lower, upper]);
                let first_lo = ends[0].0;
                let mut u = vec![edge_use(ends[0].1), format!("[{seam},{first_lo}]")];
                if let Some(e) = ends.get(1) {
                    u.push(edge_use(e.1));
                }
                u.push(format!("[{seam},{}]", !first_lo));
                vec![format!("[{}]", u.join(","))]
            }
            (Some(s), None) => {
                let seam = edges.len();
                let to = match &s.to {
                    SeamEnd::Ring(r) => ring_vertex[*r].ok_or_else(|| Refused("export/model/edge-plan".into()))?,
                    SeamEnd::Apex(point) => { vertices.push(*point); vertices.len() - 1 }
                };
                edges.push([ring_vertex[s.from].ok_or_else(|| Refused("export/model/edge-plan".into()))?, to]);
                let ls = &f.loops;
                let mut u = vec![edge_use(uses(m, world, ls[0])[0]), format!("[{seam},true]")];
                if let SeamEnd::Ring(_) = s.to {
                    u.push(edge_use(uses(m, world, ls[1])[0]));
                }
                u.push(format!("[{seam},false]"));
                vec![format!("[{}]", u.join(","))]
            }
            (None, None) => f.loops.iter().map(|&l| format!("[{}]", uses(m, world, l).into_iter().map(edge_use).collect::<Vec<_>>().join(","))).collect(),
        };
        faces_json.push(format!("[{}]", loops.join(",")));
    }
    let probes: Vec<String> = probes.iter().map(|_| "{\"refused\":\"observe/model-probe-distance-unimplemented\"}".to_string()).collect();
    let list = |v: &[f64]| v.iter().map(|x| format!("{x:?}")).collect::<Vec<_>>().join(",");
    Ok(format!(
        concat!(
            "{{\"basis\":\"native-f64-construction\",\"certificate\":\"GeneralBooleanModel\",\"axis\":null,\"boundToConstruction\":true,",
            "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{}],",
            "\"centroidMm\":{},\"centroidBoundMm\":{},\"bboxMm\":{{\"min\":{},\"max\":{}}},\"mappedBboxMm\":{},",
            "\"topology\":{{\"bodies\":{},\"shells\":{},\"faces\":{},\"edges\":{},\"vertices\":{},\"loops\":{},\"ringEdges\":{},\"closedToroidalFaces\":0,\"genus\":{},\"singularPoints\":{},\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":{}}},\"toleranceMm\":{:?},",
            "\"frame\":{{\"orthonormalityDefect\":{:?}}},\"probes\":[{}],",
            "\"projection\":{{\"vertices\":[{}],\"edges\":[{}],\"faces\":[{}]}}}}"
        ),
        volume,
        volume_rel,
        area,
        area_rel,
        list(&faces),
        list(&perimeters),
        f3(centroid),
        f3(centroid_bound),
        f3(lo),
        f3(hi),
        mapped,
        d.solids.len(),
        ns,
        nf,
        ne,
        nv,
        nl,
        rings,
        genus,
        apexes,
        volume > 0.0,
        p.budget,
        defect,
        probes.join(","),
        vertices.iter().map(|v| f3(*v)).collect::<Vec<_>>().join(","),
        edges.iter().map(|e| format!("[{},{}]", e[0], e[1])).collect::<Vec<_>>().join(","),
        faces_json.join(","),
    ))
}
fn f3(v: [f64; 3]) -> String {
    format!("[{:?},{:?},{:?}]", v[0], v[1], v[2])
}

#[cfg(test)]
mod rechart_tests {
    use super::*;
    fn q(n: i64, d: i64) -> Q {
        Q::new(n.into(), d.into())
    }
    fn p(x: Q, y: Q, z: Q) -> Point {
        [x, y, z]
    }
    fn chart(frame: Frame, height: Q, r: Q) -> Chart {
        Chart { frame, height: Radical::from(height), r: Radical::from(r) }
    }
    fn lift(p: Point) -> RPoint {
        wonky_geom::model::algebraic::lift(&p)
    }
    /// A ring centred on the band axis is re-charted onto the generator
    /// through `toward` with the same radius and sense; a tilted circle
    /// through the same chart point is not that circle and refuses.
    #[test]
    fn rechart_admits_only_the_same_circle() {
        let band = Frame::identity();
        let (o, i) = (q(0, 1), q(1, 1));
        let toward = p(q(3, 1), q(4, 1), o.clone());
        let flat = chart(Frame::identity(), o.clone(), q(5, 1));
        let moved = rechart(&band, &lift(toward.clone()), &flat).expect("same circle");
        // Columns carry |toward| = 5, so the chart radius is 1 (point set radius 5).
        assert_eq!(moved.r, Radical::from(q(1, 1)));
        assert!(moved.height.is_zero());
        assert_eq!(moved.frame.columns()[0], p(q(3, 1), q(4, 1), o.clone()));
        // A ring at chart height 2 of its frame: the same circle, centred on
        // the lifted centre.
        let lifted = rechart(&band, &lift(toward.clone()), &chart(Frame::identity(), q(2, 1), q(5, 1))).expect("same lifted circle");
        assert_eq!(lifted.frame.origin(), &p(o.clone(), o.clone(), q(2, 1)));
        assert_eq!(lifted.r, Radical::from(q(1, 1)));
        // Rotated about x by (cos, sin) = (3/5, 4/5): chart point (5,0,0) is
        // unchanged, but the circle leaves the plane perpendicular to the axis.
        let tilted = Frame::new(
            p(o.clone(), o.clone(), o.clone()),
            [p(i.clone(), o.clone(), o.clone()), p(o.clone(), q(3, 5), q(4, 5)), p(o.clone(), q(-4, 5), q(3, 5))],
        )
        .unwrap();
        let error = rechart(&band, &lift(toward.clone()), &chart(tilted, o.clone(), q(5, 1))).unwrap_err();
        assert_eq!(error.0, "export/model/seam-off-generator");
        // A Q(√d) radius has no rational re-chart: it refuses by name.
        let surd = Chart { frame: Frame::identity(), height: Radical::default(), r: Radical::quadratic(q(0, 1), q(1, 1), q(2, 1)).expect("sqrt 2") };
        let error = rechart(&band, &lift(toward), &surd).unwrap_err();
        assert_eq!(error.0, "export/model/seam-off-generator");
    }
}
