"""Page-only contract tests; synthetic scores do not represent live CAD evidence."""

import importlib.util
from pathlib import Path
import re
import unittest

SCRIPT = Path(__file__).with_name("build-status-page.py")
spec = importlib.util.spec_from_file_location("build_status_page", SCRIPT)
page = importlib.util.module_from_spec(spec)
spec.loader.exec_module(page)


class StatusPageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = page.PAGE.read_text(encoding="utf-8")
        cls.zones = re.findall(r'<div class="zone-modal" id="zone-(AC\d{2})"', cls.source)
        assert len(cls.zones) == len(set(cls.zones)) == 48

    def sample(self):
        rows = []
        kernels = {}
        for kernel in page.KERNELS:
            for zone in self.zones:
                tolerant = kernel == "onshape" and zone == "AC20"
                rows.append({"kernel": kernel, "zone": zone, "status": "TOLERANT" if tolerant else "CORRECT",
                             "strictStatus": "WRONG" if tolerant else "PASS", "strictPoints": 0 if tolerant else 1,
                             "toleranceRuleIds": ["TR-X"] if tolerant else [], "reasons": [],
                             "evidencePending": ["Independent witness < pending"] if kernel == "onshape" and zone == "AC40" else [],
                             "variants": {"V0": {"status": "WRONG" if tolerant else "PASS",
                                                 "strictStatus": "WRONG" if tolerant else "PASS",
                                                 "reason": "current V0 observation"}}})
            counts = {tier: 0 for tier in page.TIERS}
            counts["CORRECT"] = 47 if kernel == "onshape" else 48
            counts["TOLERANT"] = 1 if kernel == "onshape" else 0
            kernels[kernel] = {"counts": counts, "strict": 47 if kernel == "onshape" else 48,
                               "practical": 48, "total": 48}
        return {"schema": "wonky/cad-acid-scoreboard/2", "zones": rows, "kernels": kernels,
                "toleranceRules": {"rules": [{"id": "TR-X", "phenomenon": "Export curve within < tolerance",
                                               "acceptance": {"description": "No material changed. Full boundary retained."}}]}}

    def test_keeps_comparison_modals_and_cites_tolerant_rule(self):
        generated = page.render(self.sample(), self.source)
        self.assertEqual(generated.count('class="zone-modal"'), 48)
        self.assertEqual(generated.count('class="kernel-columns"'), 48)
        self.assertEqual(len(re.findall(r'class="status-tile(?: disputed-border)?"', generated)), 144)
        self.assertEqual(generated.count('class="tolerance-citation"'), 1)
        self.assertIn('Strict verdict: WRONG. Rule: <strong>TR-X</strong> Export curve within &lt; tolerance Acceptance: No material changed. Full boundary retained.', generated)
        modal_ac19 = generated.split('id="zone-AC19"', 1)[1].split('</section>', 1)[0]
        self.assertIn('Current four-variant verdict: CORRECT', modal_ac19)
        self.assertNotIn('RustCapabilityError', modal_ac19)
        self.assertIn('47/48', generated)
        self.assertIn('48/48', generated)
        self.assertIn('grid-filter v-tolerant', generated)
        self.assertIn('A = kernel issue', generated)
        self.assertIn('Strict follows the frozen v1 rules', generated)
        self.assertNotIn('Strict is exact', generated)
        self.assertEqual(generated.count('Evidence pending (verdict unchanged): Independent witness &lt; pending'), 2)
        modal_ac40 = generated.split('id="zone-AC40"', 1)[1].split('id="zone-AC41"', 1)[0]
        self.assertIn('class="verdict correct">CORRECT', modal_ac40)
        self.assertNotIn('<script', generated.lower())
        self.assertLess(len(generated.encode('utf-8')), 500_000)
        self.assertEqual(page.render(self.sample(), generated), generated)

    def test_missing_code_identity_is_named_not_crashed(self):
        data = self.sample()
        data["verification"] = {"code": None}
        self.assertIn('code tree identity not recorded', page.render(data, self.source))
        data["verification"] = {"code": {"head": None}}
        self.assertIn('code tree identity not recorded', page.render(data, self.source))

    def test_no_uncited_tolerance(self):
        data = self.sample()
        next(row for row in data["zones"] if row["status"] == "TOLERANT")["toleranceRuleIds"] = []
        with self.assertRaisesRegex(ValueError, "missing its rule citation"):
            page.render(data, self.source)

    def test_score_must_match_rows(self):
        data = self.sample()
        data["kernels"]["onshape"]["practical"] = 47
        with self.assertRaisesRegex(ValueError, "Practical points inconsistent"):
            page.render(data, self.source)


if __name__ == "__main__":
    unittest.main()
