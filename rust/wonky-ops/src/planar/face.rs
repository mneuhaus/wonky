//! Port of kernel/face-classification.bend (planar faces, line edges) and the
//! line branch of kernel/curve-plane.bend: point membership in a trimmed
//! planar face by a boundary-distance test and five in-plane rays.
//!
//! As in kernel/ports/planar-boolean-classification.bend (K.prepare), the
//! point-independent work is done once per face (`PFace::new`): loop
//! preparation, the five ray directions, per ray and line edge the curve-plane
//! coefficient b, the exact parallel certificate and the near-parallel test
//! (a near-parallel, non-parallel edge makes the ray invalid for every point:
//! `dead`). Per query, an edge whose answer is certain is skipped by a cheap
//! f64 bound with a slack far above f64 rounding (`far_line`, `box_far`), and
//! then gets exactly the answer the full evaluation would give. Every other
//! comparison is a certified interval decision (num::lt/le), every zero test
//! exact (exact.rs). `PFace::classify` answers what F.face_surface answers.

use crate::exact;
use crate::model::*;
use crate::num::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaceClass {
    Inside,
    Outside,
    Boundary,
    Unresolved,
}

#[derive(Clone, Copy, Debug)]
pub struct PEdge {
    pub start: P3,
    pub end: P3,
    pub origin: P3,
    pub direction: P3,
    pub first: f64,
    pub last: f64,
    /// max-norm box of start/end and |start| + |end| + |origin| (max norms)
    pub lo: P3,
    pub hi: P3,
    pub mag: f64,
}

#[derive(Clone, Debug)]
pub struct PLoop {
    pub outer: bool,
    pub edges: Vec<PEdge>,
}

/// Point-independent part of curve-plane classify for one line edge and one ray cut plane.
#[derive(Clone, Copy, Debug)]
pub struct RayEdge {
    /// dot(normalize(cut), direction)
    pub b: Iv,
    /// exact: dot(cut, direction) == 0
    pub parallel: bool,
    pub babs: f64,
    pub dir_mag: f64,
    pub len: f64,
}

#[derive(Clone, Debug)]
pub struct Ray {
    /// normalize(direction)
    pub unit: P3,
    /// normalize(cross(normal, unit))
    pub cut: P3,
    /// normalize(cut)
    pub un: I3,
    pub un_f: P3,
    pub geometry_ok: bool,
    /// some line edge is near-parallel and not parallel: invalid for every point
    pub dead: bool,
    /// per loop, per edge (aligned with PFace::loops)
    pub edges: Vec<Vec<RayEdge>>,
}

#[derive(Clone, Debug)]
pub struct PFace {
    pub plane: bool,
    pub geometry_ok: bool,
    pub origin: P3,
    pub unit: P3,
    /// None: a point-independent preparation failure (fixed reason or open loop).
    pub loops: Option<Vec<PLoop>>,
    /// max endpoint / plane incidence errors of all prepared uses (compared with the per-point budget)
    pub max_endpoint: Iv,
    pub max_planar: Iv,
    pub outer_count: u32,
    pub rays: Vec<Ray>,
    /// F.edges_scale over all edges of the solid, folded without the point term.
    pub edges_top: f64,
}

fn line_parameter(origin: I3, direction: I3, point: I3) -> Iv {
    point.sub(origin).dot(direction) / direction.dot(direction)
}

/// C.curve_valid for a line
fn line_curve_valid(origin: P3, direction: P3) -> bool {
    vec_valid(origin) && vec_valid(direction) && direction_valid(direction)
}

/// F.curve_scale over all edges (a line: magnitude(origin)).
pub fn edges_top(edges: &[Edge]) -> f64 {
    edges.iter().fold(f64::NEG_INFINITY, |s, e| match e.curve {
        Curve::Line { origin, .. } => s.max(origin.magnitude()),
        Curve::Round => f64::INFINITY,
    })
}

enum Prep {
    Fixed,
    Gap(PEdge, Iv, Iv),
}

fn prepare_use(u: &Use, vertices: &[P3], edges: &[Edge], domains: &[DomainChoice], origin: P3, unit: P3) -> Prep {
    let choice = domains.get(u.edge as usize).copied().unwrap_or(DomainChoice::Auto);
    let Some(edge) = edges.get(u.edge as usize) else { return Prep::Fixed };
    let Curve::Line { origin: lo, direction } = edge.curve else { return Prep::Fixed };
    if !line_curve_valid(lo, direction) {
        return Prep::Fixed;
    }
    let (Some(start), Some(end)) = (vertices.get(edge.start as usize), vertices.get(edge.end as usize)) else { return Prep::Fixed };
    if !(vec_valid(*start) && vec_valid(*end)) {
        return Prep::Fixed;
    }
    let domain = match choice {
        DomainChoice::Auto => {
            // line_parameter in f64 (a constructed domain, as Bend stores its F32x2 value)
            let lp = |p: P3| p.sub(lo).dot(direction) / direction.dot(direction);
            let (a, b) = (lp(*start), lp(*end));
            Domain::Interval { first: a.min(b), last: a.max(b) }
        }
        DomainChoice::Given(d) => d,
    };
    let Domain::Interval { first, last } = domain else { return Prep::Fixed }; // a line needs a finite domain
    if !(scalar_valid(first) && scalar_valid(last) && first < last) {
        return Prep::Fixed;
    }
    // endpoint_error (Interval): curve points at the domain ends against the stored vertices
    let (o, d) = (lo.iv(), direction.iv());
    let (pa, pb) = if edge.same_sense { (first, last) } else { (last, first) };
    let a = o.add(d.scale(Iv::point(pa)));
    let b = o.add(d.scale(Iv::point(pb)));
    let endpoints = start.iv().sub(a).length().max(end.iv().sub(b).length());
    // plane_error_line with coefficients(curve, origin, unit): b = dot(n, dir), c = dot(n, lo - origin), n = normalize(unit)
    let n = unit.iv().normalize();
    let cb = n.dot(d);
    let cc = n.dot(o.sub(origin.iv()));
    let planar = (cb * Iv::point(first) + cc).abs().max((cb * Iv::point(last) + cc).abs());
    let (s, t) = (*start, *end);
    let pedge = PEdge {
        start: s,
        end: t,
        origin: lo,
        direction,
        first,
        last,
        lo: v3(s.x.min(t.x), s.y.min(t.y), s.z.min(t.z)),
        hi: v3(s.x.max(t.x), s.y.max(t.y), s.z.max(t.z)),
        mag: s.magnitude() + t.magnitude() + lo.magnitude(),
    };
    Prep::Gap(pedge, endpoints, planar)
}

/// F.loop_valid on the prepared edges: consecutive uses chain start -> end.
fn loop_closed(uses: &[Use], edges: &[Edge]) -> bool {
    if uses.is_empty() {
        return false;
    }
    let s = |u: &Use| {
        let e = &edges[u.edge as usize];
        if u.forward {
            e.start
        } else {
            e.end
        }
    };
    let t = |u: &Use| {
        let e = &edges[u.edge as usize];
        if u.forward {
            e.end
        } else {
            e.start
        }
    };
    for i in 0..uses.len() {
        let next = &uses[(i + 1) % uses.len()];
        if t(&uses[i]) != s(next) {
            return false;
        }
    }
    true
}

impl PFace {
    /// `tol`: the operation's tolerance; None prepares no rays (loop checks only).
    pub fn new(face: &Face, vertices: &[P3], edges: &[Edge], domains: &[DomainChoice], edges_top: f64, tol: Option<&Tolerance>) -> PFace {
        let (plane, origin, normal) = match face.surface {
            Surface::Plane { origin, normal, .. } => (true, origin, normal),
            Surface::Other => (false, v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 1.0)),
        };
        let geometry_ok = plane && vec_valid(origin) && vec_valid(normal) && direction_valid(normal);
        let unit = normal.normalize();
        let mut loops = Some(Vec::with_capacity(face.loops.len()));
        let mut max_endpoint = Iv::point(0.0);
        let mut max_planar = Iv::point(0.0);
        let mut outer_count = 0;
        for l in &face.loops {
            let mut pedges = Vec::with_capacity(l.uses.len());
            let mut fixed = false;
            for u in &l.uses {
                match prepare_use(u, vertices, edges, domains, origin, unit) {
                    Prep::Fixed => fixed = true,
                    Prep::Gap(e, a, b) => {
                        max_endpoint = max_endpoint.max(a);
                        max_planar = max_planar.max(b);
                        pedges.push(e);
                    }
                }
            }
            if fixed || !loop_closed(&l.uses, edges) {
                loops = None;
            } else if let Some(ls) = loops.as_mut() {
                ls.push(PLoop { outer: l.outer, edges: pedges });
            }
            if l.outer {
                outer_count += 1;
            }
        }
        let mut rays = Vec::new();
        if let (Some(tol), Some(ls)) = (tol, loops.as_ref()) {
            // F.classify_rays directions: u = axis_x(normal), v = cross(normal, u)
            let u = axis_x(unit, unit.x.abs() < 0.9_f32 as f64);
            let v = unit.cross(u);
            let near_limit = Iv::point(tol.angular) + Iv::point(angular_guard());
            for d in [u, u.add(v.scale(0.375)), u.add(v.scale(0.8125)), u.add(v.scale(1.3125)), v] {
                let ud = d.normalize();
                let cut = unit.cross(ud).normalize();
                let un = cut.iv().normalize();
                let mut dead = false;
                let redges = ls
                    .iter()
                    .map(|l| {
                        l.edges
                            .iter()
                            .map(|e| {
                                let di = e.direction.iv();
                                let b = un.dot(di);
                                let parallel = exact::perpendicular(cut, e.direction, "ray parallel certificate");
                                if !parallel && le(b.abs() / di.length(), near_limit, "ray near parallel") {
                                    dead = true;
                                }
                                RayEdge { b, parallel, babs: b.m.abs(), dir_mag: e.direction.magnitude(), len: e.direction.length() }
                            })
                            .collect()
                    })
                    .collect();
                rays.push(Ray { unit: ud, cut, un, un_f: v3(un.x.m, un.y.m, un.z.m), geometry_ok: vec_valid(cut) && direction_valid(cut), dead, edges: redges });
            }
        }
        PFace { plane, geometry_ok, origin, unit, loops, max_endpoint, max_planar, outer_count, rays, edges_top }
    }

    /// F.face_surface(face, vertices, edges, domains, point, tolerance, source_budget)
    pub fn classify(&self, point: P3, tol: &Tolerance, source_budget: f64) -> FaceClass {
        if !self.plane {
            return FaceClass::Unresolved;
        }
        if !(self.geometry_ok && vec_valid(point)) {
            return FaceClass::Unresolved;
        }
        let linear = Iv::point(tol.linear);
        // plane_valid: resolution from the point, the face origin and every edge of the solid
        let scale = self.edges_top.max(point.magnitude().max(self.origin.magnitude()).max(1.0));
        let resolution = Iv::point(angular_guard()) * Iv::point(scale);
        if !lt(resolution, linear, "face resolution") {
            return FaceClass::Unresolved;
        }
        let budget = Iv::point(source_budget) + resolution;
        let Some(loops) = &self.loops else { return FaceClass::Unresolved };
        if !(le(self.max_endpoint, budget, "face endpoint gap") && le(self.max_planar, budget, "face plane gap")) {
            return FaceClass::Unresolved;
        }
        if self.outer_count != 1 {
            return FaceClass::Unresolved;
        }
        let n = self.unit.iv();
        let offset = point.iv().sub(self.origin.iv()).dot(n).abs();
        if le((offset - linear).abs(), resolution, "face near plane") {
            return FaceClass::Unresolved;
        }
        if lt(linear + resolution, offset, "face off plane") {
            return FaceClass::Outside;
        }
        // project(point, origin, unit), constructed
        let projected = point.sub(self.unit.scale(point.sub(self.origin).dot(self.unit)));
        let margin = linear + Iv::point(source_budget) + resolution;
        let box_clear = 2.0 * (tol.linear + resolution.hi() + source_budget + budget.hi());
        match boundaries(loops, projected, self.origin, self.unit, linear, Iv::point(source_budget), resolution, box_clear) {
            Bound::On => FaceClass::Boundary,
            Bound::Uncertain => FaceClass::Unresolved,
            Bound::Clear => self.classify_rays(loops, projected, tol, margin),
        }
    }

    fn classify_rays(&self, loops: &[PLoop], point: P3, tol: &Tolerance, margin: Iv) -> FaceClass {
        let mut count = 0u32;
        let mut inside = false;
        let mut conflict = false;
        let point_ok = vec_valid(point);
        for ray in &self.rays {
            let mut valid = point_ok && ray.geometry_ok && !ray.dead;
            let mut outer = false;
            let mut hole = false;
            if valid {
                'loops: for (l, redges) in loops.iter().zip(&ray.edges) {
                    let mut crossings = 0u32;
                    for (e, re) in l.edges.iter().zip(redges) {
                        match ray_edge(e, re, point, ray, tol, margin) {
                            None => {
                                valid = false;
                                break 'loops;
                            }
                            Some(k) => crossings += k,
                        }
                    }
                    let odd = crossings & 1 == 1;
                    if l.outer {
                        outer |= odd;
                    } else {
                        hole |= odd;
                    }
                }
            }
            if valid {
                let next = outer && !hole;
                if count != 0 && next != inside {
                    conflict = true;
                }
                inside = next;
                count += 1;
            }
        }
        if conflict || count < 2 {
            FaceClass::Unresolved
        } else if inside {
            FaceClass::Inside
        } else {
            FaceClass::Outside
        }
    }
}

enum Bound {
    Clear,
    On,
    Uncertain,
}

/// A relative slack of 2^-30 of the magnitudes involved: f64 rounding of the
/// few bound operations is below 2^-50 of them.
#[inline]
fn slack(mag: f64) -> f64 {
    (1.0 + mag) * (1.0 / 1073741824.0)
}

#[allow(clippy::too_many_arguments)]
fn boundaries(loops: &[PLoop], point: P3, face_origin: P3, normal: P3, linear: Iv, source_budget: Iv, resolution: Iv, box_clear: f64) -> Bound {
    let p = point.iv();
    let n = normal.iv();
    let fo = face_origin.iv();
    let mh = point.magnitude();
    let mut uncertain = false;
    for l in loops {
        for e in &l.edges {
            // box_far: the trimmed line is within the loop budget of its vertex segment
            let gap = |lo: f64, hi: f64, x: f64| (lo - x).max(x - hi).max(0.0);
            let distance = gap(e.lo.x, e.hi.x, point.x).max(gap(e.lo.y, e.hi.y, point.y)).max(gap(e.lo.z, e.hi.z, point.z));
            if distance > box_clear + 4.0 * slack(e.mag + mh) {
                continue; // ClearBoundary
            }
            let (o, d) = (e.origin.iv(), e.direction.iv());
            let t = line_parameter(o, d, p).min(Iv::point(e.last)).max(Iv::point(e.first));
            let candidate = o.add(d.scale(t));
            let lower = p.sub(candidate).length();
            let projected = candidate.sub(n.scale(candidate.sub(fo).dot(n)));
            let upper = p.sub(projected).length();
            if le(upper, linear - resolution, "boundary on") {
                return Bound::On;
            }
            let clear = lt(linear + resolution, (lower - source_budget).max(Iv::point(0.0)), "boundary clear");
            if !clear {
                uncertain = true;
            }
        }
    }
    if uncertain {
        Bound::Uncertain
    } else {
        Bound::Clear
    }
}

/// One line edge against one in-plane ray (F.ray_edge with K's prepared b,
/// parallel and far-line skip): None = invalid ray, Some(count).
fn ray_edge(e: &PEdge, re: &RayEdge, point: P3, ray: &Ray, tol: &Tolerance, margin: Iv) -> Option<u32> {
    let linear_f = tol.linear;
    let mh = point.magnitude();
    // far_line: both vertices far on one side of the cut plane (K.far_line)
    let hn = point.dot(ray.un_f);
    let (ds, de) = (e.start.dot(ray.un_f) - hn, e.end.dot(ray.un_f) - hn);
    let a = slack(e.mag + mh);
    let w = 3.0 * (linear_f + margin.hi()) + 4.0 * a;
    if (ds > w && de > w) || (ds < -w && de < -w) {
        let scale0 = e.origin.magnitude().max(mh).max(1.0);
        let linear_ok = round_guard() * scale0 * 1.0001 <= linear_f || le(Iv::point(round_guard()) * Iv::point(scale0), Iv::point(linear_f), "ray linear budget");
        if !linear_ok {
            return None;
        }
        if re.parallel {
            return Some(0); // Disjoint: the whole line is that far
        }
        let dn = e.origin.dot(ray.un_f) - hn;
        let t = (dn.abs() + a) / re.babs * 1.0001;
        let g = round_guard() * (1.0 + e.mag + mh + 2.0 * re.dir_mag * t) * 1.0001;
        if t <= 1.0e9 && g * (1.0 + re.len / re.babs) * 1.001 <= 0.5 * linear_f {
            return Some(0); // the root is outside the trimmed interval: Disjoint
        }
    }
    let p = point.iv();
    let cut = ray.cut.iv();
    // ray_avoids_vertices (Interval domain)
    if !(lt(margin, e.start.iv().sub(p).dot(cut).abs(), "ray vertex clear") && lt(margin, e.end.iv().sub(p).dot(cut).abs(), "ray vertex clear")) {
        return None;
    }
    let linear = Iv::point(linear_f);
    let guard = |s: Iv| Iv::point(round_guard()) * s;
    // input_scale(curve origin, point, radius 0)
    let scale = Iv::point(e.origin.magnitude().max(mh).max(1.0));
    if !le(guard(scale), linear, "ray linear budget") {
        return None;
    }
    // C.classify: coefficients with unit = normalize(cut)
    let (o, d) = (e.origin.iv(), e.direction.iv());
    let b = re.b;
    let c = ray.un.dot(o.sub(p));
    if re.parallel {
        // parallel_curve
        if exact::coincident(ray.cut, e.origin, point, "ray coincidence certificate") {
            return None; // Coincident: not a Crossing/Disjoint relation
        }
        return if lt(linear + guard(scale), c.abs(), "ray parallel clear") { Some(0) } else { None };
    }
    // (near-parallel edges made the ray dead)
    // line_root
    let t = -c / b;
    let hit = o.add(d.scale(t));
    let g = guard(scale.max(hit.magnitude().max(d.scale(t).magnitude())));
    let parameter_resolution = g / b.abs();
    let linear_resolution = g + d.length() * parameter_resolution;
    if !le(t.abs(), Iv::point(LIMIT), "ray parameter range") {
        return None; // Rejected OutputRange
    }
    if !le(linear_resolution, linear, "ray linear resolution") {
        return None; // LinearBudget
    }
    let (first, last) = (Iv::point(e.first), Iv::point(e.last));
    // AtFirst/NearFirst/AtLast/NearLast all end in an endpoint or ambiguous hit: invalid ray
    if le((t - first).abs(), parameter_resolution, "ray near first") || le((t - last).abs(), parameter_resolution, "ray near last") {
        return None;
    }
    if lt(t, first, "ray before first") || lt(last, t, "ray after last") {
        return Some(0);
    }
    // Interior hit: along the ray
    let along = hit.sub(p).dot(ray.unit.iv());
    if !lt(margin, along.abs(), "ray hit margin") {
        return None;
    }
    Some(if lt(margin, along, "ray hit forward") { 1 } else { 0 })
}
