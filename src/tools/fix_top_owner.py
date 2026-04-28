#!/usr/bin/env python3
"""
Fixes top_owner in ownership_trees by finding the common owner with shortest
total path to both entity_a (news site) and entity_b (article subject).

Uses BFS on the ownership graph to find the common owner with minimum
sum of distances to both entities.

Updates:
- investigation_data.top_owner
- ownership_tree.topOwner (for frontend)
- summary

Usage:
    python fix_top_owner.py [--dry-run] [--max-repairs N] [--limit N] [--batch-size N]
    python fix_top_owner.py --ownership-tree-id <uuid>
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
import argparse
import asyncio
import logging
import json
from collections import deque

from supabase import create_client

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

INF = float('inf')


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


def bfs_distances(relationships, start_id):
    """
    BFS from start_id up the ownership chain.
    Returns dict: entity_id -> distance (number of relationships to traverse).

    Relationships: source_entity_id owns target_entity_id.
    To go "up" from start_id, we find relationships where target_entity_id == start_id,
    then the source_entity_id is an owner (distance 1), and recurse.
    """
    # Build reverse adjacency: entity -> list of entities that own it
    owners_of = {}  # target -> [source entities that own it]
    for rel_id, rel in relationships.items():
        source = rel.get("source_entity_id") or rel.get("source")
        target = rel.get("target_entity_id") or rel.get("target")
        if not source or not target:
            continue
        if target not in owners_of:
            owners_of[target] = []
        owners_of[target].append(source)

    dist = {}
    queue = deque([(start_id, 0)])

    while queue:
        entity_id, d = queue.popleft()
        if entity_id in dist:
            continue
        dist[entity_id] = d
        for owner_id in owners_of.get(entity_id, []):
            if owner_id not in dist:
                queue.append((owner_id, d + 1))

    return dist


def find_best_top_owner(common_owner_results, entity_a, entity_b):
    """
    Find the common owner with minimum total distance to entity_a (news_site) and entity_b (article_subject).
    Returns (owner_dict, total_distance) or (None, INF) if none found.
    """
    common_owners = common_owner_results.get("common_owners") or {}
    relationships = common_owner_results.get("relationships") or {}

    if not entity_a or not entity_b or not common_owners or not relationships:
        return None, INF

    entity_a_id = entity_a.get("id")
    entity_b_id = entity_b.get("id")

    if not entity_a_id or not entity_b_id:
        return None, INF

    dist_a = bfs_distances(relationships, entity_a_id)
    dist_b = bfs_distances(relationships, entity_b_id)

    best_owner = None
    best_dist = INF

    for owner_id, owner in common_owners.items():
        d_a = dist_a.get(owner_id, INF)
        d_b = dist_b.get(owner_id, INF)
        total = d_a + d_b
        if total < best_dist:
            best_dist = total
            best_owner = owner

    return best_owner, best_dist


def owners_equal(o1, o2):
    """Check if two owner dicts/objects represent the same entity."""
    if not o1 and not o2:
        return True
    if not o1 or not o2:
        return False
    id1 = o1.get("id") if isinstance(o1, dict) else getattr(o1, "id", None)
    id2 = o2.get("id") if isinstance(o2, dict) else getattr(o2, "id", None)
    return id1 == id2


def generate_summary(investigation_data):
    """Regenerate summary based on top_owner and article info."""
    article_subject = investigation_data.get("article_subject")
    news_site = investigation_data.get("news_site")
    top_owner = investigation_data.get("top_owner")

    article_subject_name = article_subject.get("name") if isinstance(article_subject, dict) else "?"
    news_site_name = news_site.get("name") if isinstance(news_site, dict) else "?"

    if top_owner:
        top_owner_name = top_owner.get("name", "Unknown") if isinstance(top_owner, dict) else "Unknown"
        return f"{top_owner_name} owns both {article_subject_name} and {news_site_name}"
    else:
        return f"No common owner found between {article_subject_name} and {news_site_name}"


async def process_tree(supabase, record, dry_run=False):
    """
    Process a single ownership_tree record.
    Returns True if repaired, False if skipped or no change needed.
    """
    tree_id = record.get("id")
    ownership_tree_raw = record.get("ownership_tree")
    investigation_data_raw = record.get("investigation_data")

    if not ownership_tree_raw or not investigation_data_raw:
        logger.debug(f"[{tree_id[:8]}] Missing ownership_tree or investigation_data, skipping")
        return False

    ownership_tree = parse_json_field(ownership_tree_raw)
    investigation_data = parse_json_field(investigation_data_raw)

    if not ownership_tree or not investigation_data:
        logger.debug(f"[{tree_id[:8]}] Empty data after parse, skipping")
        return False

    # Skip if top_owner is None
    current_top = investigation_data.get("top_owner")
    if current_top is None:
        logger.debug(f"[{tree_id[:8]}] top_owner is None, skipping")
        return False

    # Get entity_a (news_site) and entity_b (article_subject) from investigation_data
    entity_a = investigation_data.get("news_site") or {}
    entity_b = investigation_data.get("article_subject") or {}

    # Find best top owner using graph distance
    best_owner, best_dist = find_best_top_owner(ownership_tree, entity_a, entity_b)

    if best_owner is None or best_dist == INF:
        logger.debug(f"[{tree_id[:8]}] No valid common owner found via BFS")
        return False

    if owners_equal(best_owner, current_top):
        logger.debug(f"[{tree_id[:8]}] top_owner already correct, skipping")
        return False

    best_name = best_owner.get("name", "?") if isinstance(best_owner, dict) else "?"
    current_name = current_top.get("name", "?") if isinstance(current_top, dict) else "?"
    logger.info(f"[{tree_id[:8]}] Replacing '{current_name}' with '{best_name}' (dist={best_dist})")

    if dry_run:
        logger.info(f"[{tree_id[:8]}] DRY RUN - would update top_owner")
        return True

    # Update investigation_data
    investigation_data["top_owner"] = best_owner

    # Update ownership_tree
    ownership_tree["topOwner"] = best_owner

    # Regenerate summary
    new_summary = generate_summary(investigation_data)

    # Write back to Supabase
    update_result = (
        supabase.table("ownership_trees")
        .update({
            "investigation_data": investigation_data,
            "ownership_tree": ownership_tree,
            "summary": new_summary,
        })
        .eq("id", tree_id)
        .execute()
    )

    if update_result.data:
        logger.info(f"[{tree_id[:8]}] Updated. Summary: {new_summary}")
        return True
    else:
        logger.error(f"[{tree_id[:8]}] Failed to update")
        return False


async def process_batch(supabase, records, dry_run=False):
    """Process a batch of records. Returns (repaired_count, processed_count)."""
    repaired = 0
    for record in records:
        try:
            ok = await process_tree(supabase, record, dry_run=dry_run)
            if ok:
                repaired += 1
        except Exception as e:
            tree_id = record.get("id", "?")[:8]
            logger.warning(f"[{tree_id}] Error: {e}")
    return repaired, len(records)


async def main():
    parser = argparse.ArgumentParser(description="Fix top_owner in ownership_trees using graph distance")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be updated without persisting")
    parser.add_argument("--max-repairs", type=int, default=0, help="Stop after N repairs (0 = unlimited)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of trees to process (0 = all)")
    parser.add_argument("--batch-size", type=int, default=50, help="Batch size for processing")
    parser.add_argument("--ownership-tree-id", type=str, default=None, help="Process a specific ownership_tree by ID")
    args = parser.parse_args()

    supabase = get_supabase_client()

    if args.ownership_tree_id:
        result = (
            supabase.table("ownership_trees")
            .select("id, ownership_tree, investigation_data, summary")
            .eq("id", args.ownership_tree_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            logger.error(f"No ownership_tree found for id: {args.ownership_tree_id}")
            return
        ok = await process_tree(supabase, result.data[0], dry_run=args.dry_run)
        logger.info(f"{'DRY RUN' if args.dry_run else 'Done'}. Repaired: {1 if ok else 0}")
        return

    # Fetch trees that have a top_owner (not null)
    query = (
        supabase.table("ownership_trees")
        .select("id, ownership_tree, investigation_data, summary")
        .not_.is_("investigation_data->top_owner", "null")
    )

    if args.limit > 0:
        query = query.limit(args.limit)

    result = query.execute()
    records = result.data or []

    logger.info(f"Found {len(records)} ownership_trees with top_owner set")

    if args.dry_run:
        logger.info("DRY RUN MODE - no changes will be made")

    total_repaired = 0
    total_processed = 0

    for i in range(0, len(records), args.batch_size):
        if args.max_repairs > 0 and total_repaired >= args.max_repairs:
            logger.info(f"Reached --max-repairs limit ({args.max_repairs})")
            break

        batch = records[i:i + args.batch_size]
        # Trim batch if needed
        if args.max_repairs > 0:
            remaining = args.max_repairs - total_repaired
            batch = batch[:remaining]

        repaired, processed = await process_batch(supabase, batch, dry_run=args.dry_run)
        total_repaired += repaired
        total_processed += processed

        logger.info(f"Batch {i // args.batch_size + 1}: processed {processed}, repaired so far {total_repaired}")

    mode = "DRY RUN" if args.dry_run else "Done"
    logger.info(f"{mode}. Processed {total_processed} trees, repaired {total_repaired}")


if __name__ == "__main__":
    asyncio.run(main())
