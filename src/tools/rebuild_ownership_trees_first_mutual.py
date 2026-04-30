#!/usr/bin/env python3
"""
Rebuild persisted Supabase ownership trees using the first-mutual-owner ruleset.

This tool does not write to Weaviate. It reads completed article_queue rows with
ownership_tree_id, recomputes each referenced ownership_trees row from Weaviate,
then updates Supabase ownership_tree, investigation_data, and summary.

Usage:
    python3 src/tools/rebuild_ownership_trees_first_mutual.py --dry-run
    python3 src/tools/rebuild_ownership_trees_first_mutual.py --limit 25
    python3 src/tools/rebuild_ownership_trees_first_mutual.py --ownership-tree-id <uuid>
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from supabase import create_client

from app.util.common_owner_frontier import (
    COMMON_OWNER_RULESET,
    is_frontier_ruleset,
    serialize_common_owner_results,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

INF = float("inf")
RETRYABLE_BACKOFF_SECONDS = (1.0, 2.0, 5.0)


def get_supabase_client():
    from dotenv import load_dotenv

    load_dotenv()
    url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(url, service_role_key)


def run_sync_with_retry(operation_name: str, operation):
    last_error = None
    for attempt, delay in enumerate((0.0, *RETRYABLE_BACKOFF_SECONDS), start=1):
        if delay:
            time.sleep(delay)
        try:
            return operation()
        except Exception as exc:
            last_error = exc
            if attempt >= len(RETRYABLE_BACKOFF_SECONDS) + 1:
                break
            logger.warning("%s failed on attempt %s; retrying: %s", operation_name, attempt, exc)
    raise last_error


async def run_async_with_retry(operation_name: str, operation):
    last_error = None
    for attempt, delay in enumerate((0.0, *RETRYABLE_BACKOFF_SECONDS), start=1):
        if delay:
            await asyncio.sleep(delay)
        try:
            return await operation()
        except Exception as exc:
            last_error = exc
            if attempt >= len(RETRYABLE_BACKOFF_SECONDS) + 1:
                break
            logger.warning("%s failed on attempt %s; retrying: %s", operation_name, attempt, exc)
    raise last_error


def parse_json_field(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        return json.loads(raw)
    return {}


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))


def entity_id(entity: Any) -> Optional[str]:
    if isinstance(entity, dict):
        value = entity.get("id")
    else:
        value = getattr(entity, "id", None)
    return str(value) if value else None


def entity_name(entity: Any, fallback: str = "?") -> str:
    if isinstance(entity, dict):
        return entity.get("name") or fallback
    return getattr(entity, "name", None) or fallback


def relationship_source(rel: Dict[str, Any]) -> Optional[str]:
    return rel.get("source_entity_id") or rel.get("source")


def relationship_target(rel: Dict[str, Any]) -> Optional[str]:
    return rel.get("target_entity_id") or rel.get("target")


def bfs_distances(relationships: Dict[str, Dict[str, Any]], start_id: str) -> Dict[str, int]:
    owners_of: Dict[str, List[str]] = {}
    for rel in relationships.values():
        source = relationship_source(rel)
        target = relationship_target(rel)
        if not source or not target:
            continue
        owners_of.setdefault(target, []).append(source)

    distances: Dict[str, int] = {}
    queue = deque([(start_id, 0)])
    while queue:
        current_id, distance = queue.popleft()
        if current_id in distances:
            continue
        distances[current_id] = distance
        for owner_id in owners_of.get(current_id, []):
            if owner_id not in distances:
                queue.append((owner_id, distance + 1))
    return distances


def existing_ranking_index(investigation_data: Dict[str, Any]) -> Dict[str, Tuple[int, Dict[str, Any]]]:
    ranking = ((investigation_data.get("final_ranking") or {}).get("ranking") or [])
    out: Dict[str, Tuple[int, Dict[str, Any]]] = {}
    for idx, entry in enumerate(ranking):
        company_id = entry.get("company_id") or (entry.get("company") or {}).get("id")
        if company_id:
            out[str(company_id)] = (idx, entry)
    return out


def choose_top_owner(
    *,
    common_owner_results: Dict[str, Any],
    news_site: Dict[str, Any],
    article_subject: Dict[str, Any],
    investigation_data: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    common_owners = common_owner_results.get("common_owners") or {}
    if not common_owners:
        return None

    relationships = common_owner_results.get("relationships") or {}
    news_site_id = entity_id(news_site)
    article_subject_id = entity_id(article_subject)
    if not news_site_id or not article_subject_id:
        first_id = sorted(common_owners.keys(), key=lambda owner_id: entity_name(common_owners[owner_id]))[0]
        return common_owners[first_id]

    news_dist = bfs_distances(relationships, news_site_id)
    subject_dist = bfs_distances(relationships, article_subject_id)
    rank_index = existing_ranking_index(investigation_data)

    def sort_key(owner_id: str) -> Tuple[float, int, str]:
        total_distance = news_dist.get(owner_id, INF) + subject_dist.get(owner_id, INF)
        ranking_position = rank_index.get(owner_id, (10**9, {}))[0]
        return (total_distance, ranking_position, entity_name(common_owners[owner_id]).casefold())

    best_id = sorted(common_owners.keys(), key=sort_key)[0]
    return common_owners[best_id]


def build_repaired_ranking(
    *,
    common_owner_results: Dict[str, Any],
    top_owner: Optional[Dict[str, Any]],
    investigation_data: Dict[str, Any],
) -> Dict[str, Any]:
    common_owners = common_owner_results.get("common_owners") or {}
    existing_rank = existing_ranking_index(investigation_data)
    top_owner_id = entity_id(top_owner)

    def rank_sort_key(item: Tuple[str, Dict[str, Any]]) -> Tuple[int, int, str]:
        owner_id, owner = item
        top_sort = 0 if owner_id == top_owner_id else 1
        existing_sort = existing_rank.get(owner_id, (10**9, {}))[0]
        return (top_sort, existing_sort, entity_name(owner).casefold())

    ranking: List[Dict[str, Any]] = []
    for idx, (owner_id, owner) in enumerate(sorted(common_owners.items(), key=rank_sort_key), start=1):
        previous = existing_rank.get(owner_id, (None, {}))[1]
        ranking.append({
            "rank": idx,
            "company_id": owner_id,
            "company_name": entity_name(owner),
            "capital_influence_level": previous.get("capital_influence_level", "Unknown"),
            "confidence": previous.get("confidence", 1.0),
            "justification": previous.get(
                "justification",
                f"Rebuilt by {COMMON_OWNER_RULESET}; terminal first-mutual-owner candidate.",
            ),
        })

    return {
        "entities": common_owners,
        "ranking": ranking,
        "metadata": {
            "rebuilt_by": Path(__file__).name,
            "common_owner_ruleset": COMMON_OWNER_RULESET,
        },
    }


def collect_evidence_ids(investigation_data: Dict[str, Any]) -> List[str]:
    common_results = investigation_data.get("common_owner_results") or {}
    evidence_ids = set()

    for entity_key in ("news_site", "article_subject"):
        entity = investigation_data.get(entity_key) or {}
        evidence_ids.update(entity.get("evidence_ids") or [])

    for rel in (common_results.get("relationships") or {}).values():
        evidence_ids.update(rel.get("evidence_ids") or [])

    for entity in (common_results.get("owner_entities") or {}).values():
        evidence_ids.update(entity.get("evidence_ids") or [])

    return sorted(evidence_ids)


async def serialize_evidence(evidence_ids: Iterable[str]) -> List[Dict[str, Any]]:
    ids = list(evidence_ids)
    if not ids:
        return []

    from app.core.db.database_service import DatabaseService

    service = DatabaseService.get()
    try:
        evidence_list = await service.get_evidence_batch(ids)
    except Exception as exc:
        logger.warning("Could not hydrate %s evidence records; continuing without embedded evidence: %s", len(ids), exc)
        return []

    serialized = []
    for evidence in evidence_list or []:
        if evidence and hasattr(evidence, "to_serializeable_object"):
            serialized.append(evidence.to_serializeable_object())
    return serialized


async def build_new_payload(ot_row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    investigation_data = parse_json_field(ot_row.get("investigation_data"))
    current_ownership_tree = parse_json_field(ot_row.get("ownership_tree"))

    article_subject = investigation_data.get("article_subject") or {}
    news_site = investigation_data.get("news_site") or {}

    article_subject_id = entity_id(article_subject) or ot_row.get("company_a")
    news_site_id = entity_id(news_site) or ot_row.get("company_b")
    if not article_subject_id or not news_site_id:
        logger.warning("[%s] Missing company ids, skipping", ot_row.get("id"))
        return None

    from app.core.db.database_service import DatabaseService

    service = DatabaseService.get()
    article_subject_entity = await run_async_with_retry(
        f"fetch entity {article_subject_id}",
        lambda: service.get_entity(article_subject_id),
    )
    news_site_entity = await run_async_with_retry(
        f"fetch entity {news_site_id}",
        lambda: service.get_entity(news_site_id),
    )
    if article_subject_entity is None or news_site_entity is None:
        logger.warning("[%s] Could not fetch one or both entities from Weaviate", ot_row.get("id"))
        return None

    common_owner_results_raw = await run_async_with_retry(
        "find common owners frontier",
        lambda: service.find_common_owners_between_entities(
            entity_a=news_site_entity,
            entity_b=article_subject_entity,
        ),
    )
    common_owner_results = serialize_common_owner_results(common_owner_results_raw)

    if not investigation_data:
        investigation_data = {}
    investigation_data["news_site"] = (
        news_site if news_site else news_site_entity.to_serializeable_object()
    )
    investigation_data["article_subject"] = (
        article_subject if article_subject else article_subject_entity.to_serializeable_object()
    )
    investigation_data["common_owner_results"] = common_owner_results

    top_owner = choose_top_owner(
        common_owner_results=common_owner_results,
        news_site=investigation_data["news_site"],
        article_subject=investigation_data["article_subject"],
        investigation_data=investigation_data,
    )
    investigation_data["top_owner"] = top_owner
    investigation_data["final_ranking"] = build_repaired_ranking(
        common_owner_results=common_owner_results,
        top_owner=top_owner,
        investigation_data=investigation_data,
    )
    investigation_data["evidence"] = await serialize_evidence(collect_evidence_ids(investigation_data))

    subject_name = entity_name(investigation_data.get("article_subject"))
    news_name = entity_name(investigation_data.get("news_site"))
    if top_owner:
        summary = f"{entity_name(top_owner)} owns both {subject_name} and {news_name}"
    else:
        summary = f"No common owner found between {subject_name} and {news_name}"

    new_ownership_tree = dict(common_owner_results)
    new_ownership_tree["topOwner"] = top_owner

    changed = (
        not is_frontier_ruleset(current_ownership_tree)
        or stable_json(current_ownership_tree.get("common_owners") or {}) != stable_json(new_ownership_tree.get("common_owners") or {})
        or stable_json(current_ownership_tree.get("relationships") or {}) != stable_json(new_ownership_tree.get("relationships") or {})
        or stable_json(current_ownership_tree.get("owner_entities") or {}) != stable_json(new_ownership_tree.get("owner_entities") or {})
        or stable_json(current_ownership_tree.get("a_ownership_tree") or {}) != stable_json(new_ownership_tree.get("a_ownership_tree") or {})
        or stable_json(current_ownership_tree.get("b_ownership_tree") or {}) != stable_json(new_ownership_tree.get("b_ownership_tree") or {})
        or stable_json(current_ownership_tree.get("topOwner")) != stable_json(top_owner)
        or stable_json(parse_json_field(ot_row.get("investigation_data")).get("top_owner")) != stable_json(top_owner)
        or (ot_row.get("summary") or "") != summary
    )

    return {
        "ownership_tree": new_ownership_tree,
        "investigation_data": investigation_data,
        "summary": summary,
        "changed": changed,
        "old_counts": {
            "common_owners": len((current_ownership_tree.get("common_owners") or {})),
            "relationships": len((current_ownership_tree.get("relationships") or {})),
            "owner_entities": len((current_ownership_tree.get("owner_entities") or {})),
        },
        "new_counts": {
            "common_owners": len(common_owner_results.get("common_owners") or {}),
            "relationships": len(common_owner_results.get("relationships") or {}),
            "owner_entities": len(common_owner_results.get("owner_entities") or {}),
        },
    }


async def process_ownership_tree(supabase, ot_row: Dict[str, Any], *, dry_run: bool) -> bool:
    tree_id = ot_row.get("id")
    payload = await build_new_payload(ot_row)
    if payload is None:
        return False

    old_counts = payload["old_counts"]
    new_counts = payload["new_counts"]
    top_owner = payload["investigation_data"].get("top_owner")
    logger.info(
        "[%s] %s common=%s->%s rels=%s->%s entities=%s->%s top_owner=%s",
        str(tree_id)[:8],
        "UPDATE" if payload["changed"] else "OK",
        old_counts["common_owners"],
        new_counts["common_owners"],
        old_counts["relationships"],
        new_counts["relationships"],
        old_counts["owner_entities"],
        new_counts["owner_entities"],
        entity_name(top_owner, "None") if top_owner else "None",
    )

    if not payload["changed"]:
        return False

    if dry_run:
        return True

    result = run_sync_with_retry(
        f"update ownership_tree {tree_id}",
        lambda: (
            supabase.table("ownership_trees")
            .update({
                "ownership_tree": payload["ownership_tree"],
                "investigation_data": payload["investigation_data"],
                "summary": payload["summary"],
            })
            .eq("id", tree_id)
            .execute()
        ),
    )
    if result.data:
        return True

    logger.error("[%s] Supabase update returned no rows", str(tree_id)[:8])
    return False


def fetch_ownership_tree(supabase, tree_id: str) -> Optional[Dict[str, Any]]:
    result = run_sync_with_retry(
        f"fetch ownership_tree {tree_id}",
        lambda: (
            supabase.table("ownership_trees")
            .select("id, company_a, company_b, ownership_tree, investigation_data, summary")
            .eq("id", tree_id)
            .limit(1)
            .execute()
        ),
    )
    return (result.data or [None])[0]


def fetch_complete_article_rows(supabase, *, limit: int, page_size: int) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    offset = 0

    while True:
        if limit > 0 and len(rows) >= limit:
            return rows[:limit]

        upper = offset + page_size - 1
        query = (
            supabase.table("article_queue")
            .select("id, url, status, ownership_tree_id")
            .eq("status", "complete")
            .not_.is_("ownership_tree_id", "null")
            .range(offset, upper)
        )
        result = run_sync_with_retry("fetch complete article rows", query.execute)
        batch = result.data or []
        if not batch:
            return rows

        rows.extend(batch)
        if len(batch) < page_size:
            return rows[:limit] if limit > 0 else rows

        offset += page_size


async def main():
    parser = argparse.ArgumentParser(description="Rebuild Supabase ownership trees using first mutual owner frontier")
    parser.add_argument("--dry-run", action="store_true", help="Show updates without writing to Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Limit article_queue rows to scan (0 = all)")
    parser.add_argument("--max-updates", type=int, default=0, help="Stop after N changed trees (0 = unlimited)")
    parser.add_argument("--batch-size", type=int, default=100, help="Supabase article_queue page size")
    parser.add_argument("--ownership-tree-id", type=str, default=None, help="Process a specific ownership_trees row")
    args = parser.parse_args()

    supabase = get_supabase_client()

    if args.dry_run:
        logger.info("DRY RUN MODE - no Supabase updates will be written")

    if args.ownership_tree_id:
        try:
            row = fetch_ownership_tree(supabase, args.ownership_tree_id)
            if not row:
                logger.error("No ownership_tree found for id: %s", args.ownership_tree_id)
                return
            changed = await process_ownership_tree(supabase, row, dry_run=args.dry_run)
            logger.info("%s. Changed: %s", "DRY RUN" if args.dry_run else "Done", 1 if changed else 0)
            return
        except Exception as exc:
            logger.exception("Failed to process ownership_tree %s: %s", args.ownership_tree_id, exc)
            return

    try:
        article_rows = fetch_complete_article_rows(
            supabase,
            limit=args.limit,
            page_size=args.batch_size,
        )
    except Exception as exc:
        logger.exception("Failed to list completed article rows: %s", exc)
        return
    tree_ids = []
    seen = set()
    for row in article_rows:
        tree_id = row.get("ownership_tree_id")
        if tree_id and tree_id not in seen:
            seen.add(tree_id)
            tree_ids.append(tree_id)

    logger.info("Found %s complete article rows referencing %s unique ownership trees", len(article_rows), len(tree_ids))

    changed_count = 0
    processed_count = 0
    for tree_id in tree_ids:
        if args.max_updates > 0 and changed_count >= args.max_updates:
            logger.info("Reached --max-updates limit (%s)", args.max_updates)
            break

        try:
            row = fetch_ownership_tree(supabase, tree_id)
            if not row:
                logger.warning("[%s] ownership_tree row missing", str(tree_id)[:8])
                continue
            changed = await process_ownership_tree(supabase, row, dry_run=args.dry_run)
            if changed:
                changed_count += 1
            processed_count += 1
        except Exception as exc:
            logger.exception("[%s] Error processing tree: %s", str(tree_id)[:8], exc)

    logger.info(
        "%s. Processed %s trees, changed %s",
        "DRY RUN" if args.dry_run else "Done",
        processed_count,
        changed_count,
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        database_service_module = sys.modules.get("app.core.db.database_service")
        database_service_cls = getattr(database_service_module, "DatabaseService", None)
        database_service = getattr(database_service_cls, "_instance", None)
        if database_service is not None:
            database_service.shutdown()
