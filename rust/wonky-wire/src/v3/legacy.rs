//! A quarantine wrapper, not a guessed v3 solid. Bend has no construction DAG,
//! curve ranges, pcurves or certified shell decomposition. BR1 may convert the
//! topology explicitly; no adapter can recover E4 construction intent.
use super::*;
use crate::{analytic_Solid, Version, Wire};
#[derive(Clone, Debug)]
pub struct LegacyImport {
    solid: analytic_Solid,
    provenance: Provenance,
}
impl LegacyImport {
    pub fn solid(&self) -> &analytic_Solid {
        &self.solid
    }
    pub fn provenance(&self) -> &Provenance {
        &self.provenance
    }
    pub fn contained(
        &self,
        _curve: CurveId,
        _surface: SurfaceId,
    ) -> Result<wonky_contract::Incidence> {
        Err(ContractError::NoProvenance.into())
    }
}
/// Input is exactly the existing v2 analytic_Solid payload (no invented header).
/// Canonical re-encoding also rejects a legacy decoder that silently drops data.
pub fn import_v2(words: &[u32]) -> Result<LegacyImport> {
    if words.len() > MAX_WORDS {
        return Err(Error::ResourceLimit);
    }
    let mut reader = Reader::new(words);
    let solid = analytic_Solid::dec(Version::V2, &mut reader)?;
    reader.finish()?;
    let mut canonical = Vec::new();
    solid.enc(Version::V2, &mut canonical)?;
    if words != canonical {
        return Err(malformed("non-canonical v2 solid"));
    }
    for e in &solid.edges {
        if e.start as usize >= solid.vertices.len() || e.end as usize >= solid.vertices.len() {
            return Err(malformed("v2 edge vertex reference"));
        }
    }
    for f in &solid.faces {
        for lp in &f.loops {
            for c in &lp.uses {
                if c.edge as usize >= solid.edges.len() {
                    return Err(malformed("v2 coedge reference"));
                }
            }
        }
    }
    Ok(LegacyImport {
        solid,
        provenance: Provenance::None {},
    })
}
