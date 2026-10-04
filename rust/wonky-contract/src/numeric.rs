//! Small source-witness replay adapter over wonky-num. Same exact expressions as
//! W0-BREP's numeric adapter; no dependency on its topology or geometry layer.
use wonky_num::{expansion as ex, Refusal, Sign, UndecidedKind, P3};
type Result<T> = std::result::Result<T, Refusal>;
pub(crate) fn check(values: &[f64], site: &'static str) -> Result<()> {
    wonky_num::check_range(values, site).map_err(|e| e.into_refusal())
}
pub(crate) fn finish(e: &[f64], g: &ex::Guard) -> Result<Sign> {
    if !g.exact() {
        return Err(Refusal {
            site: "wire v3 witness expansion",
            kind: UndecidedKind::NotExact,
        });
    }
    Ok(match ex::sign(e) {
        -1 => Sign::Negative,
        0 => Sign::Zero,
        _ => Sign::Positive,
    })
}
pub(crate) fn compare(a: f64, b: f64) -> Result<Sign> {
    check(&[a, b], "wire v3 compare")?;
    let mut g = ex::Guard::new();
    finish(&ex::difference(a, b, &mut g), &g)
}
pub(crate) fn nonzero(p: P3) -> Result<bool> {
    check(&[p.x, p.y, p.z], "wire v3 vector")?;
    Ok([p.x, p.y, p.z]
        .into_iter()
        .any(|x| Sign::of_exact(x) != Sign::Zero))
}
pub(crate) fn plane_side(n: P3, p: P3, origin: P3) -> Result<Sign> {
    wonky_num::plane_side(n, p, origin, "wire v3 source plane").map_err(|e| e.into_refusal())
}
pub(crate) fn parallel(a: P3, b: P3) -> Result<bool> {
    wonky_num::parallel(a, b, "wire v3 source tangency").map_err(|e| e.into_refusal())
}
pub(crate) fn on_line_at(p: P3, a: P3, b: P3, t: f64) -> Result<bool> {
    let mut g = ex::Guard::new();
    for ((p, a), b) in [p.x, p.y, p.z]
        .into_iter()
        .zip([a.x, a.y, a.z])
        .zip([b.x, b.y, b.z])
    {
        let d = ex::difference(b, a, &mut g);
        let td = ex::scale(&d, t, &mut g);
        let offset = ex::difference(a, p, &mut g);
        if finish(&ex::sum(&offset, &td, &mut g), &g)? != Sign::Zero {
            return Ok(false);
        }
    }
    Ok(true)
}
/// (p - o) x axis == 0 exactly: p lies on the line through o along axis.
pub(crate) fn on_axis(p: P3, o: P3, axis: P3) -> Result<bool> {
    check(
        &[p.x, p.y, p.z, o.x, o.y, o.z, axis.x, axis.y, axis.z],
        "wire v3 axis incidence",
    )?;
    let mut g = ex::Guard::new();
    let d = [
        ex::difference(p.x, o.x, &mut g),
        ex::difference(p.y, o.y, &mut g),
        ex::difference(p.z, o.z, &mut g),
    ];
    let a = [axis.x, axis.y, axis.z];
    for (i, j) in [(1, 2), (2, 0), (0, 1)] {
        let c = ex::sum(
            &ex::scale(&d[i], a[j], &mut g),
            &ex::neg(&ex::scale(&d[j], a[i], &mut g)),
            &mut g,
        );
        if finish(&c, &g)? != Sign::Zero {
            return Ok(false);
        }
    }
    Ok(true)
}
/// |b - a| == 1 exactly: a chart segment spans one full turn.
pub(crate) fn unit_span(a: f64, b: f64) -> Result<bool> {
    check(&[a, b], "wire v3 turn span")?;
    let mut g = ex::Guard::new();
    let d = ex::difference(b, a, &mut g);
    Ok(finish(&ex::sum(&d, &[-1.], &mut g), &g)? == Sign::Zero
        || finish(&ex::sum(&d, &[1.], &mut g), &g)? == Sign::Zero)
}
