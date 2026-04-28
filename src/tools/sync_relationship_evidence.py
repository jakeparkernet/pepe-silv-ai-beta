#!/usr/bin/env python3
"""
Syncs evidence_ids from Weaviate relationships into Supabase ownership_trees rows.

For each ownership_tree, checks relationships in investigation_data and ownership_tree
columns. If any relationship has null/empty evidence_ids, fetches the live relationship
from Weaviate and updates both columns with fresh evidence_ids.

Usage:
    python sync_relationship_evidence.py [--dry-run] [--limit N] [--batch-size N] [--max-updates N]
    python sync_relationship_evidence.py --ownership-tree-id <uuid>
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


def needs_evidence_sync(relationships):
    """Check if any relationship has null/empty evidence_ids."""
    if not relationships:
        return False
    for rel in relationships.values():
        evidence_ids = rel.get("evidence_ids") or []
        if not evidence_ids or len(evidence_ids) == 0:
            return True
    return False


async def sync_relationships(service, relationships):
    """
    Sync evidence_ids from Weaviate for relationships with null/empty evidence_ids.
    Returns (updated_relationships, changed_count).
    """
    updated = dict(relationships)
    changed = 0

    for rel_id, rel in relationships.items():
        evidence_ids = rel.get("evidence_ids") or []
        if evidence_ids and len(evidence_ids) > 0:
            continue

        live_rel = await service.get_relationship(rel_id)
        if not live_rel:
            logger.warning(f"Relationship {rel_id} not found in Weaviate, skipping")
            continue

        if live_rel.evidence_ids and len(live_rel.evidence_ids) > 0:
            updated[rel_id]["evidence_ids"] = live_rel.evidence_ids
            changed += 1
            logger.info(f"Updated relationship {rel_id}: {len(live_rel.evidence_ids)} evidence_ids")

    return updated, changed


async def process_tree(supabase, service, ot_row, dry_run=False):
    """Process a single ownership_tree row. Returns True if updated."""
    ot_id = ot_row.get("id")

    investigation_data_raw = ot_row.get("investigation_data")
    ownership_tree_raw = ot_row.get("ownership_tree")

    if not investigation_data_raw or not ownership_tree_raw:
        logger.debug(f"[{ot_id[:8]}] Missing columns, skipping")
        return False

    try:
        investigation_data = parse_json_field(investigation_data_raw)
        ownership_tree = parse_json_field(ownership_tree_raw)
    except json.JSONDecodeError as e:
        logger.warning(f"[{ot_id[:8]}] Invalid JSON: {e}")
        return False

    if not investigation_data or not ownership_tree:
        logger.debug(f"[{ot_id[:8]}] Empty data after parse, skipping")
        return False

    id_rels = investigation_data.get("common_owner_results", {}).get("relationships", {})
    ot_rels = ownership_tree.get("relationships", {})

    if not needs_evidence_sync(id_rels) and not needs_evidence_sync(ot_rels):
        logger.debug(f"[{ot_id[:8]}] All relationships have evidence, skipping")
        return False

    updated_id_rels, id_changes = await sync_relationships(service, id_rels)
    updated_ot_rels, ot_changes = await sync_relationships(service, ot_rels)

    total_changes = id_changes + ot_changes
    if total_changes == 0:
        logger.debug(f"[{ot_id[:8]}] No evidence found in Weaviate for null relationships")
        return False

    if dry_run:
        logger.info(f"[{ot_id[:8]}] DRY RUN - would update {total_changes} relationships")
        return True

    investigation_data["common_owner_results"]["relationships"] = updated_id_rels
    ownership_tree["relationships"] = updated_ot_rels

    update_result = (
        supabase.table("ownership_trees")
        .update({
            "investigation_data": json.dumps(investigation_data),
            "ownership_tree": json.dumps(ownership_tree),
        })
        .eq("id", ot_id)
        .execute()
    )

    if update_result.data:
        logger.info(f"[{ot_id[:8]}] Updated {total_changes} relationships")
        return True
    else:
        logger.error(f"[{ot_id[:8]}] Failed to update")
        return False


async def process_by_ot_id(supabase, service, ot_id, dry_run=False):
    """Process a specific ownership_tree by ID."""
    result = (
        supabase.table("ownership_trees")
        .select("id, ownership_tree, investigation_data")
        .eq("id", ot_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        logger.error(f"No ownership_tree found for id: {ot_id}")
        return False

    return await process_tree(supabase, service, result.data[0], dry_run=dry_run)


async def main():
    parser = argparse.ArgumentParser(description="Sync relationship evidence_ids from Weaviate to Supabase")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be updated without persisting")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of trees to process (0 = all)")
    parser.add_argument("--max-updates", type=int, default=0, help="Stop after N updates (0 = unlimited)")
    parser.add_argument("--batch-size", type=int, default=50, help="Batch size for processing")
    parser.add_argument("--ownership-tree-id", type=str, default=None, help="Process a specific ownership_tree by ID")
    args = parser.parse_args()

    supabase = get_supabase_client()
    service = DatabaseService.get()
    await service.initialize()

    if args.ownership_tree_id:
        ok = await process_by_ot_id(supabase, service, args.ownership_tree_id, dry_run=args.dry_run)
        logger.info(f"{'DRY RUN' if args.dry_run else 'Done'}. Updated: {1 if ok else 0}")
        await service.close()
        return

    query = supabase.table("ownership_trees").select("id, ownership_tree, investigation_data")

    if args.limit > 0:
        query = query.limit(args.limit)

    result = query.execute()
    rows = result.data or []

    logger.info(f"Found {len(rows)} ownership_trees to check")

    if args.dry_run:
        logger.info("DRY RUN MODE - no changes will be made")

    updated = 0
    processed = 0

    for i in range(0, len(rows), args.batch_size):
        if args.max_updates > 0 and updated >= args.max_updates:
            logger.info(f"Reached --max-updates limit ({args.max_updates})")
            break

        batch = rows[i:i + args.batch_size]
        if args.max_updates > 0:
            remaining = args.max_updates - updated
            batch = batch[:remaining]

        for row in batch:
            if args.max_updates > 0 and updated >= args.max_updates:
                break
            try:
                ok = await process_tree(supabase, service, row, dry_run=args.dry_run)
                if ok:
                    updated += 1
                processed += 1
            except Exception as e:
                logger.warning(f"Error processing {row.get('id', '?')}: {e}")

        logger.info(f"Batch {i // args.batch_size + 1}: processed {len(batch)}, updated so far {updated}")

    mode = "DRY RUN" if args.dry_run else "Done"
    logger.info(f"{mode}. Processed {processed}, updated {updated}")

    await service.close()


if __name__ == "__main__":
    asyncio.run(main())
