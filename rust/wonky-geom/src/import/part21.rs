//! Owned, bounded ISO 10303-21 syntax reader. Schema admission is separate.
use super::{Error, Limits, Result};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    String(String),
    Number(String),
    Enum(String),
    Ref(u32),
    Null,
    Derived,
    List(Vec<Value>),
    Typed(String, Vec<Value>),
}
#[derive(Clone, Debug)]
pub struct Entity {
    pub components: Vec<(String, Vec<Value>)>,
}
#[derive(Clone, Debug)]
pub struct Document {
    pub entities: BTreeMap<u32, Entity>,
}
struct Reader<'a> {
    s: &'a [u8],
    i: usize,
    limits: Limits,
    values: usize,
}
impl Reader<'_> {
    fn error<T>(&self) -> Result<T> {
        Err(Error::new("import/part21-syntax"))
    }
    fn ws(&mut self) -> Result<()> {
        loop {
            while self.s.get(self.i).is_some_and(u8::is_ascii_whitespace) {
                self.i += 1;
            }
            if self.s.get(self.i..self.i + 2) != Some(b"/*") {
                return Ok(());
            }
            self.i += 2;
            while self.s.get(self.i..self.i + 2) != Some(b"*/") {
                if self.i >= self.s.len() {
                    return self.error();
                }
                self.i += 1;
            }
            self.i += 2;
        }
    }
    fn eat(&mut self, c: u8) -> Result<()> {
        self.ws()?;
        if self.s.get(self.i) != Some(&c) {
            return self.error();
        }
        self.i += 1;
        Ok(())
    }
    fn word(&mut self) -> Result<String> {
        self.ws()?;
        let start = self.i;
        while self
            .s
            .get(self.i)
            .is_some_and(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
        {
            self.i += 1;
        }
        if start == self.i {
            return self.error();
        }
        Ok(std::str::from_utf8(&self.s[start..self.i])
            .map_err(|_| Error::new("import/part21-syntax"))?
            .to_string())
    }
    fn expect(&mut self, word: &str) -> Result<()> {
        if self.word()? != word {
            return self.error();
        }
        Ok(())
    }
    fn string(&mut self) -> Result<String> {
        self.eat(b'\'')?;
        let mut out = String::new();
        loop {
            let c = *self
                .s
                .get(self.i)
                .ok_or_else(|| Error::new("import/part21-syntax"))?;
            self.i += 1;
            if c == b'\'' {
                if self.s.get(self.i) == Some(&b'\'') {
                    out.push('\'');
                    self.i += 1;
                } else {
                    return Ok(out);
                }
            } else if c == b'\\' {
                // ISO extended Unicode escapes; unsupported legacy code pages refuse.
                if self.s.get(self.i..self.i + 3) == Some(b"X2\\")
                    || self.s.get(self.i..self.i + 3) == Some(b"X4\\")
                {
                    let width = if self.s[self.i + 1] == b'2' { 4 } else { 8 };
                    self.i += 3;
                    let start = self.i;
                    while self.s.get(self.i..self.i + 4) != Some(b"\\X0\\") {
                        if self.i >= self.s.len() {
                            return self.error();
                        }
                        self.i += 1;
                    }
                    let text = std::str::from_utf8(&self.s[start..self.i])
                        .map_err(|_| Error::new("import/string-escape"))?;
                    if text.len() % width != 0 || !text.as_bytes().iter().all(u8::is_ascii_hexdigit)
                    {
                        return Err(Error::new("import/string-escape"));
                    }
                    let words = text
                        .as_bytes()
                        .chunks(width)
                        .map(|w| {
                            u32::from_str_radix(std::str::from_utf8(w).unwrap(), 16)
                                .map_err(|_| Error::new("import/string-escape"))
                        })
                        .collect::<Result<Vec<_>>>()?;
                    if width == 4 {
                        for c in char::decode_utf16(words.into_iter().map(|w| w as u16)) {
                            out.push(c.map_err(|_| Error::new("import/string-escape"))?);
                        }
                    } else {
                        for w in words {
                            out.push(
                                char::from_u32(w)
                                    .ok_or_else(|| Error::new("import/string-escape"))?,
                            );
                        }
                    }
                    self.i += 4;
                } else if self.s.get(self.i) == Some(&b'\\') {
                    self.i += 1;
                    out.push('\\');
                } else {
                    return Err(Error::new("import/string-escape-unsupported"));
                }
            } else if (32..=126).contains(&c) || matches!(c, b'\n' | b'\r') {
                out.push(c as char);
            } else {
                return self.error();
            }
        }
    }
    fn list(&mut self, depth: usize) -> Result<Vec<Value>> {
        self.eat(b'(')?;
        let mut out = vec![];
        self.ws()?;
        if self.s.get(self.i) == Some(&b')') {
            self.i += 1;
            return Ok(out);
        }
        loop {
            out.push(self.value(depth + 1)?);
            self.ws()?;
            match self.s.get(self.i) {
                Some(b')') => {
                    self.i += 1;
                    return Ok(out);
                }
                Some(b',') => self.i += 1,
                _ => return self.error(),
            }
        }
    }
    fn value(&mut self, depth: usize) -> Result<Value> {
        if depth > self.limits.depth {
            return Err(Error::new("import/depth-limit"));
        }
        self.values += 1;
        if self.values > self.limits.values {
            return Err(Error::new("import/graph-limit"));
        }
        self.ws()?;
        Ok(match self.s.get(self.i) {
            Some(b'\'') => Value::String(self.string()?),
            Some(b'(') => Value::List(self.list(depth)?),
            Some(b'$') => {
                self.i += 1;
                Value::Null
            }
            Some(b'*') => {
                self.i += 1;
                Value::Derived
            }
            Some(b'#') => {
                self.i += 1;
                let n = self
                    .word()?
                    .parse::<u32>()
                    .map_err(|_| Error::new("import/id-invalid"))?;
                if n == 0 {
                    return Err(Error::new("import/id-invalid"));
                }
                Value::Ref(n)
            }
            Some(b'.') if !self.s.get(self.i + 1).is_some_and(u8::is_ascii_digit) => {
                self.i += 1;
                let v = self.word()?;
                self.eat(b'.')?;
                Value::Enum(v)
            }
            Some(c) if c.is_ascii_digit() || matches!(c, b'+' | b'-' | b'.') => {
                let start = self.i;
                while self.s.get(self.i).is_some_and(|c| {
                    c.is_ascii_digit() || matches!(c, b'+' | b'-' | b'.' | b'E' | b'e')
                }) {
                    self.i += 1;
                }
                let v = std::str::from_utf8(&self.s[start..self.i])
                    .unwrap()
                    .to_string();
                super::number(&v)?;
                Value::Number(v)
            }
            Some(c) if c.is_ascii_alphabetic() => {
                let name = self.word()?;
                Value::Typed(name, self.list(depth)?)
            }
            _ => return self.error(),
        })
    }
    fn component(&mut self) -> Result<(String, Vec<Value>)> {
        self.values += 1;
        if self.values > self.limits.values {
            return Err(Error::new("import/graph-limit"));
        }
        let name = self.word()?;
        let args = self.list(0)?;
        Ok((name, args))
    }
}
impl Document {
    pub fn parse(source: &[u8], limits: Limits) -> Result<Self> {
        let max = Limits::default();
        if limits.depth > max.depth
            || limits.bytes > max.bytes
            || limits.entities > max.entities
            || limits.values > max.values
        {
            return Err(Error::new("import/limits-invalid"));
        }
        if source.len() > limits.bytes {
            return Err(Error::new("import/size-limit"));
        }
        let mut r = Reader {
            s: source,
            i: 0,
            limits,
            values: 0,
        };
        r.expect("ISO-10303-21")?;
        r.eat(b';')?;
        r.expect("HEADER")?;
        r.eat(b';')?;
        loop {
            r.ws()?;
            if r.s.get(r.i..r.i + 6) == Some(b"ENDSEC") {
                r.expect("ENDSEC")?;
                r.eat(b';')?;
                break;
            }
            r.component()?;
            r.eat(b';')?;
        }
        r.expect("DATA")?;
        r.eat(b';')?;
        let mut entities = BTreeMap::new();
        loop {
            r.ws()?;
            if r.s.get(r.i..r.i + 6) == Some(b"ENDSEC") {
                r.expect("ENDSEC")?;
                r.eat(b';')?;
                break;
            }
            let Value::Ref(id) = r.value(0)? else {
                return r.error();
            };
            r.eat(b'=')?;
            r.ws()?;
            let mut components = vec![];
            if r.s.get(r.i) == Some(&b'(') {
                r.i += 1;
                loop {
                    r.ws()?;
                    if r.s.get(r.i) == Some(&b')') {
                        r.i += 1;
                        break;
                    }
                    components.push(r.component()?);
                }
            } else {
                components.push(r.component()?);
            }
            r.eat(b';')?;
            let mut names = BTreeSet::new();
            if components.is_empty() || components.iter().any(|c| !names.insert(&c.0)) {
                return Err(Error::new("import/entity-invalid"));
            }
            if entities.insert(id, Entity { components }).is_some() {
                return Err(Error::new("import/duplicate-id"));
            }
            if entities.len() > limits.entities {
                return Err(Error::new("import/graph-limit"));
            }
        }
        r.expect("END-ISO-10303-21")?;
        r.eat(b';')?;
        r.ws()?;
        if r.i != source.len() {
            return r.error();
        }
        fn refs(v: &Value, ids: &BTreeMap<u32, Entity>) -> Result<()> {
            match v {
                Value::Ref(id) => {
                    if ids.contains_key(id) {
                        Ok(())
                    } else {
                        Err(Error::new("import/missing-id"))
                    }
                }
                Value::List(v) | Value::Typed(_, v) => {
                    for x in v {
                        refs(x, ids)?
                    }
                    Ok(())
                }
                Value::String(_)
                | Value::Number(_)
                | Value::Enum(_)
                | Value::Null
                | Value::Derived => Ok(()),
            }
        }
        for e in entities.values() {
            for (_, args) in &e.components {
                for v in args {
                    refs(v, &entities)?
                }
            }
        }
        Ok(Self { entities })
    }
    pub fn component(&self, id: u32, name: &str) -> Result<&[Value]> {
        let e = self
            .entities
            .get(&id)
            .ok_or_else(|| Error::new("import/missing-id"))?;
        e.components
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_slice())
            .ok_or_else(|| Error::new(&format!("import/entity-unsupported:{}", e.components[0].0)))
    }
}
impl Value {
    pub fn reference(&self) -> Result<u32> {
        if let Self::Ref(n) = self {
            Ok(*n)
        } else {
            Err(Error::new("import/reference-invalid"))
        }
    }
    pub fn list(&self) -> Result<&[Value]> {
        if let Self::List(v) = self {
            Ok(v)
        } else {
            Err(Error::new("import/list-invalid"))
        }
    }
    pub fn boolean(&self) -> Result<bool> {
        match self {
            Self::Enum(v) if v == "T" => Ok(true),
            Self::Enum(v) if v == "F" => Ok(false),
            _ => Err(Error::new("import/boolean-invalid")),
        }
    }
}
pub(super) fn arg(v: &[Value], i: usize) -> Result<&Value> {
    v.get(i)
        .ok_or_else(|| Error::new("import/entity-arguments"))
}
