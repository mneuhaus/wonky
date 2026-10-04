//! Distance from a point outside the columned target to its body.
//!
//! `plan()` requires the base to carry a profile (never a bare cylinder), so
//! the boundary is covered by closed pieces over that profile: its lateral
//! wall (unconditional -- every column lies strictly inside the profile, so
//! columns never touch it); its two caps, each the full profile disc minus
//! at most one `CapRing` hole per side (columns are pairwise disjoint, so a
//! point lies under at most one ring); and, per column, its own `Wall`
//! (cylindrical band) and `Flat` (annulus/disc) pieces. Each piece is a
//! product of an exact planar region and an axial interval; region
//! membership is decided on exact rationals and each piece distance is an
//! interval enclosure of its closed form. Nothing is sampled or projected in
//! floating point.
use crate::{
    arc_profile::{dot, enclose, finite, q, sub, P},
    prism_columns::{no, Columns, R},
};
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use wonky_curve as wc;
use wonky_num::{Iv, Scalar};

fn i(x: f64) -> Iv {
    Iv::point(x)
}
fn norm(radial: Iv, axial: Iv) -> R<Iv> {
    finite(radial.norm3(axial, i(0.)))
}
/// Distance from the level `z` to the closed interval `[a, b]`.
fn axial_gap(z: &Q, a: &Q, b: &Q) -> R<Iv> {
    enclose(&(a - z).max(z - b).max(Q::zero()))
}
/// `|sqrt(d2) - r|`, rationalized so a point next to the circle does not
/// cancel two nearly equal enclosures.
fn ring_gap(d2: &Q, r: f64) -> R<Iv> {
    let r2 = q(r) * q(r);
    let excess = (d2 - &r2).abs();
    finite(enclose(&excess)? / (i(r) + enclose(d2)?.sqrt()))
}
fn squared(u: &P, c: &P) -> Q {
    let d = sub(u, c);
    dot(&d, &d)
}
fn min(pieces: impl IntoIterator<Item = Iv>) -> Option<Iv> {
    pieces.into_iter().reduce(|a, b| a.min(b))
}
/// Planar distance for a point against an annulus/disc `[inner, outer]`: 0
/// between the bounds, else the gap to the nearer ring.
fn annulus_gap(d2: &Q, inner: Option<f64>, outer: f64) -> R<Iv> {
    if *d2 > q(outer) * q(outer) {
        return ring_gap(d2, outer);
    }
    if let Some(ri) = inner {
        if *d2 < q(ri) * q(ri) {
            return ring_gap(d2, ri);
        }
    }
    Ok(i(0.))
}

impl Columns {
    /// Source-frame distance from a point outside the closed body.
    pub(crate) fn outside_distance(&self, p: &[Q; 3]) -> R<Iv> {
        let k = self.plan.axis;
        let (j1, j2) = ((k + 1) % 3, (k + 2) % 3);
        let u = [p[j1].clone(), p[j2].clone()];
        let z = &p[k];
        let mut pieces = vec![];
        let profile = self.base.profile().ok_or_else(|| no("target-carrier"))?;
        let point = wc::ExactPoint::from_rational(u.clone());
        let near = profile
            .profile
            .segments()
            .iter()
            .map(|s| Ok(s.distance(&point)?))
            .collect::<R<Vec<_>>>()?;
        let boundary = min(near).ok_or_else(|| no("target-carrier"))?;
        let inside = profile.contains(&point)?;
        let bounds = self.plan.levels.map(q);
        pieces.push(norm(boundary, axial_gap(z, &bounds[0], &bounds[1])?)?);
        for side in 0..2 {
            let planar = if !inside {
                boundary
            } else if let Some(ring) = self.plan.rings.iter().find(|r| {
                r.side == side && {
                    let c = self.plan.columns[r.column].center;
                    squared(&u, &[q(c[j1]), q(c[j2])]) < q(r.radius) * q(r.radius)
                }
            }) {
                let c = self.plan.columns[ring.column].center;
                ring_gap(&squared(&u, &[q(c[j1]), q(c[j2])]), ring.radius)?
            } else {
                i(0.)
            };
            pieces.push(norm(planar, enclose(&(z - &bounds[side]).abs())?)?);
        }
        for (ci, col) in self.plan.columns.iter().enumerate() {
            let center = [q(col.center[j1]), q(col.center[j2])];
            let d2 = squared(&u, &center);
            let (walls, flats, _) = self.plan.parts(ci);
            for w in walls {
                pieces.push(norm(ring_gap(&d2, w.radius)?, axial_gap(z, &q(w.lo), &q(w.hi))?)?);
            }
            for f in flats {
                let planar = annulus_gap(&d2, f.inner, f.outer)?;
                pieces.push(norm(planar, enclose(&(z - &q(f.level)).abs())?)?);
            }
        }
        min(pieces).ok_or_else(|| no("probe-empty"))
    }
}
