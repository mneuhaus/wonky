//! Counter-clockwise direction order and the star of rays at a vertex.
//! Order is decided exactly on radical direction vectors; no angle and no
//! normalization is involved.
//!
//! Rays that leave a vertex in one direction are ordered by their signed
//! curvature (S6, `order_rays`): a ray that bends left lies counter-clockwise of
//! one that bends less. With first and second derivatives `d`, `e` of any
//! regular parameterization, `kappa = (d x e) / |d|^3`; equal directions give
//! `d_a = lambda d_b` with an exact radical `lambda > 0`, so `kappa_a < kappa_b` is the
//! exact radical comparison `d_a x e_a < lambda^3 (d_b x e_b)`, with no square root.
use crate::radical::{cross, dot, V};
use std::cmp::Ordering;

/// A ray direction (not normalized), opaque to consumers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Direction(pub(crate) V);

impl Direction {
    /// Counter-clockwise order in [0, 2 pi). Parallel same-sense rays are Equal.
    pub fn ccw_cmp(&self, other: &Direction) -> Ordering {
        crate::radical::direction_cmp(&self.0, &other.0)
    }
    /// The two directions lie on one line through the origin (either sense).
    pub fn parallel(&self, other: &Direction) -> bool {
        cross(&self.0, &other.0).is_zero()
    }
}

/// A ray leaving a vertex along a piece, with the second-order data of the
/// piece there (see the module doc). `spline` marks a ray on a spline carrier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ray {
    pub(crate) d: V,
    pub(crate) e: V,
    pub(crate) spline: bool,
}

impl Ray {
    pub fn direction(&self) -> Direction {
        Direction(self.d.clone())
    }
    /// Counter-clockwise order: by direction, then by signed curvature.
    pub fn ccw_cmp(&self, other: &Ray) -> Ordering {
        crate::radical::direction_cmp(&self.d, &other.d).then_with(|| {
            let lambda = dot(&self.d, &other.d) / dot(&other.d, &other.d);
            let cubed = &lambda * &lambda * &lambda;
            cross(&self.d, &self.e).cmp(&(cross(&other.d, &other.e) * cubed))
        })
    }
}

/// Result of ordering the rays at a vertex.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Star {
    /// Every consecutive pair (cyclically) is strictly ordered, or the star has
    /// at most two rays (the continuation is unique even for a zero-angle cusp).
    Ordered,
    /// A star of three or more rays has two rays of one direction: the exact
    /// branch order does not exist and the consumer must refuse.
    Tied,
}

/// Sort `rays` counter-clockwise by `direction` and report whether the order is
/// exact. The sort is stable.
pub fn order(rays: &mut [usize], direction: impl Fn(usize) -> Direction) -> Star {
    rays.sort_by(|&a, &b| direction(a).ccw_cmp(&direction(b)));
    let n = rays.len();
    if n > 2
        && (0..n).any(|i| direction(rays[i]).ccw_cmp(&direction(rays[(i + 1) % n])) == Ordering::Equal)
    {
        Star::Tied
    } else {
        Star::Ordered
    }
}

/// Sort the rays `rays` (indices into `table`) counter-clockwise by direction
/// and curvature, and report whether the order is exact. A star of three or
/// more rays is `Tied` when two rays agree in direction and curvature, and also
/// when two rays that are both on lines or circles share a direction: that is
/// the historical `tangent-branch-order` of the line/circle arrangement, kept
/// until a strand measures the CAD-Acid flips of an exact line/circle tie-break.
pub fn order_rays(rays: &mut [usize], table: &[Ray]) -> Star {
    rays.sort_by(|&a, &b| table[a].ccw_cmp(&table[b]));
    let n = rays.len();
    if n <= 2 {
        return Star::Ordered;
    }
    let tied = (0..n).any(|i| table[rays[i]].ccw_cmp(&table[rays[(i + 1) % n]]) == Ordering::Equal);
    let classic = rays.iter().enumerate().any(|(i, &a)| {
        rays[i + 1..].iter().any(|&b| {
            !table[a].spline && !table[b].spline && crate::radical::direction_cmp(&table[a].d, &table[b].d) == Ordering::Equal
        })
    });
    if tied || classic {
        Star::Tied
    } else {
        Star::Ordered
    }
}

/// `order_rays` without the historical line/circle exception: rays sharing a
/// direction (a G1 junction such as an arch's spring line, met by a section
/// in a Boolean face split) are ordered by their exact signed curvature for
/// every carrier kind; only equal direction and curvature tie. Sketch
/// regions keep `order_rays` (their contact refusals are a separate
/// contract); the general Boolean's face arrangements use this order
/// (boolean3d G12b).
pub fn order_rays_by_curvature(rays: &mut [usize], table: &[Ray]) -> Star {
    rays.sort_by(|&a, &b| table[a].ccw_cmp(&table[b]));
    let n = rays.len();
    if n > 2 && (0..n).any(|i| table[rays[i]].ccw_cmp(&table[rays[(i + 1) % n]]) == Ordering::Equal) {
        Star::Tied
    } else {
        Star::Ordered
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::numeric::pt;
    use crate::radical::vector;

    fn d(x: f64, y: f64) -> Direction {
        Direction(vector(&pt([x, y])))
    }
    #[test]
    fn direction_order_is_counter_clockwise_from_positive_x() {
        let dirs = [d(1., 0.), d(1., 1.), d(0., 1.), d(-1., 0.), d(0., -1.), d(1., -1e-9)];
        for w in dirs.windows(2) {
            assert_eq!(w[0].ccw_cmp(&w[1]), Ordering::Less, "{w:?}");
        }
        assert_eq!(d(1., 0.).ccw_cmp(&d(5., 0.)), Ordering::Equal);
        assert_eq!(d(-1., 0.).ccw_cmp(&d(1., 0.)), Ordering::Greater);
    }
    #[test]
    fn order_sorts_and_flags_ties_cyclically() {
        let dirs = [d(0., -1.), d(1., 0.), d(-1., 0.), d(0., 1.)];
        let mut rays = vec![0, 1, 2, 3];
        assert_eq!(order(&mut rays, |i| dirs[i].clone()), Star::Ordered);
        assert_eq!(rays, vec![1, 3, 2, 0]);
        // Three rays, the first and last identical: the tie exists only across the wrap.
        let dirs = [d(1., 0.), d(0., 1.), d(2., 0.)];
        let mut rays = vec![0, 1, 2];
        assert_eq!(order(&mut rays, |i| dirs[i].clone()), Star::Tied);
        // Two rays may coincide: the continuation is unique.
        let mut rays = vec![0, 2];
        assert_eq!(order(&mut rays, |i| dirs[i].clone()), Star::Ordered);
    }
    fn ray(d: [f64; 2], e: [f64; 2], spline: bool) -> Ray {
        Ray { d: vector(&pt(d)), e: vector(&pt(e)), spline }
    }
    #[test]
    fn equal_directions_order_by_signed_curvature() {
        // Three rays along +x: bending right, straight, bending left; one up.
        let table = [
            ray([1., 0.], [0., 1.], true),
            ray([2., 0.], [0., 0.], false),
            ray([1., 0.], [0., -1.], true),
            ray([0., 1.], [0., 0.], false),
        ];
        let mut rays = vec![3, 0, 1, 2];
        assert_eq!(order_rays(&mut rays, &table), Star::Ordered);
        assert_eq!(rays, vec![2, 1, 0, 3]);
        // Curvature is compared per unit length: d = (2,0), e = (0,4) is the
        // curvature 1 of d = (1,0), e = (0,1) (lambda^3 = 8), a tie.
        let table = [ray([2., 0.], [0., 4.], true), ray([1., 0.], [0., 1.], true), ray([0., 1.], [0., 0.], false)];
        let mut rays = vec![0, 1, 2];
        assert_eq!(order_rays(&mut rays, &table), Star::Tied);
        // With e = (0, 2) the first bends half as much: ordered, it comes first.
        let table = [ray([2., 0.], [0., 2.], true), ray([1., 0.], [0., 1.], true), ray([0., 1.], [0., 0.], false)];
        let mut rays = vec![1, 2, 0];
        assert_eq!(order_rays(&mut rays, &table), Star::Ordered);
        assert_eq!(rays, vec![0, 1, 2]);
    }
    #[test]
    fn line_and_circle_ties_keep_refusing() {
        // A line and a circle sharing a direction differ in curvature, but
        // their tie stays the historical tangent-branch-order refusal; with a
        // spline in the star only the line/circle pair still ties.
        let table = [ray([1., 0.], [0., 0.], false), ray([1., 0.], [0., 1.], false), ray([0., 1.], [0., 0.], false)];
        assert_eq!(order_rays(&mut [0, 1, 2], &table), Star::Tied);
        let table = [
            ray([1., 0.], [0., 0.], false),
            ray([1., 0.], [0., 2.], false),
            ray([1., 0.], [0., 1.], true),
            ray([0., -1.], [0., 0.], false),
        ];
        assert_eq!(order_rays(&mut [0, 1, 2, 3], &table), Star::Tied);
        // Two rays never tie: the continuation is unique.
        assert_eq!(order_rays(&mut [0, 1], &table), Star::Ordered);
    }
    #[test]
    fn curvature_order_admits_line_and_circle_sharing_a_direction() {
        // The tables `order_rays` keeps tied: here the straight ray comes
        // before the one bending left.
        let table = [ray([1., 0.], [0., 0.], false), ray([1., 0.], [0., 1.], false), ray([0., 1.], [0., 0.], false)];
        let mut rays = [2, 1, 0];
        assert_eq!(order_rays_by_curvature(&mut rays, &table), Star::Ordered);
        assert_eq!(rays, [0, 1, 2]);
        assert_eq!(order_rays(&mut [0, 1, 2], &table), Star::Tied);
        // Line, circle of curvature 2, spline of curvature 1 and a ray down.
        let table = [
            ray([1., 0.], [0., 0.], false),
            ray([1., 0.], [0., 2.], false),
            ray([1., 0.], [0., 1.], true),
            ray([0., -1.], [0., 0.], false),
        ];
        let mut rays = [3, 1, 2, 0];
        assert_eq!(order_rays_by_curvature(&mut rays, &table), Star::Ordered);
        assert_eq!(rays, [0, 2, 1, 3]);
        // Equal direction and equal curvature still tie, for any carrier kind.
        let table = [ray([1., 0.], [0., 1.], false), ray([2., 0.], [0., 4.], false), ray([0., 1.], [0., 0.], false)];
        assert_eq!(order_rays_by_curvature(&mut [0, 1, 2], &table), Star::Tied);
        assert_eq!(order_rays_by_curvature(&mut [0, 1], &table), Star::Ordered);
    }
    #[test]
    fn parallel_ignores_the_sense_of_the_rays() {
        assert!(d(1., 0.).parallel(&d(-3., 0.)));
        assert!(d(1., 2.).parallel(&d(-2., -4.)));
        assert!(!d(1., 0.).parallel(&d(0., 1.)));
        assert!(!d(1., 2.).parallel(&d(1., 2.0000001)));
    }
}
