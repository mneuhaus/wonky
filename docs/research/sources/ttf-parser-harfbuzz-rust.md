# ttf-parser (harfbuzz/ttf-parser, formerly RazrFalcon/ttf-parser)

- Kind: repository (Rust library). Canonical: [github.com/harfbuzz/ttf-parser](https://github.com/harfbuzz/ttf-parser). Shallow clone: `tmp/research/ttf-parser/repo` (commit `0c7291223fe9`, 2026-08-06).
- Author: Yevhenii Reizner (2018-), now maintained under the HarfBuzz org; 39 contributors, 793 stars, release v0.25.1 (2024-11-29), last commit 2026-08-06 (gh api, 2026-09-24).
- License: **MIT OR Apache-2.0** (`Cargo.toml`, `LICENSE-MIT`, `LICENSE-APACHE`). Porting its logic into Bend is unproblematic; keep the MIT notice if code structure is copied closely.
- Status: README: "This crate is in maintenance mode. Bug fixes only... For new projects, we recommend fontations (read-fonts and skrifa)".

## What it is

A zero-allocation, zero-unsafe, `no_std` parser for TrueType/OpenType/AAT that exposes glyph outlines through a callback trait `OutlineBuilder { move_to, line_to, quad_to, curve_to, close }` (`src/lib.rs:580`). It is the outline backend of rustybuzz, resvg and many Rust font tools.

## How it works

- `src/tables/glyf.rs` (692 lines): `parse_simple_outline` decodes endpoint indices, run-length flags (`FlagsIter`) and delta coordinates (`CoordsIter::next(is_short, is_same_or_short)`), yielding `GlyphPoint{x: i16, y: i16, on_curve_point, last_point}`.
- `Builder::push_point` / `finish_contour` (l.75-140) is the reference handling of implied points: remembers the first on-curve and first/last off-curve point; two consecutive off-curve points emit `quad_to(off, midpoint)`; a contour that starts off-curve starts at the midpoint of the first two off-curve points; closing emits the wrap-around quad. Midpoints are `lerp(p, 0.5)` in f32 (exact for int16 inputs).
- Composites (`CompositeGlyphIter`, l.141-222): offset args (int8/int16), F2DOT14 scale / xy-scale / 2×2 combined with `Transform::combine`; **point-matching anchors are skipped, not supported** ("We do not support matching (see the README), but the args still occupy the stream"). Recursion depth `MAX_COMPONENTS = 32` plus a total visit budget `MAX_COMPONENT_VISITS = 100_000`.
- The bbox is recomputed from emitted points (the header bbox is skipped as untrusted).
- Kerning via `kern` (format 0/2/3) and `kerx`; `GPOS` is exposed as tables only (shaping is rustybuzz's job).

## Robustness and guarantees

README: "The library must not panic"; "All recursive methods have a depth limit, and the ones whose input forms a graph (composite glyphs, the COLRv1 paint graph, CFF subroutines) additionally bound the total work per call. A depth limit alone does not: with fan-out b and depth d, a small font can force b^d visits". Arithmetic and casts "mostly checked". Fuzzed (issue #192).

## Parallelism and performance

README claims "Fast" without numbers in the repo root; benches exist under `benches/` (not run: CPU benchmark on this machine).

## Known failures, limitations, war stories

- [#220](https://github.com/harfbuzz/ttf-parser/issues/220)/[#224](https://github.com/harfbuzz/ttf-parser/issues/224): composite glyphs referencing a shared subtree caused exponential CPU; fixed by the visit budget.
- [#213](https://github.com/harfbuzz/ttf-parser/issues/213): fonts with 65536 glyphs could not be outlined.
- [#186](https://github.com/harfbuzz/ttf-parser/issues/186): RobotoSerif variable font failed to outline; [#239](https://github.com/harfbuzz/ttf-parser/issues/239), [#227](https://github.com/harfbuzz/ttf-parser/issues/227): CFF/CFF2 outline losses.
- Point-matching composites unsupported by design.

## Relevance for wonky

The cleanest small reference for a Bend `glyf` decoder: it is stateless, immutable and allocation-free, which matches Bend's no-mutation style (flags and coordinates are streams folded left-to-right; each glyph is independent, so glyphs of a string decode fork-join in parallel). The implied-point state machine is ~60 lines and can be transcribed almost 1:1 into a Bend fold over points with integer (half-lattice) arithmetic instead of f32. Adopt its two safety rules (depth limit and total-work budget for composites) as explicit wonky refusals. Not needed at all if wonky ships a pre-extracted glyph pack (see addendum proposal P1); then ttf-parser is the reference to validate the pack against.

## Pointers worth porting or studying

- `src/tables/glyf.rs` `Builder::push_point`, `finish_contour`, `parse_simple_outline`, `resolve_coords_len`, `CompositeGlyphIter::next`.
- `src/lib.rs` `OutlineBuilder` trait (the minimal outline vocabulary: move/line/quad/cubic/close).
- `src/tables/hmtx.rs`, `cmap` format 4 subtable for code-point lookup.

## Verdict: adapt

Port the implied-point state machine and the composite safety limits (MIT/Apache permits it); do not take its f32 coordinate type.
