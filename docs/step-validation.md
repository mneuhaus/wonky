# Strict independent STEP validation

`scripts/validate-step.py` reads already exported geometry using OpenCascade.
It does not construct or repair production bodies. The validator now explicitly
requests `BRepCheck_Analyzer(shape, True, False, True)`: geometric checks with
the exact CurveOnSurface method. Successful reports record this method.

## Why the previous default check was insufficient

On a newly constructed oblique full cylinder, the default sampled check reports
validity although the STEP reader's reconstructed cylinder pcurve misses the
3D edge by up to about 0.000149 mm at the measured samples. Its reported edge
tolerance is only 0.0000001 mm. The stronger check rejects the imported shape.

The 3D ellipse itself remains precise. Independent whole-conic coefficient
bounds from high-precision arithmetic place its cylinder residual at about
7e-15 mm for this case. The reader creates a cubic B-spline for the corresponding
2D curve on the cylinder; that representation introduces the observed mismatch.
Changing STEP uncertainty and eight documented reader configurations did not
resolve it. This separates a native geometry check from consumer interoperability.

The reader also measures a shifted volume. Tighter adaptive integration does
not remove the difference. The pcurve inconsistency is established; a complete
numerical attribution of the volume shift is still open. The small integration
error reported by the reader is not an overall geometry error bound.

Evidence and reproduction:

- `out/boolean-ports/truck-step-review/README.md`
- `out/boolean-ports/truck-step-review/pcurve-diagnostics.json`
- `out/boolean-ports/truck-step-review/pcurve-error-bound.json`
- `out/boolean-ports/truck-cylinder-review/native-conic-incidence.json`

The continuous pcurve bound in this diagnostic uses analytic derivative bounds
and a Lipschitz argument with a floating-point guard. It is not a formal
interval-arithmetic proof. No production tolerance was enlarged to accept it.

## Consequences for existing results

Earlier default-check reports remain historical evidence of that weaker check.
In particular, the nine Truck-cylinder exports previously reported as valid
must not be presented as nine successes under the strengthened check. In the
first strict rerun, straight axial cuts passed and oblique cases failed. The
full-band repair and its fresh evidence are described below. Both newly
constructed curved P10 exports currently fail the strict check.

The nine solid-intersection exports, including planar concavity, contact chains
and axial cylinders, have been rerun and passed the stronger validator.
Other historical exports need their relevant strict validation rerun before
promotion. Native success, standard-reader success and strict-reader success
are separate outcomes; the comparison must keep failed exports visible.

A Bend-generated pcurve with an explicit approximation budget is now integrated
for full cylindrical bands with circular/elliptical rims and automatic domains.
All nine Truck full-band exports pass the strict check through the normal
exporter: `out/step-pcurves/integrated-step-validation.json`. Analytic 3D curves
and surfaces are preserved. The pcurve's declared total budget is at most
1e-8 mm and includes the native support and operational arithmetic guards.
Arbitrary imported shells and explicit partial trims remain outside this slice;
the two P10 exports still lack strict independent acceptance.

The volume validator now requests adaptive closed-shell Gauss integration with
relative target 1e-10 and records the returned error estimate. This resolves a
separate fixed-quadrature accuracy limit in the repaired oblique cases. That
estimate describes integration of the imported representation; it does not
certify all source/representation error or replace CurveOnSurface validation.
