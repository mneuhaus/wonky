//! Versioned, canonical geometry transport, separate from Bend's v1/v2 op ABI.
//! Binary64 bits never pass through a decimal conversion. Decoder rechecks
//! references/claims and never synthesizes construction provenance for imports.
use crate::{Reader, WireError};
use wonky_contract::*;
mod layout;
mod legacy;
pub use legacy::{import_v2, LegacyImport};

pub const MAGIC: u32 = 0x33564b57; // little-endian bytes "WKV3"
pub const SCHEMA_VERSION: u32 = 4;
/// Resource ceiling, not a geometric tolerance. Enforced before decoding counts.
pub const MAX_WORDS: usize = 4 * 1024 * 1024;
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    Wire(WireError),
    Contract(ContractError),
    UnknownVersion(u32),
    ResourceLimit,
}
impl From<WireError> for Error {
    fn from(e: WireError) -> Self {
        Self::Wire(e)
    }
}
impl From<ContractError> for Error {
    fn from(e: ContractError) -> Self {
        Self::Contract(e)
    }
}
pub type Result<T> = std::result::Result<T, Error>;
fn malformed(s: impl Into<String>) -> Error {
    Error::Wire(WireError::Malformed(s.into()))
}

/// Raw editable input is checked too; a bad fact cannot be emitted by this API.
pub fn encode(body: &Body) -> Result<Vec<u32>> {
    body.clone().check()?;
    let mut out = vec![MAGIC, SCHEMA_VERSION, 0];
    body.put(&mut out)?;
    if out.len() > MAX_WORDS {
        return Err(Error::ResourceLimit);
    }
    out[2] = (out.len() - 3) as u32;
    Ok(out)
}
pub fn decode(words: &[u32]) -> Result<CheckedBody> {
    if words.len() > MAX_WORDS {
        return Err(Error::ResourceLimit);
    }
    let mut r = Reader::new(words);
    if r.take()? != MAGIC {
        return Err(malformed("v3 magic"));
    }
    let version = r.take()?;
    if version != SCHEMA_VERSION {
        return Err(Error::UnknownVersion(version));
    }
    if r.take()? as usize != r.left() {
        return Err(malformed("v3 payload length"));
    }
    let body = Body::get(&mut r)?;
    r.finish()?;
    Ok(body.check()?)
}
/// JSON diagnostic/export form. Schema describes this form; transport remains
/// the binary word codec. Strings of 16 lower-case hex digits preserve all bits.
pub fn to_json(body: &Body) -> Result<String> {
    body.clone().check()?;
    Ok(format!(
        "{{\"magic\":\"WKV3\",\"schemaVersion\":4,\"body\":{}}}",
        body.json()
    ))
}
pub fn json_schema() -> String {
    format!("{{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"title\":\"Wonky wire v3 (WC0)\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"magic\",\"schemaVersion\",\"body\"],\"properties\":{{\"magic\":{{\"const\":\"WKV3\"}},\"schemaVersion\":{{\"const\":4}},\"body\":{{\"$ref\":\"#/$defs/Body\"}}}},\"$defs\":{{{}}}}}", layout::definitions())
}
trait Value: Sized {
    fn put(&self, out: &mut Vec<u32>) -> Result<()>;
    fn get(r: &mut Reader<'_>) -> Result<Self>;
    fn json(&self) -> String;
    fn schema() -> String;
}
impl Value for u32 {
    fn put(&self, out: &mut Vec<u32>) -> Result<()> {
        out.push(*self);
        Ok(())
    }
    fn get(r: &mut Reader<'_>) -> Result<Self> {
        Ok(r.take()?)
    }
    fn json(&self) -> String {
        self.to_string()
    }
    fn schema() -> String {
        "{\"type\":\"integer\",\"minimum\":0,\"maximum\":4294967295}".into()
    }
}
impl Value for bool {
    fn put(&self, out: &mut Vec<u32>) -> Result<()> {
        (*self as u32).put(out)
    }
    fn get(r: &mut Reader<'_>) -> Result<Self> {
        match r.take()? {
            0 => Ok(false),
            1 => Ok(true),
            x => Err(malformed(format!("v3 bool {x}"))),
        }
    }
    fn json(&self) -> String {
        self.to_string()
    }
    fn schema() -> String {
        "{\"type\":\"boolean\"}".into()
    }
}
impl Value for Binary64 {
    fn put(&self, out: &mut Vec<u32>) -> Result<()> {
        out.push(self.bits() as u32);
        out.push((self.bits() >> 32) as u32);
        Ok(())
    }
    fn get(r: &mut Reader<'_>) -> Result<Self> {
        let lo = r.take()? as u64;
        Ok(Self::from_bits(lo | ((r.take()? as u64) << 32))?)
    }
    fn json(&self) -> String {
        format!("\"{:016x}\"", self.bits())
    }
    fn schema() -> String {
        "{\"type\":\"string\",\"minLength\":16,\"maxLength\":16,\"pattern\":\"^[0-9a-f]{16}$\"}"
            .into()
    }
}
impl<T: Value> Value for Vec<T> {
    fn put(&self, out: &mut Vec<u32>) -> Result<()> {
        if self.len() > MAX_WORDS {
            return Err(Error::ResourceLimit);
        }
        (self.len() as u32).put(out)?;
        for x in self {
            x.put(out)?;
            if out.len() > MAX_WORDS {
                return Err(Error::ResourceLimit);
            }
        }
        Ok(())
    }
    fn get(r: &mut Reader<'_>) -> Result<Self> {
        // Every value occupies at least one word, including empty-tag variants.
        // Do not share P0's feature-gated count guard: v3 always fails closed.
        let n = r.take()? as usize;
        if n > r.left() {
            return Err(malformed("v3 count exceeds remaining words"));
        }
        let mut values = Vec::new();
        for _ in 0..n {
            values.push(T::get(r)?);
        }
        Ok(values)
    }
    fn json(&self) -> String {
        format!(
            "[{}]",
            self.iter().map(Value::json).collect::<Vec<_>>().join(",")
        )
    }
    fn schema() -> String {
        format!(
            "{{\"type\":\"array\",\"items\":{},\"maxItems\":{MAX_WORDS}}}",
            T::schema()
        )
    }
}
impl<T: Value, const N: usize> Value for [T; N] {
    fn put(&self, out: &mut Vec<u32>) -> Result<()> {
        for x in self {
            x.put(out)?;
        }
        Ok(())
    }
    fn get(r: &mut Reader<'_>) -> Result<Self> {
        let values = (0..N).map(|_| T::get(r)).collect::<Result<Vec<_>>>()?;
        values.try_into().map_err(|_| malformed("array length"))
    }
    fn json(&self) -> String {
        format!(
            "[{}]",
            self.iter().map(Value::json).collect::<Vec<_>>().join(",")
        )
    }
    fn schema() -> String {
        format!(
            "{{\"type\":\"array\",\"minItems\":{N},\"maxItems\":{N},\"items\":{}}}",
            T::schema()
        )
    }
}

macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        impl Value for $name {
            fn put(&self, out: &mut Vec<u32>) -> Result<()> { $(self.$field.put(out)?;)* Ok(()) }
            fn get(r: &mut Reader<'_>) -> Result<Self> { Ok(Self { $($field: <$ty as Value>::get(r)?,)* }) }
            fn json(&self) -> String { format!("{{{}}}", vec![$(format!("\"{}\":{}", stringify!($field), self.$field.json()),)*].join(",")) }
            fn schema() -> String { format!("{{\"$ref\":\"#/$defs/{}\"}}", stringify!($name)) }
        }
        impl Definition for $name {
            fn definition() -> String { object(vec![$((stringify!($field), <$ty>::schema())),*]) }
        }
    };
}
macro_rules! choice {
    ($name:ident { $($tag:literal => $variant:ident { $($field:ident : $ty:ty),* $(,)? }),* $(,)? }) => {
        impl Value for $name {
            fn put(&self, out: &mut Vec<u32>) -> Result<()> {
                match self { $(Self::$variant { $($field,)* } => { out.push($tag); $($field.put(out)?;)* })* }
                Ok(())
            }
            fn get(r: &mut Reader<'_>) -> Result<Self> {
                Ok(match r.take()? { $($tag => Self::$variant { $($field: <$ty as Value>::get(r)?,)* },)*
                    x => return Err(malformed(format!("{} tag {x}", stringify!($name)))), })
            }
            fn json(&self) -> String {
                match self { $(Self::$variant { $($field,)* } => format!("{{{}}}", vec![format!("\"kind\":\"{}\"", stringify!($variant)), $(format!("\"{}\":{}", stringify!($field), $field.json()),)*].join(",")),)* }
            }
            fn schema() -> String { format!("{{\"$ref\":\"#/$defs/{}\"}}", stringify!($name)) }
        }
        impl Definition for $name {
            fn definition() -> String { format!("{{\"oneOf\":[{}]}}", vec![$(object(vec![("kind", format!("{{\"const\":\"{}\"}}", stringify!($variant))), $((stringify!($field), <$ty>::schema())),*])),*].join(",")) }
        }
    };
}
use {choice, record};
trait Definition {
    fn definition() -> String;
}
fn object(fields: Vec<(&str, String)>) -> String {
    format!("{{\"type\":\"object\",\"additionalProperties\":false,\"required\":[{}],\"properties\":{{{}}}}}",
        fields.iter().map(|(k, _)| format!("\"{k}\"")).collect::<Vec<_>>().join(","),
        fields.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect::<Vec<_>>().join(","))
}

/// The host transport check (HS1): `words` decode, pass the contract, and are
/// word for word their own canonical encoding (no second spelling passes).
/// Returns the WC0 JSON reading.
pub fn checked_json(words: &[u32]) -> std::result::Result<String, String> {
    let checked = decode(words).map_err(|e| format!("WC0 v3 decode: {e:?}"))?;
    let canonical = encode(checked.body()).map_err(|e| format!("WC0 v3 re-encode: {e:?}"))?;
    if canonical != words {
        return Err("WC0 v3 noncanonical input".into());
    }
    to_json(checked.body()).map_err(|e| format!("WC0 v3 json: {e:?}"))
}
