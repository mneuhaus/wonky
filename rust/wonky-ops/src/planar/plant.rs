//! Planted negatives for S3 (compiled only with `--features plant`, never in
//! the measured build): PLANT=flip inverts one membership predicate outcome,
//! PLANT=vertex moves one constructed vertex by 1e-8 mm. The validation
//! (rust/harness/compare.mjs) must flag every affected call.
use std::cell::Cell;

thread_local! {
    static FIRED: Cell<bool> = const { Cell::new(false) };
}

pub fn active(kind: &str) -> bool {
    std::env::var("PLANT").map(|v| v == kind).unwrap_or(false)
}

/// true exactly once per process
pub fn once() -> bool {
    FIRED.with(|f| !f.replace(true))
}
