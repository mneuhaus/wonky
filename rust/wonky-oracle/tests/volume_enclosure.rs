use num_traits::Zero;
use wonky_oracle::{
    point3,
    volume::{self, Cell, Membership, Operation},
    R,
};
fn box3(lo: [f64; 3], hi: [f64; 3]) -> Cell {
    [point3(lo).unwrap(), point3(hi).unwrap()]
}
fn classify(b: &Cell, c: &Cell) -> Membership {
    if (0..3).any(|k| c[1][k] <= b[0][k] || c[0][k] >= b[1][k]) {
        Membership::Outside
    } else if (0..3).all(|k| b[0][k] <= c[0][k] && c[1][k] <= b[1][k]) {
        Membership::Inside
    } else {
        Membership::Boundary
    }
}
#[test]
fn exact_operand_grid_all_operations_and_contact() {
    let a = box3([0.; 3], [2.; 3]);
    let b = box3([1.; 3], [3.; 3]);
    let cuts = std::array::from_fn(|k| {
        vec![
            a[0][k].clone(),
            b[0][k].clone(),
            a[1][k].clone(),
            b[1][k].clone(),
        ]
    });
    for (op, v) in [
        (Operation::Union, 15),
        (Operation::Intersection, 1),
        (Operation::Difference, 7),
    ] {
        let e = volume::enclose(box3([0.; 3], [3.; 3]), &cuts, 256, |c| {
            Ok::<_, ()>(op.classify(&[classify(&a, c), classify(&b, c)]))
        })
        .unwrap();
        assert!(e.converged);
        assert!(e.width().is_zero());
        assert_eq!(e.lower, R::from_integer(v.into()));
        assert!(!e.contains(&R::from_integer((v + 1).into())));
    }
    let b = box3([2.; 3], [4.; 3]);
    let e = volume::enclose(
        box3([0.; 3], [4.; 3]),
        &std::array::from_fn(|_| vec![R::from_integer(2.into())]),
        64,
        |c| Ok::<_, ()>(Operation::Intersection.classify(&[classify(&a, c), classify(&b, c)])),
    )
    .unwrap();
    assert!(e.upper.is_zero());
}
#[test]
fn boundary_budget_never_becomes_success_or_loses_volume() {
    let root = box3([0.; 3], [1.; 3]);
    let e = volume::enclose(root, &std::array::from_fn(|_| vec![]), 17, |_| {
        Ok::<_, ()>(Membership::Boundary)
    })
    .unwrap();
    assert_eq!(e.classified, 17);
    assert!(!e.converged);
    assert!(e.lower.is_zero());
    assert_eq!(e.upper, R::from_integer(1.into()));
    assert_eq!(e.boundary_cells, 18);
    assert!(volume::enclose(
        box3([0.; 3], [1.; 3]),
        &std::array::from_fn(|_| vec![]),
        1,
        |_| Err::<Membership, _>("named refusal")
    )
    .is_err());
}
#[test]
fn all_three_valued_csg_tables_are_conservative() {
    use Membership::*;
    for a in [Inside, Outside, Boundary] {
        for b in [Inside, Outside, Boundary] {
            for op in [
                Operation::Union,
                Operation::Difference,
                Operation::Intersection,
            ] {
                let predicted = op.classify(&[a, b]);
                assert_eq!(
                    op.classify_lazy(2, |i| Ok::<_, ()>([a, b][i])).unwrap(),
                    predicted
                );
                for av in [false, true] {
                    for bv in [false, true] {
                        if (a == Inside && !av)
                            || (a == Outside && av)
                            || (b == Inside && !bv)
                            || (b == Outside && bv)
                        {
                            continue;
                        }
                        let actual = match op {
                            Operation::Union => av || bv,
                            Operation::Difference => av && !bv,
                            Operation::Intersection => av && bv,
                        };
                        assert!(
                            !(predicted == Inside && !actual || predicted == Outside && actual)
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn sphere_box_membership_is_exact_including_tangency_and_false_corner_inference() {
    use volume::sphere_membership;
    let c = point3([0.; 3]).unwrap();
    let r = R::from_integer(1.into());
    assert_eq!(
        sphere_membership(&box3([-0.5; 3], [0.5; 3]), &c, &r),
        Membership::Inside
    );
    assert_eq!(
        sphere_membership(&box3([1., 0., 0.], [2., 1., 1.]), &c, &r),
        Membership::Outside
    );
    // All corners are outside; the interior still contains the entire sphere.
    assert_eq!(
        sphere_membership(&box3([-2.; 3], [2.; 3]), &c, &r),
        Membership::Boundary
    );
    assert_eq!(
        sphere_membership(&box3([1., 0., 0.], [1., 0., 0.]), &c, &r),
        Membership::Inside
    );
}

#[test]
fn lazy_cell_membership_propagates_needed_refusals_and_stops_on_decisive_proofs() {
    use Membership::*;
    for (op, first, expected) in [
        (Operation::Union, Inside, Inside),
        (Operation::Intersection, Outside, Outside),
        (Operation::Difference, Outside, Outside),
    ] {
        assert_eq!(
            op.classify_lazy(2, |i| if i == 0 {
                Ok(first)
            } else {
                Err("needed predicate unavailable")
            })
            .unwrap(),
            expected
        );
    }
    for op in [
        Operation::Union,
        Operation::Intersection,
        Operation::Difference,
    ] {
        assert_eq!(
            op.classify_lazy(2, |i| if i == 0 {
                Ok(Boundary)
            } else {
                Err("named membership refusal")
            }),
            Err("named membership refusal")
        );
    }
}
