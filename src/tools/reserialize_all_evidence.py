#!/usr/bin/env python3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
import argparse
from typing import Any, Dict, List, Set
import logging

from supabase import create_client
from app.util.get_value_safe import get_value_safe
from app.core.db.database_service import DatabaseService

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def get_supabase_client():
    url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(url, service_role_key)


def collect_all_evidence_ids(final_output: Dict[str, Any]) -> List[str]:
    evidence_ids: Set[str] = set()

    common_results = final_output.get("common_owner_results", {})
    if not common_results:
        return []

    relationships = common_results.get("relationships", {})
    for rel in relationships.values():
        rel_evidence = get_value_safe(rel, "evidence_ids", []) or []
        evidence_ids.update(rel_evidence)

    owner_entities = common_results.get("owner_entities", {})
    for ent in owner_entities.values():
        ent_evidence = get_value_safe(ent, "evidence_ids", []) or []
        evidence_ids.update(ent_evidence)

    news_site = final_output.get("news_site")
    if news_site:
        ns_evidence = get_value_safe(news_site, "evidence_ids", []) or []
        evidence_ids.update(ns_evidence)

    article_subject = final_output.get("article_subject")
    if article_subject:
        as_evidence = get_value_safe(article_subject, "evidence_ids", []) or []
        evidence_ids.update(as_evidence)

    return list(evidence_ids)


def serialize_evidence(evidence_ids: List[str], update_null_dates: bool = False, update_weaviate: bool = False) -> List[Dict[str, Any]]:
    from app.core.db.weaviate import weaviate_wrapper as ww
    from datetime import datetime, timezone
    from app.core.db.models import Evidence
    import asyncio

    serialized = []
    service = DatabaseService.get()

    async def fetch_and_serialize():
        client = await ww.create_async_client()
        try:
            for ev_id in evidence_ids:
                if not ev_id:
                    continue
                try:
                    evidence = await service.get_evidence(ev_id)
                    if evidence:
                        serialized_obj = evidence.to_serializeable_object()

                        if update_null_dates and serialized_obj.get("date") is None:
                            evidence_with_meta = await ww.fetch_evidence_with_metadata(client, ev_id)
                            if evidence_with_meta:
                                meta = evidence_with_meta.get("_additional", {})
                                last_update = meta.get("lastUpdateTimeUnix")
                                if last_update:
                                    ts = int(last_update)
                                    new_date = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                                    serialized_obj["date"] = new_date.isoformat()

                                    if update_weaviate:
                                        evidence.date = new_date
                                        await service.update_evidence(evidence)
                                        logger.info(f"Updated Weaviate evidence {ev_id} with date {new_date.isoformat()}")

                        serialized.append(serialized_obj)
                except Exception as e:
                    logger.warning(f"Failed to fetch evidence {ev_id}: {e}")
        finally:
            await client.close()

    asyncio.run(fetch_and_serialize())
    return serialized


def process_ownership_tree(supabase, row: Dict[str, Any], args) -> bool:
    import json

    row_id = row.get("id")
    logger.info(f"Processing ownership_tree: {row_id}")

    raw_investigation_data = row.get("investigation_data", "{}")

    if isinstance(raw_investigation_data, str):
        investigation_data = json.loads(raw_investigation_data)
    else:
        investigation_data = raw_investigation_data

    if not investigation_data:
        logger.warning(f"  No investigation_data, skipping")
        return False

    evidence_ids = collect_all_evidence_ids(investigation_data)
    if not evidence_ids:
        logger.warning(f"  No evidence IDs found, skipping")
        return False

    logger.info(f"  Found {len(evidence_ids)} evidence IDs")

    evidence = serialize_evidence(evidence_ids, update_null_dates=args.update_dates, update_weaviate=args.update_weaviate)
    logger.info(f"  Serialized {len(evidence)} evidence objects")

    investigation_data["evidence"] = evidence

    if args.dry_run:
        logger.info(f"  [DRY RUN] Would update investigation_data with {len(evidence)} evidence items")
        return True

    update_result = (
        supabase.table("ownership_trees")
        .update({"investigation_data": investigation_data})
        .eq("id", row_id)
        .execute()
    )

    if update_result.data:
        logger.info(f"  Updated ownership_tree {row_id}")
        return True
    else:
        logger.error(f"  Failed to update ownership_tree {row_id}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Reserialize all ownership_trees with full evidence")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be updated without persisting")
    parser.add_argument("--update-dates", action="store_true", help="Update null dates with lastUpdateTimeUnix from Weaviate")
    parser.add_argument("--update-weaviate", action="store_true", help="Also update the Weaviate evidence records with the new dates")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of ownership_trees to process")
    args = parser.parse_args()

    supabase = get_supabase_client()

    query = supabase.table("ownership_trees").select("id, investigation_data, company_a, company_b")

    if args.limit:
        query = query.limit(args.limit)

    result = query.execute()

    if not result.data:
        logger.warning("No ownership_trees found")
        return

    logger.info(f"Found {len(result.data)} ownership_trees")

    processed = 0
    skipped = 0
    failed = 0

    for row in result.data:
        try:
            success = process_ownership_tree(supabase, row, args)
            if success:
                processed += 1
            else:
                skipped += 1
        except Exception as e:
            logger.error(f"Error processing {row.get('id')}: {e}")
            failed += 1

    logger.info(f"\nSummary: processed={processed}, skipped={skipped}, failed={failed}")


if __name__ == "__main__":
    main()
