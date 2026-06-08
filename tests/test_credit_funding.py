from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from app.core.jobs.openrouter_cost import InvestigationFundingPaused, OpenrouterCost


class FakeCompanyPairJob:
    def __init__(self) -> None:
        self.calls = 0

    def on_credit_cost_updated(self) -> None:
        self.calls += 1


class PausingCompanyPairJob:
    def on_credit_cost_updated(self) -> None:
        raise InvestigationFundingPaused("needs funding")


class CreditFundingTests(unittest.TestCase):
    def test_openrouter_cost_calls_company_pair_credit_hook(self) -> None:
        tracker = OpenrouterCost()
        job = FakeCompanyPairJob()
        tracker._investigation_job = job

        tracker.add_cost(0.012345)

        self.assertAlmostEqual(tracker.get_cost(), 0.012345)
        self.assertEqual(job.calls, 1)

    def test_openrouter_cost_propagates_company_pair_pause(self) -> None:
        tracker = OpenrouterCost()
        tracker._investigation_job = PausingCompanyPairJob()

        with self.assertRaises(InvestigationFundingPaused):
            tracker.add_cost(0.01)


if __name__ == "__main__":
    unittest.main()
