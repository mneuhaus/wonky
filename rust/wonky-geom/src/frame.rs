use crate::{cross, dot, sub, zero, Point, Refused, Result, Q};
use num_traits::{One, Signed, Zero};

/// Columns and origin are authoritative rational construction values. They
/// need not be orthonormal: interpreter normalization is rounded binary64.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    origin: Point,
    columns: [Point; 3],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RelationClass {
    R0Identical,
    R1PermutationTranslation,
    R2RationalRotation,
    R3Affine,
}
#[derive(Clone, Debug)]
pub struct Relation {
    pub class: RelationClass,
    pub map: Frame,
}
impl Frame {
    pub fn new(origin: Point, columns: [Point; 3]) -> Result<Self> {
        if dot(&columns[0], &cross(&columns[1], &columns[2])).is_zero() {
            return Err(Refused("frame/singular"));
        }
        Ok(Self { origin, columns })
    }
    pub fn identity() -> Self {
        Self {
            origin: zero(),
            columns: std::array::from_fn(|i| {
                std::array::from_fn(|j| if i == j { Q::one() } else { Q::zero() })
            }),
        }
    }
    pub fn vector(&self, p: &Point) -> Point {
        std::array::from_fn(|i| (0..3).map(|j| &self.columns[j][i] * &p[j]).sum())
    }
    pub fn point(&self, p: &Point) -> Point {
        let v = self.vector(p);
        std::array::from_fn(|i| &self.origin[i] + &v[i])
    }
    pub fn origin(&self) -> &Point {
        &self.origin
    }
    pub fn columns(&self) -> &[Point; 3] {
        &self.columns
    }
    pub fn inverse(&self) -> Self {
        let [x, y, z] = &self.columns;
        let det = dot(x, &cross(y, z));
        let rows = [cross(y, z), cross(z, x), cross(x, y)];
        let columns = std::array::from_fn(|i| std::array::from_fn(|j| &rows[j][i] / &det));
        let mut inverse = Self {
            origin: zero(),
            columns,
        };
        inverse.origin = inverse.vector(&self.origin).map(|v| -v);
        inverse
    }
    /// Maps coordinates in `source` into coordinates in `self`.
    pub fn relation_from(&self, source: &Self) -> Relation {
        let inverse = self.inverse();
        let map = Self {
            origin: inverse.vector(&sub(&source.origin, &self.origin)),
            columns: source.columns.each_ref().map(|c| inverse.vector(c)),
        };
        let permutation = map.columns.iter().all(|c| {
            c.iter().filter(|v| !v.is_zero()).count() == 1
                && c.iter().all(|v| v.is_zero() || v.abs().is_one())
        });
        let isometry = map.is_isometry();
        let class = if map == Self::identity() {
            RelationClass::R0Identical
        } else if permutation {
            RelationClass::R1PermutationTranslation
        } else if isometry {
            RelationClass::R2RationalRotation
        } else {
            RelationClass::R3Affine
        };
        Relation { class, map }
    }
    pub fn is_isometry(&self) -> bool {
        (0..3).all(|i| {
            (0..3).all(|j| {
                dot(&self.columns[i], &self.columns[j]) == if i == j { Q::one() } else { Q::zero() }
            })
        })
    }
}
impl Relation {
    /// Circular carriers are preserved only by a proved isometry. Plane
    /// pullback deliberately does not use this gate (Rule P).
    pub fn require_isometry(&self) -> Result<()> {
        if self.map.is_isometry() {
            Ok(())
        } else {
            Err(Refused("frame/non-isometric-curved-image"))
        }
    }
}
