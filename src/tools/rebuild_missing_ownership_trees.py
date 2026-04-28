#!/usr/bin/env python3
"""
Rebuilds ownership_tree common_owner_results for rows that have:
- summary starting with "No common owner found between"
- ownership_tree that is empty or has empty a_ownership_tree / b_ownership_tree

Steps:
1. Look up the ownership_trees row
2. If summary starts with "No common owner found between" AND ownership_tree is empty/broken
3. Parse investigation_data, extract article_subject + news_site
4. Use DatabaseService.find_ownership_relationships() for each to get fresh trees from Weaviate
5. Build common_owner_results, update ownership_trees row

Usage:
    python rebuild_missing_ownership_trees.py [--dry-run] [--limit N] [--batch-size N]
    python rebuild_missing_ownership_trees.py --ownership-tree-id <uuid>
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
import argparse
import asyncio
import logging
import json

from supabase import create_client
from app.core.db.database_service import DatabaseService

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


def parse_json_field(raw):
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        return json.loads(raw)
    return {}


def serialize_base_dict(base_dict):
    out = {}
    for key, value in base_dict.items():
        if hasattr(value, "to_serializeable_object"):
            out[key] = value.to_serializeable_object()
        elif isinstance(value, dict):
            out[key] = value
        else:
            out[key] = value
    return out


def serialize_ownership_tree(ownership_tree):
    return {
        "target_entity": ownership_tree["target_entity"].to_serializeable_object(),
        "owner_entities": serialize_base_dict(ownership_tree["owner_entities"]),
        "relationships": serialize_base_dict(ownership_tree["relationships"])
    }


def ownership_tree_is_valid(tree):
    if not tree:
        return False
    if not isinstance(tree, dict):
        return False
    a = tree.get("a_ownership_tree")
    b = tree.get("b_ownership_tree")
    if not a and not b:
        return False
    if isinstance(a, dict) and len(a) > 0:
        return True
    if isinstance(b, dict) and len(b) > 0:
        return True
    return False


def summary_needs_rebuild(summary):
    if not summary:
        return False
    return summary.startswith("No common owner found between")


async def rebuild_by_ot_id(supabase, ot_id, dry_run=False):
    """Look up a specific ownership_tree row by ID and rebuild it if needed."""
    ot_result = (
        supabase.table("ownership_trees")
        .select("id, ownership_tree, investigation_data, summary, company_a, company_b")
        .eq("id", ot_id)
        .limit(1)
        .execute()
    )
    if not ot_result.data:
        logger.error(f"No ownership_tree found for id: {ot_id}")
        return False
    return await rebuild_for_ot_row(supabase, ot_result.data[0], dry_run=dry_run)


async def rebuild_for_ot_row(supabase, ot_row, dry_run=False):
    """
    Rebuild ownership_tree for a pre-fetched ownership_trees row.
    Uses the row directly - no additional DB lookup needed.
    """
    ot_id = ot_row.get("id")
    summary = ot_row.get("summary", "")
    ownership_tree_raw = ot_row.get("ownership_tree")

    if not summary_needs_rebuild(summary):
        logger.debug(f"[{ot_id}] Summary does not need rebuild: {summary[:60]}")
        return False

    ownership_tree = parse_json_field(ownership_tree_raw)

    if ownership_tree_is_valid(ownership_tree):
        logger.debug(f"[{ot_id}] ownership_tree is already valid")
        return False

    logger.info(f"[{ot_id}] Row needs rebuild")

    investigation_data_raw = ot_row.get("investigation_data")
    investigation_data = parse_json_field(investigation_data_raw)

    if not investigation_data:
        logger.warning(f"[{ot_id}] No investigation_data, skipping")
        return False

    article_subject = investigation_data.get("article_subject") or {}
    news_site = investigation_data.get("news_site") or {}

    article_subject_id = article_subject.get("id") if isinstance(article_subject, dict) else article_subject if isinstance(article_subject, str) else None
    news_site_id = news_site.get("id") if isinstance(news_site, dict) else news_site if isinstance(news_site, str) else None

    if not article_subject_id or not news_site_id:
        logger.warning(f"[{ot_id}] Missing subject or site id in investigation_data")
        return False

    service = DatabaseService.get()

    entity_a = await service.get_entity(article_subject_id)
    entity_b = await service.get_entity(news_site_id)

    if not entity_a or not entity_b:
        logger.warning(f"[{ot_id}] Could not fetch entities from Weaviate")
        return False

    max_depth = 3

    async def find_ownership_tree_depth_limited(entity, max_depth=3):
        ownership_tree = {
            "target_entity": entity,
            "owner_entities": {},
            "relationships": {}
        }
        visited_ids = set()

        async def walk(current_entity, depth):
            if depth > max_depth:
                return
            entity_id = current_entity.id
            if entity_id in visited_ids:
                return
            visited_ids.add(entity_id)

            owner_relationships = await service.find_ownership_relationships(entity_id)
            if not owner_relationships:
                return

            for rel in owner_relationships:
                if rel.id not in ownership_tree["relationships"]:
                    ownership_tree["relationships"][rel.id] = rel

                if rel.source_entity_id not in ownership_tree["owner_entities"]:
                    owner = await service.get_entity(rel.source_entity_id)
                    ownership_tree["owner_entities"][rel.source_entity_id] = owner
                    await walk(owner, depth + 1)

        await walk(entity, 0)
        return ownership_tree

    a_tree = await find_ownership_tree_depth_limited(entity_a, max_depth)
    b_tree = await find_ownership_tree_depth_limited(entity_b, max_depth)

    logger.debug(f"[{ot_id}] a_tree: entities={len(a_tree['owner_entities'])}, rels={len(a_tree['relationships'])}")
    logger.debug(f"[{ot_id}] b_tree: entities={len(b_tree['owner_entities'])}, rels={len(b_tree['relationships'])}")

    relationships = dict(a_tree.get("relationships", {}))
    relationships.update(b_tree.get("relationships", {}))
    owner_entities = dict(a_tree.get("owner_entities", {}))
    owner_entities.update(b_tree.get("owner_entities", {}))

    common_keys = set(a_tree.get("owner_entities", {}).keys()) & set(b_tree.get("owner_entities", {}).keys())
    common_owners = {k: b_tree.get("owner_entities", {}).get(k) for k in common_keys}

    new_ownership_tree = {
        "a_ownership_tree": serialize_ownership_tree(a_tree),
        "b_ownership_tree": serialize_ownership_tree(b_tree),
        "relationships": serialize_base_dict(relationships),
        "owner_entities": serialize_base_dict(owner_entities),
        "common_owners": serialize_base_dict(common_owners)
    }

    top_owner_name = "?"
    if common_owners:
        first_owner = next(iter(common_owners.values()))
        if first_owner is None:
            pass
        elif hasattr(first_owner, "name"):
            top_owner_name = first_owner.name
        elif isinstance(first_owner, dict):
            top_owner_name = first_owner.get("name", "?")

    article_subject_name = article_subject.get("name", "?") if isinstance(article_subject, dict) else str(article_subject) if article_subject else "?"
    news_site_name = news_site.get("name", "?") if isinstance(news_site, dict) else str(news_site) if news_site else "?"

    if top_owner_name != "?":
        new_summary = f"{top_owner_name} owns both {article_subject_name} and {news_site_name}"
    else:
        new_summary = f"No common owner found between {article_subject_name} and {news_site_name}"

    if dry_run:
        logger.info(f"[{ot_id}] DRY RUN - would update ownership_tree + summary to: {new_summary}")
        return True

    update_result = (
        supabase.table("ownership_trees")
        .update({
            "ownership_tree": new_ownership_tree,
            "summary": new_summary
        })
        .eq("id", ot_id)
        .execute()
    )

    if update_result.data:
        logger.info(f"[{ot_id}] Updated, summary: {new_summary}")
        return True
    else:
        logger.error(f"[{ot_id}] Failed to update ownership_tree")
        return False


async def rebuild_for_row(supabase, aq_row, dry_run=False):
    """
    Rebuild ownership_tree for a pre-fetched article_queue row.
    Looks up the ownership_trees row first, then delegates to rebuild_for_ot_row.
    """
    aq_id = aq_row.get("id")
    ot_id = aq_row.get("ownership_tree_id")

    if not ot_id or ot_id == "None" or ot_id is None:
        logger.debug(f"[{aq_id}] No ownership_tree_id, skipping")
        return False

    ot_result = (
        supabase.table("ownership_trees")
        .select("id, ownership_tree, investigation_data, summary, company_a, company_b")
        .eq("id", ot_id)
        .limit(1)
        .execute()
    )

    if not ot_result.data:
        logger.warning(f"[{aq_id}] No ownership_tree found for id {ot_id}")
        return False

    return await rebuild_for_ot_row(supabase, ot_result.data[0], dry_run=dry_run)


async def main():
    parser = argparse.ArgumentParser(description="Rebuild missing ownership_tree common_owner_results")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be updated without persisting")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of article_queue rows to process (0 = all)")
    parser.add_argument("--max-updates", type=int, default=0, help="Stop after N successful updates (0 = unlimited)")
    parser.add_argument("--batch-size", type=int, default=50, help="Batch size for processing")
    parser.add_argument("--ownership-tree-id", type=str, default=None, help="Process a specific ownership_tree by ID")
    args = parser.parse_args()

    supabase = get_supabase_client()

    if args.ownership_tree_id:
        ok = await rebuild_by_ot_id(supabase, args.ownership_tree_id, dry_run=args.dry_run)
        logger.info(f"{'DRY RUN' if args.dry_run else 'Done'}. Updated: {1 if ok else 0}")
        return

    q = supabase.table("article_queue").select("id, url, ownership_tree_id").not_.is_("ownership_tree_id", "null")

    if args.limit > 0:
        q = q.limit(args.limit)

    result = q.execute()
    aq_rows = result.data or []

    logger.info(f"Found {len(aq_rows)} article_queue rows with ownership_tree_id")

    updated = 0
    processed = 0

    for i in range(0, len(aq_rows), args.batch_size):
        if args.max_updates > 0 and updated >= args.max_updates:
            logger.info(f"Reached --max-updates limit ({args.max_updates})")
            break
        batch = aq_rows[i:i + args.batch_size]
        for aq_row in batch:
            if args.max_updates > 0 and updated >= args.max_updates:
                break
            try:
                ok = await rebuild_for_row(supabase, aq_row, dry_run=args.dry_run)
                if ok:
                    updated += 1
                processed += 1
            except Exception as e:
                logger.exception(f"Error processing row {aq_row.get('id')}: {e}")

        logger.info(f"Batch {i // args.batch_size + 1}: processed {len(batch)}, updated so far {updated}")

    mode = "DRY RUN" if args.dry_run else "Done"
    logger.info(f"{mode}. Processed {processed} rows, updated {updated}")


if __name__ == "__main__":
    asyncio.run(main())
