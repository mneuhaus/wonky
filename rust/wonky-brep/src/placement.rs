//! Symbolic proper rigid operations are authoritative; matrices are display only.
use crate::{numeric, Error, Result};
use wonky_num::{v3, P3};

/// R*p + translation, matching wonky-geom's around_axis convention (the first
/// argument is NOT a pivot). Its semantics use exact sin/cos and axis normalization
/// of these binary64 parameters, not the rounded display coefficients.
#[derive(Clone, Debug, PartialEq)]
pub struct Rigid {
    translation: P3,
    axis: P3,
    angle: f64,
    columns: [P3; 3],
}

impl Rigid {
    pub fn around_axis(translation: P3, axis: P3, angle: f64) -> Result<Self> {
        numeric::point(translation)?;
        numeric::check(&[angle], "brep rotation angle")?;
        if !numeric::nonzero(axis)? {
            return Err(Error::Degenerate("rotation axis"));
        }
        // hypot avoids unnecessary overflow/underflow. No matrix rigidity test
        // promotes these rounded coefficients to an exact rotation certificate.
        let unit = axis.scale(1.0 / axis.x.hypot(axis.y).hypot(axis.z));
        let (s, c) = angle.sin_cos();
        let rotate = |v: P3| {
            v.scale(c)
                .add(unit.cross(v).scale(s))
                .add(unit.scale(unit.dot(v) * (1.0 - c)))
        };
        let columns = [
            rotate(v3(1., 0., 0.)),
            rotate(v3(0., 1., 0.)),
            rotate(v3(0., 0., 1.)),
        ];
        for p in columns {
            numeric::point(p)?;
        }
        Ok(Self {
            translation,
            axis,
            angle,
            columns,
        })
    }

    pub fn translation(offset: P3) -> Result<Self> {
        Self::around_axis(offset, v3(0., 0., 1.), 0.)
    }

    pub fn parameters(&self) -> (P3, P3, f64) {
        (self.translation, self.axis, self.angle)
    }

    /// Preserve the symbolic operation on the wire, never its display matrix.
    pub fn to_contract_frame(
        &self,
        parent: crate::contract::FrameId,
    ) -> crate::contract::Result<crate::contract::Frame> {
        use crate::contract::{vector, Binary64, Frame};
        Ok(Frame::Rigid {
            parent,
            translation: vector(self.translation)?,
            axis: vector(self.axis)?,
            angle: Binary64::new(self.angle)?,
        })
    }

    /// Uncertified f64 materialization, never an incidence/volume authority.
    pub fn approximate_vector(&self, p: P3) -> Result<P3> {
        numeric::point(p)?;
        let out = self.columns[0]
            .scale(p.x)
            .add(self.columns[1].scale(p.y))
            .add(self.columns[2].scale(p.z));
        numeric::point(out)?;
        Ok(out)
    }

    pub fn approximate_point(&self, p: P3) -> Result<P3> {
        let out = self.approximate_vector(p)?.add(self.translation);
        numeric::point(out)?;
        Ok(out)
    }
}

/// All entities in one Brep share this source-to-world path. Appending an op
/// preserves every intra-body fact. No independently movable entity cache exists.
#[derive(Clone, Debug, Default)]
pub struct Placement {
    steps: Vec<Rigid>,
}

impl Placement {
    pub fn steps(&self) -> &[Rigid] {
        &self.steps
    }
    pub(crate) fn push(&mut self, by: Rigid) {
        self.steps.push(by);
    }
    pub fn approximate_point(&self, mut p: P3) -> Result<P3> {
        for step in &self.steps {
            p = step.approximate_point(p)?;
        }
        Ok(p)
    }
    pub fn approximate_vector(&self, mut p: P3) -> Result<P3> {
        for step in &self.steps {
            p = step.approximate_vector(p)?;
        }
        Ok(p)
    }
}
