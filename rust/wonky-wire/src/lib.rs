//! Wire codecs of the Rust kernel (docs/rust-migration.md 3.3, package W0).
//!
//! The value types, their v1/v2 codecs, the op table, the `Kernel` trait and
//! `dispatch` are generated (`src/generated.rs`, by
//! `node scripts/native-bridge/gen-wire-rust.mjs`); this file holds the
//! hand-written runtime they build on: the word reader with its count rule,
//! the scalar codecs and the reply statuses. Wire rules in one place:
//! scripts/native-bridge/gen-wire-rust.mjs.

mod generated;
pub mod v3;
pub use generated::*;

/// Wire ABI version reported by the addon; JS refuses any other.
pub const API_VERSION: u32 = 1;

pub const STATUS_OK: u32 = 0;
pub const STATUS_MALFORMED: u32 = 1;
pub const STATUS_UNKNOWN_OP: u32 = 2;
pub const STATUS_INVALID: u32 = 3;
pub const STATUS_FAULT: u32 = 5;
pub const STATUS_UNAVAILABLE: u32 = 6;

/// v1: the Bend native wire (F32 = 1 word, Real = its two F32 words).
/// v2: F32 and Real = binary64 in two words, low word first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Version {
    V1,
    V2,
}

impl Version {
    pub fn from_u32(v: u32) -> Option<Version> {
        match v {
            1 => Some(Version::V1),
            2 => Some(Version::V2),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum WireError {
    /// Status 1: the words are not a value of the type.
    Malformed(String),
    /// Status 3: a well-formed word pattern whose value the kernel refuses (NaN, +-Inf).
    Invalid(String),
    /// A value that has no encoding in this version (an F32 that is not exactly
    /// an f32 in v1, a Real whose parts do not sum exactly in v2, NaN, +-Inf).
    Unencodable(String),
}

/// Why a call produced no ok reply.
#[derive(Clone, Debug, PartialEq)]
pub enum CallError {
    Wire(WireError),
    UnknownOp(u32),
    Op(OpError),
    /// The result (or a round-tripped value) does not encode: a kernel fault.
    Reply(WireError),
}

impl From<WireError> for CallError {
    fn from(e: WireError) -> Self {
        CallError::Wire(e)
    }
}

impl From<OpError> for CallError {
    fn from(e: OpError) -> Self {
        CallError::Op(e)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum OpError {
    /// Status 6: this entry is not ported to the Rust kernel.
    Unavailable,
}

/// Reads request words. Every count is checked against the words left before
/// anything is allocated for it (`count`).
pub struct Reader<'a> {
    words: &'a [u32],
    i: usize,
}

impl<'a> Reader<'a> {
    pub fn new(words: &'a [u32]) -> Self {
        Reader { words, i: 0 }
    }

    pub fn left(&self) -> usize {
        self.words.len() - self.i
    }

    pub fn take(&mut self) -> Result<u32, WireError> {
        match self.words.get(self.i) {
            Some(&w) => {
                self.i += 1;
                Ok(w)
            }
            None => Err(WireError::Malformed("truncated".into())),
        }
    }

    /// A count of elements at least `min_words` wide fits only if
    /// count * min_words <= words left. An impossible count is malformed
    /// before a single element is decoded or allocated, so decoding work and
    /// memory stay in proportion to the request, whatever the count claims.
    pub fn count(&mut self, min_words: u64) -> Result<usize, WireError> {
        let n = self.take()? as u64;
        #[cfg(not(feature = "plant-count"))]
        {
            if n.saturating_mul(min_words.max(1)) > self.left() as u64 {
                return Err(WireError::Malformed(format!("count {n} exceeds the {} words left", self.left())));
            }
        }
        #[cfg(feature = "plant-count")]
        let _ = min_words;
        Ok(n as usize)
    }

    pub fn finish(&self) -> Result<(), WireError> {
        if self.i == self.words.len() {
            Ok(())
        } else {
            Err(WireError::Malformed(format!("{} trailing words", self.left())))
        }
    }
}

/// A value that crosses the wire in both versions.
pub trait Wire: Sized {
    fn min_words(v: Version) -> u64;
    fn enc(&self, v: Version, out: &mut Vec<u32>) -> Result<(), WireError>;
    fn dec(v: Version, r: &mut Reader) -> Result<Self, WireError>;
}

impl Wire for u32 {
    fn min_words(_: Version) -> u64 {
        1
    }
    fn enc(&self, _: Version, out: &mut Vec<u32>) -> Result<(), WireError> {
        out.push(*self);
        Ok(())
    }
    fn dec(_: Version, r: &mut Reader) -> Result<Self, WireError> {
        r.take()
    }
}

impl Wire for bool {
    fn min_words(_: Version) -> u64 {
        1
    }
    fn enc(&self, _: Version, out: &mut Vec<u32>) -> Result<(), WireError> {
        out.push(*self as u32);
        Ok(())
    }
    fn dec(_: Version, r: &mut Reader) -> Result<Self, WireError> {
        match r.take()? {
            0 => Ok(false),
            1 => Ok(true),
            w => Err(WireError::Malformed(format!("Bool word {w}"))),
        }
    }
}

fn finite(x: f64, what: &str) -> Result<f64, WireError> {
    if x.is_finite() {
        Ok(x)
    } else {
        Err(WireError::Invalid(format!("{what} {x} does not cross the wire")))
    }
}

fn dec_f32_word(r: &mut Reader) -> Result<f64, WireError> {
    finite(f32::from_bits(r.take()?) as f64, "F32")
}

fn enc_f32_word(x: f64, out: &mut Vec<u32>) -> Result<(), WireError> {
    let f = x as f32;
    if !x.is_finite() || (f as f64).to_bits() != x.to_bits() {
        return Err(WireError::Unencodable(format!("{x:e} is not exactly an f32")));
    }
    out.push(f.to_bits());
    Ok(())
}

fn dec_f64_words(r: &mut Reader) -> Result<f64, WireError> {
    let lo = r.take()? as u64;
    let hi = r.take()? as u64;
    finite(f64::from_bits((hi << 32) | lo), "binary64")
}

fn enc_f64_words(x: f64, out: &mut Vec<u32>) -> Result<(), WireError> {
    if !x.is_finite() {
        return Err(WireError::Unencodable(format!("{x} does not cross the wire")));
    }
    let b = x.to_bits();
    out.push(b as u32);
    out.push((b >> 32) as u32);
    Ok(())
}

/// A Bend `F32` field. The Rust kernel has no f32 arithmetic: the value is an
/// f64, exactly the F32 in v1, a binary64 in v2.
impl Wire for f64 {
    fn min_words(v: Version) -> u64 {
        match v {
            Version::V1 => 1,
            Version::V2 => 2,
        }
    }
    fn enc(&self, v: Version, out: &mut Vec<u32>) -> Result<(), WireError> {
        match v {
            Version::V1 => enc_f32_word(*self, out),
            Version::V2 => enc_f64_words(*self, out),
        }
    }
    fn dec(v: Version, r: &mut Reader) -> Result<Self, WireError> {
        match v {
            Version::V1 => dec_f32_word(r),
            Version::V2 => dec_f64_words(r),
        }
    }
}

/// `kernel/real.bend:Real`. v1 keeps Bend's F32x2 pair exactly (so a replayed
/// request re-encodes word for word); v2 carries one binary64 and decodes to
/// `lo == 0`. `value()` is the number both mean when the sum is exact.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Real {
    pub hi: f64,
    pub lo: f64,
}

impl Real {
    pub fn new(value: f64) -> Real {
        Real { hi: value, lo: 0.0 }
    }

    /// hi + lo when that sum is exact in binary64 (lo == 0 keeps the sign of hi).
    pub fn exact_value(&self) -> Option<f64> {
        if self.lo == 0.0 {
            return Some(self.hi);
        }
        let s = self.hi + self.lo;
        let b = s - self.hi;
        let e = (self.hi - (s - b)) + (self.lo - b);
        if e == 0.0 && s.is_finite() {
            Some(s)
        } else {
            None
        }
    }
}

impl Wire for Real {
    fn min_words(_: Version) -> u64 {
        2
    }
    fn enc(&self, v: Version, out: &mut Vec<u32>) -> Result<(), WireError> {
        match v {
            Version::V1 => {
                enc_f32_word(self.hi, out)?;
                enc_f32_word(self.lo, out)
            }
            Version::V2 => match self.exact_value() {
                Some(x) => enc_f64_words(x, out),
                None => Err(WireError::Unencodable(format!("Real {:e} + {:e} is not exact in binary64", self.hi, self.lo))),
            },
        }
    }
    fn dec(v: Version, r: &mut Reader) -> Result<Self, WireError> {
        match v {
            Version::V1 => {
                let hi = dec_f32_word(r)?;
                let lo = dec_f32_word(r)?;
                Ok(Real { hi, lo })
            }
            Version::V2 => Ok(Real::new(dec_f64_words(r)?)),
        }
    }
}

/// A Bend `String`: one word per code point, lone surrogates included (Rust's
/// `String` cannot hold those), each below 0x110000.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Text(pub Vec<u32>);

impl Text {
    pub fn from_str(s: &str) -> Text {
        Text(s.chars().map(|c| c as u32).collect())
    }
}

impl Wire for Text {
    fn min_words(_: Version) -> u64 {
        1
    }
    fn enc(&self, _: Version, out: &mut Vec<u32>) -> Result<(), WireError> {
        out.push(self.0.len() as u32);
        out.extend_from_slice(&self.0);
        Ok(())
    }
    fn dec(_: Version, r: &mut Reader) -> Result<Self, WireError> {
        let n = r.count(1)?;
        let mut codes = Vec::with_capacity(n);
        for _ in 0..n {
            let c = r.take()?;
            if c > 0x10FFFF {
                return Err(WireError::Malformed(format!("Char {c}")));
            }
            codes.push(c);
        }
        Ok(Text(codes))
    }
}

impl<T: Wire> Wire for Vec<T> {
    fn min_words(_: Version) -> u64 {
        1
    }
    fn enc(&self, v: Version, out: &mut Vec<u32>) -> Result<(), WireError> {
        if self.len() > u32::MAX as usize {
            return Err(WireError::Unencodable(format!("list of {} elements", self.len())));
        }
        out.push(self.len() as u32);
        for x in self {
            x.enc(v, out)?;
        }
        Ok(())
    }
    fn dec(v: Version, r: &mut Reader) -> Result<Self, WireError> {
        let n = r.count(T::min_words(v))?;
        let mut xs = Vec::with_capacity(n);
        for _ in 0..n {
            xs.push(T::dec(v, r)?);
        }
        Ok(xs)
    }
}

impl<T: Wire> Wire for Option<T> {
    fn min_words(_: Version) -> u64 {
        1
    }
    fn enc(&self, v: Version, out: &mut Vec<u32>) -> Result<(), WireError> {
        match self {
            None => out.push(0),
            Some(x) => {
                out.push(1);
                x.enc(v, out)?;
            }
        }
        Ok(())
    }
    fn dec(v: Version, r: &mut Reader) -> Result<Self, WireError> {
        match r.take()? {
            0 => Ok(None),
            1 => Ok(Some(T::dec(v, r)?)),
            t => Err(WireError::Malformed(format!("Maybe tag {t}"))),
        }
    }
}

/// `[0, ...value]`.
pub fn ok_reply<T: Wire>(v: Version, value: &T) -> Result<Vec<u32>, CallError> {
    let mut out = vec![STATUS_OK];
    value.enc(v, &mut out).map_err(CallError::Reply)?;
    Ok(out)
}

/// `[status, count, code points...]` for a nonzero status.
pub fn status_reply(status: u32, message: &str) -> Vec<u32> {
    let mut out = vec![status];
    // Text::enc never fails.
    let _ = Text::from_str(message).enc(Version::V1, &mut out);
    out
}

/// The reply words of a call: the ok reply, or the status of the error with its message.
pub fn reply_words(result: Result<Vec<u32>, CallError>, entry: Option<&str>) -> Vec<u32> {
    match result {
        Ok(words) => words,
        Err(CallError::Wire(WireError::Malformed(m))) => status_reply(STATUS_MALFORMED, &m),
        Err(CallError::Wire(WireError::Invalid(m))) => status_reply(STATUS_INVALID, &m),
        Err(CallError::Wire(WireError::Unencodable(m))) => status_reply(STATUS_MALFORMED, &m),
        Err(CallError::UnknownOp(op)) => status_reply(STATUS_UNKNOWN_OP, &format!("unknown op {op} (this build serves ops 0..{})", OPS.len().saturating_sub(1))),
        Err(CallError::Op(OpError::Unavailable)) => status_reply(STATUS_UNAVAILABLE, &format!("{} is not ported to the Rust kernel", entry.unwrap_or("this entry"))),
        Err(CallError::Reply(e)) => status_reply(STATUS_FAULT, &format!("the result does not encode: {e:?}")),
    }
}

