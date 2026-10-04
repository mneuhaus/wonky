use super::part21::{arg, Document, Value};
use super::*;
use std::collections::BTreeSet;
fn id(v: &Value) -> Result<u32> {
    v.reference()
}
fn ids(v: &Value) -> Result<Vec<u32>> {
    v.list()?.iter().map(id).collect()
}
fn scalar(v: &Value, d: &mut ImportDraft) -> Result<Q> {
    if let Value::Number(s) = v {
        d.numeric(s)
    } else {
        Err(Error::new("import/number-invalid"))
    }
}
fn vector(doc: &Document, id: u32, kind: &str, d: &mut ImportDraft, scale: bool) -> Result<Point> {
    let a = doc.component(id, kind)?;
    let list = arg(a, 1)?.list()?;
    if list.len() != 3 {
        return Err(Error::new("import/dimension-unsupported"));
    }
    let mut p = [q(0), q(0), q(0)];
    for i in 0..3 {
        p[i] = scalar(&list[i], d)?;
        if scale {
            p[i] *= &d.state.unit_to_mm;
            if p[i].abs() > binary64(f64::MAX)? {
                return Err(Error::new("import/coordinate-range"));
            }
        }
    }
    Ok(p)
}
fn enum_name(v: &Value) -> Result<&str> {
    if let Value::Enum(s) = v {
        Ok(s)
    } else {
        Err(Error::new("import/unit-unsupported"))
    }
}
pub(super) fn unit(
    doc: &Document,
    id: u32,
    seen: &mut BTreeSet<u32>,
    depth: usize,
    limits: Limits,
) -> Result<Q> {
    if depth > limits.depth {
        return Err(Error::new("import/depth-limit"));
    }
    if !seen.insert(id) {
        return Err(Error::new("import/unit-cycle"));
    }
    let entity = doc
        .entities
        .get(&id)
        .ok_or_else(|| Error::new("import/missing-id"))?;
    let result = if let Some((_, a)) = entity.components.iter().find(|(n, _)| n == "SI_UNIT") {
        if enum_name(arg(a, 1)?)? != "METRE" {
            return Err(Error::new("import/unit-unsupported"));
        }
        match arg(a, 0)? {
            Value::Null => q(1000),
            Value::Enum(p) => match p.as_str() {
                prefix => {
                    let exponent = match prefix {
                        "YOTTA" => 24,
                        "ZETTA" => 21,
                        "EXA" => 18,
                        "PETA" => 15,
                        "TERA" => 12,
                        "GIGA" => 9,
                        "MEGA" => 6,
                        "KILO" => 3,
                        "HECTO" => 2,
                        "DECA" => 1,
                        "DECI" => -1,
                        "CENTI" => -2,
                        "MILLI" => -3,
                        "MICRO" => -6,
                        "NANO" => -9,
                        "PICO" => -12,
                        "FEMTO" => -15,
                        "ATTO" => -18,
                        "ZEPTO" => -21,
                        "YOCTO" => -24,
                        _ => return Err(Error::new("import/unit-unsupported")),
                    };
                    q(10).pow(exponent + 3)
                }
            },
            _ => return Err(Error::new("import/unit-unsupported")),
        }
    } else {
        let a = doc.component(id, "CONVERSION_BASED_UNIT")?;
        let Value::String(name) = arg(a, 0)? else {
            return Err(Error::new("import/unit-unsupported"));
        };
        if !name.eq_ignore_ascii_case("inch") {
            return Err(Error::new("import/unit-unsupported"));
        }
        let named = doc.component(id, "NAMED_UNIT")?;
        let dimension = doc.component(id_of(arg(named, 0)?)?, "DIMENSIONAL_EXPONENTS")?;
        if dimension.len() != 7 {
            return Err(Error::new("import/unit-dimension"));
        }
        for (i, v) in dimension.iter().enumerate() {
            let Value::Number(s) = v else {
                return Err(Error::new("import/unit-dimension"));
            };
            if decimal_ratio(s)? != q(i64::from(i == 0)) {
                return Err(Error::new("import/unit-dimension"));
            }
        }
        let m = doc.component(id_of(arg(a, 1)?)?, "LENGTH_MEASURE_WITH_UNIT")?;
        let base = unit(doc, id_of(arg(m, 1)?)?, seen, depth + 1, limits)?;
        let Value::Typed(t, v) = arg(m, 0)? else {
            return Err(Error::new("import/unit-unsupported"));
        };
        if t != "LENGTH_MEASURE" || v.len() != 1 {
            return Err(Error::new("import/unit-unsupported"));
        }
        let Value::Number(n) = &v[0] else {
            return Err(Error::new("import/unit-unsupported"));
        };
        // Conversion definitions are exact decimal unit ratios, not coordinates.
        if decimal_ratio(n)? * base != Q::new(127.into(), 5.into()) {
            return Err(Error::new("import/unit-conflict"));
        }
        Q::new(127.into(), 5.into())
    };
    seen.remove(&id);
    Ok(result)
}
fn id_of(v: &Value) -> Result<u32> {
    id(v)
}
pub(super) fn decimal_ratio(s: &str) -> Result<Q> {
    if s.len() > 128 {
        return Err(Error::new("import/unit-number-limit"));
    }
    number(s)?;
    let (mant, exp) = s.split_once(['E', 'e']).unwrap_or((s, "0"));
    let exp = exp
        .parse::<i64>()
        .map_err(|_| Error::new("import/unit-unsupported"))?;
    if !(-32..=32).contains(&exp) {
        return Err(Error::new("import/unit-unsupported"));
    }
    let frac = mant.split_once('.').map_or(0, |(_, f)| f.len() as i64);
    let digits = mant.replace('.', "");
    let n = digits
        .parse()
        .map_err(|_| Error::new("import/unit-unsupported"))?;
    let power = exp - frac;
    if power.abs() > 32 {
        return Err(Error::new("import/unit-unsupported"));
    }
    let ten = Q::from_integer(10.into());
    let factor = ten.pow(power.abs() as i32);
    Ok(if power >= 0 {
        Q::from_integer(n) * factor
    } else {
        Q::from_integer(n) / factor
    })
}
pub(super) fn decode(bytes: &[u8], source: Source, limits: Limits) -> Result<ImportDraft> {
    let mut d = ImportDraft::new(bytes, source, limits, Decoder::Part21)?;
    let doc = Document::parse(bytes, limits)?;
    d.state.source_entity_ids = doc.entities.keys().map(|n| format!("#{n}")).collect();
    let reps = doc
        .entities
        .iter()
        .filter_map(|(id, e)| {
            e.components
                .iter()
                .find(|(n, _)| {
                    matches!(
                        n.as_str(),
                        "ADVANCED_BREP_SHAPE_REPRESENTATION"
                            | "SHAPE_REPRESENTATION"
                            | "MANIFOLD_SURFACE_SHAPE_REPRESENTATION"
                    )
                })
                .map(|(_, a)| (*id, a))
        })
        .collect::<Vec<_>>();
    if reps.len() != 1 {
        return Err(Error::new(if reps.is_empty() {
            "import/missing-unit"
        } else {
            "import/representation-selection-unavailable"
        }));
    }
    let (_, rep) = reps[0];
    let context = id(arg(rep, 2)?)?;
    let geometry = doc.component(context, "GEOMETRIC_REPRESENTATION_CONTEXT")?;
    if !matches!(arg(geometry,0)?,Value::Number(n) if n=="3") {
        return Err(Error::new("import/dimension-unsupported"));
    }
    let units = doc
        .component(context, "GLOBAL_UNIT_ASSIGNED_CONTEXT")
        .map_err(|_| Error::new("import/missing-unit"))?;
    let lengths = ids(arg(units, 0)?)?
        .into_iter()
        .filter(|n| {
            doc.entities[n]
                .components
                .iter()
                .any(|(t, _)| t == "LENGTH_UNIT")
        })
        .collect::<Vec<_>>();
    if lengths.len() != 1 {
        return Err(Error::new(if lengths.is_empty() {
            "import/missing-unit"
        } else {
            "import/unit-conflict"
        }));
    }
    d.state.unit_to_mm = unit(&doc, lengths[0], &mut BTreeSet::new(), 0, limits)?;
    if let Ok(a) = doc.component(context, "GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT") {
        let entries = ids(arg(a, 0)?)?;
        if entries.len() != 1 {
            return Err(Error::new("import/uncertainty-unsupported"));
        }
        let a = doc.component(entries[0], "UNCERTAINTY_MEASURE_WITH_UNIT")?;
        let Value::Typed(t, v) = arg(a, 0)? else {
            return Err(Error::new("import/uncertainty-unsupported"));
        };
        if t != "LENGTH_MEASURE" || v.len() != 1 {
            return Err(Error::new("import/uncertainty-unsupported"));
        }
        let scale = unit(&doc, id(arg(a, 1)?)?, &mut BTreeSet::new(), 0, limits)?;
        let mm = scalar(&v[0], &mut d)? * scale;
        if mm < q(0) {
            return Err(Error::new("import/uncertainty-invalid"));
        }
        d.state.uncertainty = Uncertainty::Declared { mm };
    }
    let mut solids = vec![];
    for item in ids(arg(rep, 1)?)? {
        let e = &doc.entities[&item];
        if e.components.iter().any(|(n, _)| n == "MANIFOLD_SOLID_BREP") {
            solids.push(item)
        } else {
            return Err(Error::new(&format!(
                "import/entity-unsupported:{}",
                e.components[0].0
            )));
        }
    }
    if solids.len() != 1 {
        return Err(Error::new("import/solid-selection-unavailable"));
    }
    let solid = doc.component(solids[0], "MANIFOLD_SOLID_BREP")?;
    let shell = doc.component(id(arg(solid, 1)?)?, "CLOSED_SHELL")?;
    let mut vertices = BTreeSet::new();
    let mut edges = BTreeSet::new();
    let mut faces = BTreeSet::new();
    let mut bounds = BTreeSet::new();
    for face_id in ids(arg(shell, 1)?)? {
        if !faces.insert(face_id) {
            return Err(Error::new("import/topology-duplicate-use"));
        }
        let a = doc.component(face_id, "ADVANCED_FACE")?;
        let surface = doc.component(id(arg(a, 2)?)?, "PLANE")?;
        let placement = doc.component(id(arg(surface, 1)?)?, "AXIS2_PLACEMENT_3D")?;
        let o = vector(
            &doc,
            id(arg(placement, 1)?)?,
            "CARTESIAN_POINT",
            &mut d,
            true,
        )?;
        let n = match arg(placement, 2)? {
            Value::Null => [q(0), q(0), q(1)],
            v => vector(&doc, id(v)?, "DIRECTION", &mut d, false)?,
        };
        let x = match arg(placement, 3)? {
            Value::Null => None,
            v => Some(vector(&doc, id(v)?, "DIRECTION", &mut d, false)?),
        };
        let plane = plane(o, n, x)?;
        let mut loops = vec![];
        for bound_id in ids(arg(a, 1)?)? {
            if !bounds.insert(bound_id) {
                return Err(Error::new("import/topology-duplicate-use"));
            }
            let entity = &doc.entities[&bound_id];
            let outer = entity
                .components
                .iter()
                .any(|(n, _)| n == "FACE_OUTER_BOUND");
            let bound = doc.component(
                bound_id,
                if outer {
                    "FACE_OUTER_BOUND"
                } else {
                    "FACE_BOUND"
                },
            )?;
            let lp = doc.component(id(arg(bound, 1)?)?, "EDGE_LOOP")?;
            let mut uses = vec![];
            for oriented in ids(arg(lp, 1)?)? {
                let use_ = doc.component(oriented, "ORIENTED_EDGE")?;
                if !matches!(arg(use_, 1)?, Value::Derived)
                    || !matches!(arg(use_, 2)?, Value::Derived)
                {
                    return Err(Error::new("import/oriented-edge-invalid"));
                }
                let edge_id = id(arg(use_, 3)?)?;
                let forward = arg(use_, 4)?.boolean()?;
                if edges.insert(edge_id) {
                    let edge = doc.component(edge_id, "EDGE_CURVE")?;
                    let ends = [id(arg(edge, 1)?)?, id(arg(edge, 2)?)?];
                    for v in ends {
                        if vertices.insert(v) {
                            let a = doc.component(v, "VERTEX_POINT")?;
                            let p = vector(&doc, id(arg(a, 1)?)?, "CARTESIAN_POINT", &mut d, true)?;
                            d.vertices.push(InputVertex {
                                id: format!("#{v}"),
                                point: p,
                            });
                        }
                    }
                    let line = doc.component(id(arg(edge, 3)?)?, "LINE")?;
                    let p = vector(&doc, id(arg(line, 1)?)?, "CARTESIAN_POINT", &mut d, true)?;
                    let v = doc.component(id(arg(line, 2)?)?, "VECTOR")?;
                    let direction = vector(&doc, id(arg(v, 1)?)?, "DIRECTION", &mut d, false)?;
                    // LINE carrier is invariant under positive VECTOR magnitude;
                    // unit normalization is unnecessary for exact incidence.
                    let magnitude = scalar(arg(v, 2)?, &mut d)?;
                    if magnitude <= q(0) {
                        return Err(Error::new("import/vector-magnitude"));
                    }
                    d.edges.push(InputEdge {
                        id: format!("#{edge_id}"),
                        vertices: ends.map(|v| format!("#{v}")),
                        p,
                        d: direction,
                        same_sense: arg(edge, 4)?.boolean()?,
                    });
                }
                uses.push((format!("#{edge_id}"), forward));
            }
            if !arg(bound, 2)?.boolean()? {
                uses.reverse();
                for (_, f) in &mut uses {
                    *f = !*f;
                }
            }
            loops.push(InputLoop {
                id: format!("#{bound_id}"),
                outer,
                uses,
            });
        }
        d.faces.push(InputFace {
            id: format!("#{face_id}"),
            plane,
            forward: arg(a, 3)?.boolean()?,
            loops,
        });
    }
    Ok(d)
}
