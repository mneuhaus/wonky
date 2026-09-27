# Open Sans: v1.10 (Apache-2.0, 2011) vs v3.003 (OFL-1.1, 2021+), and which one Onshape uses

- Kind: font repositories and font binaries. Canonical: [googlefonts/opensans](https://github.com/googlefonts/opensans) (v3 sources, `OFL.txt`, `FONTLOG.txt`, `README.md`), [google/fonts history of `apache/opensans`](https://github.com/google/fonts/commits/main/apache/opensans) (v1.10/v1.101 binaries), [google/fonts PR #4206 "Clarify Open Sans licensing status as OFL"](https://github.com/google/fonts/pull/4206). Local copies: `tmp/research/sktext/fonts/v1-OpenSans-{Regular,Bold}.ttf` (from `google/fonts@beaec0837bd2` `apache/opensans/`), `v3-OpenSans-{Regular,Bold}.ttf` (googlefonts/opensans `main` `fonts/ttf/`), `v1-LICENSE.txt`, `v1-METADATA.pb`, `opensans-OFL.txt`, `opensans-FONTLOG.txt`.
- Authors: Steve Matteson (Ascender) for Google, 2010-2011; v3 by Micah Stupak et al., re-derived from Noto Sans sources.
- License: **v1.10 = Apache-2.0** (name ID 13 inside the TTF: "Licensed under the Apache License, Version 2.0"; `METADATA.pb` `license: "APACHE2"`; copyright "Digitized data copyright © 2010-2011, Google Corporation"). **v3.003 = SIL OFL 1.1** (name ID 13, `OFL.txt` "Copyright 2020 The Open Sans Project Authors"). Both permit embedding in software. Apache-2.0: keep the license text and any NOTICE when redistributing; OFL: font may be bundled/embedded, must stay under OFL, may not be sold by itself, reserved-name rules apply to modified fonts. For a private project either is unproblematic; shipping the v1.10 file inside wonky later means shipping `LICENSE` (Apache) next to it. PR #4206 (2022, DOCUMENTED) only moved the *v3* files to `ofl/` ("No TTF changes, only moving directory... to clarify"); it does not relicense old v1.10 binaries that carry an Apache notice (INFERRED; not legal advice).
- Status: googlefonts/opensans last commit 2023-11-16 ("Fix version number to v3.003"), 299 stars, 7 contributors (gh api, 2026-09-24). v1.x is frozen.

## What it is

The default and practically only font in Marc's corpus (`OpenSans-Regular.ttf` 176×, `OpenSans-Bold.ttf` 9×). Two incompatible generations exist under the same file name:

| property (Regular) | v1.10 | v3.003 |
|---|---|---|
| `head.fontRevision` / name 5 | 1.1010 / "Version 1.10" | 3.0030 / "Version 3.003; ttfautohint (v1.8.4)" |
| unitsPerEm | 2048 | 2048 |
| glyphs | 938 | 1150 |
| tables | has `kern` (format 0) and GPOS | no `kern`, GPOS only |
| hhea asc/desc/gap | 2189/−600/0 | 2189/−600/0 |
| OS/2 typo asc/desc/gap | 1567/−492/132 | 2189/−600/0 (USE_TYPO_METRICS set, fsSelection 0x1c0) |
| capHeight / xHeight | 1462 / 1096 | 1462 / 1096 |
| `R` adv/lsb | 1266/201 | 1264/200 |
| `1` bbox | 188..715 | 185..719 |
| sha256 | `13c03e22…b05f8` | `c53aceea…eb59` |

DOCUMENTED by `tmp/research/sktext/fontinfo.py` (fonttools). v3 README: "The Open Sans styles have been updated from Noto Sans sources... scale Noto Sans from 1000 units-per-em to 2048", so v3 outlines are a different drawing, not a re-hint.

## How it works

Static TrueType (`glyf`, quadratic). v1.10 ASCII glyphs 0x21-0x7E: no composite glyphs, `OVERLAP_SIMPLE` never set, at most 66 points and 5 contours per glyph (Regular), 65/5 (Bold); sampled check finds no crossing contours inside any ASCII glyph (INFERRED from `selfx.mjs`). fonttools warns "'kern' subtable longer than defined: 112178 bytes instead of 46642" for v1.10: the format-0 subtable length field (uint16) overflows; parsers must use nPairs, not the length (DOCUMENTED warning; INFERRED cause).

## Robustness and guarantees

Integer font units, int16 range; outlines hand-drawn and hinted for screen, clean for CAD use in the ASCII range. No guarantee that non-ASCII glyphs are overlap-free.

## Parallelism and performance

Irrelevant (a few kB of glyph data per string).

## Known failures, limitations, war stories

- Downloading "Open Sans" today yields v3 (Google Fonts API, googlefonts repo, most Linux distros ship v1.10 as `fonts-open-sans` historically, but that is not guaranteed; HEARSAY). Using v3 shifts every glyph (v3 matches 1/304 Onshape points).
- v1.10 `kern` table length overflow (above).

## Relevance for wonky

Measured: Onshape's `OpenSans-Regular.ttf` is **v1.10** (see `onshape-sktext-layout-measured-from-step-export.md`). wonky must pin the v1.10 binaries by sha256 (Regular `13c03e22a633919beb2847c58c8285fb8a735ee97097d7c48fd403f8294b05f8`, Bold `1b43de2449d39b65ff6f63315d4afda585f72fbbec2e3d9a56f59de6c75149d3`) and record the provenance (`google/fonts` commit `beaec0837bd21524b57ecb435158f9011fc03999`). Bold is unverified against Onshape (no Bold sample exported yet). For the other 11 std font names (7 `.ttf`, 4 CJK `.otf`), Apache/OFL sources exist in google/fonts (Arimo, Tinos, Droid Sans Mono, Roboto Slab, Noto, Allerta Stencil; HEARSAY, licenses and versions not checked here) but each needs the same "which version does Onshape use" check before it is admitted; until then wonky should refuse them explicitly.

## Pointers worth porting or studying

- Pinned files and hashes above; `v1-LICENSE.txt` (Apache-2.0 text) to ship alongside.
- `hmtx`, `cmap` (format 4), `glyf`/`loca` are the only tables the Onshape rule needs (no kerning, no GSUB/GPOS).

## Verdict: adopt (v1.10 Regular now; Bold after one verification capture)

Right font, permissive license, tiny data. Do not use v3.
