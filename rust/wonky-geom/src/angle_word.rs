//! Binary64 construction arithmetic, never a geometry predicate. The atan port
//! defines standalone construction; the Node host supplies its own atan.
//! Port of V8 fdlibm atan from Node v22.16.0 deps/v8/src/base/ieee754.cc.
//! Source SHA256: da01a54955911cfc550117988de91516c6f1aac343af28142dce619b433a67fc.
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.
// Modified significantly by Google Inc.
// Copyright 2016 the V8 project authors. All rights reserved.
// Copyright 2014, the V8 project authors. All rights reserved.
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
// * Redistributions of source code must retain the above copyright notice,
//   this list of conditions and the following disclaimer.
// * Redistributions in binary form must reproduce the above copyright notice,
//   this list of conditions and the following disclaimer in the documentation
//   and/or other materials provided with the distribution.
// * Neither the name of Google Inc. nor the names of its contributors may be
//   used to endorse or promote products derived from this software without
//   specific prior written permission.
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

/// Exact nearest-even word assembly, including the subnormal grid. No
/// floating multiply, underflow mode or intermediate ratio decides rounding.
pub(crate) fn nearest(value: &crate::Q) -> crate::Result<f64> {
    use num_traits::{Signed, ToPrimitive, Zero};
    use wonky_alg::BigInt;
    if value.is_zero() {
        return Ok(0.);
    }
    let n = value.numer().abs();
    let d = value.denom();
    let mut e = n.bits() as i64 - d.bits() as i64;
    if if e >= 0 {
        n < (d << e as usize)
    } else {
        (&n << (-e) as usize) < *d
    } {
        e -= 1;
    }
    if e > 1023 {
        return Err(crate::Refused("angle/witness-mismatch"));
    }
    let s = if e < -1022 { 1074 } else { 52 - e };
    let (a, b) = if s >= 0 {
        (n << s as usize, d.clone())
    } else {
        (n, d << (-s) as usize)
    };
    let mut rounded = &a / &b;
    let remainder = &a % &b;
    if &remainder * 2 > b || (&remainder * 2 == b && (&rounded % 2) != BigInt::from(0)) {
        rounded += 1;
    }
    let mut significand = rounded
        .to_u64()
        .ok_or(crate::Refused("angle/witness-mismatch"))?;
    let bits = if e < -1022 {
        significand
    } else {
        if significand == 1 << 53 {
            significand >>= 1;
            e += 1;
        }
        if e > 1023 {
            return Err(crate::Refused("angle/witness-mismatch"));
        }
        (((e + 1023) as u64) << 52) | (significand - (1 << 52))
    };
    Ok(f64::from_bits(
        bits | if value.is_negative() { 1 << 63 } else { 0 },
    ))
}

#[cfg(test)]
mod tests {
    use super::nearest;
    use crate::Q;
    use num_traits::One;
    use wonky_alg::BigInt;
    #[test]
    fn exact_word_rounding_covers_subnormal_ties_and_carry() {
        let unit = Q::new(BigInt::one(), BigInt::one() << 1074);
        for k in [1u64, 2, 3, (1 << 52) - 1, 1 << 52] {
            let value = &unit * Q::from_integer(k.into());
            assert_eq!(nearest(&value).unwrap().to_bits(), k);
            assert_eq!(nearest(&-value).unwrap().to_bits(), k | (1 << 63));
        }
        assert_eq!(
            nearest(&(&unit / Q::from_integer(2.into())))
                .unwrap()
                .to_bits(),
            0
        );
        assert_eq!(
            nearest(&(&unit * Q::new(3.into(), 2.into())))
                .unwrap()
                .to_bits(),
            2
        );
        assert_eq!(
            nearest(&crate::binary64(f64::MAX).unwrap())
                .unwrap()
                .to_bits(),
            f64::MAX.to_bits()
        );
    }
}

pub(crate) fn atan(mut x: f64) -> f64 {
    let hi = [
        0x3fddac670561bb4f,
        0x3fe921fb54442d18,
        0x3fef730bd281f69b,
        0x3ff921fb54442d18,
    ]
    .map(f64::from_bits);
    let lo = [
        0x3c7a2b7f222f65e2,
        0x3c81a62633145c07,
        0x3c7007887af0cbbd,
        0x3c91a62633145c07,
    ]
    .map(f64::from_bits);
    let a = [
        0x3fd555555555550d,
        0xbfc999999998ebc4,
        0x3fc24924920083ff,
        0xbfbc71c6fe231671,
        0x3fb745cdc54c206e,
        0xbfb3b0f2af749a6d,
        0x3fb10d66a0d03d51,
        0xbfadde2d52defd9a,
        0x3fa97b4b24760deb,
        0xbfa2b4442c6a6c2f,
        0x3f90ad3ae322da11,
    ]
    .map(f64::from_bits);
    let negative = x.is_sign_negative();
    let ix = ((x.to_bits() >> 32) as u32) & 0x7fffffff;
    if ix >= 0x44100000 {
        if x.is_nan() {
            return x + x;
        }
        return if negative {
            -hi[3] - lo[3]
        } else {
            hi[3] + lo[3]
        };
    }
    let id;
    if ix < 0x3fdc0000 {
        if ix < 0x3e400000 {
            return x;
        }
        id = None;
    } else {
        x = x.abs();
        if ix < 0x3ff30000 {
            if ix < 0x3fe60000 {
                id = Some(0);
                x = (2. * x - 1.) / (2. + x);
            } else {
                id = Some(1);
                x = (x - 1.) / (x + 1.);
            }
        } else if ix < 0x40038000 {
            id = Some(2);
            x = (x - 1.5) / (1. + 1.5 * x);
        } else {
            id = Some(3);
            x = -1. / x;
        }
    }
    let z = x * x;
    let w = z * z;
    let s1 = z * (a[0] + w * (a[2] + w * (a[4] + w * (a[6] + w * (a[8] + w * a[10])))));
    let s2 = w * (a[1] + w * (a[3] + w * (a[5] + w * (a[7] + w * a[9]))));
    match id {
        None => x - x * (s1 + s2),
        Some(id) => {
            let z = hi[id] - ((x * (s1 + s2) - lo[id]) - x);
            if negative {
                -z
            } else {
                z
            }
        }
    }
}
