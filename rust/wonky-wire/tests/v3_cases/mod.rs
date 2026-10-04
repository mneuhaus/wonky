//! Deterministic transport corpus, not a claim of generated solid geometry.
use wonky_brep::contract::*;
use wonky_brep::Rigid;
use wonky_num::v3;
pub fn f(x: f64) -> Binary64 {
    Binary64::new(x).unwrap()
}
pub fn p(x: f64, y: f64, z: f64) -> Vector3 {
    [f(x), f(y), f(z)]
}
pub fn range(a: f64, b: f64) -> Domain {
    Domain {
        lower: Limit::Finite {
            value: f(a),
            closed: true,
        },
        upper: Limit::Finite {
            value: f(b),
            closed: true,
        },
    }
}
pub fn estimate(x: f64) -> Bound {
    Bound::Estimated {
        estimate: Estimate { magnitude: f(x) },
    }
}
fn claim(x: f64) -> Bound {
    Bound::Enclosed {
        claim: EnclosureClaim {
            magnitude: f(x),
            witness: ProofRef {
                rule: 17,
                nodes: vec![NodeId(0)],
            },
        },
    }
}
pub fn source() -> Body {
    let key = BodyKey {
        id: [2, 7, 1, 9],
        revision: 13,
    };
    let z = p(0., 0., 0.);
    let x = p(1., 0., 0.);
    let normal = p(0., 0., 1.);
    let constructions = vec![
        Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: z.into_iter().chain(x).collect(),
            frame: FrameId(0),
        },
        Construction {
            operation: Operation::LineThrough {},
            rule_version: 1,
            parents: vec![NodeId(0)],
            parameters: vec![],
            frame: FrameId(0),
        },
        Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: z.into_iter().chain(normal).chain(x).collect(),
            frame: FrameId(0),
        },
        Construction {
            operation: Operation::Plane {},
            rule_version: 1,
            parents: vec![NodeId(2)],
            parameters: vec![],
            frame: FrameId(0),
        },
    ];
    Body {
        key: key.clone(),
        frames: vec![Frame::Source {
            source: [3, 4, 5, 6],
        }],
        constructions,
        vertices: vec![],
        curves: vec![Curve {
            frame: FrameId(0),
            provenance: Provenance::Construction { node: NodeId(1) },
            geometry: CurveGeometry::Line { a: z, b: x },
            domain: range(0., 1.),
            supports: vec![],
        }],
        surfaces: vec![Surface {
            frame: FrameId(0),
            provenance: Provenance::Construction { node: NodeId(3) },
            geometry: SurfaceGeometry::Plane {
                origin: z,
                normal,
                x,
            },
        }],
        pcurves: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
        facts: vec![Fact::CurveOnSurface {
            claim: ContainedClaim {
                body: key,
                curve: CurveId(0),
                surface: SurfaceId(0),
                rule: 1,
            },
        }],
        budgets: vec![],
    }
}
pub fn move_both(b: &mut Body, by: Rigid) {
    let old = b.curves[0].frame;
    let frame = FrameId(b.frames.len() as u32);
    b.frames.push(by.to_contract_frame(old).unwrap());
    for origin in [&mut b.curves[0].provenance, &mut b.surfaces[0].provenance] {
        let Provenance::Construction { node } = origin else {
            panic!("source required")
        };
        let parent = *node;
        *node = NodeId(b.constructions.len() as u32);
        b.constructions.push(Construction {
            operation: Operation::RigidTransform {},
            rule_version: 1,
            parents: vec![parent],
            parameters: vec![],
            frame,
        });
    }
    b.curves[0].frame = frame;
    b.surfaces[0].frame = frame;
}
/// All enum arms and all arena tables, with varied full-significand binary64s.
/// Three symbolic operations preserve the exact source line/plane construction.
pub fn generated(seed: u64) -> Body {
    let mut b = source();
    let scalar = |offset: u64| {
        f64::from_bits(
            0x3ff0_0000_0000_0000
                | ((seed.wrapping_mul(0x9e3779b97f4a7c15).wrapping_add(offset))
                    & 0x000f_ffff_ffff_ffff),
        )
    };
    for (translation, axis, angle) in [
        (v3(3., -2., 5.), v3(1., 2., 3.), 0.1),
        (v3(scalar(1), -scalar(2), -0.), v3(2., -3., 1.), scalar(3)),
        (v3(-scalar(4), scalar(5), 2.), v3(-4., 1., 2.), -scalar(6)),
    ] {
        move_both(
            &mut b,
            Rigid::around_axis(translation, axis, angle).unwrap(),
        );
    }
    let frame = b.curves[0].frame;
    for op in [
        Operation::Sketch {},
        Operation::Extrude {},
        Operation::Revolve {},
        Operation::Intersection {},
        Operation::Boolean {},
    ] {
        b.constructions.push(Construction {
            operation: op,
            rule_version: 1,
            parents: vec![NodeId(b.constructions.len() as u32 - 1)],
            parameters: vec![f(scalar(9)), f(-0.)],
            frame,
        });
    }
    let origin = p(scalar(0), -0., -scalar(1));
    let axis = p(0., 0., 1.);
    let x = p(1., 0., 0.);
    for geometry in [
        SurfaceGeometry::Cylinder {
            origin,
            axis,
            x,
            radius: f(scalar(2)),
        },
        SurfaceGeometry::Cone {
            origin,
            axis,
            x,
            radius: f(scalar(3)),
            angle: f(0.1),
        },
        SurfaceGeometry::ConeSlope {
            origin, axis, x, radius: f(scalar(3)), slope: f(scalar(6)),
        },
        SurfaceGeometry::ConeMeridian {
            origin, axis, x, start: [f(2.), f(-1.)], end: [f(1.), f(2.)],
        },
        SurfaceGeometry::Sphere {
            origin,
            axis,
            x,
            radius: f(scalar(4)),
        },
        SurfaceGeometry::Torus {
            origin,
            axis,
            x,
            major: f(4.),
            minor: f(scalar(5)),
        },
    ] {
        b.surfaces.push(Surface {
            frame,
            provenance: Provenance::None {},
            geometry,
        });
    }
    let mut add = |geometry, domain| {
        b.curves.push(Curve {
            frame,
            provenance: Provenance::None {},
            geometry,
            domain,
            supports: vec![],
        })
    };
    for arc in [ArcKind::Full {}, ArcKind::Trimmed {}] {
        add(
            CurveGeometry::Circle {
                origin,
                normal: axis,
                x,
                radius: f(scalar(7)),
                arc: arc.clone(),
            },
            if matches!(arc, ArcKind::Full {}) {
                range(0., 1.)
            } else {
                range(0.125, 0.875)
            },
        );
        add(
            CurveGeometry::Ellipse {
                origin,
                normal: axis,
                x,
                major: f(4.),
                minor: f(scalar(8)),
                arc: arc.clone(),
            },
            if matches!(arc, ArcKind::Full {}) {
                range(0., 1.)
            } else {
                range(0.25, 0.5)
            },
        );
    }
    for (branch, domain) in [
        (
            ParabolaBranch::Whole {},
            Domain {
                lower: Limit::NegativeInfinity {},
                upper: Limit::PositiveInfinity {},
            },
        ),
        (
            ParabolaBranch::Negative {},
            Domain {
                lower: Limit::NegativeInfinity {},
                upper: Limit::Finite {
                    value: f(-0.),
                    closed: false,
                },
            },
        ),
        (
            ParabolaBranch::Positive {},
            Domain {
                lower: Limit::Finite {
                    value: f(0.),
                    closed: true,
                },
                upper: Limit::PositiveInfinity {},
            },
        ),
    ] {
        add(
            CurveGeometry::Parabola {
                origin,
                axis,
                x,
                focal: f(scalar(9)),
                branch,
            },
            domain,
        );
    }
    for branch in [HyperbolaBranch::Negative {}, HyperbolaBranch::Positive {}] {
        add(
            CurveGeometry::Hyperbola {
                origin,
                axis,
                x,
                major: f(scalar(10)),
                minor: f(scalar(11)),
                branch,
            },
            range(-2., 7.),
        );
    }
    for (i, quantity) in [
        Quantity::Length {},
        Quantity::Area {},
        Quantity::VolumeClosed {},
        Quantity::VolumeQuadrature {},
        Quantity::Angle {},
    ]
    .into_iter()
    .enumerate()
    {
        let bound = if i % 2 == 0 { estimate } else { claim };
        b.budgets.push(Budget {
            quantity,
            approximation: bound(1e-12),
            construction: bound(1e-12),
            integration: bound(1e-12),
            export: bound(1e-12),
            total: bound(4e-12),
            maximum: f(1e-10),
            scale: f(1.),
            reference_width: f(1e-8),
        });
    }
    b.curves.push(Curve {
        frame,
        provenance: Provenance::None {},
        geometry: CurveGeometry::Trace {
            surfaces: [SurfaceId(0), SurfaceId(1)],
            tube: Tube {
                segments: vec![
                    TubeSegment {
                        domain: range(0., 0.5),
                        start: p(0., 0., 0.),
                        end: p(0.5, 0., 0.),
                        radius: estimate(1e-12),
                    },
                    TubeSegment {
                        domain: range(0.5, 1.),
                        start: p(0.5, 0., 0.),
                        end: p(1., 0., 0.),
                        radius: estimate(1e-12),
                    },
                ],
                budget: 0,
            },
        },
        domain: range(0., 1.),
        supports: vec![],
    });
    for geometry in [
        PcurveGeometry::Line {
            a: [f(0.), f(0.)],
            b: [f(1.), f(0.)],
        },
        PcurveGeometry::RationalBezier {
            controls: vec![[f(0.), f(0.)], [f(1.), f(0.)]],
            weights: vec![f(1.), f(1.)],
        },
        PcurveGeometry::Samples {
            parameters: vec![f(0.), f(0.5), f(1.)],
            points: vec![[f(0.), f(0.)], [f(0.5), f(0.)], [f(1.), f(0.)]],
            error: estimate(0.),
        },
    ] {
        let id = PcurveId(b.pcurves.len() as u32);
        b.curves[0].supports.push(Support {
            surface: SurfaceId(0),
            pcurve: id,
        });
        b.pcurves.push(Pcurve {
            curve: CurveId(0),
            surface: SurfaceId(0),
            domain: range(0., 1.),
            geometry,
        });
    }
    let trace_id = CurveId(b.curves.len() as u32 - 1);
    for surface in [SurfaceId(0), SurfaceId(1)] {
        let pcurve = PcurveId(b.pcurves.len() as u32);
        b.curves[trace_id.0 as usize]
            .supports
            .push(Support { surface, pcurve });
        b.pcurves.push(Pcurve {
            curve: trace_id,
            surface,
            domain: range(0., 1.),
            geometry: PcurveGeometry::Samples {
                parameters: vec![f(0.), f(0.5), f(1.)],
                points: vec![[f(0.), f(0.)], [f(0.5), f(0.)], [f(1.), f(0.)]],
                error: estimate(1e-12),
            },
        });
    }
    for point in [p(0., 0., 0.), p(1., 0., 0.)] {
        let input = NodeId(b.constructions.len() as u32);
        b.constructions.push(Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: point.to_vec(),
            frame: FrameId(0),
        });
        let mut node = NodeId(b.constructions.len() as u32);
        b.constructions.push(Construction {
            operation: Operation::Point {},
            rule_version: 1,
            parents: vec![input],
            parameters: vec![],
            frame: FrameId(0),
        });
        for i in 1..=3 {
            let parent = node;
            node = NodeId(b.constructions.len() as u32);
            b.constructions.push(Construction {
                operation: Operation::RigidTransform {},
                rule_version: 1,
                parents: vec![parent],
                parameters: vec![],
                frame: FrameId(i),
            });
        }
        b.vertices.push(Vertex {
            point,
            frame,
            provenance: Provenance::Construction { node },
        });
    }
    b.edges.push(Edge {
        curve: CurveId(0),
        domain: range(0., 1.),
        vertices: vec![VertexId(0), VertexId(1)],
    });
    b.coedges.push(Coedge {
        edge: EdgeId(0),
        forward: seed % 2 == 0,
        pcurve: PcurveId(0),
    });
    b.loops.push(Loop {
        outer: seed % 2 == 1,
        coedges: vec![CoedgeId(0)],
    });
    b.faces.push(Face {
        surface: SurfaceId(0),
        forward: true,
        loops: vec![LoopId(0)],
    });
    b.faces.push(Face {
        surface: SurfaceId(0),
        forward: false,
        loops: vec![LoopId(0)],
    });
    b.shells.push(Shell {
        faces: vec![FaceId(0), FaceId(1)],
    });
    b.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    b.facts.extend([
        Fact::VertexOnEdge {
            body: b.key.clone(),
            vertex: VertexId(0),
            edge: EdgeId(0),
            parameter: f(0.),
            rule: 2,
        },
        Fact::EdgeOnSurface {
            body: b.key.clone(),
            edge: EdgeId(0),
            surface: SurfaceId(0),
            domain: range(0., 1.),
            rule: 1,
        },
        Fact::VertexOnSurface {
            body: b.key.clone(),
            vertex: VertexId(1),
            surface: SurfaceId(0),
            rule: 3,
        },
        Fact::TangentAlong {
            body: b.key.clone(),
            face_a: FaceId(0),
            face_b: FaceId(1),
            edge: EdgeId(0),
            domain: range(0., 1.),
            rule: 4,
        },
    ]);
    b
}
