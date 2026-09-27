//! LEGACY SHIM for the decision spike's planar Boolean (docs/rust-migration.md
//! 6, K0). The spike's num.rs moved to the `wonky-num` crate (ball arithmetic,
//! vectors, Result-based `lt`/`le`). The planar code (unchanged spike files in
//! this directory) still expects the spike's sticky per-thread undecided flag,
//! so this shim maps every `Err(Undecided)` onto that flag, exactly as the
//! spike's num::lt/le did. Delete this shim when package P1 ports planar onto
//! `Result` (a forgotten flag check there is a silently wrong path; that is
//! the reason the flag is not part of wonky-num).
//!
//! The planar policy limits below (Bend's F32x2-era guards and bounds) are the
//! spike's, unchanged; they belong to this op, not to wonky-num.

use std::cell::Cell;

pub use wonky_num::{v3, Iv, Scalar, I3, P3, V3};

// ---------------------------------------------------------------- sticky flag (legacy)

thread_local! {
    static UNDECIDED: Cell<Option<&'static str>> = const { Cell::new(None) };
    static UNDECIDED_COUNT: Cell<u64> = const { Cell::new(0) };
}

/// Clears the sticky flag at the start of an operation.
pub fn reset_undecided() {
    UNDECIDED.with(|u| u.set(None));
}
/// The first comparison site that could not be decided, if any.
pub fn undecided() -> Option<&'static str> {
    UNDECIDED.with(|u| u.get())
}
pub fn undecided_total() -> u64 {
    UNDECIDED_COUNT.with(|c| c.get())
}
#[cold]
pub fn mark_undecided(site: &'static str) {
    UNDECIDED.with(|u| {
        if u.get().is_none() {
            u.set(Some(site));
        }
    });
    UNDECIDED_COUNT.with(|c| c.set(c.get() + 1));
}

/// Maps a wonky-num decision onto the sticky flag: undecided -> flag + `false`.
#[inline]
pub(crate) fn sticky(decision: Result<bool, wonky_num::Undecided>) -> bool {
    match decision {
        Ok(x) => x,
        Err(u) => {
            let site = u.into_refusal().site;
            // Planted negative (tests/shim_flag.rs): the shim drops the flag.
            if !cfg!(feature = "plant_shim_flag") {
                mark_undecided(site);
            }
            false
        }
    }
}

/// a < b, certified. Undecidable -> sticky flag and `false`.
#[inline]
pub fn lt(a: Iv, b: Iv, site: &'static str) -> bool {
    sticky(wonky_num::lt(a, b, site))
}
/// a <= b, certified (Bend I.at_most = less or equal).
#[inline]
pub fn le(a: Iv, b: Iv, site: &'static str) -> bool {
    sticky(wonky_num::le(a, b, site))
}

// ---------------------------------------------------------------- kernel constants (intersections.bend)

/// Numeric policy limits. `Bend` keeps the kernel's values (chosen for F32x2):
/// I.round_guard 1e-13, I.angular_guard 1e-12 (as F32 literals), ray.bend's
/// bounded() 1e4 mm and root range 1e5 mm. `F64` is the spike's f64 policy
/// (--f64-limits): guards 1e-15, bounds 1e9 mm. Every decision stays certified
/// (intervals, exact predicates), so a looser policy can refuse less, never guess.
pub struct Limits {
    pub round_guard: f64,
    pub angular_guard: f64,
    pub bounded: f64,
    pub root_range: f64,
}
pub const BEND_LIMITS: Limits = Limits { round_guard: 0.0000000000001_f32 as f64, angular_guard: 0.000000000001_f32 as f64, bounded: 10000.0, root_range: 100000.0 };
pub const F64_LIMITS: Limits = Limits { round_guard: 1.0e-15, angular_guard: 1.0e-15, bounded: 1.0e9, root_range: 1.0e10 };
static F64_POLICY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn use_f64_limits(on: bool) {
    F64_POLICY.store(on, std::sync::atomic::Ordering::Relaxed);
}
#[inline]
pub fn limits() -> &'static Limits {
    if F64_POLICY.load(std::sync::atomic::Ordering::Relaxed) {
        &F64_LIMITS
    } else {
        &BEND_LIMITS
    }
}
/// I.round_guard
#[inline]
pub fn round_guard() -> f64 {
    limits().round_guard
}
/// I.angular_guard
#[inline]
pub fn angular_guard() -> f64 {
    limits().angular_guard
}
/// I.limit
pub const LIMIT: f64 = 10000000000.0_f32 as f64;

/// I.scalar_valid: finite and |a| <= 1e10 (the F32x2 renorm test has no f64 analogue).
#[inline]
pub fn scalar_valid(a: f64) -> bool {
    a.is_finite() && a.abs() <= LIMIT
}
#[inline]
pub fn vec_valid(v: P3) -> bool {
    scalar_valid(v.x) && scalar_valid(v.y) && scalar_valid(v.z)
}
/// I.direction_valid: angular_guard <= magnitude(v) (on stored values: exact)
#[inline]
pub fn direction_valid(v: P3) -> bool {
    angular_guard() <= v.magnitude()
}
