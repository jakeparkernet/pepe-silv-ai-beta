#!/usr/bin/env python3
"""
Fixes ownership_tree records where common_owners was stored as a list instead of a dict.
Also ensures top_owner is a common_owner.

Usage:
    python fix_common_owners_format.py [--dry-run] [--limit N] [--batch-size N]
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
import argparse
import asyncio
import logging

from supabase import create_client

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def get_supabase_client():
    from dotenv import load_dotenv
    load_dotenv()

    url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(url, service_role_key)


def is_list_format(common_owners) -> bool:
    """Check if common_owners is in the old list format."""
    return isinstance(common_owners, list)


def convert_common_owners_list_to_dict(common_owners_list, owner_entities: dict) -> dict:
    """Convert list format to dict format using owner_entities."""
    result = {}
    for item in common_owners_list:
        if isinstance(item, dict):
            entity_id = item.get("id")
            if entity_id and entity_id in owner_entities:
                result[entity_id] = owner_entities[entity_id]
            elif entity_id:
                from app.core.db.models import Entity
                entity = Entity()
                entity.deserialize(item)
                result[entity_id] = entity
        elif hasattr(item, "id"):
            entity_id = item.id
            if entity_id in owner_entities:
                result[entity_id] = owner_entities[entity_id]
            else:
                result[entity_id] = item
    return result


def fix_investigation_data(investigation_data) -> tuple:
    """
    Fix the investigation_data if needed.
    Returns (fixed_data, was_fixed).
    """
    if not investigation_data:
        return investigation_data, False

    if isinstance(investigation_data, str):
        import json
        investigation_data = json.loads(investigation_data)

    fixed = False
    result = dict(investigation_data)

    logger.info(f"  Processing: top_owner present: {'top_owner' in result}, keys: {list(result.keys())}")

    common_owner_results = result.get("common_owner_results", {})

    if common_owner_results is None:
        return result, False

    if not common_owner_results:
        return result, False

    common_owners = common_owner_results.get("common_owners")

    if common_owners is None:
        return result, False

    if is_list_format(common_owners):
        logger.info(f"  Found common_owners as list with {len(common_owners)} items")
        owner_entities = common_owner_results.get("owner_entities", {})
        converted = convert_common_owners_list_to_dict(common_owners, owner_entities)
        logger.info(f"  Converted to dict with {len(converted)} items")
        common_owner_results["common_owners"] = converted
        result["common_owner_results"] = common_owner_results
        fixed = True
    elif not isinstance(common_owners, dict):
        logger.info(f"  common_owners is unexpected type: {type(common_owners).__name__}")

    # Check and fix top_owner - ALWAYS run this logic to handle edge cases
    top_owner = result.get("top_owner")
    common_owners_after = common_owner_results.get("common_owners", {})

    # Always recalculate top_owner from common_owners + ranking, and regenerate summary
    top_owner = result.get("top_owner")
    common_owners_after = common_owner_results.get("common_owners", {})

    if isinstance(common_owners_after, dict) and common_owners_after:
        common_owner_ids = set(common_owners_after.keys())

        # Find top ranked common owner from ranking
        final_ranking = result.get("final_ranking", {})
        ranking = final_ranking.get("ranking", [])
        entities = final_ranking.get("entities", {})

        top_common_owner = None
        for rank_entry in ranking:
            company_id = rank_entry.get("company_id") or (rank_entry.get("company") or {}).get("id")
            if company_id and company_id in common_owner_ids:
                top_common_owner = entities.get(company_id)
                if top_common_owner:
                    logger.info(f"  Found top ranked common_owner: '{top_common_owner.get('name', company_id)}'")
                    break

        if top_common_owner:
            current_top = result.get("top_owner")
            current_top_id = current_top.get("id") if isinstance(current_top, dict) else getattr(current_top, "id", None) if current_top else None
            if current_top_id != top_common_owner.get("id"):
                result["top_owner"] = top_common_owner
                fixed = True
                logger.info("  Updated top_owner to highest ranked common_owner")
        else:
            if top_owner is not None:
                result["top_owner"] = None
                fixed = True
                logger.info("  Set top_owner to None (no common owners in ranking)")
    elif isinstance(common_owners_after, dict) and not common_owners_after:
        if top_owner is not None:
            result["top_owner"] = None
            fixed = True
            logger.info("  No common_owners, setting top_owner to None")

    return result, fixed


def generate_summary(investigation_data: dict) -> str:
    """Regenerate the summary based on top_owner and article info."""
    article_subject = investigation_data.get("article_subject")
    news_site = investigation_data.get("news_site")
    top_owner = investigation_data.get("top_owner")

    article_subject_name = article_subject.get("name") if isinstance(article_subject, dict) else (getattr(article_subject, "name", None) if article_subject else "?")
    news_site_name = news_site.get("name") if isinstance(news_site, dict) else (getattr(news_site, "name", None) if news_site else "?")

    if top_owner:
        top_owner_name = top_owner.get("name", "Unknown") if isinstance(top_owner, dict) else (getattr(top_owner, "name", "Unknown") if top_owner else "Unknown")
        return f"{top_owner_name} owns both {article_subject_name} and {news_site_name}"
    else:
        return f"No common owner found between {article_subject_name} and {news_site_name}"


async def process_batch(supabase, records: list) -> tuple:
    """Process a batch of ownership_tree records."""
    updated_count = 0

    for record in records:
        tree_id = record.get("id")
        investigation_data = record.get("investigation_data")

        if not investigation_data:
            continue

        # investigation_data might be a JSON string
        if isinstance(investigation_data, str):
            import json
            try:
                investigation_data = json.loads(investigation_data)
            except json.JSONDecodeError:
                logger.warning(f"  Could not parse JSON for record {tree_id[:8]}")
                continue

        logger.debug(f"Processing record {tree_id[:8]}: common_owner_results keys = {list(investigation_data.get('common_owner_results', {}).keys()) if investigation_data.get('common_owner_results') else 'None'}")

        fixed_data, was_fixed = fix_investigation_data(investigation_data)

        # Always update - regenerate summary even if top_owner didn't change
        new_summary = generate_summary(fixed_data)
        supabase.table("ownership_trees").update({
            "investigation_data": fixed_data,
            "summary": new_summary
        }).eq("id", tree_id).execute()
        logger.info(f"  Updated record {tree_id[:8]}: {new_summary}")
        updated_count += 1

    return updated_count, len(records)


async def main():
    parser = argparse.ArgumentParser(description="Fix common_owners format in ownership_trees")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of records to process (0 = all)")
    parser.add_argument("--batch-size", type=int, default=50, help="Batch size for processing")
    args = parser.parse_args()

    supabase = get_supabase_client()

    logger.info(f"Starting fix")

    query = supabase.table("ownership_trees").select("id, investigation_data")

    if args.limit > 0:
        query = query.limit(args.limit)

    result = query.execute()
    records = result.data or []

    logger.info(f"Found {len(records)} ownership_tree records")

    total_updated = 0
    total_processed = 0

    for i in range(0, len(records), args.batch_size):
        batch = records[i:i + args.batch_size]
        updated, processed = await process_batch(supabase, batch)
        total_updated += updated
        total_processed += processed

        logger.info(f"Processed batch {i//args.batch_size + 1}: {updated} updated")

    logger.info(f"Done. Processed {total_processed} records, updated {total_updated}")


if __name__ == "__main__":
    asyncio.run(main())
