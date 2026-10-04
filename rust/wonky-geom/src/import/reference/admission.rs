//! A reference body is a distinct kernel kind. It cannot yield a checked Model.
//! Bounds and provenance are retained; modelling always crosses a named refusal.
use super::*;

#[derive(Clone, Copy, Debug)]
pub enum ModellingOperation {
    Boolean,
    Fillet,
    Chamfer,
    Pattern,
    Transform,
    TransformAndBoolean,
}
impl ModellingOperation {
    pub fn name(self) -> &'static str {
        match self {
            Self::Boolean => "boolean",
            Self::Fillet => "fillet",
            Self::Chamfer => "chamfer",
            Self::Pattern => "pattern",
            Self::Transform => "transform",
            Self::TransformAndBoolean => "transform-and-boolean",
        }
    }
}
#[derive(Clone, Debug)]
pub struct ReferenceBody {
    source: Body,
    provenance: ImportState,
    pub face_bounds: Vec<TrimEnclosure>,
    pub bounds: [CoordinateBound; 3],
}
impl ReferenceBody {
    pub fn source(&self) -> &Body {
        &self.source
    }
    pub fn provenance(&self) -> &ImportState {
        &self.provenance
    }
    pub fn exact(&self) -> bool {
        false
    }
    /// Only a later exact repair/admission stage may supply a Model.
    pub fn modelling_model(&self, operation: ModellingOperation) -> Result<&crate::model::Model> {
        fail(&format!("import/reference-body/{}", operation.name()))
    }
}
impl ReferenceDraft {
    pub fn admit_reference(self, precision: &Q) -> Result<Vec<ReferenceBody>> {
        self.check_topology()?;
        let mut admitted = Vec::new();
        for body in self.bodies {
            let faces = body
                .faces
                .iter()
                .map(|f| body.trimmed_face_enclosure(f.id, precision))
                .collect::<Result<Vec<_>>>()?;
            let first = faces
                .first()
                .ok_or_else(|| Error::new("import/face-unaccounted"))?;
            let mut bounds = first.coordinates.clone();
            for face in &faces[1..] {
                for i in 0..3 {
                    bounds[i].lower_mm = bounds[i]
                        .lower_mm
                        .clone()
                        .min(face.coordinates[i].lower_mm.clone());
                    bounds[i].upper_mm = bounds[i]
                        .upper_mm
                        .clone()
                        .max(face.coordinates[i].upper_mm.clone());
                }
            }
            let mut provenance = self.state.clone();
            provenance.validation = Validation::Reference;
            provenance.unit_to_mm = body.unit_to_mm.clone();
            provenance.uncertainty = body.uncertainty.clone();
            admitted.push(ReferenceBody {
                source: body,
                provenance,
                face_bounds: faces,
                bounds,
            });
        }
        Ok(admitted)
    }
}
