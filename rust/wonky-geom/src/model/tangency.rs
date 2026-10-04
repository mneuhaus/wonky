//! Exact construction facts, bound to the audited Model that proves them.
//! These facts carry source provenance for later blend construction; callers
//! obtain them from these exact checks, never approximate normal comparisons.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FaceTangency {
    pub edge: EdgeId,
    pub supports: [FaceId; 2],
    pub provenance: [Provenance; 2],
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EdgeTangency {
    pub vertex: VertexId,
    pub edges: [EdgeId; 2],
    pub provenance: [Provenance; 2],
}
impl Model {
    /// Two incident face/coedge pairs in stable face order.
    pub fn edge_uses(&self, edge: EdgeId) -> Result<[(FaceId, CoedgeId); 2]> {
        if edge.index() >= self.draft.edges.len() {
            return Err(Refused("model/edge-reference"));
        }
        let mut uses = Vec::new();
        for (i, f) in self.draft.faces.iter().enumerate() {
            for l in &f.loops {
                for c in &self.draft.loops[l.index()].coedges {
                    if self.draft.coedges[c.index()].edge == edge {
                        uses.push((FaceId(i as u32), *c));
                    }
                }
            }
        }
        uses.try_into().map_err(|_| Refused("model/g7-edge-uses"))
    }
    pub fn outward_normal(&self, face: FaceId) -> Result<Point> {
        let f = self
            .draft
            .faces
            .get(face.index())
            .ok_or(Refused("model/face-reference"))?;
        let p = self.draft.surfaces[f.surface.index()].carrier.plane()?;
        Ok(p.n.clone().map(|x| if f.forward { x } else { -x }))
    }
    /// Outward normal in the source metric: inverse transpose, not the
    /// vector transform (which is wrong under an affine placement).
    pub fn source_normal(&self, face: FaceId) -> Result<Point> {
        let n = self.outward_normal(face)?;
        let inv = self.draft.placement.inverse();
        Ok(std::array::from_fn(|i| dot(&inv.columns()[i], &n)))
    }
    /// G1 identity of tangent planes with the same outward orientation.
    pub fn face_tangency(&self, edge: EdgeId) -> Result<Option<FaceTangency>> {
        let uses = self.edge_uses(edge)?;
        let supports = uses.map(|u| u.0);
        let a = self.outward_normal(supports[0])?;
        let b = self.outward_normal(supports[1])?;
        if is_zero(&cross(&a, &b)) && dot(&a, &b).is_positive() {
            Ok(Some(FaceTangency {
                edge,
                supports,
                provenance: supports.map(|f| self.draft.faces[f.index()].provenance),
            }))
        } else {
            Ok(None)
        }
    }
    /// Tangent directed continuation, not two rays leaving in the same
    /// direction. Every sign is evaluated on rational construction points.
    pub fn edge_tangency(
        &self,
        vertex: VertexId,
        edges: [EdgeId; 2],
    ) -> Result<Option<EdgeTangency>> {
        if edges[0] == edges[1] {
            return Ok(None);
        }
        let away = |e: EdgeId| -> Result<Point> {
            let edge = self
                .draft
                .edges
                .get(e.index())
                .ok_or(Refused("model/edge-reference"))?;
            match &self.draft.curves[edge.curve.index()].geometry {
                Curve3::Line { .. } | Curve3::RadicalLine { .. } => {}
                Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => return Err(Refused("model/tangency-curved-edge-unsupported")),
            }
            match edge.bounds {
                Bounds::Ring => Err(Refused("model/tangency-ring-has-no-vertex")),
                Bounds::Segment([a, b]) => {
                    let other = if a == vertex {
                        b
                    } else if b == vertex {
                        a
                    } else {
                        return Err(Refused("model/tangency-incidence"));
                    };
                    let p = self.key(vertex).rational()?;
                    let q = self.key(other).rational()?;
                    Ok(sub(q, p))
                }
            }
        };
        let a = away(edges[0])?;
        let b = away(edges[1])?;
        if is_zero(&cross(&a, &b)) && dot(&a, &b).is_negative() {
            Ok(Some(EdgeTangency {
                vertex,
                edges,
                provenance: edges.map(|e| self.draft.edges[e.index()].provenance),
            }))
        } else {
            Ok(None)
        }
    }
}
