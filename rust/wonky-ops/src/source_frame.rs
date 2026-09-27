//! Source-metric constructions under an interpreter placement (E4/E9).
//!
//! Radii, setbacks, shell thickness and topology belong to the exact source
//! frame. The affine image is NOT declared constant-world-radius or constant-
//! world-thickness. Observation encloses the metric with the exact Gram matrix
//! and determinant. STEP's
//! circular carriers are a separately budgeted near-isometric export; larger
//! distortion refuses, rather than silently normalizing construction inputs.
use crate::{
    placement::Placement,
    polyhedron::Refused,
    rounding::{expansion_ball, finite_ball},
};
use num_rational::BigRational as Q;
use num_traits::Zero;
use wonky_num::{
    ball::{Iv, Scalar},
    expansion::sign,
};

type R<T> = Result<T, Refused>;
fn no(reason: &str) -> Refused {
    Refused(format!("source-frame/{reason}"))
}
fn finite(v: Iv) -> R<Iv> {
    finite_ball(v).map_err(|_| no("observation-range"))
}

pub(crate) struct SourceMetric {
    length: Iv,
    area: Iv,
    volume: Iv,
    defect: f64,
    isometry: bool,
}
impl SourceMetric {
    pub(crate) fn new(frame: &Placement) -> R<Self> {
        let det = frame.det_exact().map_err(|_| no("determinant-range"))?;
        if sign(&det) != 1 {
            return Err(no("orientation"));
        }
        let defect = frame
            .orthonormality_defect()
            .map_err(|_| no("gram-range"))?;
        // This is an observation/export capability limit, NOT a geometric snap
        // or a test for isometry. Every nonzero defect remains in the bounds.
        if defect > 1e-10 {
            return Err(no("world-metric-distortion"));
        }
        // ||G-I||_2 <= 3 max|G_ij-I_ij|. The singular values lie in
        // sqrt([1-d,1+d]); surface Jacobians lie in [1-d,1+d].
        let d = finite(Iv::point(3.) * Iv::point(defect))?.hi();
        let area = finite(Iv { m: 1., r: d })?;
        let length = finite(area.sqrt())?;
        let volume = finite(expansion_ball(&det))?;
        let isometry = frame.is_isometry().map_err(|_| no("gram-range"))?;
        Ok(Self {
            length,
            area,
            volume,
            defect,
            isometry,
        })
    }
    pub(crate) fn length(&self, value: Iv) -> R<Iv> {
        finite(value * self.length)
    }
    pub(crate) fn area(&self, value: Iv) -> R<Iv> {
        finite(value * self.area)
    }
    pub(crate) fn volume(&self, value: Iv) -> R<Iv> {
        finite(value * self.volume)
    }
    pub(crate) fn is_isometry(&self) -> bool {
        self.isometry
    }

    /// For d <= 1e-10, normalizing a carrier axis and orthogonalizing its
    /// radial basis moves any local point by <32*d*reach. Include arithmetic
    /// and world-coordinate rounding as well. This is an export error only:
    /// exact world predicates and native observations never use these carriers.
    pub(crate) fn export_budget(&self, reach_mm: f64, magnitude_mm: f64) -> R<f64> {
        finite(
            Iv::point(32.) * Iv::point(self.defect) * Iv::point(reach_mm)
                + Iv::point(64. * f64::EPSILON) * Iv::point(magnitude_mm.max(reach_mm))
                + Iv::point(f64::MIN_POSITIVE),
        )
        .map(|v| v.hi())
    }
}

fn q(v: f64) -> Q {
    Q::from_float(v).unwrap()
}
fn dot(a: &[Q; 3], b: &[Q; 3]) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn cross(a: &[Q; 3], b: &[Q; 3]) -> [Q; 3] {
    std::array::from_fn(|k| &a[(k + 1) % 3] * &b[(k + 2) % 3] - &a[(k + 2) % 3] * &b[(k + 1) % 3])
}

/// Exact inverse on the interpreter's binary64 coefficients, including units.
/// A transpose is not an inverse of a non-isometric frame. Rational values are
/// temporary predicate operands, never new construction coordinates.
pub(crate) fn inverse(frame: &Placement, world: [f64; 3], scale: f64) -> R<[Q; 3]> {
    if world.iter().any(|v| !v.is_finite()) || !scale.is_finite() || scale <= 0. {
        return Err(no("inverse-input"));
    }
    let exact = |p, translate| -> R<[Q; 3]> {
        Ok(frame
            .apply_exact(p, 1., translate)
            .map_err(|_| no("inverse-range"))?
            .map(|e| e.into_iter().map(q).sum()))
    };
    let origin = exact([0.; 3], true)?;
    let x = exact([1., 0., 0.], false)?;
    let y = exact([0., 1., 0.], false)?;
    let z = exact([0., 0., 1.], false)?;
    let dual = [cross(&y, &z), cross(&z, &x), cross(&x, &y)];
    let det = dot(&x, &dual[0]);
    if det.is_zero() {
        return Err(no("singular-inverse"));
    }
    let d = std::array::from_fn(|k| q(world[k]) / q(scale) - &origin[k]);
    Ok(dual.map(|row| dot(&d, &row) / &det))
}
