#!/usr/bin/env python3
"""
Repairs relationships in Weaviate that have null evidence.

Searches for relationships where evidence_ids is null/empty, then:
1. Gets source and target entity names
2. Uses an LLM with web search to find evidence for the claim
3. Creates new evidence records in Weaviate
4. Updates the relationship's evidence_ids

Usage:
    python repair_null_evidence.py [--dry-run] [--max-repairs N]
    python repair_null_evidence.py --relationship-id <uuid>
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
import argparse
import asyncio
import logging
import json
import uuid

from app.core.db.database_service import DatabaseService
from app.core.db.models import Evidence, Relationship, Entity

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def get_all_relationships_with_null_evidence(service):
    """Get all relationships where evidence_ids is null or empty."""
    all_relationships = await service.get_all_relationships()

    null_evidence_rels = []
    for rel in all_relationships:
        if not rel.evidence_ids or len(rel.evidence_ids) == 0:
            null_evidence_rels.append(rel)

    return null_evidence_rels


async def get_entity_name(service, entity_id):
    """Get the name of an entity by ID."""
    if not entity_id:
        return ""
    entity = await service.get_entity(entity_id)
    if entity:
        return entity.name
    return ""


async def find_evidence_for_claim(source_name, relation, target_name, model="x-ai/grok-4.3"):
    """
    Use the LLM to find evidence for a relationship claim.
    Returns list of evidence dicts with excerpt and source.
    """
    from app.functions.get_llm_response import get_llm_response
    from dotenv import load_dotenv

    load_dotenv()

    api_key = os.getenv("OPEN_ROUTER")
    if not api_key:
        raise RuntimeError("OPEN_ROUTER must be set")

    system_message = """You gather evidence to verify a relationship claim between entities.
Return ONLY valid JSON.
Do NOT write conclusions beyond what is directly supported by excerpts.
Collect short excerpts (<=25 words) with a URL source.
Include at least one official/company source when possible."""

    user_message_json = {
        "task": "verify_relationship_evidence",
        "claim": {
            "source": source_name,
            "relation": relation,
            "target": target_name
        },
        "requirements": [
            "Use web search to find evidence supporting or refuting this relationship",
            "Return 3-8 evidence items that are relevant",
            "Each evidence item must have excerpt and source fields",
            "Prioritize official company sources, SEC filings, and reputable news",
            "If the relationship is about ownership, look for stock holdings or investment disclosures"
        ],
        "output_schema": {
            "evidence": [
                {
                    "excerpt": "string<=25_words",
                    "source": "url"
                }
            ]
        }
    }

    user_message = json.dumps(user_message_json)

    messages = [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_message}
    ]

    parameters = {
        "response_format": {"type": "json_object"},
        "extra_headers": {
            "X-Reasoning-Enabled": "true",
            "X-Reasoning-Effort": "high"
        },
        "plugins": [{"id": "web"}],
        "provider": {
            "sort": "latency",
            "allow_fallbacks": True
        }
    }

    try:
        result = await get_llm_response(
            api_key=api_key,
            model=model,
            messages=messages,
            parameters=parameters,
            endpoint="openrouter.ai",
            post_endpoint="/api/v1/chat/completions"
        )

        if result and "choices" in result:
            content = result["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            return parsed.get("evidence", [])

        return []
    except Exception as e:
        logger.warning(f"LLM call failed: {e}")
        return []


async def create_evidence_in_weaviate(service, evidence_data):
    """Create a new evidence record in Weaviate and return its ID."""
    evidence = Evidence(
        id=str(uuid.uuid4()),
        excerpt=evidence_data.get("excerpt", ""),
        source=evidence_data.get("source", ""),
        metadata={},
        notes=""
    )

    await service.add_evidence(evidence)
    logger.info(f"Created evidence {evidence.id}: {evidence.excerpt[:50]}...")
    return evidence.id


async def update_relationship_evidence(service, relationship_id, evidence_ids):
    """Update a relationship's evidence_ids by adding new evidence references."""
    return await service.add_evidence_to_relationship(relationship_id, evidence_ids)


async def repair_relationship(service, rel, dry_run=False):
    """Repair a single relationship with null evidence."""
    source_name = await get_entity_name(service, rel.source_entity_id)
    target_name = await get_entity_name(service, rel.target_entity_id)

    if not source_name or not target_name:
        logger.warning(f"Skipping {rel.id}: missing source or target name")
        return None

    logger.info(f"[{rel.id}] Repairing: {source_name} -{rel.relation}-> {target_name}")

    evidence_list = await find_evidence_for_claim(source_name, rel.relation, target_name)

    if not evidence_list or len(evidence_list) == 0:
        logger.warning(f"No evidence found for {source_name} -{rel.relation}-> {target_name}")
        return None

    if dry_run:
        logger.info(f"[DRY RUN] Would create {len(evidence_list)} evidence items")
        return [f"dry_run_evidence_{i}" for i in range(len(evidence_list))]

    created_evidence_ids = []
    for ev_data in evidence_list:
        try:
            ev_id = await create_evidence_in_weaviate(service, ev_data)
            created_evidence_ids.append(ev_id)
        except Exception as e:
            logger.warning(f"Failed to create evidence: {e}")

    if created_evidence_ids:
        await update_relationship_evidence(service, rel.id, created_evidence_ids)
        logger.info(f"[{rel.id}] FIXED: created {len(created_evidence_ids)} evidence items")

    return created_evidence_ids


async def repair_by_rel_id(service, rel_id, dry_run=False):
    """Repair a specific relationship by ID."""
    rel = await service.get_relationship(rel_id)
    if not rel:
        logger.error(f"Relationship not found: {rel_id}")
        return None

    if rel.evidence_ids and len(rel.evidence_ids) > 0:
        logger.info(f"Relationship {rel_id} already has evidence, skipping")
        return rel.evidence_ids

    return await repair_relationship(service, rel, dry_run)


async def get_relationship_by_id(service, rel_id):
    """Get a relationship by ID."""
    return await service.get_relationship(rel_id)


async def main():
    parser = argparse.ArgumentParser(description="Repair relationships with null evidence in Weaviate")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be repaired without making changes")
    parser.add_argument("--max-repairs", type=int, default=50, help="Maximum number of relationships to repair")
    parser.add_argument("--relationship-id", type=str, help="Repair a specific relationship by ID")
    args = parser.parse_args()

    service = DatabaseService.get()
    await service.initialize()

    if args.relationship_id:
        logger.info(f"Repairing specific relationship: {args.relationship_id}")
        result = await repair_by_rel_id(service, args.relationship_id, dry_run=args.dry_run)
        if result:
            logger.info(f"Successfully repaired relationship {args.relationship_id}")
            logger.info(f"Created {len(result)} evidence items")
        else:
            logger.warning(f"Could not repair relationship {args.relationship_id}")
    else:
        logger.info("Finding all relationships with null evidence...")
        null_rels = await get_all_relationships_with_null_evidence(service)
        logger.info(f"Found {len(null_rels)} relationships with null evidence")

        if args.dry_run:
            logger.info(f"[DRY RUN] Would repair up to {min(len(null_rels), args.max_repairs)} relationships")
            for i, rel in enumerate(null_rels[:min(len(null_rels), args.max_repairs)]):
                source_name = await get_entity_name(service, rel.source_entity_id)
                target_name = await get_entity_name(service, rel.target_entity_id)
                logger.info(f"  [{i+1}] {source_name} -{rel.relation}-> {target_name}")
            return

        repaired_count = 0
        for rel in null_rels[:args.max_repairs]:
            try:
                result = await repair_relationship(service, rel, dry_run=args.dry_run)
                if result:
                    repaired_count += 1
                    logger.info(f"Repaired [{rel.id}] {repaired_count}/{args.max_repairs}")
            except Exception as e:
                logger.warning(f"Failed to repair [{rel.id}]: {e}")

            if repaired_count >= args.max_repairs:
                break

        logger.info(f"Done. Repaired {repaired_count} relationships")

    await service.close()


if __name__ == "__main__":
    asyncio.run(main())
