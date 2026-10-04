//! Opt-in bounded replacement of circular carriers at shared source endpoints.
//! No epsilon predicates: admission, tangency and the displacement bound are Q.
//! Endpoints and lines never move. The replacement circle passes through both
//! original endpoints and is exactly tangent to the selected adjacent carrier.
use super::{no, q, Q, R};
use num_traits::ToPrimitive;
use wonky_curve as wc;

#[derive(Clone, Debug)]
pub(crate) struct Merge {
    pub entities: [usize; 2],
    pub moved: usize,
    pub bound_mm: Q,
}
impl Merge {
    pub(crate) fn json(&self) -> R<String> {
        let rounded = self.bound_mm.to_f64().filter(|v| v.is_finite()).ok_or_else(|| no("regularization/report-range"))?;
        let upper = if q(rounded) < self.bound_mm { rounded.next_up() } else { rounded };
        Ok(format!(concat!("{{\"operation\":\"skSolve\",\"kind\":\"tangent-carrier\",",
            "\"entities\":[{},{}],\"movedEntity\":{},\"maxResidualMm\":{:?},",
            "\"boundMmExact\":{{\"numerator\":\"{}\",\"denominator\":\"{}\"}}}}"),
            self.entities[0], self.entities[1], self.moved, upper,
            self.bound_mm.numer(), self.bound_mm.denom()))
    }
}

pub(crate) fn sources(lines: &[[f64; 4]], arcs: &[[f64; 6]]) -> R<Vec<wc::Trimmed>> {
    if !lines.iter().flatten().chain(arcs.iter().flatten()).all(|x| x.is_finite()) {
        return Err(no("nonfinite-source"));
    }
    let mut sources = lines.iter().map(|s| wc::Trimmed::line([s[0], s[1]], [s[2], s[3]])).collect::<Vec<_>>();
    for a in arcs { sources.push(wc::Trimmed::arc_through([a[0], a[1]], [a[2], a[3]], [a[4], a[5]])?); }
    Ok(sources)
}
fn tangent(a: &wc::Trimmed, b: &wc::Trimmed, p: &wc::ExactPoint) -> R<bool> {
    Ok(a.normal_at(p)?.parallel(&b.normal_at(p)?))
}
/// The first of `joins` (a source pair with the point they share) that is not tangent.
fn first_untangent<'a>(
    sources: &[wc::Trimmed],
    joins: impl IntoIterator<Item = &'a (usize, usize, wc::ExactPoint)>,
) -> R<Option<&'a (usize, usize, wc::ExactPoint)>> {
    for join in joins {
        if !tangent(&sources[join.0], &sources[join.1], &join.2)? { return Ok(Some(join)); }
    }
    Ok(None)
}

/// Each circle keeps its chord and its side of that chord. With half chord a,
/// signed centre height h, a ray from the chord midpoint meets the arc at
/// t(h,theta) = h*cos(theta) + sqrt(a*a + h*h*cos(theta)^2).
/// |dt/dh| <= 2. Thus the ENTIRE trimmed arc (not only the join) moves by at
/// most 2*|delta centre|. The rational L1 bound below dominates that distance.
/// A further factor 2 covers every admitted near-rigid source plane in 3D.
/// Cumulative displacement is measured from the ORIGINAL carrier, never a
/// sequence of individually small edits. Existing exact tangencies are kept.
pub(crate) fn apply(sources: &mut [wc::Trimmed], cap_mm: f64) -> R<Vec<Merge>> {
    if !cap_mm.is_finite() || cap_mm < 0. { return Err(no("regularization/invalid-cap")); }
    if sources.len() > 512 { return Err(no("regularization/entity-budget")); }
    let original = sources.to_vec();
    let cap = q(cap_mm);
    let mut incidence = std::collections::BTreeMap::<wc::ExactPoint, Vec<usize>>::new();
    for (i, s) in sources.iter().enumerate() {
        for p in s.ends() { incidence.entry(p.clone()).or_default().push(i); }
    }
    let mut joins = vec![];
    for (p, incident) in incidence {
        for (k, &i) in incident.iter().enumerate() { for &j in &incident[k + 1..] {
            if i == j || (!sources[i].is_curved() && !sources[j].is_curved()) { continue; }
            // Two common endpoints describe complementary/coincident arcs,
            // not an isolated tangent join.
            if sources[i].ends().iter().filter(|p| sources[j].ends().contains(p)).count() == 1 {
                joins.push((i, j, p.clone()));
            }
        }}
    }
    // Line anchors first; then propagate through arc/arc chains. A bounded
    // deterministic pass count prevents cycling on incompatible constraints.
    joins.sort_by_key(|(i, j, _)| usize::from(sources[*i].is_curved() && sources[*j].is_curved()));
    let mut required = vec![];
    for join in &joins {
        if tangent(&sources[join.0], &sources[join.1], &join.2)? { required.push(join.clone()); }
    }
    let mut merges = vec![];
    for _ in 0..sources.len() {
        let mut changed = false;
        for (i, j, p) in &joins {
            if tangent(&sources[*i], &sources[*j], p)? { continue; }
            // Prefer moving a previously unmodified carrier. This lets a line
            // anchor constrain a whole biarc chain without drifting the anchor.
            let mut choices = [(*j, *i), (*i, *j)];
            choices.sort_by_key(|(moved, _)| merges.iter().any(|m: &Merge| m.moved == *moved));
            for (moved, reference) in choices {
                let Some(replacement) = sources[moved].refitted(p, &sources[reference].normal_at(p)?)? else { continue; };
                let Some(delta) = replacement.centre_l1_distance(&original[moved]) else { continue; };
                let bound_mm = q(4000.) * delta;
                if bound_mm > cap { continue; }
                let old = std::mem::replace(&mut sources[moved], replacement);
                if first_untangent(sources, &required)?.is_some() {
                    sources[moved] = old;
                    continue;
                }
                required.push((*i, *j, p.clone()));
                merges.push(Merge { entities: [*i, *j], moved, bound_mm });
                changed = true;
                break;
            }
        }
        if !changed { break; }
    }
    Ok(merges)
}

pub(crate) fn report(cap: f64, merges: &[Merge]) -> R<String> {
    Ok(format!("{{\"mode\":\"tolerated-regularized\",\"label\":\"{}\",\"exact\":{},\"capMm\":{:?},\"merges\":[{}]}}",
        if merges.is_empty() { "exact" } else { "regularized" }, merges.is_empty(), cap,
        merges.iter().map(Merge::json).collect::<R<Vec<_>>>()?.join(",")))
}
