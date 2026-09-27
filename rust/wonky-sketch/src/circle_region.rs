//! One disk region, without a polyline surrogate or a tolerance-based weld.
//! Arrangements involving other entities are deliberately handled by a separate
//! capability boundary; a disk cannot silently swallow another sketch entity.
use crate::Refusal;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Disk {
    pub center: [f64; 2],
    pub radius: f64,
}

pub fn circle_region(center: [f64; 2], radius: f64) -> Result<Disk, Refusal> {
    if !center.iter().chain([&radius]).all(|x| x.is_finite()) || radius <= 0.0 {
        return Err(Refusal::InvalidInput);
    }
    wonky_num::check_range(&[center[0], center[1], radius], "circle region").map_err(|e| {
        e.into_refusal();
        Refusal::NumericDecision
    })?;
    Ok(Disk { center, radius })
}
