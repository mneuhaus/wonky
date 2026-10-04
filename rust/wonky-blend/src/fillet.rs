//! Exact plane/plane cylinders and local face surgery.
//! The boundary owns analytic arcs, not tessellation or an operation graph.
//! This layer returns a local boundary. Production adapters must prove the
//! complete output domain and pass the shared Model audit before WC0 admission.
use crate::{stripes, Convexity, EndCondition, Refusal, Request, Result, Section};
use num_traits::{One, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_curve::radical::{self, Radical};
use wonky_geom::model::{Bounds, Carrier3, Curve3, EdgeId, FaceId, Model, VertexId};
use wonky_geom::{cross, dot, sub, Point, Q};

pub type RPoint = [Radical; 3];
fn lift(p: &Point) -> RPoint {
    p.clone().map(Radical::from)
}
fn subtract(a: &RPoint, b: &RPoint) -> RPoint {
    std::array::from_fn(|i| &a[i] - &b[i])
}
fn scalar(a: &RPoint, b: &RPoint) -> Radical {
    (0..3).fold(Radical::default(), |s, i| s + &a[i] * &b[i])
}
fn vector(a: &RPoint, b: &RPoint) -> RPoint {
    std::array::from_fn(|i| &a[(i + 1) % 3] * &b[(i + 2) % 3] - &a[(i + 2) % 3] * &b[(i + 1) % 3])
}
fn sqrt(q: Q) -> Result<Radical> {
    Radical::quadratic(Q::zero(), Q::one(), q).map_err(|e| Refusal(format!("blend/{e:?}")))
}
fn fail<T>(code: &str) -> Result<T> {
    Err(Refusal(format!("blend/{code}")))
}

/// Short circle arc: the two radial endpoints determine the sweep (< pi).
/// Axis scale is immaterial; its sign defines the positive orientation.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Arc {
    pub center: RPoint,
    pub axis: Point,
    pub radius2: Q,
}
#[derive(Clone, Debug)]
pub struct Piece {
    pub start: RPoint,
    pub end: RPoint,
    pub arc: Option<Arc>,
}
impl Piece {
    fn reversed(&self) -> Self {
        Self {
            start: self.end.clone(),
            end: self.start.clone(),
            arc: self.arc.clone(),
        }
    }
}
#[derive(Clone, Debug)]
pub enum Carrier {
    Plane {
        normal: Point,
        offset: Q,
    },
    Cylinder {
        origin: RPoint,
        axis: Point,
        radius2: Q,
        convexity: Convexity,
    },
}
#[derive(Clone, Debug)]
pub struct Face {
    pub carrier: Carrier,
    pub loops: Vec<Vec<Piece>>,
    /// Source face retained by surgery; None is a new cylinder.
    pub source: Option<FaceId>,
}
#[derive(Clone, Debug)]
pub struct Stripe {
    pub edge: EdgeId,
    pub supports: [FaceId; 2],
    pub convexity: Convexity,
    pub axis: Point,
    pub centers: [RPoint; 2],
    /// Endpoint first, then support in the graph's stable support order.
    pub springs: [[RPoint; 2]; 2],
    pub radius: Q,
    pub source_points: [Point; 2],
    pub source_normals: [Point; 2],
}
#[derive(Clone, Debug)]
pub struct Boundary {
    pub faces: Vec<Face>,
    pub stripes: Vec<Stripe>,
}

/// Foot of the ball centre on a stripe. In particular a three-plane corner
/// does not generally have setback r; no normalization or f64 is involved.
pub fn project_on_stripe(center: &RPoint, origin: &Point, axis: &Point) -> Result<RPoint> {
    let a = lift(axis);
    let aa = scalar(&a, &a);
    if aa.is_zero() {
        return fail("contract-violation:projection/zero-axis");
    }
    let o = lift(origin);
    let t = scalar(&subtract(center, &o), &a) / aa;
    Ok(std::array::from_fn(|i| &o[i] + &t * &a[i]))
}

/// Solve the offset planes in the source metric. This is also the general
/// centre construction needed by later corner stages, without building them.
pub fn offset_plane_center(planes: [(Point, Q); 3], radius: &Q) -> Result<RPoint> {
    radical::guard(|| {
        if radius <= &Q::zero() {
            return fail("invalid-size");
        }
        let normals = planes.each_ref().map(|p| lift(&p.0));
        let rhs = planes
            .each_ref()
            .map(|p| {
                sqrt(dot(&p.0, &p.0))
                    .map(|len| Radical::from(p.1.clone()) - Radical::from(radius.clone()) * len)
            })
            .into_iter()
            .collect::<Result<Vec<_>>>()?;
        let bc = vector(&normals[1], &normals[2]);
        let ca = vector(&normals[2], &normals[0]);
        let ab = vector(&normals[0], &normals[1]);
        let det = scalar(&normals[0], &bc);
        if det.is_zero() {
            return fail("corner-degenerate");
        }
        Ok(std::array::from_fn(|i| {
            (&rhs[0] * &bc[i] + &rhs[1] * &ca[i] + &rhs[2] * &ab[i]) / &det
        }))
    })
    .map_err(|e| Refusal(format!("blend/{e:?}")))?
}

fn section(input: &Model, edge: &crate::EdgeClass, radius: &Q) -> Result<Stripe> {
    let ends = match input.draft().edges[edge.edge.index()].bounds {
        Bounds::Segment(v) => v,
        Bounds::Ring => return fail("requires-line-edges"),
    };
    let points: [Point; 2] = ends
        .map(|v| {
            input
                .key(v)
                .rational()
                .map(|p| input.draft().placement.point(p))
        })
        .into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()?
        .try_into()
        .unwrap();
    let axis = sub(&points[1], &points[0]);
    let ns = edge
        .supports
        .map(|f| input.source_normal(f))
        .into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let aa = dot(&ns[0], &ns[0]);
    let bb = dot(&ns[1], &ns[1]);
    let ab = dot(&ns[0], &ns[1]);
    let det = &aa * &bb - &ab * &ab;
    if det.is_zero() {
        return fail("tangent-edge");
    }
    let lengths = [sqrt(aa.clone())?, sqrt(bb.clone())?];
    let sign = if edge.convexity == Convexity::Convex {
        -Q::one()
    } else {
        Q::one()
    };
    let offsets = lengths
        .each_ref()
        .map(|l| Radical::from(&sign * radius) * l);
    let u = (&offsets[0] * Radical::from(bb) - &offsets[1] * Radical::from(ab.clone()))
        / Radical::from(det.clone());
    let v =
        (&offsets[1] * Radical::from(aa) - &offsets[0] * Radical::from(ab)) / Radical::from(det);
    let delta: RPoint = std::array::from_fn(|i| {
        &u * Radical::from(ns[0][i].clone()) + &v * Radical::from(ns[1][i].clone())
    });
    let centers = points
        .each_ref()
        .map(|p| std::array::from_fn(|i| Radical::from(p[i].clone()) + &delta[i]));
    let springs = centers.each_ref().map(|c| {
        std::array::from_fn(|s| {
            std::array::from_fn(|i| &c[i] - Radical::from(&sign * radius * &ns[s][i]) / &lengths[s])
        })
    });
    Ok(Stripe {
        edge: edge.edge,
        supports: edge.supports,
        convexity: edge.convexity,
        axis,
        centers,
        springs,
        radius: radius.clone(),
        source_points: points,
        source_normals: ns.try_into().unwrap(),
    })
}

/// Construct real analytic geometry, with exact widths for overflow. Both
/// allowEdgeOverflow settings refuse notches in F1b; false is retained in the
/// refusal because it is a semantic constraint, not a numeric fallback.
pub fn plane_plane(
    input: &Model,
    selected: &[EdgeId],
    request: Request,
    allow_edge_overflow: bool,
) -> Result<Boundary> {
    radical::guard(|| {
        build(
            input,
            selected,
            request,
            allow_edge_overflow,
            &BTreeMap::new(),
        )
    })
    .map_err(|e| Refusal(format!("blend/{e:?}")))?
}

/// Independent constant-radius stripes on the same source, useful for the
/// shadow of successive fillet operations. Admission forbids shared selected
/// vertices, so this does not implement a variable-radius or mitre feature.
pub fn plane_plane_radii(
    input: &Model,
    sizes: &[(EdgeId, Q)],
    allow_edge_overflow: bool,
) -> Result<Boundary> {
    radical::guard(|| {
        if sizes.is_empty() {
            return fail("empty-selection");
        }
        let mut radii = BTreeMap::new();
        for (edge, radius) in sizes {
            if radius <= &Q::zero() {
                return fail("invalid-size");
            }
            if let Some(old) = radii.insert(*edge, radius.clone()) {
                if old != *radius {
                    return fail("conflicting-stripe-radii");
                }
            }
        }
        let selected = radii.keys().copied().collect::<Vec<_>>();
        build(
            input,
            &selected,
            Request {
                section: Section::Fillet {
                    radius: sizes[0].1.clone(),
                },
                tangent_propagation: false,
            },
            allow_edge_overflow,
            &radii,
        )
    })
    .map_err(|e| Refusal(format!("blend/{e:?}")))?
}

fn build(
    input: &Model,
    selected: &[EdgeId],
    request: Request,
    allow: bool,
    radii: &BTreeMap<EdgeId, Q>,
) -> Result<Boundary> {
    let radius = match &request.section {
        Section::Fillet { radius } => radius.clone(),
        Section::EqualOffsets { .. } | Section::TwoOffsets { .. } => {
            return fail("fillet-section-required")
        }
    };
    let graph = stripes(input, selected, request)?;
    for v in &graph.vertices {
        if v.end.condition != EndCondition::PerpendicularCap {
            return Err(Refusal(format!(
                "blend/vertex-network-unsupported:{:?}",
                v.end.condition
            )));
        }
    }
    let d = input.draft();
    let mut faces = Vec::new();
    for (i, f) in d.faces.iter().enumerate() {
        match &d.surfaces[f.surface.index()].carrier {
            Carrier3::Plane(_) => {}
            Carrier3::Rotated(_) => return fail("rotated-source-normal-unavailable"),
            Carrier3::RadicalPlane(_) => return fail("radical-source-normal-unavailable"),
            Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => {
                return fail("curved-source-boundary-unavailable")
            }
        }
        let normal = input.source_normal(FaceId(i as u32))?;
        let mut loops = Vec::new();
        for l in &f.loops {
            let mut pieces = Vec::new();
            for c in &d.loops[l.index()].coedges {
                let co = &d.coedges[c.index()];
                let edge = &d.edges[co.edge.index()];
                match &d.curves[edge.curve.index()].geometry {
                    Curve3::Line { .. } => {}
                    Curve3::RadicalLine { .. } | Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => {
                        return fail("requires-line-source-boundary")
                    }
                }
                let ends = match edge.bounds {
                    Bounds::Segment(v) => v,
                    Bounds::Ring => return fail("requires-line-source-boundary"),
                };
                let [a, b] = if co.forward { ends } else { [ends[1], ends[0]] };
                pieces.push(Piece {
                    start: lift(&d.placement.point(input.key(a).rational()?)),
                    end: lift(&d.placement.point(input.key(b).rational()?)),
                    arc: None,
                });
            }
            loops.push(pieces);
        }
        let offset = scalar(&lift(&normal), &loops[0][0].start)
            .rational()
            .ok_or_else(|| Refusal("blend/source-plane-not-rational".into()))?;
        faces.push(Face {
            carrier: Carrier::Plane { normal, offset },
            loops,
            source: Some(FaceId(i as u32)),
        });
    }
    let stripes = graph
        .edges
        .iter()
        .map(|e| section(input, e, radii.get(&e.edge).unwrap_or(&radius)))
        .collect::<Result<Vec<_>>>()?;
    // All replacements are derived from the frozen input. Sequentially
    // replacing corners would hide an overflow between adjacent rounds.
    let mut replacements: BTreeMap<(FaceId, VertexId), Vec<RPoint>> = BTreeMap::new();
    let mut cap_arcs: BTreeMap<(FaceId, VertexId), Arc> = BTreeMap::new();
    for stripe in &stripes {
        let vs = match d.edges[stripe.edge.index()].bounds {
            Bounds::Segment(v) => v,
            Bounds::Ring => unreachable!(),
        };
        for (k, v) in vs.into_iter().enumerate() {
            let source = lift(&d.placement.point(input.key(v).rational()?));
            let cap_faces = d
                .faces
                .iter()
                .enumerate()
                .filter_map(|(fi, f)| {
                    let id = FaceId(fi as u32);
                    if stripe.supports.contains(&id) {
                        return None;
                    }
                    f.loops
                        .iter()
                        .any(|l| {
                            d.loops[l.index()].coedges.iter().any(|c| {
                                match d.edges[d.coedges[c.index()].edge.index()].bounds {
                                    Bounds::Segment(vs) => vs.contains(&v),
                                    Bounds::Ring => false,
                                }
                            })
                        })
                        .then_some(id)
                })
                .collect::<Vec<_>>();
            if cap_faces.len() != 1 {
                return fail("contract-violation:cap/incidence");
            }
            let cap = cap_faces[0];
            let cap_normal = match &faces[cap.index()].carrier {
                Carrier::Plane { normal, .. } => normal,
                Carrier::Cylinder { .. } => unreachable!(),
            };
            if cross(cap_normal, &stripe.axis).iter().any(|x| !x.is_zero()) {
                return fail("vertex-network-unsupported:ObliqueCap");
            }
            for (s, support) in stripe.supports.into_iter().enumerate() {
                replacements.insert((support, v), vec![stripe.springs[k][s].clone()]);
            }
            let lp = faces[cap.index()]
                .loops
                .iter()
                .find(|lp| lp.iter().any(|p| p.start == source))
                .ok_or_else(|| Refusal("blend/contract-violation:cap/loop".into()))?;
            let ix = lp.iter().position(|p| p.start == source).unwrap();
            let prev = &lp[(ix + lp.len() - 1) % lp.len()].start;
            let next = &lp[ix].end;
            let on_ray = |p: &RPoint, end: &RPoint| {
                let a = subtract(p, &source);
                let b = subtract(end, &source);
                vector(&a, &b).iter().all(Radical::is_zero) && scalar(&a, &b).is_positive()
            };
            let first = stripe.springs[k]
                .iter()
                .find(|p| on_ray(p, prev))
                .cloned()
                .ok_or_else(|| Refusal("blend/contract-violation:spring/prev-ray".into()))?;
            let last = stripe.springs[k]
                .iter()
                .find(|p| on_ray(p, next))
                .cloned()
                .ok_or_else(|| Refusal("blend/contract-violation:spring/next-ray".into()))?;
            replacements.insert((cap, v), vec![first, last]);
            cap_arcs.insert(
                (cap, v),
                Arc {
                    center: stripe.centers[k].clone(),
                    axis: stripe.axis.clone(),
                    radius2: &stripe.radius * &stripe.radius,
                },
            );
        }
    }
    // Compare the total exact consumption on every original edge. This
    // includes two rounds that meet critically on the same support face.
    for (fi, f) in d.faces.iter().enumerate() {
        let face = FaceId(fi as u32);
        for l in &f.loops {
            for c in &d.loops[l.index()].coedges {
                let co = &d.coedges[c.index()];
                let e = &d.edges[co.edge.index()];
                let vs = match e.bounds {
                    Bounds::Segment(v) => v,
                    Bounds::Ring => unreachable!(),
                };
                let [a, b] = if co.forward { vs } else { [vs[1], vs[0]] };
                let pa = lift(&d.placement.point(input.key(a).rational()?));
                let pb = lift(&d.placement.point(input.key(b).rational()?));
                let dir = subtract(&pb, &pa);
                let aa = replacements
                    .get(&(face, a))
                    .map(|ps| ps.last().unwrap())
                    .unwrap_or(&pa);
                let bb = replacements.get(&(face, b)).map(|ps| &ps[0]).unwrap_or(&pb);
                // A selected support edge is translated to its spring line;
                // other edges lose a prefix and/or suffix on the same line.
                if !vector(&subtract(aa, &pa), &dir)
                    .iter()
                    .all(Radical::is_zero)
                    || !vector(&subtract(bb, &pb), &dir)
                        .iter()
                        .all(Radical::is_zero)
                {
                    continue;
                }
                let has = scalar(&dir, &dir);
                let needs = scalar(&subtract(aa, &pa), &dir) + scalar(&subtract(&pb, bb), &dir);
                if needs > has {
                    let unit = sqrt(
                        has.rational()
                            .ok_or_else(|| Refusal("blend/source-width-not-rational".into()))?,
                    )?;
                    return Err(Refusal(format!(
                        "blend/overflow:{}(needs={:?},has={:?},allowEdgeOverflow={allow})",
                        co.edge.0,
                        needs / &unit,
                        has / unit
                    )));
                }
            }
        }
    }
    // Rebuild each loop from its corner replacements, keeping cap arcs as
    // single analytic edges. Zero-length linear pieces disappear by equality.
    for (fi, f) in d.faces.iter().enumerate() {
        let face = FaceId(fi as u32);
        let mut loops = Vec::new();
        for l in &f.loops {
            let mut corners = Vec::new();
            for c in &d.loops[l.index()].coedges {
                let co = &d.coedges[c.index()];
                let vs = match d.edges[co.edge.index()].bounds {
                    Bounds::Segment(v) => v,
                    Bounds::Ring => unreachable!(),
                };
                let v = vs[usize::from(!co.forward)];
                let p = lift(&d.placement.point(input.key(v).rational()?));
                corners.push((v, replacements.get(&(face, v)).cloned().unwrap_or(vec![p])));
            }
            let mut pieces = Vec::new();
            for i in 0..corners.len() {
                let (v, points) = &corners[i];
                if points.len() == 2 {
                    pieces.push(Piece {
                        start: points[0].clone(),
                        end: points[1].clone(),
                        arc: Some(cap_arcs[&(face, *v)].clone()),
                    });
                }
                let a = points.last().unwrap();
                let b = &corners[(i + 1) % corners.len()].1[0];
                if a != b {
                    pieces.push(Piece {
                        start: a.clone(),
                        end: b.clone(),
                        arc: None,
                    });
                }
            }
            // A face consumed at equality is removed, not welded by epsilon.
            if pieces.len() >= 3 {
                loops.push(pieces);
            } else if pieces.iter().any(|p| p.arc.is_some()) {
                return fail("contract-violation:consumption/arc-face");
            }
        }
        faces[fi].loops = loops;
    }
    for stripe in &stripes {
        let cap_piece = |k: usize| -> Result<Piece> {
            let vs = match d.edges[stripe.edge.index()].bounds {
                Bounds::Segment(v) => v,
                Bounds::Ring => unreachable!(),
            };
            let (_, arc) = cap_arcs
                .iter()
                .find(|((_, v), a)| *v == vs[k] && a.center == stripe.centers[k])
                .ok_or_else(|| Refusal("blend/contract-violation:cap/arc".into()))?;
            faces
                .iter()
                .flat_map(|f| &f.loops)
                .flatten()
                .find(|p| {
                    p.arc.as_ref() == Some(arc)
                        && stripe.springs[k].contains(&p.start)
                        && stripe.springs[k].contains(&p.end)
                })
                .map(Piece::reversed)
                .ok_or_else(|| Refusal("blend/contract-violation:cap/arc-use".into()))
        };
        let a = cap_piece(0)?;
        let b = cap_piece(1)?;
        faces.push(Face {
            carrier: Carrier::Cylinder {
                origin: stripe.centers[0].clone(),
                axis: stripe.axis.clone(),
                radius2: &stripe.radius * &stripe.radius,
                convexity: stripe.convexity,
            },
            loops: vec![vec![
                a.clone(),
                Piece {
                    start: a.end.clone(),
                    end: b.start.clone(),
                    arc: None,
                },
                b.clone(),
                Piece {
                    start: b.end.clone(),
                    end: a.start.clone(),
                    arc: None,
                },
            ]],
            source: None,
        });
    }
    faces.retain(|f| !f.loops.is_empty());
    let result = Boundary { faces, stripes };
    result.check()?;
    Ok(result)
}

fn canonical_axis(axis: &Point) -> Result<Point> {
    let pivot = axis
        .iter()
        .find(|x| !x.is_zero())
        .ok_or_else(|| Refusal("blend/contract-violation:axis/zero".into()))?;
    Ok(axis.each_ref().map(|x| x / pivot))
}
fn on_arc(p: &Piece, point: &RPoint) -> bool {
    let arc = p.arc.as_ref().expect("arc contact");
    let a = subtract(&p.start, &arc.center);
    let b = subtract(&p.end, &arc.center);
    let v = subtract(point, &arc.center);
    let n = lift(&arc.axis);
    let turn = scalar(&vector(&a, &b), &n);
    let av = scalar(&vector(&a, &v), &n);
    let vb = scalar(&vector(&v, &b), &n);
    if turn.is_positive() {
        !av.is_negative() && !vb.is_negative()
    } else {
        !av.is_positive() && !vb.is_positive()
    }
}
fn radical_root(value: &Radical) -> Result<Radical> {
    value
        .quadratic_sqrt()
        .map_err(|e| Refusal(format!("blend/contact-number-class-exceeded:{e:?}")))
}
fn line_circle(line: &Piece, arc: &Piece) -> Result<Vec<RPoint>> {
    let c = arc.arc.as_ref().unwrap();
    let u = subtract(&line.end, &line.start);
    let w = subtract(&line.start, &c.center);
    let a = scalar(&u, &u);
    let b = scalar(&u, &w);
    let cc = scalar(&w, &w) - Radical::from(c.radius2.clone());
    let delta = &b * &b - &a * cc;
    if delta.is_negative() {
        return Ok(vec![]);
    }
    let root = radical_root(&delta)?;
    let mut points = BTreeSet::new();
    for numerator in [-&b - &root, -&b + &root] {
        let t = numerator / &a;
        if t < Radical::default() || t > Radical::from(Q::one()) {
            continue;
        }
        let p = std::array::from_fn(|i| &line.start[i] + &t * &u[i]);
        if on_arc(arc, &p) {
            points.insert(p);
        }
    }
    Ok(points.into_iter().collect())
}
fn arc_contacts(a: &Piece, b: &Piece) -> Result<Vec<RPoint>> {
    let ac = a.arc.as_ref().unwrap();
    let bc = b.arc.as_ref().unwrap();
    let d = subtract(&bc.center, &ac.center);
    let dd = scalar(&d, &d);
    if dd.is_zero() {
        if ac.radius2 != bc.radius2 {
            return Ok(vec![]);
        }
        return Ok([&a.start, &a.end, &b.start, &b.end]
            .into_iter()
            .filter(|p| on_arc(a, p) && on_arc(b, p))
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect());
    }
    let k = (Radical::from(&ac.radius2 - &bc.radius2) + &dd)
        / (Radical::from(Q::from_integer(2.into())) * &dd);
    let h2 = Radical::from(ac.radius2.clone()) - &dd * &k * &k;
    if h2.is_negative() {
        return Ok(vec![]);
    }
    let offset = vector(&lift(&ac.axis), &d);
    let t = radical_root(&(h2 / scalar(&offset, &offset)))?;
    let base: RPoint = std::array::from_fn(|i| &ac.center[i] + &k * &d[i]);
    let mut points = BTreeSet::new();
    for sign in [-Q::one(), Q::one()] {
        let p = std::array::from_fn(|i| &base[i] + Radical::from(sign.clone()) * &t * &offset[i]);
        if on_arc(a, &p) && on_arc(b, &p) {
            points.insert(p);
        }
    }
    Ok(points.into_iter().collect())
}
fn contacts(a: &Piece, b: &Piece, n: &Point) -> Result<Vec<RPoint>> {
    match (&a.arc, &b.arc) {
        (Some(_), Some(_)) => arc_contacts(a, b),
        (None, Some(_)) => line_circle(a, b),
        (Some(_), None) => line_circle(b, a),
        (None, None) => {
            let u = subtract(&a.end, &a.start);
            let v = subtract(&b.end, &b.start);
            let w = subtract(&b.start, &a.start);
            let normal = lift(n);
            let det = scalar(&vector(&u, &v), &normal);
            if det.is_zero() {
                if vector(&u, &w).iter().any(|x| !x.is_zero()) {
                    return Ok(vec![]);
                }
                let on = |p: &RPoint, line: &Piece| {
                    let dir = subtract(&line.end, &line.start);
                    let t = scalar(&subtract(p, &line.start), &dir);
                    !t.is_negative() && t <= scalar(&dir, &dir)
                };
                return Ok([&a.start, &a.end, &b.start, &b.end]
                    .into_iter()
                    .filter(|p| on(p, a) && on(p, b))
                    .cloned()
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect());
            }
            let t = scalar(&vector(&w, &v), &normal) / &det;
            let s = scalar(&vector(&w, &u), &normal) / det;
            if t < Radical::default()
                || t > Radical::from(Q::one())
                || s < Radical::default()
                || s > Radical::from(Q::one())
            {
                return Ok(vec![]);
            }
            Ok(vec![std::array::from_fn(|i| &a.start[i] + &t * &u[i])])
        }
    }
}
impl Boundary {
    /// Certified change in volume in the source units, from the analytic
    /// circular segment in each normal section times its stripe length.
    /// No sampled mesh or rounded coefficient participates in this measure.
    pub fn delta_volume_enclosure(&self) -> Result<(f64, f64)> {
        radical::guard(|| {
            let mut total = wonky_curve::numeric::enclose(&Q::zero())
                .map_err(|e| Refusal(format!("blend/{e:?}")))?;
            for stripe in &self.stripes {
                let axis = lift(&stripe.axis);
                let length = sqrt(dot(&stripe.axis, &stripe.axis))?;
                let origin = lift(&stripe.source_points[0]);
                let [a, b] = &stripe.springs[0];
                let tri = scalar(&vector(&subtract(a, &origin), &subtract(b, &origin)), &axis)
                    .abs()
                    / &length;
                let ra = subtract(a, &stripe.centers[0]);
                let rb = subtract(b, &stripe.centers[0]);
                let sine_area = scalar(&vector(&ra, &rb), &axis).abs() / &length;
                let cosine = scalar(&ra, &rb);
                let angle = radical::positive_angle(&cosine, &sine_area)
                    .map_err(|e| Refusal(format!("blend/{e:?}")))?;
                let radial_sector = Radical::from(&stripe.radius * &stripe.radius)
                    .enclosure()
                    .map_err(|e| Refusal(format!("blend/{e:?}")))?
                    * angle;
                let polygon = (tri + sine_area)
                    .enclosure()
                    .map_err(|e| Refusal(format!("blend/{e:?}")))?;
                let swept = (polygon - radial_sector)
                    * length
                        .enclosure()
                        .map_err(|e| Refusal(format!("blend/{e:?}")))?
                    / wonky_curve::numeric::enclose(&Q::from_integer(2.into()))
                        .map_err(|e| Refusal(format!("blend/{e:?}")))?;
                total = if stripe.convexity == Convexity::Convex {
                    total - swept
                } else {
                    total + swept
                };
            }
            if !total.lo().is_finite() || !total.hi().is_finite() {
                return fail("measure-range");
            }
            Ok((total.lo(), total.hi()))
        })
        .map_err(|e| Refusal(format!("blend/{e:?}")))?
    }
    /// Exact incidence, closure, opposite sewing and vertex links. This does
    /// not claim the Model G1–G8 audit or global surface embedding.
    pub fn check(&self) -> Result<()> {
        radical::guard(|| self.check_exact()).map_err(|e| Refusal(format!("blend/{e:?}")))?
    }
    fn check_exact(&self) -> Result<()> {
        for stripe in &self.stripes {
            if stripe.radius <= Q::zero() || stripe.axis.iter().all(Q::is_zero) {
                return fail("contract-violation:stripe/size");
            }
            let sign = if stripe.convexity == Convexity::Convex {
                -Q::one()
            } else {
                Q::one()
            };
            for k in 0..2 {
                if project_on_stripe(&stripe.centers[k], &stripe.source_points[k], &stripe.axis)?
                    != lift(&stripe.source_points[k])
                {
                    return fail("contract-violation:stripe/centre-projection");
                }
                for s in 0..2 {
                    let n = lift(&stripe.source_normals[s]);
                    let foot = &stripe.springs[k][s];
                    let radial = subtract(foot, &stripe.centers[k]);
                    if !scalar(&n, &subtract(foot, &lift(&stripe.source_points[k]))).is_zero()
                        || !vector(&radial, &n).iter().all(Radical::is_zero)
                        || scalar(&radial, &radial)
                            != Radical::from(&stripe.radius * &stripe.radius)
                        || scalar(&radial, &n).is_positive() != (sign < Q::zero())
                    {
                        return fail("contract-violation:stripe/tangency");
                    }
                }
            }
        }
        type Key = (RPoint, RPoint, Option<Arc>);
        let mut uses: BTreeMap<Key, Vec<bool>> = BTreeMap::new();
        let mut links: BTreeMap<RPoint, Vec<(Key, Key)>> = BTreeMap::new();
        for face in &self.faces {
            if face.loops.is_empty() {
                return fail("contract-violation:empty-face");
            }
            for lp in &face.loops {
                if lp.len() < 3 {
                    return fail("contract-violation:short-loop");
                }
                let mut keys = Vec::new();
                for (i, p) in lp.iter().enumerate() {
                    if p.start == p.end {
                        return fail("contract-violation:zero-edge");
                    }
                    if p.end != lp[(i + 1) % lp.len()].start {
                        return fail("contract-violation:loop-open");
                    }
                    if let Some(arc) = &p.arc {
                        if arc.radius2 <= Q::zero() {
                            return fail("contract-violation:arc/radius");
                        }
                        let axis = lift(&arc.axis);
                        for v in [&p.start, &p.end] {
                            let radial = subtract(v, &arc.center);
                            if !scalar(&radial, &axis).is_zero()
                                || scalar(&radial, &radial) != Radical::from(arc.radius2.clone())
                            {
                                return fail("contract-violation:arc/incidence");
                            }
                        }
                        if scalar(
                            &vector(
                                &subtract(&p.start, &arc.center),
                                &subtract(&p.end, &arc.center),
                            ),
                            &axis,
                        )
                        .is_zero()
                        {
                            return fail("contract-violation:arc/not-short");
                        }
                    }
                    match &face.carrier {
                        Carrier::Plane { normal, offset } => {
                            let n = lift(normal);
                            if normal.iter().all(Q::is_zero) {
                                return fail("contract-violation:plane/normal");
                            }
                            if [&p.start, &p.end]
                                .into_iter()
                                .any(|v| scalar(&n, v) != Radical::from(offset.clone()))
                            {
                                return fail("contract-violation:plane/incidence");
                            }
                            if let Some(arc) = &p.arc {
                                if cross(normal, &arc.axis).iter().any(|x| !x.is_zero())
                                    || scalar(&n, &arc.center) != Radical::from(offset.clone())
                                {
                                    return fail("contract-violation:plane/arc-incidence");
                                }
                            }
                        }
                        Carrier::Cylinder {
                            origin,
                            axis,
                            radius2,
                            ..
                        } => {
                            let a = lift(axis);
                            let aa = scalar(&a, &a);
                            if aa.is_zero() || radius2 <= &Q::zero() {
                                return fail("contract-violation:cylinder/carrier");
                            }
                            for v in [&p.start, &p.end] {
                                let delta = subtract(v, origin);
                                let t = scalar(&delta, &a);
                                if scalar(&delta, &delta) - &t * &t / &aa
                                    != Radical::from(radius2.clone())
                                {
                                    return fail("contract-violation:cylinder/incidence");
                                }
                            }
                            match &p.arc {
                                None => {
                                    if !vector(&subtract(&p.end, &p.start), &a)
                                        .iter()
                                        .all(Radical::is_zero)
                                    {
                                        return fail("contract-violation:cylinder/generator");
                                    }
                                }
                                Some(arc) => {
                                    if cross(axis, &arc.axis).iter().any(|x| !x.is_zero())
                                        || !vector(&subtract(&arc.center, origin), &a)
                                            .iter()
                                            .all(Radical::is_zero)
                                        || arc.radius2 != *radius2
                                    {
                                        return fail("contract-violation:cylinder/arc");
                                    }
                                }
                            }
                        }
                    }
                    let forward = p.start < p.end;
                    let arc = p
                        .arc
                        .as_ref()
                        .map(|a| -> Result<Arc> {
                            Ok(Arc {
                                axis: canonical_axis(&a.axis)?,
                                ..a.clone()
                            })
                        })
                        .transpose()?;
                    let key = if forward {
                        (p.start.clone(), p.end.clone(), arc)
                    } else {
                        (p.end.clone(), p.start.clone(), arc)
                    };
                    uses.entry(key.clone()).or_default().push(forward);
                    keys.push(key);
                }
                for i in 0..lp.len() {
                    links
                        .entry(lp[i].end.clone())
                        .or_default()
                        .push((keys[i].clone(), keys[(i + 1) % lp.len()].clone()));
                }
            }
            if let Carrier::Plane { normal, .. } = &face.carrier {
                let all = face
                    .loops
                    .iter()
                    .enumerate()
                    .flat_map(|(li, lp)| lp.iter().enumerate().map(move |(i, p)| (li, i, p)))
                    .collect::<Vec<_>>();
                for (k, (la, ia, a)) in all.iter().enumerate() {
                    for (lb, ib, b) in &all[k + 1..] {
                        let consecutive = la == lb
                            && (*ib == ia + 1 || (*ia == 0 && *ib == face.loops[*la].len() - 1));
                        for point in contacts(a, b, normal)? {
                            if !consecutive
                                || !([&a.start, &a.end].contains(&&point)
                                    && [&b.start, &b.end].contains(&&point))
                            {
                                return Err(Refusal(format!(
                                    "blend/overflow:face-{:?}/boundary-contact",
                                    face.source
                                )));
                            }
                        }
                    }
                }
            }
        }
        if uses.values().any(|u| u.len() != 2 || u[0] == u[1]) {
            return fail("contract-violation:sewing");
        }
        for corners in links.values() {
            let mut adjacency: BTreeMap<Key, Vec<Key>> = BTreeMap::new();
            for (a, b) in corners {
                adjacency.entry(a.clone()).or_default().push(b.clone());
                adjacency.entry(b.clone()).or_default().push(a.clone());
            }
            if adjacency.values().any(|ns| ns.len() != 2) {
                return fail("contract-violation:vertex-link-degree");
            }
            let mut seen = BTreeSet::new();
            let mut todo = vec![adjacency.keys().next().unwrap().clone()];
            while let Some(e) = todo.pop() {
                if seen.insert(e.clone()) {
                    todo.extend(adjacency[&e].clone());
                }
            }
            if seen.len() != adjacency.len() {
                return fail("contract-violation:vertex-link-disconnected");
            }
        }
        Ok(())
    }
    pub fn counts(&self) -> (usize, usize, usize) {
        let mut vertices = BTreeSet::new();
        let mut edges = BTreeSet::new();
        for p in self.faces.iter().flat_map(|f| &f.loops).flatten() {
            vertices.insert(p.start.clone());
            vertices.insert(p.end.clone());
            let arc = p.arc.as_ref().map(|a| {
                (
                    a.center.clone(),
                    canonical_axis(&a.axis).expect("checked axis"),
                    a.radius2.clone(),
                )
            });
            edges.insert((
                p.start.clone().min(p.end.clone()),
                p.start.clone().max(p.end.clone()),
                arc,
            ));
        }
        (vertices.len(), edges.len(), self.faces.len())
    }
}
