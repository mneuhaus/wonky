//! Shared export-only error/separation certificate for sampled prism boundaries.
//! Both a single profile and a stacked arrangement reserve world rounding and
//! refine nonincident chords BEFORE cap triangulation. No sample is modelling
//! geometry and no failed contour is repaired by the triangulator.
use crate::{placement::Placement, polyhedron::Refused, rounding::{expansion_ball, finite_ball, norm_ball, round}};
use num_traits::{Signed, Zero};
use wonky_curve::numeric::{cross, dot, q, sub, P, Q};
use wonky_num::{Iv, Scalar};

type R<T> = Result<T, Refused>;
fn no(reason: &str) -> Refused { Refused(format!("export/stl/{reason}")) }
fn finite(v: Iv) -> R<Iv> { finite_ball(v).map_err(|_| no("vertex-precision-budget")) }

pub(crate) const MAX_REFINEMENTS: usize = 24;
pub(crate) const SEPARATION: f64 = 5.;
const CHECK_SEPARATION: bool = !cfg!(feature = "plant_mesh_skip_separation");

pub(crate) struct Metric {
    /// Largest world stretch (mm/source unit), rounded outward.
    pub scale: Iv,
    /// Smallest stretch in metres/source unit.
    shrink: f64,
}
impl Metric {
    pub fn new(frame: &Placement) -> R<Self> {
        let mut square = Iv::point(0.);
        for column in frame.enclosed_columns() {
            for v in column { square = square + v * v; }
        }
        let scale = finite(square.sqrt() * Iv::point(1000.))?;
        let defect = frame.orthonormality_defect().map_err(|_| no("frame-range"))?;
        let shrink = finite((Iv::point(1.) - Iv::point(3.) * Iv::point(defect)).sqrt())?.lo();
        if scale.lo() <= 0. || shrink <= 0. { return Err(no("frame-range")); }
        Ok(Self { scale, shrink })
    }

    /// Map a sample midpoint ONCE and enclose both its source uncertainty and
    /// the residual of the exact placed point. Computing the residual before
    /// rounding is essential at a large translation (e.g. a 1.03 mm level at
    /// 1e15 mm rounds to 1 mm). A later f32 guard cannot detect that lost 0.03.
    pub fn sample(&self, frame: &Placement, p: [Iv; 3]) -> R<([f64; 3], f64)> {
        for v in p { finite(v)?; }
        let exact = frame.apply_exact(p.map(|v| v.mid()), 1000., true).map_err(|_| no("world-range"))?;
        let mut world = [0.; 3];
        let mut residual = [Iv::point(0.); 3];
        let mut guard = wonky_num::expansion::Guard::new();
        for k in 0..3 {
            world[k] = round(&exact[k]).map_err(|_| no("world-range"))?;
            residual[k] = expansion_ball(&wonky_num::expansion::sum(&exact[k], &[-world[k]], &mut guard));
        }
        if !guard.exact() { return Err(no("world-range")); }
        let source = norm_ball(p.map(|v| Iv::point(v.r))).map_err(|_| no("vertex-precision-budget"))?;
        let mapped = norm_ball(residual).map_err(|_| no("vertex-precision-budget"))?;
        let rounding = finite(self.scale * source + mapped)?.hi();
        Ok((world, rounding))
    }

    pub fn deviation(&self, budget: f64, rounding: f64, requested: f64) -> R<f64> {
        let d = finite(Iv::point(budget) / Iv::point(2.) + Iv::point(rounding))?.hi();
        if d > requested { return Err(no("vertex-precision-budget")); }
        Ok(d)
    }

    /// Lower separation bound for nonincident chords of ALL supplied contours,
    /// including between the outer loop and its holes. None requests refinement.
    pub fn separation(&self, points: &[[f64; 2]], loops: &[Vec<usize>], deviation: f64, quantization: f64, rounding: f64) -> R<Option<f64>> {
        self.separation_with_cusps(points, loops, deviation, quantization, rounding, &[], &[])
    }

    /// Exact tangent cusps have incident source faces whose gap tends to zero.
    /// For their chord pairs, certify the output against rounding instead of
    /// demanding a positive source-face clearance. All other pairs retain the
    /// full deviation/separation constraint. `owners` names each chord's source
    /// piece; `cusps` contains only joins proven by exact source tangents.
    pub fn separation_with_cusps(&self, points: &[[f64; 2]], loops: &[Vec<usize>], deviation: f64, quantization: f64, rounding: f64, owners: &[usize], cusps: &[[usize; 2]]) -> R<Option<f64>> {
        let output_threshold = finite((Iv::point(SEPARATION) * Iv::point(quantization) + Iv::point(2.) * Iv::point(rounding))
            / (Iv::point(self.shrink) * Iv::point(1000.)))?.hi();
        let wanted = finite(Iv::point(SEPARATION) * (Iv::point(deviation) + Iv::point(quantization)))?.hi();
        let threshold = finite((Iv::point(wanted) + Iv::point(2.) * Iv::point(rounding))
            / (Iv::point(self.shrink) * Iv::point(1000.)))?.hi();
        let closest = if cusps.is_empty() {
            closest_non_incident(points, loops, threshold)?
        } else {
            closest_with_cusps(points, loops, threshold, output_threshold, owners, cusps)?
        };
        if CHECK_SEPARATION && closest.as_ref().is_some_and(|d| *d < q(threshold) * q(threshold)) {
            return Ok(None);
        }
        let nearest = match closest {
            Some(d) => wonky_curve::bspline::QBound::exact(d).sqrt_iv()?.lo().min(threshold),
            None => threshold,
        };
        let separation = finite(Iv::point(self.shrink) * Iv::point(1000.) * Iv::point(nearest)
            - Iv::point(2.) * Iv::point(rounding))?.lo();
        Ok(Some(separation))
    }
}

/// L2 bound for the later STL float32 displacement (normal/subnormal range).
/// This deliberately stays conservative even when particular samples round
/// exactly: the separation guarantee cannot depend on fortunate quantization.
pub(crate) fn quantization(vertices: &[[f64; 3]]) -> R<f64> {
    let reach = vertices.iter().flatten().fold(0.0f64, |m, v| m.max(v.abs()));
    Ok(finite((Iv::point(reach) * Iv::point(2f64.powi(-23)) + Iv::point(1e-38)) * Iv::point(3.).sqrt())?.hi())
}

fn qp(p: [f64; 2]) -> P { [q(p[0]), q(p[1])] }
fn sign(x: &Q) -> i32 { if x.is_zero() { 0 } else if x.is_positive() { 1 } else { -1 } }
fn point_segment2(p: &P, a: &P, b: &P) -> Q {
    let d = sub(b, a);
    let t = dot(&sub(p, a), &d);
    let len2 = dot(&d, &d);
    if !t.is_positive() || len2.is_zero() {
        let v = sub(p, a); dot(&v, &v)
    } else if t >= len2 {
        let v = sub(p, b); dot(&v, &v)
    } else {
        let c = cross(&d, &sub(p, a)); &c * &c / len2
    }
}
fn segment2(a: &P, b: &P, c: &P, d: &P) -> Q {
    let o = |p: &P, q: &P, r: &P| sign(&cross(&sub(q, p), &sub(r, p)));
    let (o1, o2, o3, o4) = (o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b));
    if o1 * o2 < 0 && o3 * o4 < 0 { return Q::zero(); }
    [point_segment2(a, c, d), point_segment2(b, c, d), point_segment2(c, a, b), point_segment2(d, a, b)]
        .into_iter().min().expect("four distances")
}

/// Exact source chord distance; boxes only prune pairs with an outward-safe
/// gap bound. Endpoint incidence is by shared sample ID, never coordinates.
fn closest_non_incident(points: &[[f64; 2]], loops: &[Vec<usize>], threshold: f64) -> R<Option<Q>> {
    closest_with_cusps(points, loops, threshold, threshold, &[], &[])
}

fn closest_with_cusps(points: &[[f64; 2]], loops: &[Vec<usize>], threshold: f64, output_threshold: f64, owners: &[usize], cusps: &[[usize; 2]]) -> R<Option<Q>> {
    if !owners.is_empty() && owners.len() != points.len() { return Err(no("chord-owner-shape")); }
    if loops.iter().map(Vec::len).sum::<usize>() > 8192 {
        return Err(no("contour-resource-limit"));
    }
    let edges: Vec<[usize; 2]> = loops.iter().flat_map(|lp| (0..lp.len()).map(|k| [lp[k], lp[(k + 1) % lp.len()]])).collect();
    let threshold2 = q(threshold) * q(threshold);
    let mut pairs = 0usize;
    let boxes: Vec<[[f64; 2]; 2]> = edges.iter().map(|&[a, b]| {
        let (a, b) = (points[a], points[b]);
        [[a[0].min(b[0]), a[1].min(b[1])], [a[0].max(b[0]), a[1].max(b[1])]]
    }).collect();
    let mut order: Vec<usize> = (0..edges.len()).collect();
    order.sort_by(|&i, &j| boxes[i][0][0].total_cmp(&boxes[j][0][0]));
    let gap = |a: f64, b: f64| (Iv::point(a) - Iv::point(b)).lo();
    let mut best: Option<Q> = None;
    for (at, &i) in order.iter().enumerate() {
        for &j in &order[at + 1..] {
            if gap(boxes[j][0][0], boxes[i][1][0]) > threshold { break; }
            let ([a, b], [c, d]) = (edges[i], edges[j]);
            if a == c || a == d || b == c || b == d
                || gap(boxes[j][0][1], boxes[i][1][1]) > threshold || gap(boxes[i][0][1], boxes[j][1][1]) > threshold { continue; }
            pairs += 1;
            if pairs > 1_000_000 { return Err(no("separation-resource-limit")); }
            let dist = segment2(&qp(points[a]), &qp(points[b]), &qp(points[c]), &qp(points[d]));
            let cusp = !owners.is_empty() && cusps.iter().any(|&[u, v]|
                (owners[a] == u && owners[c] == v) || (owners[a] == v && owners[c] == u));
            if cusp {
                // A cusp cannot authorize a crossing or a quantization contact.
                // Every endpoint moves by at most the certified rounding bound.
                if dist < q(output_threshold) * q(output_threshold) { return Ok(Some(dist)); }
                continue;
            }
            // One offending pair is sufficient to require refinement. Finding
            // the global minimum of a doomed sampling wastes quadratic work.
            if dist < threshold2 { return Ok(Some(dist)); }
            if best.as_ref().is_none_or(|b| dist < *b) { best = Some(dist); }
        }
    }
    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::affine::Affine;

    fn placement(frame: Affine) -> Placement {
        use wonky_contract::{sketch3::Entity, BodyKey};
        let body = crate::curve_profile::build(
            BodyKey { id: [11, 1, 0, 0], revision: 0 }, frame,
            &[
                Entity::Bezier { controls: vec![[0., 0.], [0.008, 0.006], [0.018, 0.006], [0.026, 0.]] },
                Entity::Line { a: [0.026, 0.], b: [0., 0.] },
            ], 0.00103, false,
        ).unwrap();
        Placement::from_frames(&body, body.vertices[0].frame).unwrap()
    }

    #[test]
    fn mapped_sample_encloses_large_translation_residual_and_source_radius() {
        let frame = placement(Affine { origin: [0., 0., 1e12], ..Affine::IDENTITY });
        let metric = Metric::new(&frame).unwrap();
        let (p, error) = metric.sample(&frame, [Iv::point(0.), Iv::point(0.), Iv::point(0.00103)]).unwrap();
        assert_eq!(p[2], 1e15 + 1.);
        assert!(error >= 0.03 && error < 0.031, "residual {error}");
        assert!(metric.deviation(0.005, error, 0.005).is_err());
        let frame = placement(Affine::IDENTITY);
        let metric = Metric::new(&frame).unwrap();
        let (_, error) = metric.sample(&frame, [Iv { m: 0.01, r: 0.000001 }, Iv::point(0.), Iv::point(0.)]).unwrap();
        assert!(error >= 0.001, "source radius must survive world mapping: {error}");
    }

    #[test]
    fn exact_cusp_incidence_never_admits_output_contact_or_crossing() {
        let mut points = [[0., -1.], [0., 0.], [-0.01, -0.2], [-0.04, -0.4],
                          [-1., -1.], [-1., -2.], [0., -2.]];
        let loops = [vec![0, 1, 2, 3, 4, 5, 6]];
        let owners = [0, 1, 1, 1, 2, 3, 4];
        let cusps = [[0, 1]];
        assert!(closest_non_incident(&points, &loops, 0.03).unwrap().is_some());
        assert!(closest_with_cusps(&points, &loops, 0.03, 0.001, &owners, &cusps).unwrap().is_none());
        // A planted rounding-contact bound is still rejected at that cusp.
        assert!(closest_with_cusps(&points, &loops, 0.03, 0.02, &owners, &cusps).unwrap().is_some());
        // A planted crossing cannot be excused by source incidence either.
        points[3][0] = 0.04;
        assert_eq!(closest_with_cusps(&points, &loops, 0.03, 0.001, &owners, &cusps).unwrap(), Some(q(0.)));
    }

    #[test]
    fn separation_checks_between_loops_not_just_within_them() {
        let points = [[0., 0.], [10., 0.], [10., 10.], [0., 10.],
            [4., 0.000001], [6., 0.000001], [6., 1.], [4., 1.]];
        let loops = [vec![0, 1, 2, 3], vec![4, 5, 6, 7]];
        let nearest = closest_non_incident(&points, &loops, 0.001).unwrap().unwrap();
        assert!(nearest < q(0.001) * q(0.001));
        assert_eq!(closest_non_incident(&points, &[loops[0].clone()], 0.001).unwrap(), None);
    }
}
