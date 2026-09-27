"""Behavioral checks for the OCCT reference generator (real OCP geometry)."""
from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
import sys

from OCP.TopoDS import TopoDS_Shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate


class OracleGeneratorTests(unittest.TestCase):
    def test_catalog_covers_primitives_boolean_contacts_and_fillets(self) -> None:
        catalog = generate.cases()
        self.assertEqual(len(catalog), 25)
        self.assertEqual(
            {case["geometry"]["kind"] for case in catalog if case["operation"] == "primitive"},
            {"box", "prism", "cylinder", "cone", "sphere"},
        )
        boolean_cases = [case for case in catalog if case["operation"] == "boolean"]
        self.assertEqual({case["boolean"] for case in boolean_cases}, {"union", "subtract", "intersect"})
        self.assertTrue(any("coplanar" in case["id"] for case in boolean_cases))
        self.assertTrue(any("tangent" in case["id"] for case in boolean_cases))
        self.assertEqual(sum(case["operation"] == "fillet" for case in catalog), 2)

    def test_boolean_catalog_outputs_are_valid_and_empty_contacts_are_explicit(self) -> None:
        boolean_cases = [case for case in generate.cases() if case["operation"] == "boolean"]
        expected_empty = {
            "boolean-sphere-external-tangent-intersect",
            "boolean-box-face-tangent-intersect",
            "boolean-box-near-disjoint-intersect",
        }
        actual_empty: set[str] = set()
        for case in boolean_cases:
            with self.subTest(case=case["id"]):
                result = generate.measure(generate.build_case(case))
                self.assertTrue(result["valid"])
                if case["id"] in expected_empty:
                    self.assertTrue(generate._is_empty_result(result), result)
                    actual_empty.add(case["id"])
                else:
                    self.assertGreater(result["volume"], 0.0)
        self.assertEqual(actual_empty, expected_empty)

    def test_export_validation_rejects_swapped_geometry_and_malformed_stl(self) -> None:
        catalog = {case["id"]: case for case in generate.cases()}
        box_case = copy.deepcopy(catalog["primitive-box"])
        box_case["result"] = generate.measure(generate.build_case(box_case))
        cylinder_case = catalog["primitive-cylinder"]

        with tempfile.TemporaryDirectory() as temp:
            export_dir = Path(temp)
            box_case["exports"] = generate._export(generate.build_case(box_case), "box", export_dir)
            cylinder_exports = generate._export(generate.build_case(cylinder_case), "cylinder", export_dir)

            with self.assertRaisesRegex(AssertionError, "STEP geometry mismatch"):
                generate._validate_step_export(box_case, export_dir / "cylinder.step")

            fake_stl = export_dir / "fake.stl"
            fake_stl.write_text("solid fake\nfacet normal nonsensical\nendsolid\n", encoding="ascii")
            with self.assertRaisesRegex(AssertionError, "malformed STL facet normal"):
                generate._validate_stl_export(box_case, fake_stl)

            with self.assertRaisesRegex(AssertionError, "bbox"):
                generate._validate_stl_export(box_case, export_dir / "cylinder.stl")

    def test_step_rejects_near_tangent_cavity_with_matching_aggregate_metrics(self) -> None:
        catalog = {case["id"]: case for case in generate.cases()}
        expected_case = copy.deepcopy(catalog["boolean-sphere-internal-tangent-subtract"])
        expected_case["result"] = generate.measure(generate.build_case(expected_case))
        shifted_case = copy.deepcopy(catalog["boolean-sphere-near-tangent-contained-subtract"])
        shifted_result = generate.measure(generate.build_case(shifted_case))
        self.assertAlmostEqual(shifted_result["volume"], expected_case["result"]["volume"], places=8)
        self.assertAlmostEqual(shifted_result["area"], expected_case["result"]["area"], places=8)
        self.assertEqual(shifted_result["bbox"], expected_case["result"]["bbox"])
        self.assertEqual(shifted_result["faces"], expected_case["result"]["faces"])

        with tempfile.TemporaryDirectory() as temp:
            export_dir = Path(temp)
            expected_case["exports"] = generate._export(generate.build_case(expected_case), "expected-cavity", export_dir)
            generate._export(generate.build_case(shifted_case), "shifted-cavity", export_dir)
            shifted_step = export_dir / "shifted-cavity.step"
            with self.assertRaisesRegex(AssertionError, "STEP geometry mismatch"):
                generate._validate_step_export(expected_case, shifted_step)

    def test_stl_rejects_missing_facet_with_unchanged_bbox(self) -> None:
        box_case = copy.deepcopy(next(case for case in generate.cases() if case["id"] == "primitive-box"))
        box_case["result"] = generate.measure(generate.build_case(box_case))

        with tempfile.TemporaryDirectory() as temp:
            export_dir = Path(temp)
            box_case["exports"] = generate._export(generate.build_case(box_case), "box", export_dir)
            original = (export_dir / "box.stl").read_text(encoding="ascii")
            lines = original.splitlines(keepends=True)
            facet_start = next(index for index, line in enumerate(lines) if line.strip().lower().startswith("facet normal "))
            del lines[facet_start:facet_start + 7]
            missing_facet = export_dir / "missing-facet.stl"
            missing_facet.write_text("".join(lines), encoding="ascii")

            original_facets, original_bbox, original_bad_edges = generate._parse_ascii_stl(export_dir / "box.stl")
            mutant_facets, mutant_bbox, mutant_bad_edges = generate._parse_ascii_stl(missing_facet)
            self.assertEqual(original_facets - mutant_facets, 1)
            self.assertEqual(original_bbox, mutant_bbox)
            self.assertEqual(original_bad_edges, 0)
            self.assertGreater(mutant_bad_edges, 0)
            with self.assertRaisesRegex(AssertionError, "geometry mismatch"):
                generate._validate_stl_export(box_case, missing_facet)

    def test_stl_rejects_closed_wrong_mesh_within_bbox_tolerance(self) -> None:
        catalog = {case["id"]: case for case in generate.cases()}
        expected_case = copy.deepcopy(catalog["primitive-box"])
        shifted_case = copy.deepcopy(expected_case)
        shifted_case["geometry"]["origin"] = [0.05, 0.0, 0.0]
        expected_case["result"] = generate.measure(generate.build_case(expected_case))
        shifted_case["result"] = generate.measure(generate.build_case(shifted_case))

        with tempfile.TemporaryDirectory() as temp:
            export_dir = Path(temp)
            expected_case["exports"] = generate._export(generate.build_case(expected_case), "expected", export_dir)
            generate._export(generate.build_case(shifted_case), "shifted", export_dir)
            shifted_path = export_dir / "shifted.stl"
            expected_facets, expected_bbox, expected_bad_edges = generate._parse_ascii_stl(export_dir / "expected.stl")
            shifted_facets, shifted_bbox, shifted_bad_edges = generate._parse_ascii_stl(shifted_path)
            self.assertGreater(expected_facets, 0)
            self.assertGreater(shifted_facets, 0)
            self.assertEqual(expected_bad_edges, 0)
            self.assertEqual(shifted_bad_edges, 0)
            canonical_bbox = expected_case["result"]["bbox"]
            for observed_bbox in (expected_bbox, shifted_bbox):
                self.assertTrue(
                    all(
                        abs(actual - reference) <= generate.STL_BBOX_TOL
                        for bound in ("min", "max")
                        for actual, reference in zip(observed_bbox[bound], canonical_bbox[bound])
                    ),
                    (canonical_bbox, observed_bbox),
                )
            with self.assertRaisesRegex(AssertionError, "STL geometry mismatch"):
                generate._validate_stl_export(expected_case, shifted_path)

    def test_contact_intersections_export_as_valid_empty_results(self) -> None:
        empty_cases = [case for case in generate.cases() if case.get("expectedOutcome") == "empty"]
        self.assertEqual(len(empty_cases), 3)
        with tempfile.TemporaryDirectory() as temp:
            export_dir = Path(temp)
            for case in empty_cases:
                with self.subTest(case=case["id"]):
                    result = generate.measure(generate.build_case(case))
                    self.assertTrue(result["valid"])
                    self.assertTrue(generate._is_empty_result(result), result)
                    record = copy.deepcopy(case)
                    record["result"] = result
                    record["exports"] = generate._export(generate.build_case(case), case["id"], export_dir)
                    self.assertEqual(record["exports"]["stepMode"], "empty-result")
                    self.assertEqual(record["exports"]["stlMode"], "empty-result")
                    generate._validate_step_export(record, export_dir / f"{case['id']}.step")
                    generate._validate_stl_export(record, export_dir / f"{case['id']}.stl")

    def test_analytic_primitives_match_closed_forms(self) -> None:
        analytic_cases = [case for case in generate.cases() if case.get("analytic")]
        self.assertEqual(len(analytic_cases), 5)
        for case in analytic_cases:
            with self.subTest(case=case["id"]):
                result = generate.measure(generate.build_case(case))
                check = generate.closed_form_check(case, result)
                self.assertIsNotNone(check)
                self.assertTrue(check["passed"], check)

    def test_null_shape_is_a_valid_empty_result(self) -> None:
        result = generate.measure(TopoDS_Shape())
        self.assertTrue(result["valid"])
        self.assertTrue(generate._is_empty_result(result), result)

    def test_box_topology_counts_unique_subshapes(self) -> None:
        case = next(case for case in generate.cases() if case["id"] == "primitive-box")
        result = generate.measure(generate.build_case(case))
        self.assertEqual((result["faces"], result["edges"], result["vertices"]), (6, 12, 8))
        self.assertTrue(result["valid"])

    def test_planted_negative_suite_catches_parameter_and_export_errors(self) -> None:
        self.assertEqual(generate._planted_negative_checks(), (4, 25))

    def test_planted_box_and_cylinder_parameter_errors_are_caught(self) -> None:
        catalog = {case["id"]: case for case in generate.cases()}
        mutations = (
            ("primitive-box", "size", [21.0, 30.0, 40.0]),
            ("primitive-cylinder", "radius", 5.25),
        )
        for case_id, parameter, wrong_value in mutations:
            with self.subTest(case=case_id, parameter=parameter):
                mutant = copy.deepcopy(catalog[case_id])
                mutant["geometry"][parameter] = wrong_value
                result = generate.measure(generate.build_case(mutant))
                check = generate.closed_form_check(mutant, result)
                self.assertIsNotNone(check)
                self.assertFalse(check["passed"], f"wrong {parameter} escaped: {check}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
