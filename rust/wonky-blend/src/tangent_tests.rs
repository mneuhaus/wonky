//! Exercise the production closure/stripe traversal with exact analytic curve
//! tangents. This is not a curved-face Model adapter or blend geometry proof.
use super::*;
use wonky_curve::Trimmed;

#[test]
fn one_line_expands_to_the_exact_closed_slot_loop() {
    let curves = [
        Trimmed::line([-2., -1.], [2., -1.]),
        Trimmed::arc_through([2., -1.], [3., 0.], [2., 1.]).unwrap(),
        Trimmed::line([2., 1.], [-2., 1.]),
        Trimmed::arc_through([-2., 1.], [-3., 0.], [-2., -1.]).unwrap(),
    ];
    let incident: BTreeMap<_, _> = (0..4)
        .map(|v| (VertexId(v), vec![EdgeId((v + 3) % 4), EdgeId(v)]))
        .collect();
    let exact_tangent = |v: VertexId, es: [EdgeId; 2]| {
        let a = curves[es[0].index()].tangent(es[0].0 == v.0);
        let b = curves[es[1].index()].tangent(es[1].0 == v.0);
        // Exact angular order distinguishes opposite rays from same-sense
        // rays even when their unnormalized lengths differ.
        Ok(a.parallel(&b) && a.ccw_cmp(&b) != std::cmp::Ordering::Equal)
    };
    let all: BTreeSet<_> = (0..4).map(EdgeId).collect();
    for seed in 0..4 {
        let initial = BTreeSet::from([EdgeId(seed)]);
        let (expanded, adjacency) =
            tangent_selection(&initial, &incident, true, exact_tangent).unwrap();
        assert_eq!(expanded, all);
        assert_eq!(expanded.difference(&initial).count(), 3);
        assert_eq!(
            stripe_components(expanded, &adjacency),
            vec![Stripe {
                edges: all.iter().copied().collect(),
                closed: true,
            }]
        );
        let (single, adjacency) =
            tangent_selection(&initial, &incident, false, exact_tangent).unwrap();
        assert_eq!(single, initial);
        assert_eq!(
            stripe_components(single, &adjacency),
            vec![Stripe {
                edges: vec![EdgeId(seed)],
                closed: false,
            }]
        );
    }
}

#[test]
fn undecidable_tangency_refusal_is_preserved() {
    let incident = BTreeMap::from([(VertexId(0), vec![EdgeId(0), EdgeId(1)])]);
    let initial = BTreeSet::from([EdgeId(0)]);
    let result = tangent_selection(&initial, &incident, true, |_, _| {
        refuse("blend/tangency-unsupported:carrier")
    });
    assert_eq!(result.unwrap_err().0, "blend/tangency-unsupported:carrier");
}
