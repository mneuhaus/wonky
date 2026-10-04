//! A minimal JSON reader for the oracle files of the wonky-curve tests (the
//! workspace has no JSON crate). Strings carry no escapes; numbers stay text.
#![allow(dead_code)]

#[derive(Debug, Clone)]
pub enum J {
    Null,
    Num(String),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

pub struct Reader<'a> {
    pub s: &'a [u8],
    pub i: usize,
}

impl Reader<'_> {
    fn ws(&mut self) {
        while self.s[self.i].is_ascii_whitespace() {
            self.i += 1;
        }
    }
    fn eat(&mut self, c: u8) {
        self.ws();
        assert_eq!(self.s[self.i], c, "json: expected {:?} at {}", c as char, self.i);
        self.i += 1;
    }
    fn string(&mut self) -> String {
        self.eat(b'"');
        let start = self.i;
        while self.s[self.i] != b'"' {
            assert_ne!(self.s[self.i], b'\\', "oracle strings carry no escapes");
            self.i += 1;
        }
        self.i += 1;
        String::from_utf8(self.s[start..self.i - 1].to_vec()).unwrap()
    }
    pub fn value(&mut self) -> J {
        self.ws();
        match self.s[self.i] {
            b'"' => J::Str(self.string()),
            b'[' => {
                self.i += 1;
                let mut v = vec![];
                loop {
                    self.ws();
                    if self.s[self.i] == b']' {
                        self.i += 1;
                        return J::Arr(v);
                    }
                    if !v.is_empty() {
                        self.eat(b',');
                    }
                    v.push(self.value());
                }
            }
            b'{' => {
                self.i += 1;
                let mut v = vec![];
                loop {
                    self.ws();
                    if self.s[self.i] == b'}' {
                        self.i += 1;
                        return J::Obj(v);
                    }
                    if !v.is_empty() {
                        self.eat(b',');
                    }
                    let k = self.string();
                    self.eat(b':');
                    v.push((k, self.value()));
                }
            }
            b'n' => {
                self.i += 4;
                J::Null
            }
            _ => {
                let start = self.i;
                while !matches!(self.s[self.i], b',' | b']' | b'}') && !self.s[self.i].is_ascii_whitespace() {
                    self.i += 1;
                }
                J::Num(String::from_utf8(self.s[start..self.i].to_vec()).unwrap())
            }
        }
    }
}

impl J {
    pub fn get(&self, k: &str) -> &J {
        match self {
            J::Obj(v) => &v.iter().find(|(n, _)| n == k).unwrap_or_else(|| panic!("no key {k}")).1,
            other => panic!("not an object: {other:?}"),
        }
    }
    pub fn arr(&self) -> &[J] {
        match self {
            J::Arr(v) => v,
            other => panic!("not an array: {other:?}"),
        }
    }
    pub fn str(&self) -> &str {
        match self {
            J::Str(s) => s,
            other => panic!("not a string: {other:?}"),
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, J::Null)
    }
}

/// Parse a whole JSON document.
pub fn parse(text: &str) -> J {
    Reader { s: text.as_bytes(), i: 0 }.value()
}
