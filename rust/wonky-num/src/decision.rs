//! Signs, undecided decisions and the input range policy.

use std::fmt;

/// The certified sign of an exact or enclosed value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Sign {
    Negative,
    Zero,
    Positive,
}

impl Sign {
    #[inline]
    pub fn to_i32(self) -> i32 {
        match self {
            Sign::Negative => -1,
            Sign::Zero => 0,
            Sign::Positive => 1,
        }
    }
    #[inline]
    pub fn flip(self) -> Sign {
        match self {
            Sign::Negative => Sign::Positive,
            Sign::Zero => Sign::Zero,
            Sign::Positive => Sign::Negative,
        }
    }
    #[inline]
    pub fn is_zero(self) -> bool {
        self == Sign::Zero
    }
    /// Sign of an f64 that is known to be exact (-0.0 is Zero).
    #[inline]
    pub fn of_exact(x: f64) -> Sign {
        if x > 0.0 {
            Sign::Positive
        } else if x < 0.0 {
            Sign::Negative
        } else {
            Sign::Zero
        }
    }
}

/// Why a decision could not be certified.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum UndecidedKind {
    /// An input is NaN, infinite, subnormal or outside [MIN_MAGNITUDE, MAX_MAGNITUDE].
    OutOfRange,
    /// An intermediate of the exact evaluation left the range in which the
    /// expansion arithmetic is exact (product below 2^-960 or overflow).
    NotExact,
    /// A certified interval comparison straddles its threshold.
    Unresolved,
}

/// An uncertified decision. It must be returned with `?` and finally turned
/// into a named refusal with [`Undecided::into_refusal`]. Dropping it in any
/// other way means a decision was swallowed, and panics (unless the thread is
/// already unwinding).
#[must_use = "an Undecided must be propagated with `?` or turned into a named refusal with .into_refusal()"]
pub struct Undecided {
    site: &'static str,
    kind: UndecidedKind,
}

impl Undecided {
    #[cold]
    #[inline(never)]
    pub fn new(site: &'static str, kind: UndecidedKind) -> Undecided {
        Undecided { site, kind }
    }
    pub fn site(&self) -> &'static str {
        self.site
    }
    pub fn kind(&self) -> UndecidedKind {
        self.kind
    }
    /// The only way to retire an Undecided: the refusal record a caller reports.
    pub fn into_refusal(self) -> Refusal {
        let refusal = Refusal { site: self.site, kind: self.kind };
        std::mem::forget(self);
        refusal
    }
}

impl Drop for Undecided {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            panic!("wonky-num: Undecided at '{}' ({:?}) was dropped without becoming a refusal (swallowed decision)", self.site, self.kind);
        }
    }
}

impl fmt::Debug for Undecided {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Undecided {{ site: {:?}, kind: {:?} }}", self.site, self.kind)
    }
}

impl fmt::Display for Undecided {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "undecided {:?} at {}", self.kind, self.site)
    }
}

/// A retired Undecided: the named refusal an operation reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Refusal {
    pub site: &'static str,
    pub kind: UndecidedKind,
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "refused {:?} at {}", self.kind, self.site)
    }
}

/// A certified sign or a named reason why there is none.
pub type Decision = Result<Sign, Undecided>;

/// Input range policy (docs/rust-migration.md 3.2): nonzero inputs must lie in
/// [MIN_MAGNITUDE, MAX_MAGNITUDE]; everything else (subnormals, NaN, infinities)
/// is refused by name. Within the range, the predicates scale each homogeneous
/// input group by a power of two, which is exact there.
pub const MIN_MAGNITUDE: f64 = 1.0e-150;
pub const MAX_MAGNITUDE: f64 = 1.0e150;

/// Zero (either sign) or finite with magnitude in [MIN_MAGNITUDE, MAX_MAGNITUDE].
#[inline]
pub fn in_range(x: f64) -> bool {
    x == 0.0 || (x.abs() >= MIN_MAGNITUDE && x.abs() <= MAX_MAGNITUDE)
}

/// Refuses (OutOfRange) unless every value is in range.
#[inline]
pub fn check_range(values: &[f64], site: &'static str) -> Result<(), Undecided> {
    // Planted negative (K0): the range gate is gone, every input reaches the filters.
    if cfg!(feature = "plant_no_range") || values.iter().all(|x| in_range(*x)) {
        Ok(())
    } else {
        Err(Undecided::new(site, UndecidedKind::OutOfRange))
    }
}
