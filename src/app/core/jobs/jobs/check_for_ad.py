import json
import re
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from typing import Any, ClassVar, Dict, List, Optional, Set
from urllib.parse import parse_qs, urlparse

from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json


@dataclass
class LinkCandidate:
    url: str
    domain: str
    anchor_text: str
    context_text: str
    html_start: int
    affiliate_score: int
    commerce_score: int
    affiliate_reasons: List[str]
    is_retailer: bool


@Job.register(name="check_for_ad")
class CheckForAd(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Check For Ad"
    description: str = (
        "Conservative detector for commerce intent, affiliate links, and whether "
        "affiliate/commission disclosure is explicit enough to trust."
    )

    # Strong, high-signal affiliate domains.
    AFFILIATE_NETWORK_DOMAINS: ClassVar[Set[str]] = {
        "amzn.to",
        "howl.me",
        "shop-links.co",
        "go.skimresources.com",
        "skimresources.com",
        "shopstyle.com",
        "shareasale.com",
        "cj.com",
        "jdoqocy.com",
        "tkqlhce.com",
        "anrdoezrs.net",
        "linksynergy.com",
        "rakuten.com",
        "impact.com",
        "impactradius.com",
        "partnerize.com",
        "flexlinks.com",
        "pepperjam.com",
        "awin1.com",
        "avantlink.com",
        "tidd.ly",
        "geni.us",
    }

    # Retailer labels rather than substring fragments like "amazon.".
    RETAILER_LABELS: ClassVar[Set[str]] = {
        "amazon",
        "walmart",
        "target",
        "bestbuy",
        "ebay",
        "newegg",
        "homedepot",
        "lowes",
        "costco",
        "samsung",
        "apple",
        "nike",
        "adidas",
        "wayfair",
        "etsy",
        "macys",
        "kohls",
        "nordstrom",
        "sephora",
        "ulta",
    }

    # Definite or strong affiliate/referral params.
    DEFINITE_AFFILIATE_PARAMS: ClassVar[Set[str]] = {
        "aff",
        "aff_id",
        "affid",
        "affiliate",
        "affiliate_id",
        "aff_source",
        "aff_sub",
        "aff_sub2",
        "refid",
        "ref_id",
        "referral",
        "referrer",
        "subid",
        "sub_id",
        "clickid",
        "irclickid",
        "publisher_id",
        "partnerid",
        "ascsubtag",
        "asc_campaign",
        "campid",
        "pubref",
        "ranmid",
        "ran_eaid",
    }

    # Soft params: not enough alone, but can raise suspicion on commerce pages.
    SOFT_TRACKING_PARAMS: ClassVar[Set[str]] = {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "gclid",
        "fbclid",
        "msclkid",
        "sid",
        "aid",
        "pid",
    }

    DEAL_PATTERNS: ClassVar[List[str]] = [
        r"\bdeal\b",
        r"\bdeals\b",
        r"\bsale\b",
        r"\bdiscount\b",
        r"\bcoupon\b",
        r"\bpromo code\b",
        r"\bpromotion\b",
        r"\blimited[- ]time\b",
        r"\bsave\b",
        r"\bmoney off\b",
        r"\bpercent off\b",
        r"\b\d{1,3}% off\b",
        r"\bbest price\b",
        r"\blowest price\b",
        r"\bon sale\b",
        r"\bprice drop\b",
        r"\bmarkdown\b",
        r"\bblack friday\b",
        r"\bcyber monday\b",
        r"\bgift guide\b",
        r"\bbest\b.{0,30}\bfor\b",
        r"\btop \d+\b",
        r"\bour top picks\b",
        r"\beditor'?s picks?\b",
    ]

    CTA_PATTERNS: ClassVar[List[str]] = [
        r"\bshop now\b",
        r"\bbuy now\b",
        r"\bget deal\b",
        r"\bsee price\b",
        r"\bcheck price\b",
        r"\bview on amazon\b",
        r"\bview deal\b",
        r"\bclaim offer\b",
        r"\bgrab it\b",
    ]

    # Only these count as true disclosure.
    EXPLICIT_DISCLOSURE_PATTERNS: ClassVar[List[str]] = [
        r"\bthis (post|article|page|story|guide)\s+(contains|includes)\s+affiliate links?\b",
        r"\bwe may earn (a )?commission if you (buy|purchase|click)\b",
        r"\bwe earn (a )?commission if you (buy|purchase|click)\b",
        r"\bwe may receive (a )?commission if you (buy|purchase|click)\b",
        r"\bwe receive (a )?commission if you (buy|purchase|click)\b",
        r"\bcommissioned purchases?\b",
        r"\bas an amazon associate\b",
        r"\bearn from qualifying purchases\b",
        r"\baffiliate compensation\b",
        r"\baffiliate commission\b",
        r"\bpaid a commission\b",
        r"\bif you buy through links on this (post|page|article)\b",
        r"\bif you click (these|those|our) links?, we may earn\b",
    ]

    # These are weak. They do NOT count as sufficient affiliate disclosure.
    WEAK_DISCLOSURE_PATTERNS: ClassVar[List[str]] = [
        r"\bsponsored\b",
        r"\badvertisement\b",
        r"\badvertiser disclosure\b",
        r"\bpartner content\b",
        r"\bpaid partnership\b",
        r"\bcompensated\b",
        r"\bpromoted\b",
    ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._latest_prepass: Dict[str, Any] = {}

    async def run(self, platform: str):
        self._platform = platform
        self._model = "x-ai/grok-4.3"
        self._max_retries = 1

        await super().run(platform)

        raw_html = self.input["raw_html"]
        article_title = self.input.get("article_title", "")
        article_url = self.input.get("article_url", "")
        force_llm_check = bool(self.input.get("force_llm_check", False))

        prepass = self._run_prepass(
            raw_html=raw_html,
            article_title=article_title,
            article_url=article_url,
        )
        self._latest_prepass = prepass

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "PREPASS_COMPLETE",
            "details": {
                "force_llm_check": force_llm_check,
                "prepass": {
                    k: v for k, v in prepass.items() if k != "llm_context"
                },
            },
        })

        # Conservative policy:
        # only early-out when there is basically nothing interesting at all.
        should_early_out = prepass["can_early_out"] and not force_llm_check
        if should_early_out:
            early_result = self._build_result_from_prepass(
                prepass=prepass,
                llm_check_ran=False,
                early_out=True,
                force_llm_check=force_llm_check,
            )

            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "EARLY_OUT",
                "details": early_result,
            })

            self._set_output(early_result)
            self.complete()
            return

        title_for_prompt = article_title or "No title provided"
        url_for_prompt = article_url or "No URL provided"

        llm_context = prepass["llm_context"]
        prompt_prepass = {k: v for k, v in prepass.items() if k != "llm_context"}

        self._system_message = """
You are a precise affiliate-disclosure compliance detection engine.
Return ONLY valid JSON. No markdown. No commentary.

Conservative mode rules:
- Presume disclosure is NOT sufficient unless it is explicit.
- Generic labels such as "sponsored", "advertisement", "partner content", or "paid partnership"
  do NOT by themselves count as affiliate disclosure.
- For has_disclosure to be true, the page must clearly tell an ordinary reader that the publisher
  may earn a commission or that links are affiliate links.
- Placement matters. A footer-only disclosure or weak disclosure should usually NOT count.
- If affiliate monetization is reasonably supported and the disclosure is absent, weak, vague,
  or poorly associated with the monetized links, set violation_exists to true.
- When in doubt, prefer false positives over false negatives.

Output JSON schema (STRICT):
{
  "potential_ad": true or false,
  "has_affiliate_links": true or false,
  "has_disclosure": true or false,
  "violation_exists": true or false,
  "reason": "Brief explanation of the overall decision",
  "evidence": [
    "Short evidence item 1",
    "Short evidence item 2"
  ],
  "suspected_affiliate_urls": [
    "URL or partial URL string"
  ],
  "disclosure_snippets": [
    "Disclosure text if present"
  ],
  "llm_check_ran": true,
  "early_out": false,
  "force_llm_check": true or false,
  "prepass_summary": {
    "deal_signal_count": 0,
    "affiliate_signal_count": 0,
    "disclosure_signal_count": 0,
    "commerce_link_count": 0,
    "outbound_url_count": 0,
    "early_out_reason": "string or null"
  }
}

Important interpretation:
- has_disclosure means clear, consumer-facing affiliate/commission disclosure, not merely disclosure-ish text.
- weak disclosure language can appear in disclosure_snippets, but should usually NOT flip has_disclosure to true.
- evidence must always be an array.
- suspected_affiliate_urls must always be an array.
- disclosure_snippets must always be an array.
- prepass_summary must always be an object with the exact keys shown above.

Return ONLY JSON.
""".strip()

        self._user_message = f"""
Analyze this page for:
1. commerce/deal intent,
2. likely affiliate links,
3. whether affiliate/commission disclosure is explicit enough to trust,
4. likely disclosure violation.

Article Title: {title_for_prompt}
Article URL: {url_for_prompt}
Force LLM Check: {json.dumps(force_llm_check)}

Prepass Findings:
{json.dumps(prompt_prepass, ensure_ascii=False, indent=2)}

Affiliate Link Samples:
{json.dumps(llm_context["affiliate_link_samples"], ensure_ascii=False, indent=2)}

Explicit Disclosure Candidates:
{json.dumps(llm_context["explicit_disclosure_candidates"], ensure_ascii=False, indent=2)}

Weak Disclosure Candidates:
{json.dumps(llm_context["weak_disclosure_candidates"], ensure_ascii=False, indent=2)}

Visible Text (start):
{llm_context["visible_text_start"]}

Visible Text (end):
{llm_context["visible_text_end"]}

Respond ONLY with JSON in the exact format specified in the system message.
""".strip()

        try:
            self.run_llm_loop()
        except Exception as e:
            self._set_status(JobStatus.FAILED)
            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "ERROR",
                "details": {"error": str(e)},
            })
            raise

    def _run_prepass(
        self,
        raw_html: str,
        article_title: str = "",
        article_url: str = "",
    ) -> Dict[str, Any]:
        normalized_html = unescape(raw_html or "")
        text_for_scan = self._extract_text_for_scan(normalized_html)
        link_candidates = self._extract_link_candidates(normalized_html)

        outbound_url_count = len(link_candidates)

        deal_matches = self._collect_pattern_matches(text_for_scan, self.DEAL_PATTERNS, 30)
        cta_matches = self._collect_pattern_matches(text_for_scan, self.CTA_PATTERNS, 20)

        commerce_links = [c for c in link_candidates if c.is_retailer or c.commerce_score >= 2]
        affiliate_links = [c for c in link_candidates if c.affiliate_score >= 4]

        explicit_hits = self._find_pattern_hits(
            text=text_for_scan,
            patterns=self.EXPLICIT_DISCLOSURE_PATTERNS,
            max_items=12,
            context=150,
        )
        weak_hits = self._find_pattern_hits(
            text=text_for_scan,
            patterns=self.WEAK_DISCLOSURE_PATTERNS,
            max_items=12,
            context=150,
        )

        near_link_explicit_hits = self._find_explicit_hits_near_links(affiliate_links, max_items=10)

        top_text_window = text_for_scan[: min(len(text_for_scan), 5000)]
        top_explicit_hits = self._find_pattern_hits(
            text=top_text_window,
            patterns=self.EXPLICIT_DISCLOSURE_PATTERNS,
            max_items=6,
            context=150,
        )

        explicit_disclosure_snippets = self._dedupe_preserve_order(
            [hit["snippet"] for hit in explicit_hits]
        )[:10]
        weak_disclosure_snippets = self._dedupe_preserve_order(
            [hit["snippet"] for hit in weak_hits]
        )[:10]
        near_link_disclosure_snippets = self._dedupe_preserve_order(near_link_explicit_hits)[:10]

        suspected_affiliate_urls = self._dedupe_preserve_order(
            [c.url for c in affiliate_links]
        )[:25]

        has_affiliate_links = len(affiliate_links) > 0

        # Conservative disclosure rule:
        # weak hits do not count.
        # explicit text must be near affiliate links or appear clearly and early.
        has_clear_disclosure = bool(near_link_disclosure_snippets) or (
            has_affiliate_links and len(top_explicit_hits) > 0
        )

        potential_ad = (
            len(deal_matches) > 0
            or len(cta_matches) > 0
            or len(commerce_links) >= 2
            or len(affiliate_links) > 0
        )

        violation_exists = has_affiliate_links and not has_clear_disclosure

        evidence: List[str] = []

        if len(deal_matches) > 0:
            evidence.append(f"Detected {len(deal_matches)} deal/recommendation language matches.")

        if len(cta_matches) > 0:
            evidence.append(f"Detected {len(cta_matches)} commerce CTA matches.")

        if len(commerce_links) > 0:
            evidence.append(f"Detected {len(commerce_links)} retailer/commerce links.")

        if has_affiliate_links:
            top_reasons: List[str] = []
            for link in affiliate_links[:5]:
                top_reasons.extend(link.affiliate_reasons)
            top_reasons = self._dedupe_preserve_order(top_reasons)[:6]
            evidence.append(
                f"Detected {len(affiliate_links)} likely affiliate links: "
                + "; ".join(top_reasons)
            )

        if near_link_disclosure_snippets:
            evidence.append("Found explicit affiliate/commission disclosure near monetized link context.")
        elif explicit_disclosure_snippets:
            evidence.append("Found explicit disclosure language, but not strongly tied to link context.")
        elif weak_disclosure_snippets:
            evidence.append("Found weak disclosure-ish language only; not trusted as affiliate disclosure.")

        if violation_exists:
            evidence.append("Likely affiliate monetization appears without sufficiently explicit disclosure.")

        if not potential_ad and not has_affiliate_links and not explicit_disclosure_snippets and not weak_disclosure_snippets:
            reason = "No meaningful commerce, affiliate, or disclosure signals found."
            can_early_out = True
            early_out_reason = "No meaningful commerce, affiliate, or disclosure signals found in prepass."
        else:
            if violation_exists:
                reason = (
                    "Likely affiliate links were found, but no sufficiently explicit, trustworthy affiliate disclosure "
                    "was found near the monetized links or clearly early on the page."
                )
            elif has_affiliate_links and has_clear_disclosure:
                reason = (
                    "Likely affiliate links were found and the page appears to contain explicit affiliate/commission disclosure "
                    "that is strong enough to count."
                )
            elif potential_ad:
                reason = (
                    "Commerce or deal intent was found, but affiliate monetization is not strongly established."
                )
            else:
                reason = "Mixed signals found; LLM review required."

            can_early_out = False
            early_out_reason = None

        affiliate_signal_count = len(affiliate_links)
        disclosure_signal_count = len(explicit_disclosure_snippets)
        commerce_link_count = len(commerce_links)

        llm_context = {
            "affiliate_link_samples": [
                {
                    "url": c.url,
                    "domain": c.domain,
                    "anchor_text": c.anchor_text,
                    "context_text": c.context_text[:500],
                    "affiliate_score": c.affiliate_score,
                    "affiliate_reasons": c.affiliate_reasons[:8],
                }
                for c in affiliate_links[:10]
            ],
            "explicit_disclosure_candidates": explicit_disclosure_snippets[:10],
            "weak_disclosure_candidates": weak_disclosure_snippets[:10],
            "visible_text_start": text_for_scan[:12000],
            "visible_text_end": text_for_scan[-8000:] if len(text_for_scan) > 12000 else "",
        }

        return {
            "potential_ad": potential_ad,
            "has_affiliate_links": has_affiliate_links,
            "has_disclosure": has_clear_disclosure,
            "violation_exists": violation_exists,
            "reason": reason,
            "evidence": evidence[:10],
            "suspected_affiliate_urls": suspected_affiliate_urls,
            "disclosure_snippets": (
                near_link_disclosure_snippets[:10]
                if near_link_disclosure_snippets
                else explicit_disclosure_snippets[:10]
            ),
            "deal_signal_count": len(deal_matches) + len(cta_matches),
            "affiliate_signal_count": affiliate_signal_count,
            "disclosure_signal_count": disclosure_signal_count,
            "commerce_link_count": commerce_link_count,
            "outbound_url_count": outbound_url_count,
            "can_early_out": can_early_out,
            "early_out_reason": early_out_reason,
            "weak_disclosure_snippets": weak_disclosure_snippets[:10],
            "llm_context": llm_context,
        }

    def _build_result_from_prepass(
        self,
        prepass: Dict[str, Any],
        llm_check_ran: bool,
        early_out: bool,
        force_llm_check: bool,
    ) -> Dict[str, Any]:
        return {
            "potential_ad": bool(prepass.get("potential_ad", False)),
            "has_affiliate_links": bool(prepass.get("has_affiliate_links", False)),
            "has_disclosure": bool(prepass.get("has_disclosure", False)),
            "violation_exists": bool(prepass.get("violation_exists", False)),
            "reason": prepass.get("reason", "No reason available"),
            "evidence": list(prepass.get("evidence", []))[:10],
            "suspected_affiliate_urls": list(prepass.get("suspected_affiliate_urls", []))[:25],
            "disclosure_snippets": list(prepass.get("disclosure_snippets", []))[:10],
            "llm_check_ran": llm_check_ran,
            "early_out": early_out,
            "force_llm_check": force_llm_check,
            "prepass_summary": {
                "deal_signal_count": int(prepass.get("deal_signal_count", 0)),
                "affiliate_signal_count": int(prepass.get("affiliate_signal_count", 0)),
                "disclosure_signal_count": int(prepass.get("disclosure_signal_count", 0)),
                "commerce_link_count": int(prepass.get("commerce_link_count", 0)),
                "outbound_url_count": int(prepass.get("outbound_url_count", 0)),
                "early_out_reason": prepass.get("early_out_reason"),
            },
        }

    def _extract_text_for_scan(self, html: str) -> str:
        text = re.sub(r"(?is)<script\b.*?</script>", " ", html)
        text = re.sub(r"(?is)<style\b.*?</style>", " ", text)
        text = re.sub(r"(?is)<!--.*?-->", " ", text)
        text = re.sub(r"(?is)<noscript\b.*?</noscript>", " ", text)
        text = re.sub(r"(?is)<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _strip_tags(self, html: str) -> str:
        return self._extract_text_for_scan(html)

    def _extract_link_candidates(self, html: str) -> List[LinkCandidate]:
        candidates: List[LinkCandidate] = []

        pattern = re.compile(
            r'(?is)<a\b([^>]*?)href\s*=\s*["\']([^"\']+)["\']([^>]*)>(.*?)</a>'
        )

        for match in pattern.finditer(html):
            raw_url = unescape((match.group(2) or "").strip())
            if not raw_url.startswith(("http://", "https://")):
                continue

            parsed = urlparse(raw_url)
            domain = (parsed.netloc or "").lower()
            if not domain:
                continue

            attrs = f"{match.group(1)} {match.group(3)}".strip()
            anchor_html = match.group(4) or ""
            anchor_text = self._strip_tags(anchor_html)
            context_html = html[max(0, match.start() - 500): min(len(html), match.end() + 500)]
            context_text = self._extract_text_for_scan(context_html)

            affiliate_score, commerce_score, affiliate_reasons, is_retailer = self._score_link_candidate(
                url=raw_url,
                domain=domain,
                query_params=parse_qs(parsed.query),
                attrs=attrs,
                anchor_text=anchor_text,
                context_text=context_text,
                path=parsed.path or "",
            )

            candidates.append(
                LinkCandidate(
                    url=raw_url,
                    domain=domain,
                    anchor_text=anchor_text[:300],
                    context_text=context_text[:900],
                    html_start=match.start(),
                    affiliate_score=affiliate_score,
                    commerce_score=commerce_score,
                    affiliate_reasons=affiliate_reasons[:10],
                    is_retailer=is_retailer,
                )
            )

        return candidates

    def _score_link_candidate(
        self,
        url: str,
        domain: str,
        query_params: Dict[str, List[str]],
        attrs: str,
        anchor_text: str,
        context_text: str,
        path: str,
    ) -> tuple[int, int, List[str], bool]:
        affiliate_score = 0
        commerce_score = 0
        reasons: List[str] = []

        qkeys = {k.lower() for k in query_params.keys()}
        attrs_lower = attrs.lower()
        combined_text = f"{anchor_text} {context_text}".lower()

        is_retailer = self._is_retailer_domain(domain)
        is_affiliate_network = any(self._domain_matches_suffix(domain, d) for d in self.AFFILIATE_NETWORK_DOMAINS)

        if is_retailer:
            commerce_score += 2
            reasons.append("retailer-domain")

        if is_affiliate_network:
            affiliate_score += 6
            reasons.append("affiliate-network-domain")

        # Amazon only counts strongly when an associate tag is present.
        if self._domain_contains_label(domain, "amazon") and "tag" in qkeys:
            affiliate_score += 6
            reasons.append("amazon-tag-param")

        definite_hits = sorted(qkeys & self.DEFINITE_AFFILIATE_PARAMS)
        if definite_hits:
            affiliate_score += min(6, 2 * len(definite_hits))
            reasons.append(f"affiliate-query-params:{','.join(definite_hits[:4])}")

        soft_hits = sorted(qkeys & self.SOFT_TRACKING_PARAMS)
        if soft_hits and is_retailer:
            commerce_score += 1
            reasons.append(f"tracking-query-params:{','.join(soft_hits[:4])}")

        if 'rel="sponsored"' in attrs_lower or "rel='sponsored'" in attrs_lower:
            affiliate_score += 2
            reasons.append("rel-sponsored")

        if self._contains_any_pattern(anchor_text, self.CTA_PATTERNS):
            commerce_score += 1
            reasons.append("cta-anchor-text")

        if self._contains_any_pattern(context_text, self.CTA_PATTERNS):
            commerce_score += 1
            reasons.append("cta-near-link")

        if self._contains_any_pattern(context_text, self.DEAL_PATTERNS):
            commerce_score += 1
            reasons.append("deal-language-near-link")

        # Conservative nudge:
        # a commerce-heavy retailer link with soft tracking still gets some suspicion,
        # but not enough by itself without stronger evidence.
        if is_retailer and soft_hits and commerce_score >= 3:
            affiliate_score += 1
            reasons.append("tracked-commerce-link")

        # Avoid overcalling plain Amazon product links with random params.
        # Plain /dp/ links without tag do not get affiliate credit.

        return affiliate_score, commerce_score, self._dedupe_preserve_order(reasons), is_retailer

    def _find_explicit_hits_near_links(
        self,
        affiliate_links: List[LinkCandidate],
        max_items: int = 10,
    ) -> List[str]:
        snippets: List[str] = []

        for link in affiliate_links:
            hits = self._find_pattern_hits(
                text=link.context_text,
                patterns=self.EXPLICIT_DISCLOSURE_PATTERNS,
                max_items=2,
                context=150,
            )
            for hit in hits:
                snippets.append(hit["snippet"])
                if len(snippets) >= max_items:
                    return self._dedupe_preserve_order(snippets)

        return self._dedupe_preserve_order(snippets)

    def _find_pattern_hits(
        self,
        text: str,
        patterns: List[str],
        max_items: int = 10,
        context: int = 120,
    ) -> List[Dict[str, Any]]:
        hits: List[Dict[str, Any]] = []

        for pattern in patterns:
            for match in re.finditer(pattern, text, flags=re.IGNORECASE):
                start = max(0, match.start() - context)
                end = min(len(text), match.end() + context)
                snippet = text[start:end].strip()

                hits.append({
                    "pattern": pattern,
                    "start": match.start(),
                    "end": match.end(),
                    "snippet": snippet,
                })

                if len(hits) >= max_items:
                    return hits

        return hits

    def _collect_pattern_matches(
        self,
        text: str,
        patterns: List[str],
        max_items: int = 20,
    ) -> List[str]:
        matches: List[str] = []

        for pattern in patterns:
            for match in re.finditer(pattern, text, flags=re.IGNORECASE):
                matches.append(match.group(0))
                if len(matches) >= max_items:
                    return matches

        return matches

    def _contains_any_pattern(self, text: str, patterns: List[str]) -> bool:
        for pattern in patterns:
            if re.search(pattern, text, flags=re.IGNORECASE):
                return True
        return False

    def _domain_matches_suffix(self, domain: str, suffix: str) -> bool:
        return domain == suffix or domain.endswith("." + suffix)

    def _domain_contains_label(self, domain: str, label: str) -> bool:
        return label in domain.split(".")

    def _is_retailer_domain(self, domain: str) -> bool:
        for label in self.RETAILER_LABELS:
            if self._domain_contains_label(domain, label):
                return True
        return False

    def _dedupe_preserve_order(self, items: List[str]) -> List[str]:
        seen = set()
        output: List[str] = []
        for item in items:
            if item not in seen:
                seen.add(item)
                output.append(item)
        return output

    def got_valid_result(self, result):
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"status": self.status},
        })

        force_llm_check = bool(self.input.get("force_llm_check", False))
        fallback = self._build_result_from_prepass(
            prepass=self._latest_prepass or {},
            llm_check_ran=True,
            early_out=False,
            force_llm_check=force_llm_check,
        )

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
        except Exception:
            fallback["reason"] = "Failed to parse LLM response; falling back to conservative prepass result."
            self._set_output(fallback)
            self.complete()
            return

        defaults = fallback.copy()
        defaults["llm_check_ran"] = True
        defaults["early_out"] = False

        if not isinstance(results_obj, dict):
            results_obj = {}

        merged = {
            "potential_ad": bool(results_obj.get("potential_ad", defaults["potential_ad"])),
            "has_affiliate_links": bool(results_obj.get("has_affiliate_links", defaults["has_affiliate_links"])),
            "has_disclosure": bool(results_obj.get("has_disclosure", defaults["has_disclosure"])),
            "violation_exists": bool(results_obj.get("violation_exists", defaults["violation_exists"])),
            "reason": str(results_obj.get("reason", defaults["reason"])),
            "evidence": results_obj.get("evidence", defaults["evidence"]),
            "suspected_affiliate_urls": results_obj.get(
                "suspected_affiliate_urls",
                defaults["suspected_affiliate_urls"],
            ),
            "disclosure_snippets": results_obj.get(
                "disclosure_snippets",
                defaults["disclosure_snippets"],
            ),
            "llm_check_ran": True,
            "early_out": False,
            "force_llm_check": bool(results_obj.get("force_llm_check", force_llm_check)),
            "prepass_summary": results_obj.get("prepass_summary", defaults["prepass_summary"]),
        }

        if not isinstance(merged["evidence"], list):
            merged["evidence"] = defaults["evidence"]

        if not isinstance(merged["suspected_affiliate_urls"], list):
            merged["suspected_affiliate_urls"] = defaults["suspected_affiliate_urls"]

        if not isinstance(merged["disclosure_snippets"], list):
            merged["disclosure_snippets"] = defaults["disclosure_snippets"]

        if not isinstance(merged["prepass_summary"], dict):
            merged["prepass_summary"] = defaults["prepass_summary"]

        required_prepass_keys = [
            "deal_signal_count",
            "affiliate_signal_count",
            "disclosure_signal_count",
            "commerce_link_count",
            "outbound_url_count",
            "early_out_reason",
        ]
        for key in required_prepass_keys:
            if key not in merged["prepass_summary"]:
                merged["prepass_summary"][key] = (
                    None if key == "early_out_reason" else 0
                )

        self._set_output(merged)
        self.complete()

    def is_valid_result(self, result):
        if super().is_valid_result(result) is False:
            return False

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
        except Exception:
            return False

        if not isinstance(results_obj, dict):
            return False

        required_keys = [
            "potential_ad",
            "has_affiliate_links",
            "has_disclosure",
            "violation_exists",
            "llm_check_ran",
            "early_out",
            "force_llm_check",
            "prepass_summary",
        ]

        for key in required_keys:
            if key not in results_obj:
                return False

        if not isinstance(results_obj["prepass_summary"], dict):
            return False

        return True