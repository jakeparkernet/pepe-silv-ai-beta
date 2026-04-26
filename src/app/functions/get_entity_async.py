from app.core.db.database_service import DatabaseService
from app.core.db import Entity
from typing import Dict, List, Any, Optional
from app.util.get_value_safe import get_value_safe
from app.util.callback_utils import is_awaitable

async def get_entity_async(options: Any) -> Optional[Entity]:
    """Finds an entity based on the name and context"""

    entity_id = get_value_safe(options, "entity_id", None)
    name = get_value_safe(options, "name", None)
    aliases = get_value_safe(options, "aliases", [])
        
    service = DatabaseService.get()

    if entity_id is not None:
        entity = await service.get_entity(entity_id)

        if entity is not None:
            return entity

    entity = await service.get_entity_by_name(name)

    if entity is not None:
        return entity

    entities = await service.get_entities_with_alias(name)

    if len(entities) >= 1:
        entity = entities[0]
        return entity

    if len(aliases) > 0:
        entities = await service.get_entities_with_any_alias(aliases)

        if len(entities) >= 1:
            entity = entities[0]
            return entity

    return None