//! Exact point membership, distance and mapped boxes for coaxial stacks.
//!
//! The solid is the closed union of its slices, and every slice is the
//! revolution of the meridian rectangle [inner, outer] x [z0, z1] about the
//! common axis. Rotating a slab point into the probe's own meridian half-plane
//! never increases its distance to the probe, so the distance to one slab is
//! the planar rectangle distance sqrt(d_rho^2 + d_axial^2), and the distance
//! to the solid is the minimum over slabs. Membership (and which side of each
//! radius and height the probe lies on) is decided on exact rationals; only
//! the reported distance is rounded, with an interval enclosure.
use crate::{
    coaxial::{no, Coaxial},
    cylinder::{envelope_mm, finite, Spec},
    placement::Placement,
    polyhedron::Refused,
    probe_exact::{enclose, local_point, q, radial},
};
use num_rational::BigRational as Q;
use num_traits::Zero;
use std::cmp::Ordering;
use wonky_contract::FrameId;
use wonky_num::{Iv, Scalar};

type R<T> = Result<T, Refused>;

impl Coaxial {
    /// Frame 1 is the audited interpreter placement (source metres to world mm).
    fn placement(&self) -> R<Placement> {
        Placement::from_frames(&self.body, FrameId(1)).map_err(|_| no("probe-frame"))
    }
    /// Box of the stack under `map` (world mm to target mm, identity when
    /// absent): the union of the slices' outer-cylinder envelopes. Bores never
    /// carry an extreme, because every slice's outer rim is part of the solid.
    pub fn bbox_in(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let frame = self.placement()?;
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for s in &self.slices {
            let (mut bottom, mut top) = (self.center, self.center);
            bottom[self.axis] = s.z0;
            top[self.axis] = s.z1;
            let spec = Spec {
                bottom,
                top,
                radius: s.outer,
            };
            let (l, h) = envelope_mm(&frame, spec, map).map_err(|_| no("bbox-range"))?;
            for j in 0..3 {
                lo[j] = lo[j].min(l[j]);
                hi[j] = hi[j].max(h[j]);
            }
        }
        if lo.iter().chain(hi.iter()).any(|x| !x.is_finite()) {
            return Err(no("bbox-range"));
        }
        Ok((lo, hi))
    }
    /// Source-frame box extents in mm: the widest outer radius across both
    /// radial axes and the first-to-last slice height along the axis (slices
    /// are sorted and contiguous), rounded as the single-cylinder extents are.
    pub fn extents_mm(&self) -> R<[f64; 3]> {
        let (Some(first), Some(last)) = (self.slices.first(), self.slices.last()) else {
            return Err(no("empty-result"));
        };
        let reach = self.slices.iter().map(|s| s.outer).fold(0f64, f64::max);
        let mut d = [reach * 2000.; 3];
        d[self.axis] = (last.z1 - first.z0) * 1000.;
        if d.iter().any(|x| !x.is_finite() || *x <= 0.) {
            return Err(no("extents-range"));
        }
        Ok(d)
    }
    /// (distance mm, inside, distance enclosure radius mm) of a world point.
    /// The boundary belongs to the closed solid; no epsilon decides a side.
    pub fn probe(&self, point_mm: [f64; 3]) -> R<(f64, bool, f64)> {
        let frame = self.placement()?;
        let p = local_point(&frame, point_mm).map_err(no)?;
        let k = self.axis;
        let mut nearest: Option<Iv> = None;
        for s in &self.slices {
            let axial = (q(s.z0).map_err(no)? - &p[k]).max(&p[k] - q(s.z1).map_err(no)?);
            let outer = radial(&p, k, self.center, s.outer).map_err(no)?;
            let bore = if s.inner > 0. {
                Some(radial(&p, k, self.center, s.inner).map_err(no)?)
                    .filter(|r| r.comparison == Ordering::Less)
            } else {
                None
            };
            let beyond = outer.comparison == Ordering::Greater;
            if axial <= Q::zero() && !beyond && bore.is_none() {
                return Ok((0., true, 0.));
            }
            let d_rho = if beyond {
                outer.offset().map_err(no)?.max(Iv::point(0.))
            } else if let Some(r) = bore {
                (Iv::point(0.) - r.offset().map_err(no)?).max(Iv::point(0.))
            } else {
                Iv::point(0.)
            };
            let d_axial = enclose(&axial).map_err(no)?.max(Iv::point(0.));
            let d = d_rho.norm3(d_axial, Iv::point(0.));
            nearest = Some(nearest.map_or(d, |n| n.min(d)));
        }
        let local = nearest.ok_or_else(|| no("empty-result"))?;
        let defect = frame
            .orthonormality_defect()
            .map_err(|_| no("probe-frame"))?;
        let distance = finite(
            local
                * Iv::point(1000.)
                * Iv {
                    m: 1.,
                    r: (3. * defect).next_up(),
                },
        )
        .map_err(|_| no("probe-range"))?;
        Ok((distance.m, false, distance.r))
    }
}
