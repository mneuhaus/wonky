# wonky

A pre-release CAD kernel written in Rust, with Onshape FeatureScript and build123d
frontends. Geometry uses floating-point coordinates with exact predicates for
sign and topology decisions. Unsupported or undecidable operations return named
refusals rather than fabricated geometry or silent partial success.

## Status

The Rust kernel is under active development. FeatureScript compatibility and
solid-modeling coverage are incomplete. [CAD-Acid](docs/cad-acid.md) is the public
benchmark; its per-case evidence and explicit failures matter, not a blanket
compatibility claim. Other CAD kernels are independent validation oracles, not
production geometry engines.

## Layout

- `rust/`: Rust workspace, geometry kernel, contracts and vendored dependencies.
- `src/`: JavaScript frontends, interpreter, bridges and export integration.
- `bin/`: command-line entry points.
- `viewer/`: model inspection UI.
- `fixtures/`: public synthetic cases and frozen reference data with provenance.
- `docs/`: architecture, algorithms, research and known limitations.
- `twin/`: experimental hardware-protocol simulator.

## Build and test

Install JavaScript dependencies with `pnpm install --frozen-lockfile` when using a
pnpm lockfile, or `npm ci` with the checked-in npm lockfile. Python tools use `uv`.

```sh
cd rust && cargo test --offline --locked --workspace
# From the repository root:
NODE_OPTIONS=--max-old-space-size=8192 node scripts/test-lane.mjs full --jobs=2
uv run --project twin pytest twin/tests
```

The Node suite explicitly skips local-only fixtures and unavailable retired Bend
inputs. Rust dependencies are vendored. Some integration tests additionally need
Python oracle dependencies; consult their diagnostics for requirements.

## Local-only fixtures

Product sources and derived captures are not all public. In particular, R20
sources and derived geometry, and the historical r10b product fixtures, are not
included. Tests that require these inputs report an explicit local-only skip.
A passing public suite does not validate the omitted products. Private report
terms can be supplied via `WONKY_PRIVATE_TERMS`; publication environments should
set `WONKY_REQUIRE_PRIVATE_TERMS=1` to require that local list.

## Bend kernel (retired)

The Bend code is retained as historical work, not an active implementation.
It does not build from a public checkout: the unlicensed vendored
bend-collections library and four copyleft reference ports are intentionally
excluded. Native Bend captures are also local-only. No new Bend work is planned.

## Licence

No licence has been granted for wonky's own code yet; all rights reserved.
Third-party material retains its respective licences and attribution.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
