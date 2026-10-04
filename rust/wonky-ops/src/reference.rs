//! Normal body reports for imported references. OCCT is never on this path.
use wonky_geom::{
    import::{
        reference::{Carrier, ReferenceDraft},
        source_digest, Limits, Source, Uncertainty,
    },
    Q,
};
fn quote(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
fn lower(q: &Q) -> Result<f64, String> {
    wonky_curve::numeric::enclose(q)
        .map(|v| v.lo())
        .map_err(|e| format!("import/report:{}", e.name()))
}
fn upper(q: &Q) -> Result<f64, String> {
    wonky_curve::numeric::enclose(q)
        .map(|v| v.hi())
        .map_err(|e| format!("import/report:{}", e.name()))
}
pub fn import_json(bytes: &[u8]) -> Result<String, String> {
    let digest = source_digest(bytes);
    let draft = ReferenceDraft::step(
        bytes,
        Source {
            digest,
            revision: None,
            instance_path: vec![],
        },
        Limits::default(),
    )
    .map_err(|e| e.name)?;
    let precision = Q::new(1.into(), 100000.into());
    let admitted = draft.admit_reference(&precision).map_err(|e| e.name)?;
    let digest = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let mut reports = Vec::new();
    for reference in admitted {
        let b = reference.source();
        let uncertainty = match &b.uncertainty {
            Uncertainty::Declared { mm } => format!(
                "{{\"status\":\"producer-declared\",\"mm\":{},\"rationalMm\":{}}}",
                upper(mm)?,
                quote(&mm.to_string())
            ),
            Uncertainty::Unknown => "{\"status\":\"unknown\"}".into(),
        };
        let lo = reference
            .bounds
            .iter()
            .map(|b| lower(&b.lower_mm).map(|v| v.to_string()))
            .collect::<Result<Vec<_>, _>>()?
            .join(",");
        let hi = reference
            .bounds
            .iter()
            .map(|b| upper(&b.upper_mm).map(|v| v.to_string()))
            .collect::<Result<Vec<_>, _>>()?
            .join(",");
        let mut census = std::collections::BTreeMap::<&str, usize>::new();
        let mut faces = Vec::new();
        for f in &reference.face_bounds {
            let source = b.faces.iter().find(|s| s.id == f.source_face).unwrap();
            let kind = match &b.surfaces[&source.surface] {
                Carrier::Spline(..) => "B_SPLINE_SURFACE_WITH_KNOTS",
                Carrier::Plane(_) => "PLANE",
                Carrier::Cylinder(..) => "CYLINDRICAL_SURFACE",
                Carrier::Cone(..) => "CONICAL_SURFACE",
                Carrier::Sphere(..) => "SPHERICAL_SURFACE",
                Carrier::Torus(..) => "TOROIDAL_SURFACE",
            };
            *census.entry(kind).or_default() += 1;
            let coords = f
                .coordinates
                .iter()
                .map(|c| Ok(format!("[{},{}]", lower(&c.lower_mm)?, upper(&c.upper_mm)?)))
                .collect::<Result<Vec<_>, String>>()?
                .join(",");
            let slack = f
                .slack_mm
                .iter()
                .map(|s| upper(s).map(|v| v.to_string()))
                .collect::<Result<Vec<_>, _>>()?
                .join(",");
            faces.push(format!("{{\"id\":{},\"label\":{},\"entityType\":{},\"outcome\":\"bounded-enclosure\",\"method\":{},\"boundsMm\":[{}],\"slackUpperMm\":[{}]}}",f.source_face,quote(&source.name),quote(kind),quote(f.method),coords,slack));
        }
        let census = census
            .into_iter()
            .map(|(k, n)| {
                format!(
                    "{}:{{\"boundedExactly\":0,\"boundedEnclosure\":{},\"refused\":0}}",
                    quote(k),
                    n
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        reports.push(format!("{{\"id\":{},\"name\":{},\"geometry\":\"imported-reference\",\"geometryClass\":\"reference\",\"exact\":false,\"labels\":[\"Imported reference\"],\"uncertainty\":{},\"provenance\":{{\"decoder\":\"Part21\",\"sha256\":{},\"representation\":{},\"instancePath\":{:?}}},\"topology\":{{\"faces\":{},\"edges\":{},\"vertices\":{},\"loops\":{},\"shells\":1}},\"volumeMm3\":null,\"areaMm2\":null,\"bboxMm\":{{\"min\":[{}],\"max\":[{}]}},\"exactness\":{{\"bbox\":\"certified-enclosure\",\"area\":\"not-evaluated\",\"volume\":\"not-evaluated\"}},\"closed\":null,\"faceCensus\":{{{}}},\"faceBounds\":[{}]}}",
            b.id,quote(&b.name),uncertainty,quote(&digest),b.representation,b.instance_path,b.faces.len(),b.edges.len(),b.vertices.len(),b.faces.iter().map(|f|f.loops.len()).sum::<usize>(),lo,hi,census,faces.join(",")));
    }
    Ok(format!("[{}]", reports.join(",")))
}

/// Display observations only: certified shared edge polylines and retained
/// carrier data. This has no route to WC0 or modelling operations.
pub fn display_source_json(bytes: &[u8], deviation: f64) -> Result<String, String> {
    use num_traits::ToPrimitive;
    use wonky_geom::import::reference::Axis;
    fn scalar(q: &Q) -> Result<String, String> {
        let v = q.to_f64().ok_or("import/display-number-range")?;
        if !v.is_finite() { return Err("import/display-number-range".into()); }
        Ok(v.to_string())
    }
    fn list(q: &[Q]) -> Result<String, String> {
        Ok(format!("[{}]", q.iter().map(scalar).collect::<Result<Vec<_>,_>>()?.join(",")))
    }
    fn frame(a: &Axis) -> Result<String, String> {
        let (f, error) = a.enclosed_frame().map_err(|e| e.name)?;
        Ok(format!("{{\"origin\":{},\"columns\":[{}],\"errorMm\":{}}}", list(f.origin())?,
            f.columns().iter().map(|p| list(p)).collect::<Result<Vec<_>,_>>()?.join(","), scalar(&error)?))
    }
    if !deviation.is_finite() || deviation <= 0. { return Err("import/display-budget-invalid".into()); }
    let draft = ReferenceDraft::step(bytes, Source { digest: source_digest(bytes), revision: None, instance_path: vec![] }, Limits::default()).map_err(|e|e.name)?;
    draft.check_topology().map_err(|e|e.name)?;
    let budget = wonky_geom::binary64(deviation / 32.).map_err(|e|e.0.to_string())?;
    let mut bodies = vec![];
    for b in draft.bodies {
        let mut carriers=vec![];
        for (id,c) in &b.surfaces {
            let (kind,params)=match c {
                Carrier::Plane(_) => ("plane", vec![]), Carrier::Cylinder(_,r)=>("cylinder",vec![r.clone()]),
                Carrier::Cone(_,r,a)=>("cone",vec![r.clone(),a.clone()]), Carrier::Sphere(_,r)=>("sphere",vec![r.clone()]),
                Carrier::Torus(_,r,s)=>("torus",vec![r.clone(),s.clone()]), Carrier::Spline(..)=>("spline",vec![])
            };
            let spline=if let Carrier::Spline(_,s)=c {
                let rows=s.points.iter().map(|r| Ok(format!("[{}]",r.iter().map(|p|list(p)).collect::<Result<Vec<_>,String>>()?.join(",")))).collect::<Result<Vec<_>,String>>()?;
                let weights=s.weights.iter().map(|r|list(r)).collect::<Result<Vec<_>,_>>()?;
                format!(",\"degrees\":{:?},\"knots\":[{},{}],\"points\":[{}],\"weights\":[{}]",s.degrees,list(&s.knots[0])?,list(&s.knots[1])?,rows.join(","),weights.join(","))
            } else { String::new() };
            carriers.push(format!("{{\"id\":{},\"kind\":{},\"frame\":{},\"parameters\":{}{} }}",id,quote(kind),frame(c.axis())?,list(&params)?,spline));
        }
        let mut edges=vec![];
        for (id,e) in &b.edges {
            let poly=b.edge_polyline(*id,&budget).map_err(|e|e.name)?;
            let samples=poly.samples.iter().map(|s|list(&s.source_point_mm)).collect::<Result<Vec<_>,_>>()?;
            edges.push(format!("{{\"id\":{},\"vertices\":{:?},\"closed\":{},\"points\":[{}]}}",id,e.vertices,poly.closed,samples.join(",")));
        }
        let faces=b.faces.iter().map(|f|{
            let loops=f.loops.iter().map(|l|format!("{{\"outer\":{},\"uses\":[{}]}}",l.outer,l.uses.iter().map(|(id,fw)|format!("[{},{}]",id,fw)).collect::<Vec<_>>().join(","))).collect::<Vec<_>>().join(",");
            format!("{{\"id\":{},\"surface\":{},\"sameSense\":{},\"loops\":[{}]}}",f.id,f.surface,f.same_sense,loops)
        }).collect::<Vec<_>>().join(",");
        let placements=b.placements.iter().map(|(from,to)|Ok(format!("[{},{}]",frame(from)?,frame(to)?))).collect::<Result<Vec<_>,String>>()?.join(",");
        let vertices=b.vertices.iter().map(|(id,p)|Ok(format!("[{},{}]",id,list(p)?))).collect::<Result<Vec<_>,String>>()?.join(",");
        let uncertainty=match &b.uncertainty { Uncertainty::Declared{mm}=>scalar(mm)?, Uncertainty::Unknown=>return Err("import/source-tolerance-missing".into()) };
        // The original source is admitted by referenceStepJson before display.
        // Preserve placements separately so UV inversion uses construction coordinates.
        bodies.push(format!("{{\"id\":{},\"unitToMm\":{},\"uncertaintyMm\":{},\"vertices\":[{}],\"carriers\":[{}],\"edges\":[{}],\"faces\":[{}],\"placements\":[{}]}}",b.id,scalar(&b.unit_to_mm)?,uncertainty,vertices,carriers.join(","),edges.join(","),faces,placements));
    }
    Ok(format!("[{}]",bodies.join(",")))
}

/// Independently check display observations against retained exact carriers.
/// Rows: body-id surface-id u v source-x source-y source-z. These observations
/// never decide reference admission or source topology.
pub fn check_display_points(bytes: &[u8], rows: &str, deviation: f64) -> Result<String,String> {
    use wonky_geom::import::reference::HomogeneousSpan;
    use wonky_alg::Polynomial as Poly;
    use num_traits::Signed;
    let mut draft=ReferenceDraft::step(bytes, Source{digest:source_digest(bytes),revision:None,instance_path:vec![]},Limits::default()).map_err(|e|e.name)?;
    let budget=wonky_geom::binary64(deviation).map_err(|e|e.0.to_string())?;
    if budget<=Q::from_integer(0.into()) {return Err("import/mesh/budget-invalid".into());}
    for b in &mut draft.bodies {b.placements.clear();}
    let mut count=0;
    let mut batches=std::collections::BTreeMap::<(u32,u32),Vec<HomogeneousSpan>>::new();
    for row in rows.lines() {
        let fields=row.split_whitespace().collect::<Vec<_>>();
        if fields.len()!=7 {return Err("import/mesh/check-row-invalid".into());}
        let id=fields[0].parse::<u32>().map_err(|_|"import/mesh/check-id-invalid")?;
        let surface=fields[1].parse::<u32>().map_err(|_|"import/mesh/check-id-invalid")?;
        let qs=fields[2..].iter().map(|s|s.parse::<f64>().map_err(|_|"import/mesh/check-number-invalid".to_string()).and_then(|f|wonky_geom::binary64(f).map_err(|e|e.0.to_string()))).collect::<Result<Vec<_>,_>>()?;
        let b=draft.bodies.iter().find(|b|b.id==id).ok_or("import/mesh/check-body-missing")?;
        let c=b.surfaces.get(&surface).ok_or("import/mesh/check-carrier-missing")?;
        if matches!(c,Carrier::Spline(..)) {
            let bounds=b.carrier_point_bounds(surface,[qs[0].clone(),qs[1].clone()],&(&budget/Q::from_integer(64.into()))).map_err(|e|e.name)?;
            let squared=(0..3).map(|i|{
                let a=(&qs[i+2]-&bounds[i].lower_mm).abs();let z=(&qs[i+2]-&bounds[i].upper_mm).abs();a.clone().max(z).pow(2)
            }).sum::<Q>();
            if squared> &budget*&budget {return Err("import/mesh/vertex-off-exact-spline".into());}
        }else {
            let span=HomogeneousSpan{a:Q::from_integer(0.into()),b:Q::from_integer(1.into()),coordinates:qs[2..].iter().cloned().chain(std::iter::once(Q::from_integer(1.into()))).map(|q|Poly::new(vec![q]).map_err(|e|format!("import/mesh/point-polynomial:{e:?}"))).collect::<Result<Vec<_>,String>>()?,chart_error_mm:Q::from_integer(0.into())};
            batches.entry((id,surface)).or_default().push(span);
        }
        count+=1;
    }
    for ((id,surface),spans) in batches {
        let b=draft.bodies.iter().find(|b|b.id==id).unwrap();
        b.surfaces[&surface].certify_spans(&spans,&budget).map_err(|e|e.name)?;
    }
    if count==0 {return Err("import/mesh/check-empty".into());}
    Ok(format!("{{\"exactCarrierChecks\":{},\"deviationMm\":{}}}",count,deviation))
}

/// Same constrained Delaunay legalizer as exact planar export. The chart
/// metric multiplies binary64 observations as rationals, without rounding a
/// sign decision. Only diagonals change; no source geometry is constructed.
pub fn legalize_display_rows(rows: &str) -> Result<String,String> {
    use crate::mesh_triangulate::{delaunay_flips,PlanarPoint};
    use wonky_num::Sign;
    use std::collections::BTreeSet;
    let bad=||"import/mesh/chart-row-invalid".to_string();
    let number=|s:&str|s.parse::<f64>().map_err(|_|bad()).and_then(|v|wonky_geom::binary64(v).map_err(|_|bad()));
    let index=|s:&str|s.parse::<usize>().map_err(|_|bad());
    let mut metric=None;let mut points=Vec::<[Q;2]>::new();let mut triangles=Vec::<[usize;3]>::new();let mut edges=BTreeSet::new();
    for row in rows.lines() {
        let f=row.split_whitespace().collect::<Vec<_>>();
        match f.as_slice() {
            ["metric",a,b] if metric.is_none() => {
                let m=[number(a)?,number(b)?];if m.iter().any(|q|q<=&Q::from_integer(0.into())) {return Err(bad());}metric=Some(m);
            }
            ["p",u,v] => {let m=metric.as_ref().ok_or_else(bad)?;points.push([number(u)?*&m[0],number(v)?*&m[1]]);}
            ["t",a,b,c] => triangles.push([index(a)?,index(b)?,index(c)?]),
            ["e",a,b] => {let (a,b)=(index(a)?,index(b)?);edges.insert((a.min(b),a.max(b)));}
            _ => return Err(bad()),
        }
        if points.len()>8192||triangles.len()>16384||edges.len()>16384 {return Err("import/mesh/chart-resource-limit".into());}
    }
    if points.len()<3||triangles.is_empty()||triangles.iter().flatten().chain(edges.iter().flat_map(|(a,b)|[a,b])).any(|&i|i>=points.len()) {return Err(bad());}
    for t in &mut triangles {
        match <[Q;2] as PlanarPoint>::orientation(&points[t[0]],&points[t[1]],&points[t[2]]).map_err(|e|e.0)? {
            Sign::Negative => t.swap(1,2), Sign::Zero => return Err("import/mesh/zero-chart-triangle".into()), Sign::Positive => {},
        }
    }
    delaunay_flips(&points,&mut triangles,&edges).map_err(|e|e.0)?;
    Ok(format!("[{}]",triangles.iter().map(|t|format!("[{},{},{}]",t[0],t[1],t[2])).collect::<Vec<_>>().join(",")))
}

#[cfg(test)]
mod display_tests {
    use super::*;
    const TETRA: &[u8] = include_bytes!("../../../fixtures/step-reference/tetra-reference.step");
    #[test]
    fn source_display_retains_all_faces_and_refuses_invalid_budget() {
        let json=display_source_json(TETRA,0.02).unwrap();
        assert!(json.contains("\"kind\":\"plane\""));
        assert!(json.contains("\"faces\":["));
        assert_eq!(display_source_json(TETRA,f64::NAN).unwrap_err(),"import/display-budget-invalid");
        assert!(display_source_json(TETRA,0.0).is_err());
    }
    #[test]
    fn empty_or_unknown_point_checks_cannot_certify_a_mesh() {
        assert!(check_display_points(TETRA,"",0.02).is_err());
        assert!(check_display_points(TETRA,"999999 1 0 0 0 0 0",0.02).is_err());
        assert!(check_display_points(TETRA,"NaN",0.02).is_err());
    }
    #[test]
    fn chart_legalization_reuses_exact_diagonal_decisions_and_rejects_bad_indices() {
        let rows="metric 2 1\np 0 0\np 3 0\np 3 1\np 0 2\nt 0 1 3\nt 1 2 3\ne 0 1\ne 1 2\ne 2 3\ne 3 0";
        let result=legalize_display_rows(rows).unwrap();
        assert!(result.contains("[1,2,0]")||result.contains("[0,1,2]")||result.contains("[2,0,1]"));
        assert!(legalize_display_rows("metric 1 1\np 0 0\np 1 0\np 0 1\nt 0 1 99").is_err());
        assert!(legalize_display_rows("metric NaN 1").is_err());
    }
}
