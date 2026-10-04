//! G8 dark Model adapters. Read replayed construction definitions, never WC0
//! curved observation coordinates. Every result is admitted by Draft::check.
use crate::{
    coaxial::Coaxial,
    cylinder::{Cylinder, Spec},
    perforated::Perforated,
    placement::Placement,
    polyhedron::{Audited, Refused},
    prism_holes::{Base, PrismHoles},
    revolve_full::FullRevolve,
};
use num_traits::{One, Signed, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::{Body, FrameId, Operation, Provenance as WireProvenance};
use wonky_curve::{
    arrangement::{self, Budget, UNBOUNDED},
    Carrier, Cycle, ExactPoint, Trimmed,
};
use wonky_geom::{
    cross,
    frame::Frame,
    model::{
        self,
        revolution::{self, Bore},
        Draft, Label, Model, Plane3, PolyFace, Provenance, VertexDef,
    },
    sub, Point, Q,
};
type R<T> = Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(s.into())
}
fn geom<T>(r: wonky_geom::Result<T>) -> R<T> {
    r.map_err(|e| no(e.0))
}
fn q(x: f64) -> R<Q> {
    geom(wonky_geom::binary64(x))
}
fn root(body: &Body) -> R<u32> {
    body.constructions
        .len()
        .checked_sub(1)
        .map(|i| i as u32)
        .ok_or_else(|| no("model/source-construction"))
}
fn axial_frame(axis: usize, origin: Point) -> R<Frame> {
    let mut columns = std::array::from_fn(|_| wonky_geom::zero());
    for (i, a) in [(0, (axis + 1) % 3), (1, (axis + 2) % 3), (2, axis)] {
        columns[i][a] = Q::one();
    }
    geom(Frame::new(origin, columns))
}
fn spec_bore(spec: Spec, extent: Option<[Q; 2]>) -> R<Bore> {
    let axis = spec.axis()?;
    let mut center = geom(wonky_geom::point(spec.bottom))?;
    center[axis] = Q::zero();
    let radius = q(spec.radius)?;
    let carrier = geom(model::Cylinder3::new(
        axial_frame(axis, center)?,
        &radius * &radius,
    ))?;
    Ok(Bore {
        carrier,
        extent: match extent {
            Some(e) => e,
            None => [q(spec.bottom[axis])?, q(spec.top[axis])?],
        },
    })
}
pub(crate) fn cylinder(source: &Cylinder) -> R<Model> {
    let checked = source
        .body
        .clone()
        .check()
        .map_err(|_| no("model/source-check"))?;
    let source = crate::cylinder::audit(&checked)?;
    let bore = spec_bore(source.spec, None)?;
    let r = q(source.spec.radius)?;
    let placement = crate::construction_geom::frame(&source.frame)?;
    let [lo, hi] = bore.extent;
    let zero = Q::zero();
    let profile = [
        [zero.clone(), lo.clone()],
        [r.clone(), lo],
        [r, hi.clone()],
        [zero, hi],
    ];
    geom(
        revolution::revolution(placement, geom(bore.carrier.frame())?.clone(), &profile, root(&source.body)?)
            .and_then(Draft::check),
    )
}

/// Rational planar source authority used inside the curved adapters. A
/// straight extrusion binding proves its vertices are literal source inputs;
/// an arrangement keeps exact replay points. No rounded normal is imported.
fn planar(source: &Audited) -> R<Model> {
    match source.model() {
        Ok(m) => return Ok(m),
        Err(e) if e.0 == "model/family-unsupported" => {}
        Err(e) => return Err(e),
    }
    if source.arcs.is_some()
        || source.rounded.is_some()
        || source.corner.is_some()
        || source.chamfer.is_some()
    {
        return Err(no("boolean/ssi-row-unavailable:profile/curved-model"));
    }
    let points = match &source.arrangement {
        Some(a) => a.source()?.to_vec(),
        None => {
            if !source.bound_to_construction {
                return Err(no("model/source-input-binding"));
            }
            let mut node = match source.body.vertices.first().map(|v| v.provenance.clone()) {
                Some(WireProvenance::Construction { node }) => node.0 as usize,
                Some(WireProvenance::None {}) | None => {
                    return Err(no("model/source-input-binding"))
                }
            };
            while source.body.constructions[node].operation == (Operation::AffineTransform {}) {
                node = source.body.constructions[node].parents[0].0 as usize;
            }
            let extrude = &source.body.constructions[node];
            if extrude.operation != (Operation::Extrude {}) || extrude.parameters.len() != 2 {
                return Err(no("model/source-input-binding"));
            }
            let sketch = &source.body.constructions[extrude.parents[0].0 as usize];
            if sketch.operation != (Operation::Sketch {}) {
                return Err(no("model/source-input-binding"));
            }
            let mut inputs = BTreeMap::new();
            for level in &extrude.parameters {
                for p in sketch.parameters.chunks_exact(2) {
                    inputs.insert(
                        [p[0].bits(), p[1].bits(), level.bits()],
                        [q(p[0].get())?, q(p[1].get())?, q(level.get())?],
                    );
                }
            }
            source
                .body
                .vertices
                .iter()
                .map(|v| {
                    inputs
                        .get(&v.point.map(|p| p.bits()))
                        .cloned()
                        .ok_or_else(|| no("model/source-input-binding"))
                })
                .collect::<R<Vec<_>>>()?
        }
    };
    let mut faces = vec![];
    let node = root(&source.body)?;
    for (fi, face) in source.body.faces.iter().enumerate() {
        let mut loops = vec![];
        for l in &face.loops {
            let indices = &source.face_loops[l.0 as usize];
            loops.push(
                indices
                    .iter()
                    .map(|&v| points[v].clone())
                    .collect::<Vec<_>>(),
            );
        }
        let outer = &loops[0];
        let o = outer[0].clone();
        let x = sub(&outer[1], &o);
        let mut n = wonky_geom::zero();
        for p in &outer[2..] {
            n = cross(&x, &sub(p, &o));
            if n.iter().any(|v| !v.is_zero()) {
                break;
            }
        }
        if n.iter().all(Q::is_zero) {
            return Err(no("model/g1-plane-degenerate"));
        }
        let nonzero = n
            .iter()
            .enumerate()
            .filter(|(_, v)| !v.is_zero())
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        let x = if nonzero.len() == 1 {
            let axis = nonzero[0];
            let positive = n[axis].is_positive();
            n = wonky_geom::zero();
            n[axis] = if positive { Q::one() } else { -Q::one() };
            let mut x = wonky_geom::zero();
            x[(axis + 1) % 3] = Q::one();
            x
        } else {
            x
        };
        faces.push(PolyFace {
            carrier: Plane3 { o, x, n },
            forward: true,
            loops: loops
                .into_iter()
                .map(|l| l.into_iter().map(VertexDef::Rational).collect())
                .collect(),
            provenance: Provenance {
                node,
                slot: fi as u32,
            },
        });
    }
    geom(
        model::polyhedron(
            crate::construction_geom::frame(&source.frame)?,
            Label::Exact,
            node,
            faces,
        )
        .and_then(Draft::check),
    )
}
pub(crate) fn perforated(source: &Perforated) -> R<Model> {
    let checked = source
        .body
        .clone()
        .check()
        .map_err(|_| no("model/source-check"))?;
    let source = crate::perforated::audit(&checked)?;
    let base = planar(&source.base)?;
    let bores = source
        .holes
        .iter()
        .map(|&s| spec_bore(s, None))
        .collect::<R<Vec<_>>>()?;
    geom(revolution::bore_trims(&base, &bores, root(&source.body)?).and_then(Draft::check))
}
pub(crate) fn prism_holes(source: &PrismHoles) -> R<Model> {
    let checked = source
        .body
        .clone()
        .check()
        .map_err(|_| no("model/source-check"))?;
    let source = crate::prism_holes::audit(&checked)?;
    if source.pocket.is_some() || !source.meridians.is_empty() {
        return Err(no("boolean/ssi-row-unavailable:bore/non-cylindrical-tool"));
    }
    let base = match &source.base {
        Base::Planar(a) => planar(a)?,
        Base::Cylinder(c) => cylinder(c)?,
        Base::Revolved(r) => revolved(&r.rev)?,
    };
    let bores = source
        .holes
        .iter()
        .zip(&source.hole_levels)
        .map(|(&s, e)| spec_bore(s, Some(e.clone())))
        .collect::<R<Vec<_>>>()?;
    geom(revolution::bore_trims(&base, &bores, root(&source.body)?).and_then(Draft::check))
}

fn meridian_union(polygons: &[Vec<[Q; 2]>]) -> R<Vec<Vec<[Q; 2]>>> {
    let cycles = polygons
        .iter()
        .map(|p| {
            (0..p.len())
                .map(|i| {
                    Trimmed::new(
                        [p[i].clone(), p[(i + 1) % p.len()].clone()].map(ExactPoint::from_rational),
                        Carrier::Line,
                    )
                    .map_err(|e| no(e.name()))
                })
                .collect::<R<Vec<_>>>()
                .map(Cycle::new)
        })
        .collect::<R<Vec<_>>>()?;
    let refs = cycles.iter().collect::<Vec<_>>();
    let mut arr = arrangement::arrange(
        &refs,
        Budget {
            segments: 1024,
            pieces: 4096,
        },
    )
    .map_err(|e| no(e.name()))?;
    arrangement::classify(&mut arr, &refs).map_err(|e| no(e.name()))?;
    let kept = |f: usize| f != UNBOUNDED && arr.cells[f].inside.iter().any(|&v| v);
    let mut boundary = BTreeMap::new();
    let mut incoming = BTreeSet::new();
    for i in 0..arr.pieces.len() {
        let (a, b) = (kept(arr.face[2 * i]), kept(arr.face[2 * i + 1]));
        if a == b {
            continue;
        }
        let h = 2 * i + usize::from(!a);
        let (a, b) = (arr.tail(h), arr.tail(h ^ 1));
        if boundary.insert(a, b).is_some() || !incoming.insert(b) {
            return Err(no("boolean/contract-violation:meridian/non-manifold"));
        }
    }
    let mut out = vec![];
    while let Some((&start, _)) = boundary.first_key_value() {
        let mut v = start;
        let mut polygon = vec![];
        loop {
            polygon.push(arr.points[v].rat().map_err(|e| no(e.name()))?.clone());
            v = boundary
                .remove(&v)
                .ok_or_else(|| no("boolean/contract-violation:meridian/open"))?;
            if v == start {
                break;
            }
        }
        // Source cell partitions may leave collinear event points. Removing
        // them changes no carrier and prevents an artificial ring at that event.
        loop {
            let mut removed = false;
            for i in 0..polygon.len() {
                let a = &polygon[(i + polygon.len() - 1) % polygon.len()];
                let b = &polygon[i];
                let c = &polygon[(i + 1) % polygon.len()];
                if (&b[0] - &a[0]) * (&c[1] - &b[1]) == (&b[1] - &a[1]) * (&c[0] - &b[0]) {
                    polygon.remove(i);
                    removed = true;
                    break;
                }
            }
            if !removed {
                break;
            }
            if polygon.len() < 3 {
                return Err(no("boolean/contract-violation:meridian/degenerate"));
            }
        }
        out.push(polygon);
    }
    Ok(out)
}
fn combine(mut a: Draft, mut b: Draft) -> R<Draft> {
    if a.placement != b.placement {
        return Err(no("boolean/cross-frame-unproved"));
    }
    let offset = [
        a.surfaces.len(),
        a.curves.len(),
        a.vertices.len(),
        a.edges.len(),
        a.coedges.len(),
        a.loops.len(),
        a.faces.len(),
        a.shells.len(),
    ];
    for e in &mut b.edges {
        e.curve.0 += offset[1] as u32;
        match &mut e.bounds {
            model::Bounds::Ring => {}
            model::Bounds::Segment(v) => {
                for v in v {
                    v.0 += offset[2] as u32;
                }
            }
        }
    }
    for c in &mut b.coedges {
        c.edge.0 += offset[3] as u32;
    }
    for l in &mut b.loops {
        for c in &mut l.coedges {
            c.0 += offset[4] as u32;
        }
    }
    for f in &mut b.faces {
        f.surface.0 += offset[0] as u32;
        for l in &mut f.loops {
            l.0 += offset[5] as u32;
        }
    }
    for s in &mut b.shells {
        for f in &mut s.faces {
            f.0 += offset[6] as u32;
        }
    }
    for s in &mut b.solids {
        for shell in &mut s.shells {
            shell.0 += offset[7] as u32;
        }
    }
    a.surfaces.extend(b.surfaces);
    a.curves.extend(b.curves);
    a.vertices.extend(b.vertices);
    a.edges.extend(b.edges);
    a.coedges.extend(b.coedges);
    a.loops.extend(b.loops);
    a.faces.extend(b.faces);
    a.shells.extend(b.shells);
    a.solids.extend(b.solids);
    Ok(a)
}
pub(crate) fn coaxial(source: &Coaxial) -> R<Model> {
    let checked = source
        .body
        .clone()
        .check()
        .map_err(|_| no("model/source-check"))?;
    let source = crate::coaxial::audit(&checked)?;
    let placement = crate::construction_geom::frame(
        &Placement::from_frames(&source.body, FrameId(1)).map_err(|_| no("model/source-frame"))?,
    )?;
    let frame = axial_frame(source.axis, geom(wonky_geom::point(source.center))?)?;
    let polygons = source
        .slices
        .iter()
        .map(|s| {
            Ok(vec![
                [q(s.inner)?, q(s.z0)?],
                [q(s.outer)?, q(s.z0)?],
                [q(s.outer)?, q(s.z1)?],
                [q(s.inner)?, q(s.z1)?],
            ])
        })
        .collect::<R<Vec<_>>>()?;
    let profiles = meridian_union(&polygons)?;
    let mut drafts = profiles
        .iter()
        .map(|p| {
            geom(revolution::revolution(
                placement.clone(),
                frame.clone(),
                p,
                root(&source.body)?,
            ))
        })
        .collect::<R<Vec<_>>>()?
        .into_iter();
    let mut draft = drafts.next().ok_or_else(|| no("model/source-empty"))?;
    for d in drafts {
        draft = combine(draft, d)?;
    }
    geom(draft.check())
}
pub(crate) fn revolved(source: &FullRevolve) -> R<Model> {
    let checked = source
        .body
        .clone()
        .check()
        .map_err(|_| no("model/source-check"))?;
    let source = if crate::revolve_boolean::candidate(&source.body) {
        crate::revolve_boolean::audit(&checked)?
    } else {
        crate::revolve_full::audit(&checked)?
    };
    let placement = crate::construction_geom::frame(
        &Placement::from_frames(&source.body, FrameId(1)).map_err(|_| no("model/source-frame"))?,
    )?;
    let columns = [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]]
        .map(|p| crate::revolve_full::local(source.mode, p[0], p[1], p[2]));
    let frame = geom(Frame::new(
        wonky_geom::zero(),
        [
            geom(wonky_geom::point(columns[0]))?,
            geom(wonky_geom::point(columns[1]))?,
            geom(wonky_geom::point(columns[2]))?,
        ],
    ))?;
    let profile = source
        .points
        .iter()
        .map(|p| Ok([q(p[0])?, q(p[1])?]))
        .collect::<R<Vec<_>>>()?;
    geom(
        revolution::revolution(placement, frame, &profile, root(&source.body)?)
            .and_then(Draft::check),
    )
}

/// A body placed by `pattern::place_body` whose source family owns no
/// placement of its own (a full-turn revolve). It is read only through its
/// exact Model: the source Model moved by the exact map from the image base
/// frame to the image frame, never a rounded product of the two frames.
#[derive(Clone, Debug)]
pub struct Placed {
    pub body: Body,
    pub source: Box<crate::analytic::Solid>,
    pub model: Model,
}
pub(crate) fn placed(body: &Body, source: crate::analytic::Solid) -> R<Placed> {
    let model = image(body, source.model()?)?;
    Ok(Placed { body: body.clone(), source: Box::new(source), model })
}
/// `model` (the Model of `body` without its last image frame) moved by the
/// exact map from the image's base frame to the image frame.
fn image(body: &Body, model: Model) -> R<Model> {
    use wonky_contract::Frame as F;
    let last = FrameId(body.frames.len().checked_sub(1).ok_or_else(|| no("model/placed-frame"))? as u32);
    let base = match body.frames.last() {
        Some(F::InterpreterImage { base, .. } | F::AffineImage { base, .. } | F::RationalImage { base, .. }) => *base,
        Some(F::Rigid { parent, .. }) => *parent,
        _ => return Err(no("model/placed-frame")),
    };
    geom(model.moved(&frame_map(body, base, last)?))
}
/// The exact world map that carries geometry observed in frame `from` to the
/// same coordinates observed in frame `to`: world(to) * world(from)^-1,
/// composed in Q from the binary64 frame coefficients and never rounded.
pub(crate) fn frame_map(body: &Body, from: FrameId, to: FrameId) -> R<Frame> {
    let world = |id| Placement::from_frames(body, id)
        .map_err(|_| no("model/placed-frame"))?
        .exact_frame();
    let (to, from) = (world(to)?, world(from)?.inverse());
    geom(Frame::new(
        to.point(from.origin()),
        from.columns().clone().map(|c| to.vector(&c)),
    ))
}

/// The exact Model of a line/arc profile prism: the replayed sketch cycle
/// (never the WC0 caches) extruded between its source levels in the source
/// chart, as the general Boolean's rule-7 leaf rebuilds it. A placed prism is
/// its source Model moved exactly. A fillet rim has no Model adapter yet.
pub(crate) fn arc_prism(a: &Audited) -> R<Model> {
    if let Some((inner, _)) = crate::pattern::unplace(&a.body) {
        let checked = inner.check().map_err(|_| no("model/source-check"))?;
        return image(&a.body, crate::analytic::audit(&checked)?.model()?);
    }
    let arcs = a.arcs.as_ref().ok_or_else(|| no("model/family-unsupported"))?;
    if arcs.rim.is_some()
        || !crate::arc_profile::candidate(&a.body)
        || a.body.constructions.len() != 3
        || a.body.frames.len() != 2
    {
        return Err(no("model/family-unsupported"));
    }
    let source = crate::arc_profile::Source::parse(&a.body.frames, &a.body.constructions)?;
    let [lo, hi] = source.levels();
    let levels = if lo < hi { [q(lo)?, q(hi)?] } else { [q(hi)?, q(lo)?] };
    let placement = crate::construction_geom::frame(
        &Placement::from_frames(&a.body, FrameId(1)).map_err(|_| no("model/source-frame"))?,
    )?;
    let label = if arcs.regularization.is_some() { Label::Regularized } else { Label::Exact };
    geom(
        model::extrusion::profile(placement, label, root(&a.body)?, source.profile()?.cycle().pieces(), levels)
            .and_then(Draft::check),
    )
}

// ------------------------------------------------- G14: sphere family adapters

/// One face of a ring-bounded sphere-family Model: carrier, sense and its
/// ring uses (edge index, coedge sense along the circle's own direction).
struct RingFace {
    carrier: model::Carrier3,
    forward: bool,
    uses: Vec<(usize, bool)>,
}
fn unit(k: usize, sign: i64) -> Point {
    let mut v = [Q::zero(), Q::zero(), Q::zero()];
    v[k] = Q::from_integer(sign.into());
    v
}
/// The frame at `origin` whose third column is `sign · e_k`, right-handed.
fn axis_frame(origin: Point, k: usize, sign: i64) -> R<Frame> {
    let (i, j) = ((k + 1) % 3, (k + 2) % 3);
    let cols = if sign > 0 { [unit(i, 1), unit(j, 1), unit(k, 1)] } else { [unit(j, 1), unit(i, 1), unit(k, -1)] };
    geom(Frame::new(origin, cols))
}
fn ring_circle(centre: Point, k: usize, sign: i64, r2: Q) -> R<model::Curve3> {
    let f = axis_frame(centre, k, sign)?;
    match wonky_curve::numeric::exact_root(&r2) {
        Some(_) => Ok(model::Curve3::Circle(geom(model::Circle3::new(f, r2))?)),
        None => {
            let r = geom(wonky_curve::radical::Radical::quadratic(Q::zero(), Q::one(), r2).map_err(|e| wonky_geom::Refused(e.name())))?;
            Ok(model::Curve3::RadicalCircle(geom(model::RadicalCircle3::new(f, wonky_curve::radical::Radical::default(), r))?))
        }
    }
}
/// Assemble and audit a Model of ring edges and ring-bounded faces; every
/// pcurve is the exact one its carrier's chart audit expects.
fn ring_model(placement: Frame, node: u32, rings: Vec<model::Curve3>, faces: Vec<RingFace>) -> R<Model> {
    use model::*;
    let prov = |slot: usize| Provenance { node, slot: slot as u32 };
    let mut d = Draft {
        placement,
        label: Label::Exact,
        surfaces: vec![],
        curves: rings.iter().enumerate().map(|(i, c)| Curve { geometry: c.clone(), provenance: prov(i) }).collect(),
        vertices: vec![],
        edges: (0..rings.len()).map(|i| Edge { curve: CurveId(i as u32), bounds: Bounds::Ring, provenance: prov(i) }).collect(),
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
    };
    for (fi, f) in faces.into_iter().enumerate() {
        d.surfaces.push(Surface { carrier: f.carrier.clone(), provenance: prov(fi) });
        let mut loops = vec![];
        for (e, forward) in f.uses {
            let c = &rings[e];
            let (pcurve, atlas) = match (&f.carrier, c) {
                (Carrier3::Plane(p), Curve3::Circle(k)) => (geom(plane_ring_pcurve(k, p, forward))?, None),
                (Carrier3::Sphere(s), _) => {
                    let a = geom(sphere_ring_trim(s, c, forward))?;
                    (a.pieces[0].piece.clone(), Some(a))
                }
                (Carrier3::Cylinder(cy), Curve3::Circle(k)) => {
                    let cf = geom(cy.frame())?;
                    let kf = geom(k.frame())?;
                    let h = cf.inverse().point(kf.origin())[2].clone();
                    let sense = forward
                        == wonky_geom::dot(&cross(&kf.columns()[0], &kf.columns()[1]), &cross(&cf.columns()[0], &cf.columns()[1]))
                            .is_positive();
                    let a = geom(AtlasTrim::ring(h, sense))?;
                    (a.pieces[0].piece.clone(), Some(a))
                }
                _ => return Err(no("model/sphere-family-ring")),
            };
            let co = CoedgeId(d.coedges.len() as u32);
            d.coedges.push(Coedge { edge: EdgeId(e as u32), forward, pcurve, atlas, provenance: prov(co.index()) });
            let l = LoopId(d.loops.len() as u32);
            d.loops.push(Loop { coedges: vec![co], provenance: prov(l.index()) });
            loops.push(l);
        }
        d.faces.push(Face { surface: SurfaceId(fi as u32), forward: f.forward, loops, provenance: prov(fi) });
    }
    d.shells.push(Shell { faces: (0..d.faces.len()).map(|i| FaceId(i as u32)).collect(), provenance: prov(0) });
    d.solids.push(Solid { shells: vec![ShellId(0)], provenance: prov(0) });
    geom(d.check())
}
fn exact3(p: [f64; 3]) -> R<Point> {
    Ok([q(p[0])?, q(p[1])?, q(p[2])?])
}
fn placement_of(frame: crate::affine::Affine) -> R<Frame> {
    crate::construction_geom::frame(&Placement::from_affine(frame).map_err(|_| no("model/source-frame"))?)
}
/// P12 (G14): a closed sphere is one loop-free face on its own carrier; the
/// equatorial family cut is the cap on the kept side of the cut plane and
/// the disc on it, sharing one ring.
pub(crate) fn sphere(source: &crate::sphere::Spherical) -> R<Model> {
    let checked = source.body().clone().check().map_err(|_| no("model/source-check"))?;
    let s = crate::sphere::audit(&checked)?;
    let placement = placement_of(s.frame)?;
    let centre = exact3(s.center)?;
    let r = q(s.radius)?;
    let node = root(&s.body)?;
    let Some(cut) = s.cut else {
        let frame = axis_frame(centre, 2, 1)?;
        let prov = model::Provenance { node, slot: 0 };
        let d = Draft {
            placement,
            label: Label::Exact,
            surfaces: vec![model::Surface { carrier: model::Carrier3::Sphere(geom(model::Sphere3::new(frame, &r * &r))?), provenance: prov }],
            curves: vec![],
            vertices: vec![],
            edges: vec![],
            coedges: vec![],
            loops: vec![],
            faces: vec![model::Face { surface: model::SurfaceId(0), forward: true, loops: vec![], provenance: prov }],
            shells: vec![model::Shell { faces: vec![model::FaceId(0)], provenance: prov }],
            solids: vec![model::Solid { shells: vec![model::ShellId(0)], provenance: prov }],
        };
        return geom(d.check());
    };
    // Keep the half where sign · l_axis ≥ 0: the cap about z' = sign e_axis.
    let sign = if cut.sign > 0. { 1 } else { -1 };
    let frame = axis_frame(centre.clone(), cut.axis, sign)?;
    let ring = ring_circle(centre.clone(), cut.axis, sign, &r * &r)?;
    let disc = Plane3 { o: centre, x: frame.columns()[0].clone(), n: frame.columns()[2].clone().map(|x| -x) };
    ring_model(
        placement,
        node,
        vec![ring],
        vec![
            RingFace { carrier: model::Carrier3::Sphere(geom(model::Sphere3::new(frame, &r * &r))?), forward: true, uses: vec![(0, true)] },
            RingFace { carrier: model::Carrier3::Plane(disc), forward: true, uses: vec![(0, false)] },
        ],
    )
}
/// P13 (G14): the lens of two equal spheres on one frame axis: two caps,
/// each about the direction to the other centre, sharing one ring.
pub(crate) fn lens(source: &crate::lens::Lens) -> R<Model> {
    let checked = source.body().clone().check().map_err(|_| no("model/source-check"))?;
    let s = crate::lens::audit(&checked)?;
    let placement = placement_of(s.frame)?;
    let node = root(&s.body)?;
    let (a, half, k) = (q(s.radius)?, q(s.half)?, s.axis);
    let ring = ring_circle(exact3(s.center)?, k, 1, &a * &a - &half * &half)?;
    let caps = [(exact3(s.centers[0])?, 1, true), (exact3(s.centers[1])?, -1, false)];
    let mut faces = vec![];
    for (c, sign, forward) in caps {
        faces.push(RingFace {
            carrier: model::Carrier3::Sphere(geom(model::Sphere3::new(axis_frame(c, k, sign)?, &a * &a))?),
            forward: true,
            uses: vec![(0, forward)],
        });
    }
    ring_model(placement, node, vec![ring], faces)
}
/// P14 (G14): a sphere minus a coaxial through bore along z: the sphere
/// band between the rings at ±h and the bore wall facing the axis.
pub(crate) fn axial(source: &crate::axial::Axial) -> R<Model> {
    let checked = source.body().clone().check().map_err(|_| no("model/source-check"))?;
    let s = crate::axial::audit(&checked)?;
    let Some(outer) = s.outer else {
        return Err(no("model/family-unsupported"));
    };
    let placement = placement_of(s.frame)?;
    let node = root(&s.body)?;
    let c = exact3(s.center)?;
    let (a, rho) = (q(outer)?, q(s.radius)?);
    let at = |h: f64| -> R<Point> {
        let mut p = c.clone();
        p[2] += q(h)?;
        Ok(p)
    };
    let rings = vec![ring_circle(at(s.levels[0])?, 2, 1, &rho * &rho)?, ring_circle(at(s.levels[1])?, 2, 1, &rho * &rho)?];
    let frame = axis_frame(c, 2, 1)?;
    ring_model(
        placement,
        node,
        rings,
        vec![
            RingFace { carrier: model::Carrier3::Sphere(geom(model::Sphere3::new(frame.clone(), &a * &a))?), forward: true, uses: vec![(0, true), (1, false)] },
            RingFace { carrier: model::Carrier3::Cylinder(geom(model::Cylinder3::new(frame, &rho * &rho))?), forward: false, uses: vec![(0, false), (1, true)] },
        ],
    )
}
