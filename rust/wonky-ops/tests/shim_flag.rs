//! K0 regression (adopted from the K0 verifier, defect 2): the legacy sticky
//! shim (src/planar/num.rs) must turn every wonky-num Undecided into the
//! planar undecided flag. The spike covered this path through num::lt in its
//! clear_margin test; without this test a shim that returns `false` without
//! the flag (a silently wrong path, plan 3.2) passes every other suite.
//! Delete together with the shim in P1.
//!
//! Planted negative: `cargo test --release -p wonky-ops --features
//! plant_shim_flag --test shim_flag` must fail.
use wonky_ops::planar::{exact, num};
use wonky_num::{v3, Iv};

#[test]
fn shim_marks_the_flag_on_undecided() {
    num::reset_undecided();
    assert!(!exact::coincident(v3(f64::NAN, 0.0, 1.0), v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 0.0), "shim-coincident"));
    assert_eq!(num::undecided(), Some("shim-coincident"));
    num::reset_undecided();
    assert!(!exact::parallel(v3(1.0e-320, 0.0, 0.0), v3(1.0, 0.0, 0.0), "shim-parallel"));
    assert_eq!(num::undecided(), Some("shim-parallel"));
    num::reset_undecided();
    let x = Iv { m: 1.0, r: 1.0e-3 };
    assert!(!num::lt(x, Iv::point(1.0), "shim-lt"));
    assert_eq!(num::undecided(), Some("shim-lt"));
    num::reset_undecided();
    assert!(exact::coincident(v3(0.0, 0.0, 1.0), v3(5.0, 1.0, 2.0), v3(-3.0, 7.0, 2.0), "shim-ok"));
    assert_eq!(num::undecided(), None);
}
