from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_text(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


class CreditSourceContractTests(unittest.TestCase):
    def test_base_credit_migration_defines_local_runtime_tables(self) -> None:
        sql = read_text("supabase/migrations/202605080001_company_pair_credits.sql")

        required_fragments = [
            "create table if not exists public.settings",
            "create table if not exists public.sites",
            "create table if not exists public.ownership_trees",
            "create table if not exists public.article_queue",
            "url text not null unique",
            "remote_requested_at timestamptz",
            "openrouter_cost numeric(12, 6)",
            "fly_io_investigation_cost numeric(12, 6)",
        ]

        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, sql)

    def test_migration_defines_gated_shared_funding_contract(self) -> None:
        sql = read_text("supabase/migrations/202606080001_investigation_credit_funding.sql")

        required_fragments = [
            "create table if not exists public.site_feature_flags",
            "'investigation_credits',\n    false",
            "values ('investigation_start_flat_cost_usd', '0.05')",
            "create table if not exists public.user_account_preferences",
            "create table if not exists public.user_notification_outbox",
            "create table if not exists public.article_investigation_funders",
            "create table if not exists public.company_pair_investigation_funders",
            "check (status in ('queued', 'in-progress', 'complete', 'failed', 'cancelled', 'paused'))",
            "create or replace function public.fund_article_investigation",
            "create or replace function public.fund_company_pair_investigation",
            "create or replace function public.debit_article_flat_start_cost",
            "create or replace function public.debit_company_pair_flat_start_cost",
            "create or replace function public.apply_article_credit_usage",
            "create or replace function public.apply_company_pair_credit_usage",
            "create or replace function public.enqueue_funding_needed_notice",
            "create or replace function public.enqueue_company_pair_funding_needed_notice",
            "article_credit_usage_cost_update",
        ]

        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, sql)

    def test_get_or_enqueue_requires_auth_and_debits_new_url_when_flag_enabled(self) -> None:
        source = read_text("supabase/functions/get-or-enqueue/index.ts")

        required_fragments = [
            '.from("site_feature_flags")',
            '.eq("key", "investigation_credits")',
            "if (investigationCreditsEnabled) {\n      authenticatedUser = await getAuthenticatedUser(req, body as Record<string, unknown>);",
            'Deno.env.get("PEPE_ALLOWED_TESTER_EMAILS")',
            'error: "under_construction"',
            "if (investigationCreditsEnabled && wasInserted && authenticatedUser == null)",
            'supabase.rpc("fund_article_investigation"',
            "p_is_starter: true",
            'supabase.rpc("debit_article_flat_start_cost"',
            'status: "paused"',
            "shouldDispatchExistingQueued",
            "queue.duplicate_existing_dispatchable",
            'error: "Sign in required to start a new investigation."',
            'error: "Not enough credits to start this investigation."',
        ]

        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, source)

    def test_company_pair_start_preserves_legacy_reservation_behind_flag(self) -> None:
        source = read_text("supabase/functions/company-pair-research-start/index.ts")
        lookup = read_text("supabase/functions/company-pair-lookup/index.ts")

        required_fragments = [
            '.from("site_feature_flags")',
            '.eq("key", "investigation_credits")',
            'Deno.env.get("PEPE_ALLOWED_TESTER_EMAILS")',
            'error: "under_construction"',
            "if (investigationCreditsEnabled) {",
            'supabase.rpc("fund_company_pair_investigation"',
            'supabase.rpc("debit_company_pair_flat_start_cost"',
            "} else {\n      const reserveSetting = await supabase",
            'supabase.rpc("reserve_user_credits"',
            "shared_funding_enabled: investigationCreditsEnabled",
            'Deno.env.get("PEPE_AUTH_MODE")',
            "mock_user_id",
        ]

        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, source)

        for fragment in [
            'Deno.env.get("PEPE_ALLOWED_TESTER_EMAILS")',
            'error: "under_construction"',
            "requiresAuth && user && !(await isAllowedTester(user))",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, lookup)

    def test_notice_sender_and_delete_account_have_expected_safety_contracts(self) -> None:
        checkout = read_text("supabase/functions/create-checkout-session/index.ts")
        credit_account = read_text("supabase/functions/credit-account/index.ts")
        notices = read_text("supabase/functions/send-funding-notices/index.ts")
        delete_account = read_text("supabase/functions/delete-account/index.ts")
        config = read_text("supabase/config.toml")

        for fragment in [
            '.from("site_feature_flags")',
            '.eq("key", "investigation_credits")',
            "Credit purchases are not enabled",
            "parseBooleanSetting(featureFlag.data?.enabled, false)",
            'Deno.env.get("PEPE_ALLOWED_TESTER_EMAILS")',
            'error: "under_construction"',
            "getClerkUserEmail(user.id)",
            'Deno.env.get("PEPE_AUTH_MODE")',
            'Deno.env.get("PEPE_PAYMENTS_MODE")',
            "cs_mock_",
            '.from("credit_ledger").insert',
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, checkout)

        for fragment in [
            'Deno.env.get("PEPE_AUTH_MODE")',
            'Deno.env.get("PEPE_ALLOWED_TESTER_EMAILS")',
            'error: "under_construction"',
            "mock_user_id",
            'action === "get"',
            'action === "update_preferences"',
            'action === "fund_article"',
            'action === "opt_out_article"',
            'supabase.rpc("get_credit_balance"',
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, credit_account)

        for fragment in [
            'Deno.env.get("INTERNAL_EDGE_API_KEY")',
            'req.headers.get("x-internal-key")',
            'Deno.env.get("CLERK_SECRET_KEY")',
            'Deno.env.get("RESEND_API_KEY")',
            '.from("user_notification_outbox")',
            '.eq("notification_type", "funding_needed")',
            'status: "skipped"',
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, notices)

        for fragment in [
            "verifyToken(token, verifyOptions)",
            'Deno.env.get("PEPE_ALLOWED_TESTER_EMAILS")',
            'error: "under_construction"',
            'supabase.rpc("update_user_account_preferences"',
            'p_delete_account: true',
            '.from("article_investigation_funders")',
            '.from("company_pair_investigation_funders")',
            "deleteClerkUser(userId)",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, delete_account)

        for fragment in [
            "[auth.third_party.clerk]",
            "enabled = false",
            "[functions.delete-account]",
            "[functions.send-funding-notices]",
            "[functions.credit-account]",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, config)

    def test_frontend_exposes_account_funding_and_running_cost_controls(self) -> None:
        html = read_text("src/site/dev/index.html")
        app = read_text("src/site/dev/js/app.js")
        api_config = read_text("src/site/dev/js/services/articleApiConfig.js")
        runtime_config = read_text("src/site/dev/runtime-config.js")
        service = read_text("src/site/dev/js/services/ArticleApiService.js")
        controller = read_text("src/site/dev/js/controllers/ArticleSubmissionController.js")
        states = read_text("src/site/dev/status_states.json")

        for fragment in [
            "account-link-button",
            "fund-investigation-button",
            "opt-out-funding-button",
            "account-panel",
            "running-cost-display",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, html)

        for fragment in [
            "window.PEPE_SUPABASE_URL",
            "window.PEPE_SUPABASE_PUBLISHABLE_KEY",
            "window.PEPE_DEFAULT_BASE_URL",
            "window.PEPE_AUTH_MODE",
            "window.PEPE_PAYMENTS_MODE",
            "window.PEPE_ALLOWED_TESTER_EMAILS",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, api_config)
                self.assertIn(fragment, runtime_config)

        for fragment in [
            "isInvestigationCreditsEnabled",
            "updateAccountPreferences",
            "deleteAccount",
            "fundCurrentInvestigation",
            "optOutCurrentFunding",
            "resumeArticleInvestigation",
            "Restarting investigation",
            "updateRunningCostDisplay",
            "isTesterAccessUrl",
            "handleUnauthorizedTester",
            "Under construction.",
            "creditTesterAuthorized",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, app)

        self.assertIn("const showSignupButtons = testerGateEnabled && !isSignedIn;", app)
        self.assertIn("const showCreditControls = featureEnabled && isTesterAuthorized;", app)

        for fragment in [
            "isInvestigationCreditsEnabled",
            "getAccountPreferences",
            "updateAccountPreferences",
            "deleteAccount",
            "fundArticleInvestigation",
            "optOutArticleFunding",
            "resumeArticleInvestigation",
            "isMockAuthMode",
            "isAllowedTester",
            "getMockAuthBody",
            "credit-account",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, service)

        self.assertIn("onPendingArticleState", controller)
        self.assertIn('"status": "paused"', states)

    def test_backend_completion_paths_pause_when_final_cost_exhausts_credits(self) -> None:
        article_job = read_text("src/app/core/jobs/jobs/investigation_job.py")
        company_pair_job = read_text("src/app/core/jobs/jobs/company_pair_investigation.py")

        for fragment in [
            "InvestigationFundingPaused, OpenrouterCost, _apply_article_credit_usage",
            "def _pause_if_article_funding_required",
            "_apply_article_credit_usage(self._queue_url_key)",
            "self.set_status(JobStatus.PAUSED)",
            "if self._pause_if_article_funding_required():\n            return",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, article_job)

        for fragment in [
            "InvestigationFundingPaused, OpenrouterCost, _send_funding_notices",
            "if self._settle_credits(costs):\n            return",
            "def _settle_credits(self, costs: Dict[str, float]) -> bool",
            "self._pause_request(\"Investigation paused: more funding is required.\")",
            "_send_funding_notices()",
        ]:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, company_pair_job)


if __name__ == "__main__":
    unittest.main()
