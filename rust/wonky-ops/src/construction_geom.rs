//! Bridge audited construction placements to the shared exact geometry core.
//! No WC0 surface/vertex cache is used as authority, and no rational relation
//! is materialized into a binary64 cylinder Spec.
use crate::{
    cylinder::{self, Cylinder},
    placement::Placement,
    polyhedron::Refused,
};
use num_traits::Zero;
use wonky_contract::Body;
use wonky_geom::{frame::Frame, point, Point, Q};
use wonky_num::{Iv, Scalar};

type R<T> = Result<T, Refused>;
fn no(code: &str) -> Refused {
    cylinder::no(code)
}
fn q(value: f64) -> R<Q> {
    wonky_geom::binary64(value).map_err(|e| Refused(e.0.into()))
}
pub(crate) fn frame(placement: &Placement) -> R<Frame> {
    let apply = |p, translate| -> R<Point> {
        let e = placement
            .apply_exact(p, 1., translate)
            .map_err(|_| no("frame-range"))?;
        let mut p = wonky_geom::zero();
        for k in 0..3 {
            for &value in &e[k] {
                p[k] += q(value)?;
            }
        }
        Ok(p)
    };
    Frame::new(
        apply([0.; 3], true)?,
        [
            apply([1., 0., 0.], false)?,
            apply([0., 1., 0.], false)?,
            apply([0., 0., 1.], false)?,
        ],
    )
    .map_err(|e| Refused(e.0.into()))
}
pub(crate) struct Axial {
    pub(crate) bottom: Point,
    pub(crate) top: Point,
    radius: Q,
    pub(crate) axis: usize,
}
impl Axial {
    pub(crate) fn in_frame(c: &Cylinder, target: &Placement) -> R<Self> {
        let relation = frame(target)?.relation_from(&frame(&c.frame)?);
        relation
            .require_isometry()
            .map_err(|e| Refused(e.0.into()))?;
        let source_bottom = point(c.spec.bottom).map_err(|e| Refused(e.0.into()))?;
        let source_top = point(c.spec.top).map_err(|e| Refused(e.0.into()))?;
        let mut bottom = relation.map.point(&source_bottom);
        let mut top = relation.map.point(&source_top);
        let axes = (0..3).filter(|&i| bottom[i] != top[i]).collect::<Vec<_>>();
        if axes.len() != 1 {
            return Err(no("non-coordinate-related-axis"));
        }
        let axis = axes[0];
        if bottom[axis] > top[axis] {
            std::mem::swap(&mut bottom, &mut top);
        }
        Ok(Self {
            bottom,
            top,
            radius: q(c.spec.radius)?,
            axis,
        })
    }
    fn radial2(&self, other: &Self) -> R<Q> {
        if self.axis != other.axis {
            return Err(no("general-quadric-ssi"));
        }
        Ok((0..3)
            .filter(|&i| i != self.axis)
            .map(|i| {
                let d = &self.bottom[i] - &other.bottom[i];
                &d * &d
            })
            .sum())
    }
}
/// The existing family can return unchanged operands without inventing a new
/// replay authority. Overlapping cross-frame output needs a chart arrangement
/// (or a reframe construction node), and remains a named refusal.
pub(crate) fn separated_boolean(op: u8, a: &Cylinder, b: &Cylinder) -> R<Vec<Body>> {
    let left = Axial::in_frame(a, &a.frame)?;
    let right = Axial::in_frame(b, &a.frame)?;
    let d2 = left.radial2(&right)?;
    let rs = &left.radius + &right.radius;
    let radial_separate = d2 >= &rs * &rs;
    let k = left.axis;
    let shared_cap = left.top[k] == right.bottom[k] || right.top[k] == left.bottom[k];
    if op == 0 && shared_cap && !radial_separate {
        return Err(no("cap-contact-arrangement"));
    }
    if left.top[k] <= right.bottom[k] || right.top[k] <= left.bottom[k] || radial_separate {
        return match op {
            0 => Ok(vec![a.body.clone(), b.body.clone()]),
            1 => Ok(vec![a.body.clone()]),
            2 => Err(Refused::geometric_verdict(no("empty-result").0)),
            _ => Err(no("operation")),
        };
    }
    Err(no("cross-frame-overlap-arrangement"))
}
pub(crate) fn tangent_box_noop(target: &crate::polyhedron::Audited, c: &Cylinder) -> R<()> {
    let cells = target
        .orthogonal
        .as_ref()
        .ok_or_else(|| no("non-orthogonal-target"))?;
    let c = Axial::in_frame(c, &target.frame)?;
    for cell in &cells.boxes {
        let lo = point(cell[0]).map_err(|e| Refused(e.0.into()))?;
        let hi = point(cell[1]).map_err(|e| Refused(e.0.into()))?;
        if c.top[c.axis] <= lo[c.axis] || c.bottom[c.axis] >= hi[c.axis] {
            continue;
        }
        let d2: Q = (0..3)
            .filter(|&i| i != c.axis)
            .map(|i| {
                let closest = c.bottom[i].clone().max(lo[i].clone()).min(hi[i].clone());
                let delta = &c.bottom[i] - closest;
                &delta * &delta
            })
            .sum();
        if d2 < &c.radius * &c.radius {
            return Err(no("cross-frame-cut-arrangement"));
        }
    }
    Ok(())
}
pub(crate) fn distance_mm(a: &Cylinder, b: &Cylinder) -> R<(f64, f64)> {
    let left = Axial::in_frame(a, &a.frame)?;
    let right = Axial::in_frame(b, &a.frame)?;
    let d2 = left.radial2(&right)?;
    let k = left.axis;
    if left.top[k] < right.bottom[k] || right.top[k] < left.bottom[k] {
        return Err(no("distance-disjoint-axial-intervals"));
    }
    let rs = &left.radius + &right.radius;
    let numerator = &d2 - &rs * &rs;
    if numerator <= Q::zero() {
        return Ok((0., 0.));
    }
    let enclose = |x: &Q| crate::probe_exact::enclose(x).map_err(|_| no("observation-range"));
    let gap = enclose(&numerator)? / (enclose(&d2)?.sqrt() + enclose(&rs)?) * Iv::point(1000.);
    let defect = a
        .frame
        .orthonormality_defect()
        .map_err(|_| no("frame-range"))?;
    let gap = cylinder::finite(
        gap * Iv {
            m: 1.,
            r: (3. * defect).next_up(),
        },
    )?;
    Ok((gap.m, gap.r))
}
