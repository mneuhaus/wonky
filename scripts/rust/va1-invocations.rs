//! Validation-only entry instrumentation, compiled into a temporary crate copy
//! by validate-va1.py. Never linked into the production crate. Counts and ordered
//! argument fingerprints come from function entries, not driver row labels.
use std::io::Write;
use std::sync::Mutex;

const NAMES: [&str; 6] = ["sin", "cos", "atan2", "acos", "exp", "log"];
const OFFSET: u64 = 0xcbf29ce484222325;
const PRIME: u64 = 0x100000001b3;
static CALLS: Mutex<[(u64, u64); 6]> = Mutex::new([(0, OFFSET); 6]);

pub fn enter(index: usize, words: [u64; 5]) {
    let mut calls = CALLS.lock().unwrap();
    let (count, fingerprint) = &mut calls[index];
    *count += 1;
    for word in words {
        for byte in word.to_be_bytes() {
            *fingerprint = (*fingerprint ^ u64::from(byte)).wrapping_mul(PRIME);
        }
    }
}

// The checker injects this guard into the temporary driver's main. The original
// driver has no access to counts, fingerprints or the audit output protocol.
pub struct Guard;
impl Drop for Guard {
    fn drop(&mut self) {
        let path = std::env::var_os("WONKY_VA1_AUDIT").expect("missing invocation audit path");
        let mut out = std::fs::File::create(path).unwrap();
        for (name, (count, fingerprint)) in NAMES.iter().zip(CALLS.lock().unwrap().iter()) {
            writeln!(out, "{name} {count} {fingerprint:016x}").unwrap();
        }
    }
}
