//! Rim blends on `Model` (fillets3d design §3 row 2, stage F2): a fillet or
//! an equal-offset chamfer of a ring edge between a plane perpendicular to
//! the axis and a coaxial cylinder band (post tops and bottoms, hole rims,
//! boss roots).
//!
//! In the meridian half-plane of the cylinder's frame the ring is a corner
//! (ρ0, h) between the plane's ray (ds, 0) and the band's ray (0, dz). The
//! rolling ball always sits in the 90° sector between those rays, centre
//! (ρ0 + ds·r, h + dz·r): material is removed when that sector is material
//! (convex) and added when it is empty (concave). The blend face is the tube
//! of the centre circle: a torus with major ρ0 + ds·r (ring or spindle; a
//! spindle face uses the apple sheet), a sphere when the major is 0, and a
//! named refusal `blend/radius-exceeds-rim(r,ρ)` beyond. Spring curves are
//! the two latitude rings; nothing is rounded, every value is a rational of
//! the inputs.
//!
//! A chamfer of width w uses the same corner and the same two springs (the
//! plane ring ρ0 + ds·w at h, the band ring ρ0 at h + dz·w); the new face is
//! the cone band through them, and a cone apex replaces the sphere cap when
//! the plane ring collapses (w = ρ0 on a disk). Both sections share one
//! surgery; only the inserted carrier and its chart heights differ. A ring
//! between a plane and a coaxial cone band is chamfered by
//! `cone_rim_chamfer`: its cone spring lies in Q(√(1 + k²)), so the spring
//! ring and the chamfer cone carry Q(√d) data (`RadicalCircle3`,
//! `Cone3::quadratic`), never a rounded root. A fillet of such a rim
//! (`cone_rim_fillet`) has its torus major in the same field and a tube band
//! ending at the cone normal's angle (exact π·atan measure). The surgery replaces the ring by the two springs, inserts
//! the tube face and runs the full Model audit (G1-G8, including the tube
//! band orientation and outward proof) on the result.
use crate::{refuse, Refusal, Result};
use num_traits::{One, Signed, Zero};
use wonky_curve::Carrier;
use wonky_geom::frame::Frame;
use wonky_geom::model::{
    plane_ring_pcurve, AtlasTrim, Bounds, Carrier3, Circle3, Coedge, CoedgeId, Cone3, Curve, Curve3,
    EdgeId, Face, FaceId, Loop, LoopId, Model, Provenance, Sphere3, Surface, SurfaceId, Torus3,
    Edge, CurveId, RadicalCircle3,
};
use wonky_curve::radical::Radical;
use wonky_geom::{cross, dot, Q};

fn kind(c: &Carrier3) -> &'static str {
    match c {
        Carrier3::Plane(_) | Carrier3::RadicalPlane(_) => "plane",
        Carrier3::Cylinder(_) | Carrier3::TranslatedCylinder(_) => "cylinder",
        Carrier3::Cone(_) => "cone",
        Carrier3::Sphere(_) => "sphere",
        Carrier3::Torus(_) => "torus",
        Carrier3::Rotated(_) => "rotated",
    }
}
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn text(x: &Q) -> String {
    num_traits::ToPrimitive::to_f64(x).map_or_else(|| x.to_string(), |v| format!("{v}"))
}

/// What the surgery decided, for callers and tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rim {
    pub convex: bool,
    /// Radius of the plane spring ring in the cylinder frame: the tube
    /// centre circle radius of a fillet, the plane ring of a chamfer cone
    /// (0: sphere cap or cone apex). Rational, or in one quadratic field for
    /// a cone-rim fillet.
    pub major: Radical,
    /// Tube radius of a fillet, offset width of a chamfer.
    pub minor: Q,
}

/// The cross-section of a rim blend.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Section {
    Fillet,
    Chamfer,
}

/// Constant-radius fillet of one ring edge. `node` is the construction node
/// that owns the new entities (provenance).
pub fn ring_fillet(m: &Model, edge: EdgeId, radius: &Q, node: u32) -> Result<(Model, Rim)> {
    if !radius.is_positive() {
        return refuse("fillet/invalid-radius");
    }
    ring_blend(m, edge, radius, Section::Fillet, node)
}

/// Equal-offset chamfer of one ring edge (AC33): both setbacks are `width`,
/// measured along the plane and along the band generator.
pub fn ring_chamfer(m: &Model, edge: EdgeId, width: &Q, node: u32) -> Result<(Model, Rim)> {
    if !width.is_positive() {
        return refuse("chamfer/invalid-width");
    }
    ring_blend(m, edge, width, Section::Chamfer, node)
}

fn ring_blend(m: &Model, edge: EdgeId, radius: &Q, section: Section, node: u32) -> Result<(Model, Rim)> {
    let d = m.draft();
    let e = d.edges.get(edge.index()).ok_or_else(|| Refusal("blend/edge-index".into()))?;
    let circle = match (&e.bounds, &d.curves[e.curve.index()].geometry) {
        (Bounds::Ring, Curve3::Circle(c)) => c.clone(),
        _ => return refuse("blend/rim-requires-ring-edge"),
    };
    // The two uses of the ring.
    let mut uses = vec![];
    for (fi, f) in d.faces.iter().enumerate() {
        for &l in &f.loops {
            for &c in &d.loops[l.index()].coedges {
                if d.coedges[c.index()].edge == edge {
                    uses.push((FaceId(fi as u32), l, c));
                }
            }
        }
    }
    if uses.len() != 2 {
        return refuse("blend/contract-violation:rim/edge-uses");
    }
    let carrier = |u: &(FaceId, LoopId, CoedgeId)| &d.surfaces[d.faces[u.0.index()].surface.index()].carrier;
    let (pu, cu) = match (carrier(&uses[0]), carrier(&uses[1])) {
        (Carrier3::Plane(_), Carrier3::Cylinder(_)) => (uses[0], uses[1]),
        (Carrier3::Cylinder(_), Carrier3::Plane(_)) => (uses[1], uses[0]),
        // Plane × cone chamfers (§3 row 3): the cone spring lies one width
        // down the unit generator, in Q(√(1 + k²)) (`cone_rim_chamfer`).
        (Carrier3::Plane(_), Carrier3::Cone(_)) if section == Section::Chamfer => {
            return cone_rim_chamfer(m, edge, &circle, radius, uses[0], uses[1], node)
        }
        (Carrier3::Cone(_), Carrier3::Plane(_)) if section == Section::Chamfer => {
            return cone_rim_chamfer(m, edge, &circle, radius, uses[1], uses[0], node)
        }
        (Carrier3::Plane(_), Carrier3::Cone(_)) => {
            return cone_rim_fillet(m, edge, &circle, radius, uses[0], uses[1], node)
        }
        (Carrier3::Cone(_), Carrier3::Plane(_)) => {
            return cone_rim_fillet(m, edge, &circle, radius, uses[1], uses[0], node)
        }
        (a, b) => {
            let (a, b) = if kind(a) <= kind(b) { (kind(a), kind(b)) } else { (kind(b), kind(a)) };
            return Err(Refusal(format!("blend/spine-not-analytic:{a}x{b}/ring")));
        }
    };
    let (Carrier3::Plane(plane), Carrier3::Cylinder(cylinder)) = (carrier(&pu), carrier(&cu)) else {
        unreachable!()
    };
    let frame = cylinder.frame()?.clone();
    let cols = frame.columns().clone();
    if !frame.is_isometry() || !dot(&cols[0], &cross(&cols[1], &cols[2])).is_positive() {
        return refuse("blend/rim-frame-not-isometric");
    }
    let band = m
        .revolution_band(cu.0)?
        .ok_or_else(|| Refusal("blend/rim-cylinder-not-a-band".into()))?;
    let rho0 = band.radius[0].clone();
    let inverse = frame.inverse();
    let h = inverse.point(circle.frame()?.origin())[2].clone();
    let other = if h == band.lo {
        band.hi.clone()
    } else if h == band.hi {
        band.lo.clone()
    } else {
        return refuse("blend/contract-violation:rim/ring-not-band-end");
    };
    let dz = if other > h { q(1) } else { q(-1) };
    if !cross(&plane.n, &cols[2]).iter().all(Q::is_zero) {
        return refuse("blend/spine-not-analytic:plane-oblique×cylinder/ring");
    }
    // Side of the plane face at the ring: a ring traversed like an outer
    // loop bounds the disk (ds = -1), otherwise the face lies outside it.
    let pf = &d.faces[pu.0.index()];
    let ring_ccw = match d.coedges[pu.2.index()].pcurve.carrier() {
        Carrier::Circle(c) => c.ccw,
        Carrier::Line | Carrier::BSpline(_) => return refuse("blend/contract-violation:rim/plane-pcurve"),
    };
    let ds = if ring_ccw == pf.forward { q(-1) } else { q(1) };
    let n_rho = if band.forward { q(1) } else { q(-1) };
    let convex = n_rho == -&ds;
    let plane_out = dot(&plane.n, &cols[2]) * if pf.forward { q(1) } else { q(-1) };
    let expected = if convex { -&dz } else { dz.clone() };
    if plane_out.signum() != expected {
        return refuse("blend/contract-violation:rim/orientation");
    }
    let r = radius.clone();
    let major = &rho0 + &ds * &r;
    if major.is_negative() {
        let what = match section {
            Section::Fillet => "radius",
            Section::Chamfer => "width",
        };
        return Err(Refusal(format!("blend/{what}-exceeds-rim({},{})", text(&r), text(&rho0))));
    }
    let hc = &h + &dz * &r;
    if !(&dz * (&other - &hc)).is_positive() {
        return Err(Refusal(format!(
            "blend/overflow:band-consumed({},{})",
            text(&r),
            text(&(&dz * (&other - &h)))
        )));
    }
    let zc = hc.clone();
    let at = |z: &Q| Frame::new(frame.point(&[Q::zero(), Q::zero(), z.clone()]), cols.clone());
    // Directions of the old uses about the axis (exact frame relation).
    let positive_old = {
        let map = frame.relation_from(circle.frame()?).map;
        let [x, y, _] = map.columns();
        (&x[0] * &y[1] - &x[1] * &y[0]).is_positive()
    };
    let ccw = |c: CoedgeId| d.coedges[c.index()].forward == positive_old;
    let (plane_ccw, band_ccw) = (ccw(pu.2), ccw(cu.2));

    let mut out = m.clone().into_draft();
    let mut slot = 0u32;
    let mut prov = || {
        slot += 1;
        Provenance { node, slot: slot - 1 }
    };
    // The band's spring ring reuses the old edge and curve.
    let spring_c = Circle3::new(at(&hc)?, &rho0 * &rho0)?;
    out.curves[e.curve.index()] = Curve { geometry: Curve3::Circle(spring_c), provenance: prov() };
    let band_atlas = AtlasTrim::ring(hc.clone(), band_ccw)?;
    {
        let co = &mut out.coedges[cu.2.index()];
        co.forward = band_ccw;
        co.pcurve = band_atlas.pieces[0].piece.clone();
        co.atlas = Some(band_atlas);
        co.provenance = prov();
    }
    let rim = Rim { convex, major: Radical::from(major.clone()), minor: r.clone() };
    let tube_patch_sign = if ds.is_negative() { q(1) } else { q(-1) };
    if major.is_zero() {
        // Sphere cap: the disk is consumed. The plane face slot becomes the
        // cap, its one loop is the band spring, closed by the pole.
        if pf.loops.len() != 1 {
            return refuse("blend/overflow:plane-face-consumed");
        }
        // A sphere cap is charted by its tube half-angle (the band spring at
        // 0), a cone apex band by the spring's height.
        let (carrier, t) = match section {
            Section::Fillet => (Carrier3::Sphere(Sphere3::new(at(&zc)?, &r * &r)?), Q::zero()),
            Section::Chamfer => {
                let rings = [(h.clone(), Q::zero()), (hc.clone(), rho0.clone())];
                (Carrier3::Cone(Cone3::new(frame.clone(), rings)?), hc.clone())
            }
        };
        out.surfaces[pf.surface.index()] = Surface { carrier, provenance: prov() };
        let atlas = AtlasTrim::ring(t, !band_ccw)?;
        out.coedges[pu.2.index()] = Coedge {
            edge,
            forward: !band_ccw,
            pcurve: atlas.pieces[0].piece.clone(),
            atlas: Some(atlas),
            provenance: prov(),
        };
        out.faces[pu.0.index()].forward = match section {
            Section::Fillet => convex,
            Section::Chamfer => band.forward,
        };
        out.faces[pu.0.index()].provenance = prov();
    } else {
        // The plane's spring ring: a new curve and edge.
        let spring_p = Circle3::new(at(&h)?, &major * &major)?;
        let pcurve = plane_ring_pcurve(&spring_p, plane, plane_ccw)?;
        for &l in &pf.loops {
            if l == pu.1 {
                continue;
            }
            for &c in &d.loops[l.index()].coedges {
                let contacts = pcurve
                    .contacts(&d.coedges[c.index()].pcurve)
                    .map_err(|e| Refusal(e.name().into()))?;
                if !contacts.is_empty() {
                    return Err(Refusal(format!(
                        "blend/overflow:edge{}({})",
                        d.coedges[c.index()].edge.0,
                        text(&r)
                    )));
                }
            }
        }
        let curve = CurveId(out.curves.len() as u32);
        out.curves.push(Curve { geometry: Curve3::Circle(spring_p), provenance: prov() });
        let pe = EdgeId(out.edges.len() as u32);
        out.edges.push(Edge { curve, bounds: Bounds::Ring, provenance: prov() });
        {
            let co = &mut out.coedges[pu.2.index()];
            co.edge = pe;
            co.forward = plane_ccw;
            co.pcurve = pcurve;
            co.provenance = prov();
        }
        // The tube face: two rings at tube half-angles 0 (band spring,
        // cos θ = -ds) and ∓1 (plane spring, sin θ = -dz). The cone face:
        // the same two rings at their heights.
        let (carrier, [band_t, plane_t]) = match section {
            Section::Fillet => (
                Carrier3::Torus(Torus3::new(at(&zc)?, major.clone(), r.clone())?),
                [Q::zero(), -&dz * &tube_patch_sign],
            ),
            Section::Chamfer => {
                let rings = [(h.clone(), major.clone()), (hc.clone(), rho0.clone())];
                (Carrier3::Cone(Cone3::new(frame.clone(), rings)?), [hc.clone(), h.clone()])
            }
        };
        let mut loops = vec![];
        for (edge, along, t) in [(edge, !band_ccw, band_t), (pe, !plane_ccw, plane_t)] {
            let atlas = AtlasTrim::ring(t, along)?;
            let co = CoedgeId(out.coedges.len() as u32);
            out.coedges.push(Coedge {
                edge,
                forward: along,
                pcurve: atlas.pieces[0].piece.clone(),
                atlas: Some(atlas),
                provenance: prov(),
            });
            let lp = LoopId(out.loops.len() as u32);
            out.loops.push(Loop { coedges: vec![co], provenance: prov() });
            loops.push(lp);
        }
        // A cone band lists its lower ring first (the revolution band audit).
        if section == Section::Chamfer && hc > h {
            loops.reverse();
        }
        let surface = SurfaceId(out.surfaces.len() as u32);
        out.surfaces.push(Surface { carrier, provenance: prov() });
        // A tube carrier's normal points out of the ball (forward when
        // convex); a cone carrier's points away from the axis, as the band's.
        let forward = match section {
            Section::Fillet => convex,
            Section::Chamfer => band.forward,
        };
        let face = FaceId(out.faces.len() as u32);
        out.faces.push(Face { surface, forward, loops, provenance: prov() });
        let shell = out
            .shells
            .iter()
            .position(|s| s.faces.contains(&pu.0))
            .ok_or_else(|| Refusal("blend/contract-violation:rim/shell".into()))?;
        out.shells[shell].faces.push(face);
    }
    let model = out.check().map_err(|e| {
        if e.0.starts_with("model/g6") {
            Refusal(format!("blend/overflow:plane-face({})", e.0))
        } else {
            Refusal(format!("blend/contract-violation:rim/{}", e.0))
        }
    })?;
    Ok((model, rim))
}

/// Equal-offset chamfer of the ring between a plane ⟂ axis and a coaxial
/// cone band (frustum tops, countersink rims; fillets3d design §3 row 3).
///
/// In the meridian half-plane the ring is the corner E = (ρh, h). The plane
/// spring sets back by `w` along the plane, (ρh + ds·w, h), rational. The
/// cone spring sets back by `w` along the unit generator towards the band's
/// other end: (ρh + k·dz·w/L, h + dz·w/L) with L = √(1 + k²), in Q(√(1+k²))
/// (Onshape EQUAL_OFFSETS sets back along each face, probe FP-a). The new
/// face is the cone through both springs, whose meridian is then in the same
/// field; the cone band keeps its far ring and ends at the spring ring, a
/// `RadicalCircle` shared by both bands. Nothing is rounded: the spring
/// height is an exact Q(√d) number, and the full Model audit (band audit in
/// Q(√d), quartic ray hits, coherence of the Q(√d) face) runs on the result.
fn cone_rim_chamfer(
    m: &Model,
    edge: EdgeId,
    circle: &Circle3,
    width: &Q,
    pu: (FaceId, LoopId, CoedgeId),
    cu: (FaceId, LoopId, CoedgeId),
    node: u32,
) -> Result<(Model, Rim)> {
    let d = m.draft();
    let carrier = |u: &(FaceId, LoopId, CoedgeId)| &d.surfaces[d.faces[u.0.index()].surface.index()].carrier;
    let (Carrier3::Plane(plane), Carrier3::Cone(cone)) = (carrier(&pu), carrier(&cu)) else {
        return refuse("blend/contract-violation:rim/carriers");
    };
    let frame = cone.frame.clone();
    let cols = frame.columns().clone();
    if !frame.is_isometry() || !dot(&cols[0], &cross(&cols[1], &cols[2])).is_positive() {
        return refuse("blend/rim-frame-not-isometric");
    }
    if !cross(&plane.n, &cols[2]).iter().all(Q::is_zero) {
        return refuse("blend/spine-not-analytic:plane-oblique×cone/ring");
    }
    let band = m
        .radical_band(cu.0)?
        .ok_or_else(|| Refusal("blend/rim-cone-not-a-band".into()))?;
    // The rim cone is rational: its generator slope k is, and so is the
    // squared generator length 1 + k².
    let (Some(b0), Some(k)) = (band.radius[0].rational(), band.radius[1].rational()) else {
        return refuse("blend/number-class-exceeded:quadratic-rim-cone");
    };
    let inverse = frame.inverse();
    let h = inverse.point(circle.frame()?.origin())[2].clone();
    let rh = Radical::from(h.clone());
    let other = if rh == band.lo {
        band.hi.clone()
    } else if rh == band.hi {
        band.lo.clone()
    } else {
        return refuse("blend/contract-violation:rim/ring-not-band-end");
    };
    let dz = if other > rh { q(1) } else { q(-1) };
    let rho_h = &b0 + &k * &h;
    let pf = &d.faces[pu.0.index()];
    let ring_ccw = match d.coedges[pu.2.index()].pcurve.carrier() {
        Carrier::Circle(c) => c.ccw,
        Carrier::Line | Carrier::BSpline(_) => return refuse("blend/contract-violation:rim/plane-pcurve"),
    };
    let ds = if ring_ccw == pf.forward { q(-1) } else { q(1) };
    // The band's outward normal leaves the axis when the face is forward;
    // the corner is convex when the plane continues against that normal.
    let n_rho = if band.forward { q(1) } else { q(-1) };
    let convex = n_rho == -&ds;
    let plane_out = dot(&plane.n, &cols[2]) * if pf.forward { q(1) } else { q(-1) };
    let expected = if convex { -&dz } else { dz.clone() };
    if plane_out.signum() != expected {
        return refuse("blend/contract-violation:rim/orientation");
    }
    let w = width.clone();
    let rho_p = &rho_h + &ds * &w;
    if !rho_p.is_positive() {
        return Err(Refusal(format!("blend/width-exceeds-rim({},{})", text(&w), text(&rho_h))));
    }
    let length2 = q(1) + &k * &k;
    let budget = |e: wonky_curve::Refusal| Refusal(format!("blend/{}", e.name()));
    let step = Radical::quadratic(Q::zero(), &dz * &w, length2.clone()).map_err(budget)?;
    let step = wonky_curve::radical::guard(|| &step / &Radical::from(length2.clone())).map_err(budget)?;
    // dz·w/L = dz·w·√(1+k²)/(1+k²); the spring ring and its radius.
    let (zc, rho_c) = wonky_curve::radical::guard(|| (&rh + &step, Radical::from(rho_h.clone()) + &step * &k))
        .map_err(budget)?;
    let past = wonky_curve::radical::guard(|| (&other - &zc) * &dz).map_err(budget)?;
    if !past.is_positive() {
        return Err(Refusal(format!("blend/overflow:band-consumed({})", text(&w))));
    }
    let at = |z: &Q| Frame::new(frame.point(&[Q::zero(), Q::zero(), z.clone()]), cols.clone());
    let positive_old = {
        let map = frame.relation_from(circle.frame()?).map;
        let [x, y, _] = map.columns();
        (&x[0] * &y[1] - &x[1] * &y[0]).is_positive()
    };
    let ccw = |c: CoedgeId| d.coedges[c.index()].forward == positive_old;
    let (plane_ccw, band_ccw) = (ccw(pu.2), ccw(cu.2));

    let mut out = m.clone().into_draft();
    let mut slot = 0u32;
    let mut prov = || {
        slot += 1;
        Provenance { node, slot: slot - 1 }
    };
    // The cone spring reuses the old edge: a Q(√d) latitude of the cone
    // frame, as the cylinder surgery re-frames its spring ring.
    let e = &d.edges[edge.index()];
    let spring_c = match (zc.rational(), rho_c.rational()) {
        (Some(z), Some(r)) => Curve3::Circle(Circle3::new(at(&z)?, &r * &r)?),
        _ => Curve3::RadicalCircle(RadicalCircle3::new(frame.clone(), zc.clone(), rho_c.clone())?),
    };
    out.curves[e.curve.index()] = Curve { geometry: spring_c, provenance: prov() };
    let band_atlas = AtlasTrim::radical_ring(zc.clone(), band_ccw)?;
    {
        let co = &mut out.coedges[cu.2.index()];
        co.forward = band_ccw;
        co.pcurve = band_atlas.pieces[0].piece.clone();
        co.atlas = Some(band_atlas);
        co.provenance = prov();
    }
    // The plane's spring ring: a new rational curve and edge.
    let spring_p = Circle3::new(at(&h)?, &rho_p * &rho_p)?;
    let pcurve = plane_ring_pcurve(&spring_p, plane, plane_ccw)?;
    for &l in &pf.loops {
        if l == pu.1 {
            continue;
        }
        for &c in &d.loops[l.index()].coedges {
            let contacts = pcurve
                .contacts(&d.coedges[c.index()].pcurve)
                .map_err(|e| Refusal(e.name().into()))?;
            if !contacts.is_empty() {
                return Err(Refusal(format!(
                    "blend/overflow:edge{}({})",
                    d.coedges[c.index()].edge.0,
                    text(&w)
                )));
            }
        }
    }
    let curve = CurveId(out.curves.len() as u32);
    out.curves.push(Curve { geometry: Curve3::Circle(spring_p), provenance: prov() });
    let pe = EdgeId(out.edges.len() as u32);
    out.edges.push(Edge { curve, bounds: Bounds::Ring, provenance: prov() });
    {
        let co = &mut out.coedges[pu.2.index()];
        co.edge = pe;
        co.forward = plane_ccw;
        co.pcurve = pcurve;
        co.provenance = prov();
    }
    // The chamfer cone through both springs, rings listed lower first.
    let mut rings = [(rh.clone(), Radical::from(rho_p.clone())), (zc.clone(), rho_c.clone())];
    if zc < rh {
        rings.swap(0, 1);
    }
    let chamfer = Carrier3::Cone(Cone3::quadratic(frame.clone(), rings)?);
    let mut loops = vec![];
    for (edge, along, t) in [(edge, !band_ccw, zc.clone()), (pe, !plane_ccw, rh.clone())] {
        let atlas = AtlasTrim::radical_ring(t, along)?;
        let co = CoedgeId(out.coedges.len() as u32);
        out.coedges.push(Coedge {
            edge,
            forward: along,
            pcurve: atlas.pieces[0].piece.clone(),
            atlas: Some(atlas),
            provenance: prov(),
        });
        let lp = LoopId(out.loops.len() as u32);
        out.loops.push(Loop { coedges: vec![co], provenance: prov() });
        loops.push(lp);
    }
    if zc > rh {
        loops.reverse();
    }
    let surface = SurfaceId(out.surfaces.len() as u32);
    out.surfaces.push(Surface { carrier: chamfer, provenance: prov() });
    // The away-from-axis normal of the chamfer cone points to the old
    // corner exactly when the plane spring lies inside the ring (ds < 0);
    // the outward side is the corner's side for a convex rim.
    let forward = ds.is_negative() == convex;
    let face = FaceId(out.faces.len() as u32);
    out.faces.push(Face { surface, forward, loops, provenance: prov() });
    let shell = out
        .shells
        .iter()
        .position(|s| s.faces.contains(&pu.0))
        .ok_or_else(|| Refusal("blend/contract-violation:rim/shell".into()))?;
    out.shells[shell].faces.push(face);
    let model = out.check().map_err(|e| {
        if e.0.starts_with("model/g6") {
            Refusal(format!("blend/overflow:plane-face({})", e.0))
        } else {
            Refusal(format!("blend/contract-violation:rim/{}", e.0))
        }
    })?;
    Ok((model, Rim { convex, major: Radical::from(rho_p), minor: w }))
}

/// Constant-radius fillet of the ring between a plane ⟂ axis and a coaxial
/// cone band (pc-cone-rim-*; fillets3d design §3 row 3, errata 2).
///
/// In the meridian half-plane the ball centre is at height h + dz·r and one
/// radius off the cone generator, on the material side when convex:
/// R = ρh + k·dz·r + σ·r·L with L = √(1 + k²), σ = −n_ρ (convex) or n_ρ.
/// The torus major R and the cone spring (R − σr/L, h + dz·r + σkr/L) are in
/// Q(√(1+k²)); the plane spring is the latitude (R, h). The tube band runs
/// from the plane spring (tube angle ±90°, quarter grid) to the cone spring,
/// whose tube angle has the rational tangent of the cone normal, so the
/// volume is exact in Q(√d)[π] plus π·atan(x). A Q(√d) plane spring is
/// charted in polar coordinates on the plane (`flat_band`). Nothing is
/// rounded; the full Model audit runs on the result.
fn cone_rim_fillet(
    m: &Model,
    edge: EdgeId,
    circle: &Circle3,
    radius: &Q,
    pu: (FaceId, LoopId, CoedgeId),
    cu: (FaceId, LoopId, CoedgeId),
    node: u32,
) -> Result<(Model, Rim)> {
    let d = m.draft();
    let carrier = |u: &(FaceId, LoopId, CoedgeId)| &d.surfaces[d.faces[u.0.index()].surface.index()].carrier;
    let (Carrier3::Plane(plane), Carrier3::Cone(cone)) = (carrier(&pu), carrier(&cu)) else {
        return refuse("blend/contract-violation:rim/carriers");
    };
    let frame = cone.frame.clone();
    let cols = frame.columns().clone();
    if !frame.is_isometry() || !dot(&cols[0], &cross(&cols[1], &cols[2])).is_positive() {
        return refuse("blend/rim-frame-not-isometric");
    }
    if !cross(&plane.n, &cols[2]).iter().all(Q::is_zero) {
        return refuse("blend/spine-not-analytic:plane-oblique×cone/ring");
    }
    let band = m
        .radical_band(cu.0)?
        .ok_or_else(|| Refusal("blend/rim-cone-not-a-band".into()))?;
    let (Some(b0), Some(k)) = (band.radius[0].rational(), band.radius[1].rational()) else {
        return refuse("blend/number-class-exceeded:quadratic-rim-cone");
    };
    let inverse = frame.inverse();
    let h = inverse.point(circle.frame()?.origin())[2].clone();
    let rh = Radical::from(h.clone());
    let other = if rh == band.lo {
        band.hi.clone()
    } else if rh == band.hi {
        band.lo.clone()
    } else {
        return refuse("blend/contract-violation:rim/ring-not-band-end");
    };
    let dz = if other > rh { q(1) } else { q(-1) };
    let rho_h = &b0 + &k * &h;
    let pf = &d.faces[pu.0.index()];
    if pf.loops.len() != 1 {
        return refuse("blend/ssi-row-unavailable:plane/quadratic-ring-with-other-loops");
    }
    let ring_ccw = match d.coedges[pu.2.index()].pcurve.carrier() {
        Carrier::Circle(c) => c.ccw,
        Carrier::Line | Carrier::BSpline(_) => return refuse("blend/contract-violation:rim/plane-pcurve"),
    };
    let ds = if ring_ccw == pf.forward { q(-1) } else { q(1) };
    let n_rho = if band.forward { q(1) } else { q(-1) };
    let convex = n_rho == -&ds;
    let plane_out = dot(&plane.n, &cols[2]) * if pf.forward { q(1) } else { q(-1) };
    let expected = if convex { -&dz } else { dz.clone() };
    if plane_out.signum() != expected {
        return refuse("blend/contract-violation:rim/orientation");
    }
    // A disk face (the only plane loop): the plane spring must stay inside it.
    if !ds.is_negative() {
        return refuse("blend/ssi-row-unavailable:plane/quadratic-ring-with-other-loops");
    }
    let r = radius.clone();
    let budget = |e: wonky_curve::Refusal| Refusal(format!("blend/{}", e.name()));
    let guard = |f: &dyn Fn() -> Radical| wonky_curve::radical::guard(f).map_err(budget);
    let length2 = q(1) + &k * &k;
    let length = Radical::quadratic(Q::zero(), q(1), length2.clone()).map_err(budget)?;
    let sigma = if convex { -&n_rho } else { n_rho.clone() };
    let hc = &h + &dz * &r;
    let major = guard(&|| Radical::from(&rho_h + &k * &dz * &r) + &length * &(&sigma * &r))?;
    if !major.is_positive() || major >= Radical::from(rho_h.clone()) {
        return Err(Refusal(format!("blend/radius-exceeds-rim({},{})", text(&r), text(&rho_h))));
    }
    // r/L = r·L/(1 + k²); the cone spring.
    let over = guard(&|| &length * &(&r / &length2))?;
    let rho_f = guard(&|| &major - &(&over * &sigma))?;
    let z_f = guard(&|| Radical::from(hc.clone()) + &over * &(&sigma * &k))?;
    let past = guard(&|| (&other - &z_f) * &dz)?;
    if !past.is_positive() {
        return Err(Refusal(format!("blend/overflow:band-consumed({})", text(&r))));
    }
    let at = |z: &Q| Frame::new(frame.point(&[Q::zero(), Q::zero(), z.clone()]), cols.clone());
    let positive_old = {
        let map = frame.relation_from(circle.frame()?).map;
        let [x, y, _] = map.columns();
        (&x[0] * &y[1] - &x[1] * &y[0]).is_positive()
    };
    let ccw = |c: CoedgeId| d.coedges[c.index()].forward == positive_old;
    let (plane_ccw, band_ccw) = (ccw(pu.2), ccw(cu.2));
    let ring = |z: &Radical, rho: &Radical| -> Result<Curve3> {
        Ok(match (z.rational(), rho.rational()) {
            (Some(z), Some(rho)) => Curve3::Circle(Circle3::new(at(&z)?, &rho * &rho)?),
            _ => Curve3::RadicalCircle(RadicalCircle3::new(frame.clone(), z.clone(), rho.clone())?),
        })
    };

    let mut out = m.clone().into_draft();
    let mut slot = 0u32;
    let mut prov = || {
        slot += 1;
        Provenance { node, slot: slot - 1 }
    };
    // The cone spring reuses the old edge.
    let e = &d.edges[edge.index()];
    out.curves[e.curve.index()] = Curve { geometry: ring(&z_f, &rho_f)?, provenance: prov() };
    let band_atlas = AtlasTrim::radical_ring(z_f.clone(), band_ccw)?;
    {
        let co = &mut out.coedges[cu.2.index()];
        co.forward = band_ccw;
        co.pcurve = band_atlas.pieces[0].piece.clone();
        co.atlas = Some(band_atlas);
        co.provenance = prov();
    }
    // The plane spring: a planar ring pcurve when rational, else the polar
    // chart of a flat band.
    let spring_p = ring(&rh, &major)?;
    let curve = CurveId(out.curves.len() as u32);
    let (pcurve, atlas) = match &spring_p {
        Curve3::Circle(c) => (plane_ring_pcurve(c, plane, plane_ccw)?, None),
        _ => {
            let atlas = AtlasTrim::radical_ring(major.clone(), plane_ccw)?;
            (atlas.pieces[0].piece.clone(), Some(atlas))
        }
    };
    out.curves.push(Curve { geometry: spring_p, provenance: prov() });
    let pe = EdgeId(out.edges.len() as u32);
    out.edges.push(Edge { curve, bounds: Bounds::Ring, provenance: prov() });
    {
        let co = &mut out.coedges[pu.2.index()];
        co.edge = pe;
        co.forward = plane_ccw;
        co.pcurve = pcurve;
        co.atlas = atlas;
        co.provenance = prov();
    }
    // The tube face: rings at their exact tube half-angles. The cone spring
    // lies at (cos, sin) = (−σ/L, σk/L) from the centre, the plane spring at
    // (0, −dz); the half-tube is the cone spring's side.
    let (cos_f, sin_f) = (guard(&|| &length * &(-&sigma / &length2))?, guard(&|| &length * &(&sigma * &k / &length2))?);
    let patch_sign = if cos_f.is_positive() { q(1) } else { q(-1) };
    let t_of = |c: &Radical, s: &Radical| guard(&|| s * &patch_sign / &(Radical::from(Q::one()) + c * &patch_sign));
    let band_t = t_of(&cos_f, &sin_f)?;
    let plane_t = Radical::from(-&dz * &patch_sign);
    let torus = Torus3::quadratic(at(&hc)?, major.clone(), r.clone())?;
    let mut loops = vec![];
    for (edge, along, t) in [(edge, !band_ccw, band_t), (pe, !plane_ccw, plane_t)] {
        let atlas = AtlasTrim::radical_ring(t, along)?;
        let co = CoedgeId(out.coedges.len() as u32);
        out.coedges.push(Coedge {
            edge,
            forward: along,
            pcurve: atlas.pieces[0].piece.clone(),
            atlas: Some(atlas),
            provenance: prov(),
        });
        let lp = LoopId(out.loops.len() as u32);
        out.loops.push(Loop { coedges: vec![co], provenance: prov() });
        loops.push(lp);
    }
    let surface = SurfaceId(out.surfaces.len() as u32);
    out.surfaces.push(Surface { carrier: Carrier3::Torus(torus), provenance: prov() });
    let face = FaceId(out.faces.len() as u32);
    out.faces.push(Face { surface, forward: convex, loops, provenance: prov() });
    let shell = out
        .shells
        .iter()
        .position(|s| s.faces.contains(&pu.0))
        .ok_or_else(|| Refusal("blend/contract-violation:rim/shell".into()))?;
    out.shells[shell].faces.push(face);
    let model = out.check().map_err(|e| Refusal(format!("blend/contract-violation:rim/{}", e.0)))?;
    Ok((model, Rim { convex, major, minor: r }))
}
