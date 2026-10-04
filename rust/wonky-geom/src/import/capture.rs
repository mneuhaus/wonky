//! Bounded JSON decoder for the frozen Onshape bodydetails records. Metres are
//! part of that API contract; absent tolerance stays Unknown. No repair here.
use super::*;
#[derive(Debug)]
enum Json {
    Null,
    Bool(bool),
    Num(String),
    Str(String),
    Arr(Vec<Json>),
    Obj(BTreeMap<String, Json>),
}
impl Json {
    fn get(&self, key: &str) -> Result<&Self> {
        if let Self::Obj(v) = self {
            v.get(key)
                .ok_or_else(|| Error::new("import/capture-field-missing"))
        } else {
            Err(Error::new("import/capture-shape"))
        }
    }
    fn optional(&self, key: &str) -> Option<&Self> {
        if let Self::Obj(v) = self {
            v.get(key)
        } else {
            None
        }
    }
    fn array(&self) -> Result<&[Self]> {
        if let Self::Arr(v) = self {
            Ok(v)
        } else {
            Err(Error::new("import/capture-shape"))
        }
    }
    fn text(&self) -> Result<&str> {
        if let Self::Str(v) = self {
            Ok(v)
        } else {
            Err(Error::new("import/capture-shape"))
        }
    }
    fn boolean(&self) -> Result<bool> {
        if let Self::Bool(v) = self {
            Ok(*v)
        } else {
            Err(Error::new("import/capture-shape"))
        }
    }
}
struct Reader<'a> {
    bytes: &'a [u8],
    i: usize,
    limits: Limits,
    values: usize,
}
impl Reader<'_> {
    fn ws(&mut self) {
        while self
            .bytes
            .get(self.i)
            .is_some_and(|c| matches!(c, b' ' | b'\r' | b'\n' | b'\t'))
        {
            self.i += 1
        }
    }
    fn eat(&mut self, c: u8) -> Result<()> {
        self.ws();
        if self.bytes.get(self.i) != Some(&c) {
            return Err(Error::new("import/json-syntax"));
        }
        self.i += 1;
        Ok(())
    }
    fn string(&mut self) -> Result<String> {
        self.eat(b'"')?;
        let mut out = String::new();
        loop {
            let c = *self
                .bytes
                .get(self.i)
                .ok_or_else(|| Error::new("import/json-syntax"))?;
            self.i += 1;
            match c {
                b'"' => return Ok(out),
                b'\\' => {
                    let c = *self
                        .bytes
                        .get(self.i)
                        .ok_or_else(|| Error::new("import/json-syntax"))?;
                    self.i += 1;
                    out.push(match c {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let first = self.hex4()?;
                            let value = if (0xD800..=0xDBFF).contains(&first) {
                                if self.bytes.get(self.i..self.i + 2) != Some(b"\\u") {
                                    return Err(Error::new("import/json-syntax"));
                                }
                                self.i += 2;
                                let second = self.hex4()?;
                                if !(0xDC00..=0xDFFF).contains(&second) {
                                    return Err(Error::new("import/json-syntax"));
                                }
                                0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)
                            } else {
                                first
                            };
                            char::from_u32(value).ok_or_else(|| Error::new("import/json-syntax"))?
                        }
                        _ => return Err(Error::new("import/json-syntax")),
                    });
                }
                0..=31 => return Err(Error::new("import/json-syntax")),
                32..=127 => out.push(c as char),
                _ => {
                    let start = self.i - 1;
                    let width = if c < 0xE0 {
                        2
                    } else if c < 0xF0 {
                        3
                    } else {
                        4
                    };
                    let slice = self
                        .bytes
                        .get(start..start + width)
                        .ok_or_else(|| Error::new("import/json-syntax"))?;
                    out.push_str(
                        std::str::from_utf8(slice).map_err(|_| Error::new("import/json-syntax"))?,
                    );
                    self.i = start + width;
                }
            }
        }
    }
    fn hex4(&mut self) -> Result<u32> {
        let s = self
            .bytes
            .get(self.i..self.i + 4)
            .ok_or_else(|| Error::new("import/json-syntax"))?;
        self.i += 4;
        u32::from_str_radix(
            std::str::from_utf8(s).map_err(|_| Error::new("import/json-syntax"))?,
            16,
        )
        .map_err(|_| Error::new("import/json-syntax"))
    }
    fn value(&mut self, depth: usize) -> Result<Json> {
        if depth > self.limits.depth {
            return Err(Error::new("import/depth-limit"));
        }
        self.values += 1;
        if self.values > self.limits.values {
            return Err(Error::new("import/graph-limit"));
        }
        self.ws();
        Ok(match self.bytes.get(self.i) {
            Some(b'"') => Json::Str(self.string()?),
            Some(b'{') => {
                self.i += 1;
                let mut v = BTreeMap::new();
                self.ws();
                if self.bytes.get(self.i) == Some(&b'}') {
                    self.i += 1;
                    return Ok(Json::Obj(v));
                }
                loop {
                    let key = self.string()?;
                    self.eat(b':')?;
                    let item = self.value(depth + 1)?;
                    if v.insert(key, item).is_some() {
                        return Err(Error::new("import/json-duplicate-key"));
                    }
                    self.ws();
                    match self.bytes.get(self.i) {
                        Some(b'}') => {
                            self.i += 1;
                            break;
                        }
                        Some(b',') => self.i += 1,
                        _ => return Err(Error::new("import/json-syntax")),
                    }
                }
                Json::Obj(v)
            }
            Some(b'[') => {
                self.i += 1;
                let mut v = vec![];
                self.ws();
                if self.bytes.get(self.i) == Some(&b']') {
                    self.i += 1;
                    return Ok(Json::Arr(v));
                }
                loop {
                    v.push(self.value(depth + 1)?);
                    self.ws();
                    match self.bytes.get(self.i) {
                        Some(b']') => {
                            self.i += 1;
                            break;
                        }
                        Some(b',') => self.i += 1,
                        _ => return Err(Error::new("import/json-syntax")),
                    }
                }
                Json::Arr(v)
            }
            Some(b't') if self.bytes.get(self.i..self.i + 4) == Some(b"true") => {
                self.i += 4;
                Json::Bool(true)
            }
            Some(b'f') if self.bytes.get(self.i..self.i + 5) == Some(b"false") => {
                self.i += 5;
                Json::Bool(false)
            }
            Some(b'n') if self.bytes.get(self.i..self.i + 4) == Some(b"null") => {
                self.i += 4;
                Json::Null
            }
            Some(c) if c.is_ascii_digit() || *c == b'-' => {
                let start = self.i;
                while self.bytes.get(self.i).is_some_and(|c| {
                    c.is_ascii_digit() || matches!(c, b'+' | b'-' | b'.' | b'e' | b'E')
                }) {
                    self.i += 1
                }
                let s = std::str::from_utf8(&self.bytes[start..self.i]).unwrap();
                number(s)?;
                let unsigned = s.strip_prefix('-').unwrap_or(s);
                if unsigned.starts_with('.')
                    || unsigned.ends_with('.')
                    || unsigned
                        .split_once('.')
                        .is_some_and(|(_, s)| !s.as_bytes().first().is_some_and(u8::is_ascii_digit))
                    || (unsigned.starts_with('0')
                        && unsigned.as_bytes().get(1).is_some_and(u8::is_ascii_digit))
                {
                    return Err(Error::new("import/json-syntax"));
                }
                Json::Num(s.into())
            }
            _ => return Err(Error::new("import/json-syntax")),
        })
    }
}
fn point(j: &Json, d: &mut ImportDraft, scale: bool) -> Result<Point> {
    let a = j.array()?;
    if a.len() != 3 {
        return Err(Error::new("import/dimension-unsupported"));
    }
    let mut out = [q(0), q(0), q(0)];
    for i in 0..3 {
        let Json::Num(s) = &a[i] else {
            return Err(Error::new("import/number-invalid"));
        };
        out[i] = d.numeric(s)?;
        if scale {
            out[i] *= &d.state.unit_to_mm;
            if out[i].abs() > binary64(f64::MAX)? {
                return Err(Error::new("import/coordinate-range"));
            }
        }
    }
    Ok(out)
}
pub(super) fn decode(bytes: &[u8], source: Source, limits: Limits) -> Result<ImportDraft> {
    let mut d = ImportDraft::new(bytes, source, limits, Decoder::OnshapeCapture)?;
    let mut r = Reader {
        bytes,
        i: 0,
        limits,
        values: 0,
    };
    let root = r.value(0)?;
    r.ws();
    if r.i != bytes.len() {
        return Err(Error::new("import/json-syntax"));
    }
    let revision = root.get("documentMicroversion")?.text()?;
    if d.state
        .source_revision
        .as_deref()
        .is_some_and(|s| s != revision)
    {
        return Err(Error::new("import/source-revision-mismatch"));
    }
    d.state.source_revision = Some(revision.into());
    let bodies = root.get("bodies")?.array()?;
    if bodies.len() != 1 {
        return Err(Error::new("import/solid-selection-unavailable"));
    }
    let body = &bodies[0];
    if body.get("type")?.text()? != "solid" {
        return Err(Error::new("import/body-not-solid"));
    }
    if body
        .optional("consumedByComposite")
        .is_some_and(|v| !matches!(v, Json::Null | Json::Bool(false)))
    {
        return Err(Error::new("import/composite-unavailable"));
    }
    d.state.unit_to_mm = q(1000);
    let mut ids = std::collections::BTreeSet::new();
    let mut register = |id: &str| -> Result<()> {
        if !ids.insert(id.to_string()) {
            return Err(Error::new("import/duplicate-id"));
        }
        Ok(())
    };
    register(body.get("id")?.text()?)?;
    for v in body.get("vertices")?.array()? {
        let id = v.get("id")?.text()?.to_string();
        register(&id)?;
        let p = point(v.get("point")?, &mut d, true)?;
        d.vertices.push(InputVertex { id, point: p });
    }
    let vertex_indices: BTreeMap<_, _> = d
        .vertices
        .iter()
        .enumerate()
        .map(|(i, v)| (v.id.clone(), i))
        .collect();
    for e in body.get("edges")?.array()? {
        let id = e.get("id")?.text()?.to_string();
        register(&id)?;
        let kind = e.get("curve")?.get("type")?.text()?;
        if kind != "line" {
            return Err(Error::new(&format!("import/entity-unsupported:{kind}")));
        }
        let ends = e.get("vertices")?.array()?;
        if ends.len() != 2 {
            return Err(Error::new("import/edge-endpoints"));
        }
        let ends = [ends[0].text()?.to_string(), ends[1].text()?.to_string()];
        let g = e.get("geometry")?;
        let p = point(g.get("startPoint")?, &mut d, true)?;
        let end = point(g.get("endPoint")?, &mut d, true)?;
        let direction = point(g.get("startVector")?, &mut d, false)?;
        for (id, observed) in [(&ends[0], &p), (&ends[1], &end)] {
            let index = vertex_indices
                .get(id)
                .ok_or_else(|| Error::new("import/missing-id"))?;
            let v = &d.vertices[*index];
            if &v.point != observed {
                return Err(Error::new("import/endpoint-inconsistent"));
            }
        }
        // Straight line observations suffice for a whole-domain carrier; exact
        // incidence and bounded topology are audited once in shared admission.
        for (key, denominator) in [("quarterPoint", 4), ("midPoint", 2)] {
            let observed = point(g.get(key)?, &mut d, true)?;
            let expected: Point =
                std::array::from_fn(|i| &p[i] + (&end[i] - &p[i]) / q(denominator));
            if observed != expected {
                return Err(Error::new("import/line-observation-inconsistent"));
            }
        }
        let end_direction = point(g.get("endVector")?, &mut d, false)?;
        if cross(&direction, &end_direction)
            .iter()
            .any(|x| !x.is_zero())
            || dot(&direction, &end_direction) <= q(0)
        {
            return Err(Error::new("import/edge-sense"));
        }
        d.edges.push(InputEdge {
            id,
            vertices: ends,
            p,
            d: direction,
            same_sense: true,
        });
    }
    for f in body.get("faces")?.array()? {
        let id = f.get("id")?.text()?.to_string();
        register(&id)?;
        let s = f.get("surface")?;
        let kind = s.get("type")?.text()?;
        if kind != "plane" {
            return Err(Error::new(&format!("import/entity-unsupported:{kind}")));
        }
        let o = point(s.get("origin")?, &mut d, true)?;
        let n = point(s.get("normal")?, &mut d, false)?;
        let plane = plane(o, n, None)?;
        let mut loops = vec![];
        for (i, l) in f.get("loops")?.array()?.iter().enumerate() {
            let outer = match l.get("type")?.text()? {
                "outer" => true,
                "inner" => false,
                _ => return Err(Error::new("import/bound-unsupported")),
            };
            let uses = l
                .get("coedges")?
                .array()?
                .iter()
                .map(|u| {
                    Ok((
                        u.get("edgeId")?.text()?.into(),
                        u.get("orientation")?.boolean()?,
                    ))
                })
                .collect::<Result<Vec<_>>>()?;
            loops.push(InputLoop {
                id: format!("{id}/loop/{i}"),
                outer,
                uses,
            });
        }
        d.faces.push(InputFace {
            id,
            plane,
            forward: f.get("orientation")?.boolean()?,
            loops,
        });
    }
    d.state.source_entity_ids = ids.into_iter().collect();
    if d.state.source_entity_ids.len() > limits.entities {
        return Err(Error::new("import/graph-limit"));
    }
    Ok(d)
}
