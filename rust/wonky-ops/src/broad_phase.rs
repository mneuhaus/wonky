//! Certified world-space enclosures for pair enumeration, never WC0 observation
//! caches. An unsupported enclosure leaves the pair for the unchanged narrow
//! phase. Source boxes and exact vertices share one rational affine mechanism;
//! analytic profiles reuse their already outward-rounded support functions.
use crate::{analytic::Solid, placement::Placement, polyhedron::{Audited, Refused}};
use num_rational::BigRational as Q;
use num_traits::Zero;
use wonky_num::Iv;

type R<T> = Result<T, Refused>;
type P = [Q; 3];
fn no() -> Refused { Refused("interference/certified-bounds-unavailable".into()) }
fn q(x: f64) -> Q { Q::from_float(x).expect("audited finite input") }

pub(crate) struct Bounds {
    pub min: [f64; 3],
    pub max: [f64; 3],
    // Present only when the solid fills its axis-aligned box. This witnesses
    // attainment of box distance, not merely a lower bound for arbitrary solids.
    pub occupied: Option<[P; 2]>,
}
impl Bounds {
    fn endpoints(min: [f64; 3], max: [f64; 3]) -> R<Self> {
        if !(0..3).all(|k| min[k].is_finite() && max[k].is_finite() && min[k] <= max[k]) { return Err(no()); }
        Ok(Self { min, max, occupied: None })
    }
    fn points(points: Vec<P>, occupied: bool) -> R<Self> {
        if points.is_empty() { return Err(no()); }
        let min: P = std::array::from_fn(|k| points.iter().map(|p| p[k].clone()).min().unwrap());
        let max: P = std::array::from_fn(|k| points.iter().map(|p| p[k].clone()).max().unwrap());
        let enclosed = |p: &P| -> R<[Iv; 3]> {
            let xs = p.iter().map(|x| crate::probe_exact::enclose(x).map_err(|_| no())).collect::<R<Vec<_>>>()?;
            Ok([xs[0], xs[1], xs[2]])
        };
        let mut out = Self::endpoints(enclosed(&min)?.map(|x| x.lo()), enclosed(&max)?.map(|x| x.hi()))?;
        if occupied { out.occupied = Some([min, max]); }
        Ok(out)
    }
    pub fn json(&self) -> String {
        let nums = |v: &[f64; 3]| format!("[{:?},{:?},{:?}]", v[0], v[1], v[2]);
        let occupied = match &self.occupied {
            None => "null".into(),
            Some(ps) => format!("[{}]", ps.iter().map(|p| format!("[{}]", p.iter().map(|v| format!("\"{v}\"")).collect::<Vec<_>>().join(","))).collect::<Vec<_>>().join(",")),
        };
        format!("{{\"schema\":\"wonky-certified-bounds/v1\",\"min\":{},\"max\":{},\"occupiedBoxMm\":{occupied}}}", nums(&self.min), nums(&self.max))
    }
}
// Every affine image of a source box is enclosed by its eight exact corners.
// No near-isometry assumption and no rounded source-to-world matrix is used.
fn source_box(frame: &Placement, min: P, max: P, filled: bool) -> R<Bounds> {
    let frame = frame.exact_frame()?;
    let axis_aligned = frame.columns().iter().all(|c| c.iter().filter(|v| !v.is_zero()).count() == 1);
    let points = (0..8).map(|mask| {
        frame.point(&std::array::from_fn(|k| if mask & (1 << k) == 0 { min[k].clone() } else { max[k].clone() }))
            .map(|x| x * q(1000.))
    }).collect();
    Bounds::points(points, filled && axis_aligned)
}
fn planar(a: &Audited) -> R<Bounds> {
    // An exact arrangement takes precedence over any derived observation cells.
    if a.arrangement.is_some() {
        return Bounds::points(crate::planar_geometry::world_points(a, 1000.)?, false);
    }
    if a.arcs.is_some() {
        let (lo, hi) = a.bbox_mm(None)?; // exact profile extrema, including fillet rims
        return Bounds::endpoints(lo, hi);
    }
    if let Some(s) = &a.rounded {
        return source_box(&a.frame, s.bounds[0].map(q), s.bounds[1].map(q), false);
    }
    if let Some(s) = &a.corner {
        let lo = s.origin.map(q);
        let end: P = std::array::from_fn(|k| &lo[k] + q(s.signs[k]) * q(s.lengths[k]));
        return source_box(&a.frame, std::array::from_fn(|k| lo[k].clone().min(end[k].clone())), std::array::from_fn(|k| lo[k].clone().max(end[k].clone())), false);
    }
    if let Some(s) = &a.chamfer {
        let frame = a.frame.exact_frame()?;
        return Bounds::points(s.points.iter().map(|p| frame.point(p).map(|x| x * q(1000.))).collect(), false);
    }
    if let Some(cells) = &a.orthogonal {
        if cells.boxes.len() == 1 {
            let [lo, hi] = cells.boxes[0];
            return source_box(&a.frame, lo.map(q), hi.map(q), true);
        }
    }
    Bounds::points(crate::planar_geometry::world_points(a, 1000.)?, false)
}
fn cylinder(c: &crate::cylinder::Cylinder) -> R<Bounds> {
    let axis = c.spec.axis()?;
    let lo: P = std::array::from_fn(|k| q(c.spec.bottom[k].min(c.spec.top[k])) - if k == axis { Q::zero() } else { q(c.spec.radius) });
    let hi: P = std::array::from_fn(|k| q(c.spec.bottom[k].max(c.spec.top[k])) + if k == axis { Q::zero() } else { q(c.spec.radius) });
    source_box(&c.frame, lo, hi, false)
}
fn coaxial(c: &crate::coaxial::Coaxial) -> R<Bounds> {
    // Annular slices are enclosed by the same source-box mechanism as a
    // cylinder. The bore is deliberately not a filled-box distance witness.
    let radius = c.slices.iter().map(|s| s.outer).fold(0., f64::max);
    let z0 = c.slices.iter().map(|s| s.z0).fold(f64::INFINITY, f64::min);
    let z1 = c.slices.iter().map(|s| s.z1).fold(f64::NEG_INFINITY, f64::max);
    let lo: P = std::array::from_fn(|k| if k == c.axis { q(z0) } else { q(c.center[k]) - q(radius) });
    let hi: P = std::array::from_fn(|k| if k == c.axis { q(z1) } else { q(c.center[k]) + q(radius) });
    source_box(&Placement::from_frames(&c.body, wonky_contract::FrameId(1)).map_err(|_| no())?, lo, hi, false)
}
pub(crate) fn bounds(s: &Solid) -> R<Bounds> {
    match s {
        Solid::Model(_, _) if s.curved_model() => Err(crate::polyhedron::Refused("boolean/ssi-row-unavailable:model/curved-bounds".into())),
        Solid::Planar(a) | Solid::Model(a, _) => planar(a),
        Solid::Cylinder(c) => cylinder(c),
        Solid::Coaxial(c) => coaxial(c),
        Solid::PrismStack(a) => { let (lo, hi) = a.bbox_mm(None)?; Bounds::endpoints(lo, hi) },
        Solid::PrismHoles(a) => match &a.base {
            crate::prism_holes::Base::Planar(p) => { let mut b = planar(p)?; b.occupied = None; Ok(b) },
            crate::prism_holes::Base::Cylinder(c) => cylinder(c),
            crate::prism_holes::Base::Revolved(_) => Err(no()),
        },
        Solid::Perforated(p) => { let mut b = planar(&p.base)?; b.occupied = None; Ok(b) },
        // Keep this match exhaustive: adding a carrier must prompt an explicit
        // enclosure decision, not silently inherit a fallback. A generic rounded
        // measurement is NOT a certificate.
        Solid::Columns(_) | Solid::Revolved(_) | Solid::Placed(_) | Solid::Conical(_)
        | Solid::Bicylinder(_) | Solid::CylinderTee(_)
        | Solid::Spherical(_) | Solid::Axial(_) | Solid::Lens(_)
        | Solid::PerforatedChamfer(_) => Err(no()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::affine::Affine;
    #[test]
    fn cancellation_is_enclosed_and_a_rotated_box_is_not_claimed_filled() {
        let body = crate::orthogonal::cuboid(wonky_contract::BodyKey { id: [1,2,3,4], revision: 0 }, [0.;3], [1.;3]).unwrap();
        let checked = body.check().unwrap();
        let a = crate::polyhedron::audit(&checked).unwrap();
        let frame = a.frame.then(&crate::placement::Post::Interpreter(Affine { origin: [1., 0., 0.], x: [0.6, 0.8, 0.], z: [0., 0., 1.] })).unwrap();
        let b = source_box(&frame, [q(-1.), q(0.), q(0.)], [q(1.), q(1.), q(1.)], true).unwrap();
        assert!(b.occupied.is_none());
        let exact = frame.exact_frame().unwrap();
        for mask in 0..8 {
            let p = exact.point(&[if mask & 1 == 0 {q(-1.)} else {q(1.)}, q(if mask & 2 == 0 {0.} else {1.}), q(if mask & 4 == 0 {0.} else {1.})]).map(|x| x*q(1000.));
            for k in 0..3 { assert!(q(b.min[k]) <= p[k] && p[k] <= q(b.max[k])); }
        }
    }
}
