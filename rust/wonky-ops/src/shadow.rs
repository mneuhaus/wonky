//! Shadow harness of the general Boolean (boolean3d plan C11, strand G4).
//!
//! With `WONKY_BOOLEAN_SHADOW=1`, every family Boolean of the host
//! (`OP_BOOLEAN`) is run again on the general path (`wonky_bool::fold_models` on the
//! operands' exact Models) and the two results are compared by their
//! canonical exact forms in a common exact construction frame (one per body, as
//! a sorted list), or by their FeatureScript refusal category (`empty-result`,
//! `non-manifold-result`). One JSON line per Boolean goes to the file named
//! by `WONKY_BOOLEAN_SHADOW_REPORT` (appended), else to stderr; the cell
//! label `WONKY_BOOLEAN_SHADOW_CELL` (set by the acid harness) is copied into
//! it. A `differ` between two built results also says what both still share
//! (`same_volume`, `same_planes`, `same_shells`, and `fev`, the face/edge/
//! vertex counts of family and general), so any remaining subdivision reads
//! differently from a missing or misplaced region. These metrics never turn
//! a canonical difference into equality. Exact volume and metric surface area
//! are also compared against Green integration of the emitted general B-rep.
//!
//! * **Consumer:** the dark Boolean strands (each reports its diff count over
//!   the corpus) and the family retirements R1-R6 (plan §5 step 2: zero
//!   canonical diffs before a routing flips).
//! * **Defect class:** silent disagreement between two exact paths.
//! * **Deletion:** with the last family retirement.
//!
//! **Output neutrality.** The shadow only borrows the operands and the
//! family's result; it never writes anything the host replies with, never
//! touches the host's audit memo, and a panic inside it is caught and
//! reported. A full acid run is byte-identical with the shadow on and off.
//! The planted negative `plant_shadow_mutates` "normalizes" the family
//! bodies in place (it reverses each shell's face order) and must break that
//! identity (tests/shadow.rs).
use crate::analytic::{self, Solid};
use crate::polyhedron::Refused;
use std::io::Write;
use wonky_bool::Op;
use wonky_contract::Body;
use wonky_geom::model::Model;

/// Whether the shadow runs (`WONKY_BOOLEAN_SHADOW=1`).
pub fn enabled() -> bool {
    std::env::var_os("WONKY_BOOLEAN_SHADOW").is_some_and(|v| v == "1")
}

/// The FeatureScript refusal category of a code (its last segment), when
/// it is one of the two CAD-Acid accepts as a Boolean outcome.
fn fs_category(code: &str) -> Option<&str> {
    let last = code.rsplit('/').next().unwrap_or(code);
    ["empty-result", "non-manifold-result"]
        .contains(&last)
        .then_some(last)
}

fn json(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Bake each placement into exact world construction data before comparing.
/// Local canonical forms deliberately ignore placement, and cannot detect a
/// misplaced result. This also admits two different local charts of the same
/// world B-rep. No observation cache or rounded transform is read.
#[cfg(test)]
fn world_model(model: &Model) -> Result<Model, Refused> {
    use num_traits::Signed;
    use wonky_curve::{Carrier, ExactPoint, Trimmed};
    use wonky_geom::model::{Bounds, Carrier3, Curve3, VertexDef, VertexId};
    use wonky_geom::{cross, dot};

    let mut d = model.clone().into_draft();
    let map = d.placement.clone();
    let inverse = map.inverse();
    let reflected = dot(
        &map.columns()[0],
        &cross(&map.columns()[1], &map.columns()[2]),
    )
    .is_negative();
    for (i, v) in d.vertices.iter_mut().enumerate() {
        let p = model
            .key(VertexId(i as u32))
            .rational()
            .map_err(|e| Refused(e.0.into()))?;
        v.def = VertexDef::Rational(map.point(p));
    }
    for c in &mut d.curves {
        match &mut c.geometry {
            Curve3::RadicalLine { .. } | Curve3::RadicalCircle(_) => {
                return Err(Refused(
                    "boolean/ssi-row-unavailable:radical/shadow-world".into(),
                ))
            }
            Curve3::Circle(_) | Curve3::TranslatedCircle(_) => {
                return Err(Refused(
                    "boolean/ssi-row-unavailable:circle/shadow-world".into(),
                ))
            }
            Curve3::Line { p, d } => {
                *p = map.point(p);
                *d = map.vector(d);
            }
        }
    }
    for s in &mut d.surfaces {
        match &mut s.carrier {
            Carrier3::Rotated(_) => return Err(Refused("boolean/ssi-row-unavailable:rotated/shadow-world".into())),
            Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => {
                return Err(Refused(
                    "boolean/ssi-row-unavailable:curved/shadow-world".into(),
                ))
            }
            Carrier3::RadicalPlane(_) => {
                return Err(Refused(
                    "boolean/ssi-row-unavailable:radical/shadow-world".into(),
                ))
            }
            Carrier3::Plane(p) => {
                p.o = map.point(&p.o);
                p.x = map.vector(&p.x);
                p.n = std::array::from_fn(|i| dot(&inverse.columns()[i], &p.n));
            }
        }
    }
    for face in &d.faces {
        let plane = d.surfaces[face.surface.index()]
            .carrier
            .plane()
            .map_err(|e| Refused(e.0.into()))?;
        for lp in &face.loops {
            if reflected {
                d.loops[lp.index()].coedges.reverse();
            }
            for id in &d.loops[lp.index()].coedges {
                let co = &mut d.coedges[id.index()];
                co.forward ^= reflected;
                let ends = match d.edges[co.edge.index()].bounds {
                    Bounds::Segment(ends) => ends,
                    Bounds::Ring => return Err(Refused("shadow/world-line-ring".into())),
                };
                let [a, b] = if co.forward { ends } else { [ends[1], ends[0]] };
                let chart = |v: VertexId| match &d.vertices[v.index()].def {
                    VertexDef::OnCurve(p) => p.rational().and_then(|p| plane.chart(&p)).map(ExactPoint::from_rational),
                    VertexDef::Rational(p) => plane.chart(p).map(ExactPoint::from_rational),
                    VertexDef::Quadratic(_) | VertexDef::Radical(_) | VertexDef::Real(_) => Err(wonky_geom::Refused(
                        "boolean/ssi-row-unavailable:quadratic/shadow-world",
                    )),
                    VertexDef::Input(_) => unreachable!("all vertices were baked above"),
                };
                let ends = [chart(a), chart(b)]
                    .into_iter()
                    .collect::<wonky_geom::Result<Vec<_>>>()
                    .map_err(|e| Refused(e.0.into()))?;
                co.pcurve = Trimmed::new([ends[0].clone(), ends[1].clone()], Carrier::Line)
                    .map_err(|e| Refused(e.name().into()))?;
            }
        }
    }
    d.placement = wonky_geom::frame::Frame::identity();
    d.check()
        .map_err(|e| Refused(format!("shadow/world-{}", e.0)))
}

/// What a `differ` between two built results still shares, so a consumer
/// can distinguish a face subdivision from a geometric disagreement: the exact volumes of the solids, the oriented
/// carrier planes, the shell count, and each side's face/edge/vertex count.
/// Equal volumes and planes do not prove the point sets equal; they only
/// rule out a missing or extra region on a plane of its own.
fn differ_detail(family: &[Model], general: &[Model], target: &wonky_geom::frame::Frame) -> String {
    let volumes = |ms: &[Model]| -> Option<Vec<wonky_geom::Q>> {
        let mut v = vec![];
        for m in ms {
            use num_traits::Signed;
            let map = target.relation_from(&m.draft().placement).map;
            let scale = wonky_geom::dot(
                &map.columns()[0],
                &wonky_geom::cross(&map.columns()[1], &map.columns()[2]),
            )
            .abs();
            v.extend(m.volume6().ok()?.into_iter().map(|x| x * &scale));
        }
        v.sort();
        Some(v)
    };
    let forms = |ms: &[Model]| {
        ms.iter()
            .map(|m| m.canonical_in(target))
            .collect::<wonky_geom::Result<Vec<_>>>()
    };
    let (f, g) = match (forms(family), forms(general)) {
        (Ok(f), Ok(g)) => (f, g),
        (Err(e), _) | (_, Err(e)) => return format!(",\"detail_refusal\":{}", json(e.0)),
    };
    let planes = |cs: &[wonky_geom::model::Canonical]| {
        let mut p: Vec<_> = cs
            .iter()
            .flat_map(|c| c.faces.iter().map(|x| (x.carrier.clone(), x.outward)))
            .collect();
        p.sort();
        p.dedup();
        p
    };
    let shells =
        |cs: &[wonky_geom::model::Canonical]| cs.iter().map(|c| c.shells.len()).sum::<usize>();
    let fev = |cs: &[wonky_geom::model::Canonical]| {
        let n = |k: fn(&wonky_geom::model::Canonical) -> usize| cs.iter().map(k).sum::<usize>();
        format!(
            "[{},{},{}]",
            n(|c| c.faces.len()),
            n(|c| c.edges.len()),
            n(|c| c.vertices.len())
        )
    };
    let same_volume = match (volumes(family), volumes(general)) {
        (Some(a), Some(b)) => (a == b).to_string(),
        _ => "null".into(),
    };
    format!(
        ",\"same_volume\":{same_volume},\"same_planes\":{},\"same_shells\":{},\"fev\":[{},{}]",
        planes(&f) == planes(&g),
        shells(&f) == shells(&g),
        fev(&f),
        fev(&g)
    )
}

/// Independent exact measure comparison: the family adapter's Model integral
/// against Green integration on the general path's actual emitted faces.
fn measure_detail(
    family: &[Model],
    general: &[Model],
    target: &wonky_geom::frame::Frame,
) -> Result<(bool, String), Refused> {
    let values =
        |ms: &[Model], green: bool| -> Result<Vec<(wonky_geom::Q, wonky_geom::Q)>, Refused> {
            let mut values = vec![];
            for m in ms {
                let terms = if green {
                    wonky_bool::periodic::measure_model(m, wonky_bool::split::BUDGET)
                } else {
                    m.volume6_pi()
                }
                .map_err(|e| Refused(e.0.into()))?;
                for p in &terms {
                    p.without_pi2().map_err(|e| Refused(e.0.into()))?;
                }
                use num_traits::Signed;
                let map = target.relation_from(&m.draft().placement).map;
                let scale = wonky_geom::dot(
                    &map.columns()[0],
                    &wonky_geom::cross(&map.columns()[1], &map.columns()[2]),
                )
                .abs();
                values.extend(
                    terms
                        .into_iter()
                        .map(|p| (p.rational * &scale, p.pi * &scale)),
                );
            }
            values.sort();
            Ok(values)
        };
    let (f, g) = (values(family, false)?, values(general, true)?);
    let areas =
        |ms: &[Model], green: bool| -> Result<Vec<(wonky_geom::Q, wonky_geom::Q)>, Refused> {
            let mut terms = vec![];
            for m in ms {
                let m = m.reframed(target).map_err(|e| Refused(e.0.into()))?;
                let values = if green {
                    wonky_bool::periodic::surface_area_model(&m, wonky_bool::split::BUDGET)
                } else {
                    m.area_pi()
                }
                .map_err(|e| Refused(e.0.into()))?;
                for p in &values {
                    p.without_pi2().map_err(|e| Refused(e.0.into()))?;
                }
                terms.extend(values.into_iter().map(|p| (p.rational, p.pi)));
            }
            terms.sort();
            Ok(terms)
        };
    let (fa, ga) = (areas(family, false)?, areas(general, true)?);
    let encode = |vs: &[(wonky_geom::Q, wonky_geom::Q)]| {
        format!(
            "[{}]",
            vs.iter()
                .map(|(r, p)| format!(
                    "{{\"rational\":{},\"pi\":{}}}",
                    json(&r.to_string()),
                    json(&p.to_string())
                ))
                .collect::<Vec<_>>()
                .join(",")
        )
    };
    Ok((f==g && fa==ga, format!(",\"same_measure\":{},\"same_area\":{},\"volume6\":{{\"family\":{},\"general\":{}}},\"area\":{{\"family\":{},\"general\":{}}}",f==g && fa==ga,fa==ga,encode(&f),encode(&g),encode(&fa),encode(&ga))))
}

/// The first line where two canonical lists differ.
fn first_difference(a: &[String], b: &[String]) -> String {
    if a.len() != b.len() {
        return format!("{} bodies vs {}", a.len(), b.len());
    }
    for (x, y) in a.iter().zip(b) {
        if let Some((l, r)) = x.lines().zip(y.lines()).find(|(l, r)| l != r) {
            return format!("{l} | {r}");
        }
        if x.lines().count() != y.lines().count() {
            return format!("{} lines vs {}", x.lines().count(), y.lines().count());
        }
    }
    String::new()
}

/// The family's bodies as Models (through the same WC0 round trip the host
/// replies with, but without the host's audit memo).
fn family_models(bodies: &[Body]) -> Result<Vec<Model>, Refused> {
    family_solids(bodies)?.iter().map(Solid::model).collect()
}


/// G11 output check (`WONKY_BOOLEAN_SHADOW_EXPORT=<dir>`, only with the
/// shadow on). For a Boolean whose general result equals the family's, both
/// results are written under one name: `<stem>.family.step` by the family
/// writers, `<stem>.general.step`, `.general.brep.json` and `.general.stl`
/// (deviation `EXPORT_DEVIATION_MM`) by `model_export`. The report line
/// gets an `export` field: the stem, whether the two STEP files are
/// byte-equal, and each writer's refusal. The OCCT round trip of the written
/// files is an oracle run outside the kernel.
///
/// * **Consumer:** strand G11's acceptance (OCCT round trip and measures of
///   every shadow-agreeing zone) and the routing strands G12-G15, whose
///   outputs these writers become.
/// * **Defect class:** a general-path result that is exact but cannot be
///   written, or is written differently from the family's.
/// * **Deletion:** with the shadow harness.
pub const EXPORT_DEVIATION_MM: f64 = 0.01;
fn export(dir: &std::path::Path, family: &[Body], general: &[Model]) -> String {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let cell = std::env::var("WONKY_BOOLEAN_SHADOW_CELL").unwrap_or_else(|_| "cell".into());
    let stem: String = cell.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    let stem = format!("{stem}-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let path = |suffix: &str| dir.join(format!("{stem}.{suffix}"));
    let write = |suffix: &str, bytes: &[u8]| -> Result<(), Refused> {
        std::fs::create_dir_all(dir).and_then(|_| std::fs::write(path(suffix), bytes)).map_err(|e| Refused(format!("shadow/export-io:{e}")))
    };
    let ids = |n: usize| (0..n).map(|i| format!("result/{i}")).collect::<Vec<_>>();
    let family_step = family_solids(family).and_then(|solids| {
        let named: Vec<_> = ids(solids.len()).into_iter().zip(solids).collect();
        analytic::step(&named, "result")
    });
    let named: Vec<(String, &Model)> = ids(general.len()).into_iter().zip(general.iter()).collect();
    let general_step = crate::model_export::step(&named, "result");
    let status = |r: &Result<(), Refused>| match r {
        Ok(()) => "\"written\"".to_string(),
        Err(e) => json(&e.0),
    };
    let f = family_step.as_ref().map_err(|e| e.clone()).and_then(|s| write("family.step", s.as_bytes()));
    let g = general_step.as_ref().map_err(|e| e.clone()).and_then(|s| {
        write("general.step", s.as_bytes())?;
        write("general.brep.json", crate::model_export::summary_json(&named)?.as_bytes())
    });
    let stl = general
        .iter()
        .map(|m| crate::model_export::tessellate(m, EXPORT_DEVIATION_MM))
        .collect::<Result<Vec<_>, _>>()
        .and_then(|meshes| {
            let triangles: usize = meshes.iter().map(|m| m.triangles.len()).sum();
            write("general.stl", &crate::mesh::binary_stl(&meshes, EXPORT_DEVIATION_MM)?)?;
            Ok(triangles)
        });
    let equal = matches!((&family_step, &general_step), (Ok(a), Ok(b)) if a == b);
    format!(
        ",\"export\":{{\"stem\":{},\"family\":{},\"general\":{},\"stepBytesEqual\":{equal},\"stl\":{}}}",
        json(&stem),
        status(&f),
        status(&g),
        match stl {
            Ok(n) => format!("{{\"triangles\":{n},\"watertight\":true,\"deviationMm\":{EXPORT_DEVIATION_MM}}}"),
            Err(e) => json(&e.0),
        }
    )
}

fn family_solids(bodies: &[Body]) -> Result<Vec<Solid>, Refused> {
    bodies
        .iter()
        .map(|b| {
            let words = wonky_wire::v3::encode(b).map_err(|_| Refused("shadow/family-wire".into()))?;
            let checked = wonky_wire::v3::decode(&words).map_err(|_| Refused("shadow/family-decode".into()))?;
            analytic::audit(&checked)
        })
        .collect()
}
/// One report line for one Boolean.
pub fn line(op: u8, inputs: &[Solid], family: &Result<Vec<Body>, Refused>) -> String {
    let (op_name, op) = match op {
        0 => ("union", Op::Union),
        1 => ("subtraction", Op::Subtraction),
        _ => ("intersection", Op::Intersection),
    };
    let family_json = match family {
        Ok(b) => format!("{{\"status\":\"bodies\",\"count\":{}}}", b.len()),
        Err(e) => format!("{{\"status\":\"refused\",\"code\":{}}}", json(&e.0)),
    };
    let operands: Result<Vec<Model>, Refused> = inputs.iter().map(Solid::model).collect();
    let mut detail = String::new();
    let (general_json, verdict, diff) = match operands {
        Err(e) => (
            format!("{{\"status\":\"not-run\",\"code\":{}}}", json(&e.0)),
            "not-comparable",
            String::new(),
        ),
        Ok(models) => {
            let refs: Vec<&Model> = models.iter().collect();
            let general = match refs.as_slice() {
                [one] => Ok(vec![(*one).clone()]),
                _ => wonky_bool::fold_models(op, &refs, 0),
            };
            let general_json = match &general {
                Ok(m) => format!("{{\"status\":\"bodies\",\"count\":{}}}", m.len()),
                Err(e) => format!("{{\"status\":\"refused\",\"code\":{}}}", json(e.0)),
            };
            let (verdict, diff) = match (family, &general) {
                (Ok(bodies), Ok(solids)) => match family_models(bodies) {
                    Err(e) => ("not-comparable", format!("result comparison: {}", e.0)),
                    Ok(fm) => {
                        let target = &models[0].draft().placement;
                        let forms = |ms: &[Model]| -> Result<Vec<String>, Refused> {
                            let mut v = ms
                                .iter()
                                .map(|m| {
                                    m.canonical_in(target)
                                        .map(|c| c.to_string())
                                        .map_err(|e| Refused(e.0.into()))
                                })
                                .collect::<Result<Vec<_>, _>>()?;
                            v.sort();
                            Ok(v)
                        };
                        match forms(&fm).and_then(|f| Ok((f, forms(solids)?))) {
                            Err(e) => ("not-comparable", format!("result comparison: {}", e.0)),
                            Ok((f, g)) => {
                                let measure = measure_detail(&fm, solids, target);
                                match measure {
                                    Err(e) => {
                                        // The canonical forms were compared; say so.
                                        detail = format!(",\"same_form\":{}", f == g);
                                        if f != g {
                                            detail.push_str(&format!(",\"first_difference\":{}", json(&first_difference(&f, &g))));
                                        }
                                        ("not-comparable", format!("measure comparison: {}", e.0))
                                    }
                                    Ok((equal_measure, measures)) => {
                                        detail = measures;
                                        if f == g && equal_measure {
                                            ("equal", String::new())
                                        } else {
                                            if f != g {
                                                detail
                                                    .push_str(&differ_detail(&fm, solids, target));
                                            }
                                            (
                                                "differ",
                                                if f == g {
                                                    "exact Green measure differs".into()
                                                } else {
                                                    first_difference(&f, &g)
                                                },
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                (Ok(_), Err(e)) => ("differ", format!("general refuses {}", e.0)),
                (Err(f), Err(g)) => match (fs_category(&f.0), fs_category(g.0)) {
                    (Some(a), Some(b)) if a == b => ("equal", String::new()),
                    (None, None) => ("both-refuse", String::new()),
                    _ => ("differ", format!("{} vs {}", f.0, g.0)),
                },
                (Err(f), Ok(_)) => match fs_category(&f.0) {
                    Some(c) => ("differ", format!("family refuses {c}, general builds")),
                    None => ("general-builds", String::new()),
                },
            };
            if verdict == "equal" {
                if let (Ok(bodies), Ok(solids), Some(dir)) = (family, &general, std::env::var_os("WONKY_BOOLEAN_SHADOW_EXPORT")) {
                    detail.push_str(&export(std::path::Path::new(&dir), bodies, solids));
                }
            }
            (general_json, verdict, diff)
        }
    };
    let cell = std::env::var("WONKY_BOOLEAN_SHADOW_CELL")
        .map(|c| json(&c))
        .unwrap_or_else(|_| "null".into());
    format!(
        "{{\"cell\":{cell},\"op\":\"{op_name}\",\"operands\":{},\"family\":{family_json},\"general\":{general_json}{detail},\"verdict\":\"{verdict}\",\"diff\":{}}}",
        inputs.len(),
        json(&diff)
    )
}

/// Runs the shadow for one family Boolean and appends its report line. A
/// panic on the general path is caught and reported as its own verdict.
pub fn observe(op: u8, inputs: &[Solid], family: &Result<Vec<Body>, Refused>) {
    let text = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| line(op, inputs, family)))
        .unwrap_or_else(|_| {
            format!(
                "{{\"cell\":null,\"op\":{op},\"operands\":{},\"verdict\":\"panic\"}}",
                inputs.len()
            )
        });
    let path = std::env::var_os("WONKY_BOOLEAN_SHADOW_REPORT");
    // stderr's Write API returns an error instead of eprintln!'s panic.
    let _ = report(
        &text,
        path.as_deref().map(std::path::Path::new),
        &mut std::io::stderr().lock(),
    );
}

/// Preserve the report on a failed file sink, with a visible diagnostic.
/// Returning the fallback's error also permits callers/tests to detect a
/// failure of both sinks without changing the family's geometry reply.
fn report(
    text: &str,
    path: Option<&std::path::Path>,
    fallback: &mut impl Write,
) -> std::io::Result<()> {
    if let Some(path) = path {
        let result = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut file| writeln!(file, "{text}"));
        return finish_report(text, path, result, fallback);
    }
    writeln!(fallback, "wonky-boolean-shadow {text}")
}

fn finish_report(
    text: &str,
    path: &std::path::Path,
    result: std::io::Result<()>,
    fallback: &mut impl Write,
) -> std::io::Result<()> {
    match result {
        Ok(()) => return Ok(()),
        Err(error) => writeln!(
            fallback,
            "wonky-boolean-shadow report I/O error at {}: {error}; falling back to stderr",
            path.display()
        )?,
    }
    writeln!(fallback, "wonky-boolean-shadow {text}")
}

/// PLANTED NEGATIVE (wrong on purpose): the shadow normalizes the family's
/// bodies in place before comparing them, reversing each shell's face
/// order. The bodies are the host's reply, so the reply changes.
#[cfg(feature = "plant_shadow_mutates")]
pub fn observe_mut(op: u8, inputs: &[Solid], family: &mut Result<Vec<Body>, Refused>) {
    if let Ok(bodies) = family {
        for body in bodies.iter_mut() {
            for shell in &mut body.shells {
                shell.faces.reverse();
            }
        }
    }
    observe(op, inputs, family);
}

#[cfg(test)]
mod tests {
    use super::*;
    use wonky_contract::BodyKey;
    use wonky_geom::{frame::Frame, point, Q};

    #[test]
    fn failed_report_open_preserves_the_line_and_explains_the_fallback() {
        let path = std::env::temp_dir().join(format!(
            "wonky-shadow-missing-{}/report.jsonl",
            std::process::id()
        ));
        assert!(!path.parent().unwrap().exists());
        let mut fallback = Vec::new();
        report("{\"verdict\":\"equal\"}", Some(&path), &mut fallback).unwrap();
        let text = String::from_utf8(fallback).unwrap();
        assert!(text.contains("report I/O error"));
        assert!(text.contains(&path.display().to_string()));
        assert!(text.ends_with("wonky-boolean-shadow {\"verdict\":\"equal\"}\n"));
    }

    #[test]
    fn failed_report_write_preserves_the_line_and_explains_the_fallback() {
        let path = std::env::temp_dir().join(format!("wonky-shadow-write-{}", std::process::id()));
        std::fs::write(&path, "").unwrap();
        let mut read_only = std::fs::File::open(&path).unwrap();
        let text = "{\"verdict\":\"equal\"}";
        let failed_write = writeln!(read_only, "{text}");
        assert!(failed_write.is_err());
        let mut fallback = Vec::new();
        finish_report(text, &path, failed_write, &mut fallback).unwrap();
        std::fs::remove_file(path).unwrap();
        let text = String::from_utf8(fallback).unwrap();
        assert!(text.contains("report I/O error"));
        assert!(text.ends_with("wonky-boolean-shadow {\"verdict\":\"equal\"}\n"));
    }

    #[test]
    fn failed_fallback_returns_an_error_without_panicking() {
        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        assert!(report("report", None, &mut Broken).is_err());
        assert!(report(
            "report",
            Some(std::path::Path::new("/no-such-directory/report")),
            &mut Broken
        )
        .is_err());
    }

    fn box_model(lo: [f64; 3], hi: [f64; 3]) -> Model {
        let b = crate::orthogonal::cuboid(
            BodyKey {
                id: [1, 2, 3, 4],
                revision: 0,
            },
            lo,
            hi,
        )
        .unwrap();
        family_models(&[b]).unwrap().remove(0)
    }
    #[test]
    fn world_comparison_handles_reflection_affine_scale_and_sub_ulp_placements() {
        let base = box_model([0.; 3], [1., 2., 3.]);
        let mut d = base.clone().into_draft();
        d.placement = Frame::new(
            point([0.; 3]).unwrap(),
            [
                point([-1., 0., 0.]).unwrap(),
                point([0., 1., 0.]).unwrap(),
                point([0., 0., 1.]).unwrap(),
            ],
        )
        .unwrap();
        let reflected = world_model(&d.check().unwrap()).unwrap();
        assert_eq!(
            reflected.canonical(),
            box_model([-1., 0., 0.], [0., 2., 3.]).canonical()
        );
        assert_eq!(reflected.volume6().unwrap(), base.volume6().unwrap());
        let mut d = base.clone().into_draft();
        d.placement = Frame::new(
            point([0.; 3]).unwrap(),
            [
                point([2., 0., 0.]).unwrap(),
                point([1., 3., 0.]).unwrap(),
                point([0., 0., 1.]).unwrap(),
            ],
        )
        .unwrap();
        let sheared = world_model(&d.check().unwrap()).unwrap();
        assert_eq!(
            sheared.volume6().unwrap()[0],
            &base.volume6().unwrap()[0] * Q::from_integer(6.into())
        );
        let mut d = base.clone().into_draft();
        let tiny = Q::new(1.into(), (1u128 << 100).into());
        d.placement = Frame::new(
            [tiny, Q::from_integer(0.into()), Q::from_integer(0.into())],
            Frame::identity().columns().clone(),
        )
        .unwrap();
        let shifted = d.check().unwrap();
        assert_eq!(
            shifted.canonical(),
            base.canonical(),
            "local canonical forms cannot see placement"
        );
        assert_ne!(
            world_model(&shifted).unwrap().canonical(),
            world_model(&base).unwrap().canonical()
        );
    }
}
