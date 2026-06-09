from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from app.util.common_owner_frontier import find_first_mutual_owner_frontier


class CommonOwnerFrontierTests(unittest.IsolatedAsyncioTestCase):
    async def run_frontier(self, entities, relationships_by_target, entity_a_id, entity_b_id, max_depth=50):
        async def fetch_relationships(entity_id):
            return relationships_by_target.get(entity_id, [])

        async def fetch_entity(entity_id):
            return entities.get(entity_id)

        return await find_first_mutual_owner_frontier(
            entity_a=entities[entity_a_id],
            entity_b=entities[entity_b_id],
            fetch_ownership_relationships=fetch_relationships,
            fetch_entity=fetch_entity,
            max_depth=max_depth,
        )

    async def test_stops_at_first_mutual_owner(self):
        entities = {
            "a": {"id": "a", "name": "Company A"},
            "b": {"id": "b", "name": "Company B"},
            "a1": {"id": "a1", "name": "A Parent"},
            "common": {"id": "common", "name": "Common Owner"},
            "above": {"id": "above", "name": "Above Common"},
        }
        relationships_by_target = {
            "a": [{"id": "ra", "source_entity_id": "a1", "target_entity_id": "a"}],
            "a1": [{"id": "ra1", "source_entity_id": "common", "target_entity_id": "a1"}],
            "b": [{"id": "rb", "source_entity_id": "common", "target_entity_id": "b"}],
            "common": [{"id": "rc", "source_entity_id": "above", "target_entity_id": "common"}],
        }

        result = await self.run_frontier(entities, relationships_by_target, "a", "b")

        self.assertEqual(set(result["common_owners"].keys()), {"common"})
        self.assertNotIn("above", result["owner_entities"])
        self.assertEqual(result["metadata"]["terminal_depth_a"], 2)
        self.assertEqual(result["metadata"]["terminal_depth_b"], 1)

    async def test_direct_mutual_owner_does_not_expand_above_terminal(self):
        entities = {
            "a": {"id": "a", "name": "Company A"},
            "b": {"id": "b", "name": "Company B"},
            "common": {"id": "common", "name": "Common Owner"},
            "above": {"id": "above", "name": "Above Common"},
        }
        relationships_by_target = {
            "a": [{"id": "ra", "source_entity_id": "common", "target_entity_id": "a"}],
            "b": [{"id": "rb", "source_entity_id": "common", "target_entity_id": "b"}],
            "common": [{"id": "rc", "source_entity_id": "above", "target_entity_id": "common"}],
        }

        result = await self.run_frontier(entities, relationships_by_target, "a", "b")

        self.assertEqual(set(result["common_owners"].keys()), {"common"})
        self.assertNotIn("above", result["owner_entities"])
        self.assertEqual(set(result["relationships"].keys()), {"ra", "rb"})

    async def test_no_common_owner_marks_exhausted_at_max_depth(self):
        entities = {
            "a": {"id": "a", "name": "Company A"},
            "b": {"id": "b", "name": "Company B"},
            "a1": {"id": "a1", "name": "A Parent"},
            "a2": {"id": "a2", "name": "A Grandparent"},
            "b1": {"id": "b1", "name": "B Parent"},
        }
        relationships_by_target = {
            "a": [{"id": "ra", "source_entity_id": "a1", "target_entity_id": "a"}],
            "a1": [{"id": "ra1", "source_entity_id": "a2", "target_entity_id": "a1"}],
            "b": [{"id": "rb", "source_entity_id": "b1", "target_entity_id": "b"}],
        }

        result = await self.run_frontier(entities, relationships_by_target, "a", "b", max_depth=1)

        self.assertEqual(result["common_owners"], {})
        self.assertTrue(result["metadata"]["exhausted"])
        self.assertEqual(result["metadata"]["max_depth"], 1)


if __name__ == "__main__":
    unittest.main()
