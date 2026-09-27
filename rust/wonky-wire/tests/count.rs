//! A count word larger than the message is status 1 without an allocation in
//! proportion to the claimed count (docs/rust-migration.md W0, planted negative:
//! `cargo test -p wonky-wire --features plant-count --test count -- --test-threads=1`
//! must fail; one thread, so a failing case's panic output is not counted in the next).
//!
//! The global allocator of this test binary records the largest single request
//! and the peak of live bytes. Each case decodes through the real dispatcher
//! (`dispatch` on a kernel that serves nothing: decoding runs before the op),
//! once with a count that fits and once with counts that claim far more than
//! the words carry; the refused request must not allocate more than the
//! accepted one plus a small constant.
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use wonky_wire::{dispatch, reply_words, Kernel, Version, OPS, STATUS_MALFORMED, STATUS_UNAVAILABLE};

struct Counting;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static LARGEST: AtomicUsize = AtomicUsize::new(0);
// The cases run one at a time: the counters are process-wide.
static SERIAL: Mutex<()> = Mutex::new(());

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let live = LIVE.fetch_add(layout.size(), Ordering::SeqCst) + layout.size();
        PEAK.fetch_max(live, Ordering::SeqCst);
        LARGEST.fetch_max(layout.size(), Ordering::SeqCst);
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::SeqCst);
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static A: Counting = Counting;

struct Nothing;
impl Kernel for Nothing {}

fn op(entry: &str) -> u32 {
    OPS.iter().find(|o| o.entry == entry).unwrap_or_else(|| panic!("{entry} is not in the op table")).id
}

/// (status, peak live bytes above the start, largest single allocation) of one call.
fn measure(v: Version, op: u32, words: &[u32]) -> (u32, usize, usize) {
    let base = LIVE.load(Ordering::SeqCst);
    PEAK.store(base, Ordering::SeqCst);
    LARGEST.store(0, Ordering::SeqCst);
    let reply = reply_words(dispatch(&Nothing, v, op, words), None);
    let status = reply[0];
    drop(reply);
    (status, PEAK.load(Ordering::SeqCst) - base, LARGEST.load(Ordering::SeqCst))
}

// kernel/real.bend:max takes two Reals (fixed width); kernel/identity.bend:box_layout
// takes a List of V3. The list case is the one a count can inflate.
fn list_request(v: Version, count: u32, carried: usize) -> Vec<u32> {
    // box_layout(profile: List<V3>) where V3 = {x, y, z: F32}; F32 = 1 word (v1), 2 words (v2).
    let width = match v {
        Version::V1 => 3,
        Version::V2 => 6,
    };
    let mut words = vec![count];
    words.extend(std::iter::repeat(0u32).take(carried * width));
    words
}

#[test]
fn count_larger_than_message_is_malformed_without_proportional_allocation() {
    let _serial = SERIAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let box_layout = op("kernel/identity.bend:box_layout");
    for v in [Version::V1, Version::V2] {
        // Accepted: 4 elements carried and claimed (decodes, then answers unavailable).
        let (ok_status, ok_peak, _) = measure(v, box_layout, &list_request(v, 4, 4));
        assert_eq!(ok_status, STATUS_UNAVAILABLE, "{v:?}: a well-formed request must reach the op");
        for claimed in [5u32, 1 << 16, 1 << 24, u32::MAX] {
            let (status, peak, largest) = measure(v, box_layout, &list_request(v, claimed, 4));
            assert_eq!(status, STATUS_MALFORMED, "{v:?}: count {claimed} with 4 elements carried");
            // The refusal allocates its reply and message, never the claimed elements:
            // below 1 KiB above the accepted request's peak, whatever the claim.
            assert!(peak <= ok_peak + 1024, "{v:?}: count {claimed}: peak {peak} bytes vs {ok_peak} for the accepted request");
            assert!(largest <= 1024, "{v:?}: count {claimed}: an allocation of {largest} bytes");
        }
    }
}

#[test]
fn string_count_larger_than_message_is_malformed_without_proportional_allocation() {
    let _serial = SERIAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // kernel/identity.bend:box(namespace, operation, occurrence, revision: String).
    let box_op = op("kernel/identity.bend:box");
    // Smaller claims first: under the planted variant the test fails there,
    // before the u32::MAX claim would reserve 16 GiB of address space.
    for v in [Version::V1, Version::V2] {
        for claimed in [5u32, 1 << 16, u32::MAX] {
            let (status, peak, largest) = measure(v, box_op, &[claimed, 65, 66]);
            assert_eq!(status, STATUS_MALFORMED, "{v:?}: String count {claimed} with 2 code points carried");
            assert!(peak <= 2048 && largest <= 1024, "{v:?}: count {claimed}: peak {peak}, largest {largest}");
        }
    }
}
