//! Local observation/certificate probe, not complete I1 admission.
//! No third-party source bytes are part of the crate.
//! Temporary --trim-inventory/--face-extents consumer: the I1 trim-domain
//! builder. They diagnose missing finite trims and unproved source/chart
//! correspondence gating reference measurement. Retire these modes when the
//! normal reference CLI body report exposes the same records and extents.
use wonky_geom::import::{
    reference::{Carrier, ReferenceDraft},
    source_digest, Limits, Source,
};
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let extents = args.iter().any(|a| a == "--face-extents");
    let inventory = args.iter().any(|a| a == "--trim-inventory");
    let bounds_only = args.iter().any(|a| a == "--face-supports");
    for path in args.iter().filter(|a| {
        a.as_str() != "--face-supports"
            && a.as_str() != "--trim-inventory"
            && a.as_str() != "--face-extents"
    }) {
        let bytes = std::fs::read(&path).unwrap();
        let result = ReferenceDraft::step(
            &bytes,
            Source {
                digest: source_digest(&bytes),
                revision: None,
                instance_path: vec![],
            },
            Limits::default(),
        );
        match result {
            Ok(d) => {
                if extents {
                    for body in &d.bodies {
                        let precision = match &body.uncertainty {
                            wonky_geom::import::Uncertainty::Declared { mm }
                                if mm > &wonky_geom::Q::from_integer(0.into()) =>
                            {
                                mm.clone() / wonky_geom::Q::from_integer(8.into())
                            }
                            _ => wonky_geom::Q::new(1.into(), 1000000.into()),
                        };
                        let mut enclosed = 0;
                        let mut refused = std::collections::BTreeMap::<String, usize>::new();
                        for face in &body.faces {
                            match body.face_extents(face.id, &precision) {
                                Ok(bounds) => {
                                    enclosed += 1;
                                    println!(
                                        "faceExtents solid=#{} face=#{} nominalBounds={:?}",
                                        body.id,
                                        face.id,
                                        bounds.coordinates.map(|e| (
                                            e.minimum.lower_mm.to_string(),
                                            e.maximum.upper_mm.to_string()
                                        ))
                                    );
                                }
                                Err(e) => {
                                    *refused.entry(e.name).or_default() += 1;
                                }
                            }
                        }
                        println!("solid=#{} label={:?} sourceBoundFaceExtents={} refused={:?} precisionMm={} sourceUncertainty={:?}",body.id,body.name,enclosed,refused,precision,body.uncertainty);
                    }
                    continue;
                }
                if inventory {
                    for body in &d.bodies {
                        for face in &body.faces {
                            let carrier = &body.surfaces[&face.surface];
                            let kind = match carrier {
                                Carrier::Spline(..) => "spline", Carrier::Plane(_) => "plane",
                                Carrier::Cylinder(..) => "cylinder",
                                Carrier::Cone(..) => "cone",
                                Carrier::Sphere(..) => "sphere",
                                Carrier::Torus(..) => "torus",
                            };
                            print!(
                                "face={} kind={} sense={} loops={}",
                                face.id,
                                kind,
                                face.same_sense,
                                face.loops.len()
                            );
                            for lp in &face.loops {
                                print!(" loop={} outer={} [", lp.id, lp.outer);
                                for (id, forward) in &lp.uses {
                                    let edge = &body.edges[id];
                                    print!(
                                        "edge={} forward={} sense={} pcs=",
                                        id, forward, edge.same_sense
                                    );
                                    for pc in
                                        edge.pcurves.iter().filter(|pc| pc.surface == face.surface)
                                    {
                                        match &pc.curve {
                                            wonky_geom::import::reference::Curve::Line {
                                                origin,
                                                direction,
                                            } => print!("line({origin:?},{direction:?});"),
                                            c => match c.homogeneous_spans() {
                                                Ok(spans) => {
                                                    let point=|s:&wonky_geom::import::reference::HomogeneousSpan,t:i64| { let t=wonky_geom::Q::from_integer(t.into()); let w=s.coordinates.last().unwrap().evaluate(&t).unwrap(); s.coordinates[..2].iter().map(|p| p.evaluate(&t).unwrap()/&w).collect::<Vec<_>>() };
                                                    print!(
                                                        "curve({:?},{:?});",
                                                        point(&spans[0], 0),
                                                        point(spans.last().unwrap(), 1)
                                                    );
                                                }
                                                Err(e) => print!("refused({e});"),
                                            },
                                        }
                                    }
                                    print!(" ");
                                }
                                print!("]");
                            }
                            println!();
                        }
                    }
                    continue;
                }
                if bounds_only {
                    let mut enclosed = 0;
                    let mut refused = std::collections::BTreeMap::<String, usize>::new();
                    for body in &d.bodies {
                        for face in &body.faces {
                            match body.face_support_bounds(face.id) {
                                Ok(_) => enclosed += 1,
                                Err(error) => {
                                    *refused.entry(error.name).or_default() += 1;
                                }
                            }
                        }
                        println!(
                            "solid=#{} label={:?} faces={} uncertainty={:?} placements={}",
                            body.id,
                            body.name,
                            body.faces.len(),
                            body.uncertainty,
                            body.placements.len()
                        );
                    }
                    println!("file={path} faceSupportEnclosures={enclosed} refused={refused:?} coverage=conditional-on-bounded-trims precision=conservative-not-tight-extrema");
                    println!("referenceAdmission=OPEN:import/reference-admission-incomplete");
                    continue;
                }
                println!(
                    "file={path} sourceSolids={} instances={} topology={:?}",
                    d.bodies
                        .iter()
                        .map(|b| b.id)
                        .collect::<std::collections::BTreeSet<_>>()
                        .len(),
                    d.bodies.len(),
                    d.check_topology()
                );
                println!(
                    "boundarySurfaceCertificates={:?}",
                    d.check_boundary_surfaces().map(|v| v.len())
                );
                println!(
                    "splineSurfaceCertificates={:?}",
                    d.check_spline_surfaces().map(|v| v.len())
                );
                let mut proved = 0;
                let mut refused = std::collections::BTreeMap::<String, usize>::new();
                for body in &d.bodies {
                    for edge in body.edges.values() {
                        for pc in &edge.pcurves {
                            eprintln!(
                                "checkingPcurve solid=#{} edge=#{} pcurve=#{}",
                                body.id, edge.id, pc.id
                            );
                            match body.check_pcurve(edge.id, pc.id) {
                                Ok(proof) => {
                                    proved += 1;
                                    println!(
                                        "pcurveProof solid=#{} edge=#{} pcurve=#{} method={}",
                                        body.id, edge.id, pc.id, proof.method
                                    );
                                }
                                Err(error) => {
                                    *refused.entry(error.name.clone()).or_default() += 1;
                                    println!(
                                        "pcurveRefusal solid=#{} edge=#{} pcurve=#{} name={}",
                                        body.id, edge.id, pc.id, error.name
                                    );
                                }
                            }
                        }
                    }
                }
                println!("pcurveCertificates proved={proved} refused={refused:?}");
                println!(
                    "vertexCertificates={:?}",
                    d.check_vertices().map(|v| v.len())
                );
                println!("referenceAdmission=OPEN:import/reference-admission-incomplete");
                for b in &d.bodies {
                    let mut count = [0usize; 6];
                    for f in &b.faces {
                        count[match &b.surfaces[&f.surface] {
                            Carrier::Plane(_) => 0,
                            Carrier::Cylinder(_, _) => 1,
                            Carrier::Cone(_, _, _) => 2,
                            Carrier::Sphere(_, _) => 3,
                            Carrier::Torus(_, _, _) => 4,
                            Carrier::Spline(..) => 5,
                        }] += 1;
                    }
                    println!("solid=#{} label={:?} faces={} plane/cylinder/cone/sphere/torus/spline={count:?} edges={} pcurves={} uncertainty={:?} placements={}",b.id,b.name,b.faces.len(),b.edges.len(),b.edges.values().map(|e|e.pcurves.len()).sum::<usize>(),b.uncertainty,b.placements.len());
                    for face in &b.faces {
                        println!(
                            "faceSupportEnclosure solid=#{} face=#{} result={:?}",
                            b.id,
                            face.id,
                            b.face_support_bounds(face.id).map(|bounds| (
                                bounds.method,
                                bounds.requires_bounded_trim,
                                bounds
                                    .coordinates
                                    .map(|c| (c.lower_mm.to_string(), c.upper_mm.to_string()))
                            ))
                        );
                    }
                    println!(
                        "placedSourceVertexObservations={:?}",
                        b.placed_vertex_bounds().map(|vertices| {
                            (0..3)
                                .map(|i| {
                                    (
                                        vertices
                                            .values()
                                            .map(|p| p[i].lower_mm.clone())
                                            .min()
                                            .map(|q| q.to_string()),
                                        vertices
                                            .values()
                                            .map(|p| p[i].upper_mm.clone())
                                            .max()
                                            .map(|q| q.to_string()),
                                    )
                                })
                                .collect::<Vec<_>>()
                        })
                    );
                }
            }
            Err(e) => {
                eprintln!("file={path} REFUSED {e}");
                std::process::exit(2);
            }
        }
    }
    // Decoding and partial boundary certificates do not publish a successful
    // reference body. This probe must never report full I1 success.
    std::process::exit(2);
}
