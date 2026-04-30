"""Abstract base class for database adapters"""
from __future__ import annotations
import uuid
import weaviate
from weaviate.classes.query import QueryReference
from app.util.has_attribute import has_attribute
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from datetime import datetime
from app.core.db.weaviate import weaviate_wrapper as ww
from app.util.common_owner_frontier import find_first_mutual_owner_frontier
from app.util.get_value_safe import get_value_safe
from app.util.normalize_letters_only import normalize_letters_only
from .base_adapter import DatabaseAdapter
from ..models import Entity, Article, Evidence, NewsSite, Relationship
from ..exceptions import (
    EntityNotFoundError, ArticleNotFoundError, EvidenceNotFoundError,
    NewsSiteNotFoundError, RelationshipNotFoundError, DatabaseError
)
import json
import asyncio
from collections import deque

EntityOrId = Union["Entity", str]

class WeaviateAdapter(DatabaseAdapter):

    has_ensured_collections = False

    def __init__(self):
        self._client: weaviate.WeaviateAsyncClient | None = None

    async def initialize (self):
        try:
            self._client = await ww.create_async_client()

            if WeaviateAdapter.has_ensured_collections is not True:
                #await ww.delete_all_collections(self._client)
                #await ww.ensure_all_collections(self._client)
                WeaviateAdapter.has_ensured_collections = True
        except Exception as e:
            raise DatabaseError(f"Failed to initialize Weaviate adapter: {e}")

    # Entity operations
    async def add_entity (self, entity: Entity, overwrite: bool = False) -> str:
        """
        Insert a new entity and wire any evidence references.
        Returns the entity id.
        """
        entity_id = entity.id or str(uuid.uuid4())
        props = {
            "uuid": entity_id,
            "name": entity.name,
            "aliases": entity.aliases or [],
            "entity_type": entity.entity_type,
            "tags": entity.tags or [],
            "context": entity.context or "",
            "key_value_store": create_metadata_store(entity.metadata),
            "flatname": normalize_letters_only(entity.name),
            "notes": entity.notes
        }

        if await self.get_entity(entity_id) is not None:
            if overwrite:
                await self.delete_entity(entity_id)
            else:
                return entity_id

        await ww.insert_object(self._client, "Entity", props, entity_id)

        for evidence_id in entity.evidence_ids or []:
            await ww.add_object_reference(self._client, "Entity", entity_id, "evidence", evidence_id)

        return entity_id

    async def get_entity (self, id: str) -> Optional[Entity]:
        """Fetch a single entity by ID with references hydrated."""
        obj = await ww.fetch_full_object_by_id(
            self._client,
            "Entity", id
        )
        if not obj:
            return None
        return await parse_entity(self._client, obj)

    async def get_entities_near_text (self, text: str) -> List[Entity]:
        query = f"""
        {{
        Get {{
            Entity(
            nearText: {{
                concepts: ["{text}"]
            }}) {{
            uuid
            name
            tags
            context
            }}
        }}
        }}
        """
        entities_raw = await ww.query_raw(self._client, query)
        return await self.get_parsed_entities(entities_raw)

    async def get_entity_by_name (self, entity_name) -> List[Entity]:
        query = f"""
        {{
            Get {{
                Entity(where: {{
                    path: ["name"]
                    operator: Equal
                    valueString: "{entity_name}"
                }}) {{
                    uuid
                    name
                    tags
                    context
                }}
            }}
        }}"""

        entities_raw = await ww.query_raw(self._client, query)
        parsed_entities = await self.get_parsed_entities(entities_raw)

        if len(parsed_entities) > 0:
            return parsed_entities[0]

        normalized_name = normalize_letters_only(entity_name)
        query = f"""
        {{
            Get {{
                Entity(where: {{
                    path: ["flatname"]
                    operator: Equal
                    valueString: "{normalized_name}"
                }}) {{
                    uuid
                    name
                    tags
                    context
                }}
            }}
        }}"""

        entities_raw = await ww.query_raw(self._client, query)
        parsed_entities = await self.get_parsed_entities(entities_raw)

        if len(parsed_entities) > 0:
            return parsed_entities[0]

        return None
    
    async def get_entities_contains(self, entity_name: str) -> List[Entity]:
        query = f"""
        {{
            Get {{
                Entity(where: {{
                    path: ["name"]
                    operator: Like
                    valueString: "*{entity_name}*"
                }}) {{
                    uuid
                    name
                    tags
                    context
                }}
            }}
        }}"""

        entities_raw = await ww.query_raw(self._client, query)
        return await self.get_parsed_entities(entities_raw)

    async def get_entities_starts_with(self, entity_name_prefix: str) -> List[Entity]:
        query = f"""
        {{
            Get {{
                Entity(where: {{
                    path: ["name"]
                    operator: Like
                    valueString: "{entity_name_prefix}*"
                }}) {{
                    uuid
                    name
                    tags
                    context
                }}
            }}
        }}"""

        entities_raw = await ww.query_raw(self._client, query)
        return await self.get_parsed_entities(entities_raw)

    async def get_entities_like (self, entity_name) -> List[Entity]:
        query = f"""
        {{
            Get {{
                Entity(where: {{
                    path: ["name"]
                    operator: Like
                    valueString: "{entity_name}"
                }}) {{
                    uuid
                    name
                    tags
                    context
                }}
            }}
        }}"""

        entities_raw = await ww.query_raw(self._client, query)
        return await self.get_parsed_entities(entities_raw)

    async def get_entities (self, entity_name) -> List[Entity]:
        query = f"""
        {{
            Get {{
                Entity(where: {{
                    path: ["name"]
                    operator: Equal
                    valueString: "{entity_name}"
                }}) {{
                    uuid
                    name
                    tags
                    context
                }}
            }}
        }}"""

        entities_raw = await ww.query_raw(self._client, query)
        return await self.get_parsed_entities(entities_raw)

    async def get_entities_with_any_alias (self, aliases: List[str]) -> List[Entity]:
        query = f"""
        {{
        Get {{
            Entity(where: {{
            path: ["aliases"]
            operator: ContainsAny
            valueText: {json.dumps(aliases)}
            }}) {{
            uuid
            name
            tags
            context
            }}
        }}
        }}
        """

        entities_raw = await ww.query_raw(self._client, query)
        return await self.get_parsed_entities(entities_raw)

    async def get_entities_with_alias (self, alias: str) -> List[Entity]:
        query = f"""
        {{
            Get {{
                Entity(where: {{
                    path: ["aliases"]
                    operator: ContainsAny
                    valueText: {json.dumps([alias])}
                }}) {{
                    uuid
                    name
                    tags
                    context
                }}
            }}
        }}"""

        entities_raw = await ww.query_raw(self._client, query)
        return await self.get_parsed_entities(entities_raw)

    async def get_all_entities (self):
        """Get all entities in the database"""
        try:
            query = f"""
            {{
            Get {{
                Entity{{
                uuid
                }}
            }}
            }}
            """

            entities_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_entities(entities_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to get all entities: {e}")

    async def update_entity (self, entity: Entity, caller) -> bool:
        """Update an entity"""
        c = caller
        try:
            properties = {
                "name": entity.name,
                "aliases": entity.aliases,
                "entity_type": entity.entity_type,
                "key_value_store": create_metadata_store(entity.metadata),
                "flatname": entity.flatname,
                "notes": get_value_safe(entity, "notes", ""),
                "top_dog": entity.top_dog
            }
            
            await ww.update_object_properties(self._client, entity.id, "Entity", properties)

            for evidence_id in entity.evidence_ids:
                await ww.add_object_reference(self._client, "Entity", entity.id, "evidence", evidence_id)
            
            return True
            
        except Exception as e:
            raise DatabaseError(f"Failed to update entity {entity.id}: {e}")
    
    async def delete_entity (self, id: str) -> bool:
        """Delete an entity by ID"""
        try:
            await ww.delete_object(self._client, "Entity", id)
            return True
        except Exception as e:
            raise DatabaseError(f"Failed to delete entity {id}: {e}")

    async def get_entity_evidence (self):
        """Get evidence of the entity"""
        try:
            entity = await get_entity(uuid)
            
            if entity is None:
                raise DatabaseError(f"Entity does not exist {uuid}: {e}")
            
            return entity.evidence

        except Exception as e:
            raise DatabaseError(f"Failed to get evidence for Entity {uuid}: {e}")

    
    async def find_entities_by_type (self, entity_type: str) -> List[Entity]:
        """Find entities by type using v4 API"""
        try:
            query = f"""
            {{
            Get {{
                Entity(
                where: {{
                    operator: And
                    operands: [
                    {{
                        path: ["entity_type"]
                        operator: Equal
                        valueString: "{entity_type}"
                    }}
                    ]
                }}
                ) {{
                uuid
                name
                aliases
                type
                key_value_store {{
                    key
                    value
                }}
                }}
            }}
            }}
            """
            entities_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_entities(entities_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find entities by type {entity_type}: {e}")
    
    async def find_entities_by_name (self, name: str) -> List[Entity]:
        """Find entities by name using v4 API"""
        try:
            query = f"""
            {{
            Get {{
                Entity(where: {{
                path: ["name"]
                operator: Equal
                valueString: "{name}"
                }}) {{
                uuid
                }}
            }}
            }}
            """

            entities_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_entities(entities_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find entities by name {name}: {e}")
    
    async def get_parsed_entities(self, entities_raw) -> List[Entity]:
        """
        Robustly parse Entity results.

        Backwards compatible notes:
        - Same approach as get_parsed_relationships: supports dict OR list shapes.
        """
        get_block = extract_get_block(entities_raw)

        if isinstance(get_block, dict):
            ent_rows = get_block.get("Entity", []) or []
        else:
            ent_rows = get_block or []

        parsed: List[Entity] = []
        for row in ent_rows:
            eid = row.get("uuid") if isinstance(row, dict) else None
            if not eid:
                continue
            parsed.append(await self.get_entity(eid))

        return parsed

    # Article operations
    async def add_article (self, article: Article, overwrite: bool = False) -> str:
        """Add an article and return its ID"""
        try:
            properties = {
                "uuid": article.id,
                "url": article.url,
                "key_value_store": create_metadata_store(article.metadata),
                "notes": article.notes
            }

            if await self.get_article(article.id) is not None:
                if overwrite:
                    await self.delete_article(article.id)
                else:
                    return article.id

            await ww.insert_object(self._client, "Article", properties, article.id)
            
            if article.news_site_id:
                await ww.add_object_reference(self._client, "Article", article.id, "news_site", article.news_site_id)
            
            for entity_id in article.entities:
                await ww.add_object_reference(self._client, "Article", article.id, "entities", entity_id)

            for relationship_id in article.conflicting_relationships:
                await ww.add_object_reference(self._client, "Article", article.id, "conflicting_relationships", relationship_id)
            
            return article.id
            
        except Exception as e:
            raise DatabaseError(f"Failed to add article: {e}")
    
    async def get_article (self, id: str) -> Optional[Article]:
        """Async get article by ID (mirrors get_article)."""
        try:
            obj = await ww.fetch_full_object_by_id(self._client, "Article", id)
            if not obj:
                return None

            return parse_article(obj)
        except Exception as e:
            raise DatabaseError(f"Failed to get article {id}: {e}")
    
    async def get_all_articles (self):
        """Get all articles in the database"""
        try:
            query = f"""
            {{
            Get {{
                Article{{
                uuid
                }}
            }}
            }}
            """

            articles_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_articles(articles_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to get all articles: {e}")
    async def update_article (self, article: Article) -> bool:
        """Update an article"""
        try:
            properties = {
                "url": article.url,
                "key_value_store": create_metadata_store(article.metadata)
            }
               
            await ww.update_object_properties(self._client, article.id, "Article", properties)

            if article.news_site_id:
                await ww.add_object_reference(self._client, "Article", article.id, "news_site", article.news_site_id)
            
            for entity_id in article.entities:
                await ww.add_object_reference(self._client, "Article", article.id, "entities", entity_id)

            for relationship_id in article.conflicting_relationships:
                await ww.add_object_reference(self._client, "Article", article.id, "conflicting_relationships", relationship_id)

            return True
            
        except Exception as e:
            raise DatabaseError(f"Failed to update article {article.id}: {e}")
    
    async def delete_article (self, id: str) -> bool:
        """Delete an article by ID"""
        try:
            await ww.delete_object(self._client, "Article", id)
            return True
        except Exception as e:
            raise DatabaseError(f"Failed to delete article {id}: {e}")

    async def find_article_by_url (self, url: str) -> Optional[Article]:
        """Find article by url"""
        try:
            query = f"""
            {{
            Get {{
                Article(where: {{
                    path: ["url"]
                    operator: Equal
                    valueString: "{url}"
                }}) {{
                    uuid
                }}
            }}
            }}
            """

            articles_raw = await ww.query_raw(self._client, query)
            parsed_articles = await get_parsed_articles(articles_raw)

            if len(parsed_articles) == 0:
                return None

            return parsed_articles[0]
            
        except Exception as e:
            raise DatabaseError(f"Failed to get all articles: {e}")
    
    async def find_articles_by_news_site (self, news_site_id: str) -> List[Article]:
        """Find articles by news site ID"""
        try:
            query = f"""
            {{
            Get {{
                Article(where: {{
                    path: ["news_site", "NewsSite", "uuid"]
                    operator: Equal
                    valueString: "{news_site_id}"
                }}) {{
                    uuid
                }}
            }}
            }}
            """

            articles_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_articles(articles_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to get all articles: {e}")

    async def get_parsed_articles(self, articles_raw) -> List[Article]:
        """
        Robustly parse Article results.

        Backwards compatible notes:
        - Same approach as get_parsed_relationships: supports dict OR list shapes.
        """
        get_block = extract_get_block(articles_raw)

        if isinstance(get_block, dict):
            art_rows = get_block.get("Article", []) or []
        else:
            art_rows = get_block or []

        parsed: List[Article] = []
        for row in art_rows:
            aid = row.get("uuid") if isinstance(row, dict) else None
            if not aid:
                continue
            parsed.append(await self.get_article(aid))

        return parsed


    # Evidence operations
    async def add_evidence (self, evidence: Evidence, overwrite: bool = False) -> str:
        """Add evidence and return its ID"""
        try:
            properties = {
                "uuid": evidence.id,
                "excerpt": evidence.excerpt,
                "source": evidence.source,
                "key_value_store": create_metadata_store(evidence.metadata),
                "notes": evidence.notes
            }
            
            if evidence.date and isinstance(evidence.date, datetime):
                properties["date"] = evidence.date.isoformat()

            if await self.get_evidence(evidence.id) is not None:
                if overwrite:
                    await self.delete_evidence(evidence.id)
                else:
                    return evidence.id

            await ww.insert_object(self._client, "Evidence", properties, evidence.id)
            return evidence.id
            
        except Exception as e:
            raise DatabaseError(f"Failed to add evidence: {e}")
    
    async def get_evidence (self, id: str) -> Optional[Evidence]:
        """Get evidence by ID"""
        try:
            obj = await ww.fetch_full_object_by_id(self._client, "Evidence", id)
            if not obj:
                return None
            
            return parse_evidence(obj)
            
        except Exception as e:
            raise DatabaseError(f"Failed to get evidence {id}: {e}")

    async def get_evidence_batch (self, ids: List[str]) -> List[Evidence]:
        """Get multiple evidence by IDs in a single query"""
        if not ids:
            return []

        filtered_ids = [i for i in ids if i]
        if not filtered_ids:
            return []

        try:
            where_filter = {
                "operator": "Or",
                "operands": [
                    {"path": ["uuid"], "operator": "Equal", "valueText": id}
                    for id in filtered_ids
                ]
            }

            query = f"""
            {{
            Get {{
                Evidence(
                    where: {where_filter}
                ) {{
                    uuid
                }}
            }}
            }}
            """

            evidence_list_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_evidence(evidence_list_raw)

        except Exception as e:
            raise DatabaseError(f"Failed to get evidence batch: {e}")
    
    async def get_all_evidence (self):
        """Get all evidence in the database"""
        try:
            query = f"""
            {{
            Get {{
                Evidence{{
                uuid
                }}
            }}
            }}
            """

            evidence_list_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_evidence(evidence_list_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to get all evidence: {e}")

    async def update_evidence (self, evidence: Evidence) -> bool:
        """Update evidence"""
        try:
            properties = {
                "excerpt": evidence.excerpt,
                "source": evidence.source,
                "key_value_store": create_metadata_store(evidence.metadata)
            }
            
            if evidence.date:
                properties["date"] = evidence.date.isoformat()
            
            await ww.update_object_properties(self._client, evidence.id, "Evidence", properties)
            return True
            
        except Exception as e:
            raise DatabaseError(f"Failed to update evidence {evidence.id}: {e}")
    
    
    async def delete_evidence (self, id: str) -> bool:
        """Delete evidence by ID"""
        try:
            await ww.delete_object(self._client, "Evidence", id)
            return True
        except Exception as e:
            raise DatabaseError(f"Failed to delete evidence {id}: {e}")
    
    async def find_evidence_by_source (self, source: str) -> List[Evidence]:
        """Find evidence by source"""
        try:
            query = f"""
            {{
            Get {{
                Evidence(where: {{
                    path: ["source"]
                    operator: Equal
                    valueString: "{source}"
                }}){{
                uuid
                }}
            }}
            }}
            """

            evidence_list_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_evidence(evidence_list_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find evidence by source {source}: {e}")

    async def get_parsed_evidence (self, evidence_list_raw) -> List[Evidence]:
        get_block = extract_get_block(evidence_list_raw)

        if get_block is None:
            return []
        if isinstance(get_block, dict):
            evidence_list = get_block.get("Evidence", []) or []
        else:
            evidence_list = get_block or []

        parsed_evidence_list = []
        for evidence in evidence_list:
            if not isinstance(evidence, dict):
                continue
            parsed_evidence = await self.get_evidence(evidence.get("uuid"))
            if parsed_evidence is not None:
                parsed_evidence_list.append(parsed_evidence)

        return parsed_evidence_list

    # NewsSite operations
    async def add_news_site (self, news_site: NewsSite, overwrite: bool = False) -> str:
        """Add a news site and return its ID"""
        try:
            properties = {
                "uuid": news_site.id,
                "domain": news_site.domain,
                "key_value_store": create_metadata_store(news_site.metadata),
                "notes": news_site.notes
            }

            if await self.get_news_site(news_site.id) is not None:
                if overwrite:
                    await self.delete_news_site(news_site.id)
                else:
                    return news_site.id
            
            await ww.insert_object(self._client, "NewsSite", properties, news_site.id)
            
            for entity_id in news_site.entity_ids:
                await ww.add_object_reference(self._client, "NewsSite", news_site.id, "entity", entity_id)
            
            return news_site.id
            
        except Exception as e:
            raise DatabaseError(f"Failed to add news site: {e}")
    
    async def get_news_site (self, id: str) -> Optional[NewsSite]:
        """Get a news site by ID"""
        try:
            obj = await ww.fetch_full_object_by_id(self._client, "NewsSite", id)
            if not obj:
                return None
            
            entity_ids = []
            if hasattr(obj, "references") and obj.references and obj.references.get("entity"):
                entity_ids = [str(ref.uuid) for ref in obj.references["entity"].objects]
            
            return parse_news_site(obj)
            
        except Exception as e:
            raise DatabaseError(f"Failed to get news site {id}: {e}")
    
    async def get_all_news_sites (self):
        """Get all news sites in the database"""
        try:
            query = f"""
            {{
            Get {{
                NewsSite{{
                uuid
                }}
            }}
            }}
            """

            news_sites_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_news_site(news_sites_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to get all news sites: {e}")

    async def update_news_site (self, news_site: NewsSite) -> bool:
        """Update a news site"""
        try:
            properties = {
                "domain": news_site.domain,
                "key_value_store": create_metadata_store(news_site.metadata)
            }
            
            await ww.update_object_properties(self._client, news_site.id, "NewsSite", properties)
            return True
            
        except Exception as e:
            raise DatabaseError(f"Failed to update news site {news_site.id}: {e}")
    
    async def delete_news_site (self, id: str) -> bool:
        """Delete a news site by ID"""
        try:
            await ww.delete_object(self._client, "NewsSite", id)
            return True
        except Exception as e:
            raise DatabaseError(f"Failed to delete news site {id}: {e}")
    
    async def find_news_site_by_domain (self, domain: str) -> Optional[NewsSite]:
        """Find news site by domain"""
        try:
            news_site_id = NewsSite.generate_id(domain=domain)
            return await self.get_news_site(news_site_id)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find news site by domain {domain}: {e}")

    async def get_parsed_news_site (self, news_sites_raw) -> List[NewsSite]:
            news_stites = extract_get_block(news_sites_raw)

            parsed_news_stites = []
            for news_site in news_stites:
                parsed_news_site = await self.get_news_site(news_site.get("uuid"))
                parsed_news_stites.append(parsed_news_site)

            return parsed_news_stites

    # Relationship operations
    async def add_relationship (self, relationship: Relationship, overwrite: bool = False) -> str:
        """Add a relationship and return its ID"""
        try:
            existing_id = await self.get_existing_relationship(
                relationship.source_entity_id,
                relationship.target_entity_id,
                relationship.relation
            )

            if existing_id is not None:
                if overwrite and existing_id != relationship.id:
                    await self.delete_relationship(existing_id)
                else:
                    for evidence_id in relationship.evidence_ids:
                        await ww.add_object_reference(self._client, "Relationship", existing_id, "evidence", evidence_id)

                    return existing_id

            properties = {
                "uuid": relationship.id,
                "relation": relationship.relation,
                "key_value_store": create_metadata_store(relationship.metadata),
                "is_ownership": relationship.is_ownership,
                "notes": relationship.notes
            }

            if await self.get_relationship(relationship.id) is not None:
                if overwrite:
                    await self.delete_relationship(relationship.id)
                else:
                    return relationship.id

            await ww.insert_object(self._client, "Relationship", properties, relationship.id)
            
            if relationship.source_entity_id:
                await ww.add_object_reference(self._client, "Relationship", relationship.id, "source_entity", relationship.source_entity_id)
            if relationship.target_entity_id:
                await ww.add_object_reference(self._client, "Relationship", relationship.id, "target_entity", relationship.target_entity_id)
            
            for evidence_id in relationship.evidence_ids:
                await ww.add_object_reference(self._client, "Relationship", relationship.id, "evidence", evidence_id)
            
            return relationship.id
            
        except Exception as e:
            raise DatabaseError(f"Failed to add relationship: {e}")
    
    async def get_existing_relationship (self, source_entity_id: str, target_entity_id: str, relation: str) -> Optional[str]:
        """Return an existing relationship id for (source_entity_id, target_entity_id, relation) if it exists."""
        try:
            query = f"""
            {{
            Get {{
                Relationship(where: {{
                    operator: And
                    operands: [
                        {{
                            path: ["source_entity", "Entity", "uuid"]
                            operator: Equal
                            valueString: "{source_entity_id}"
                        }},
                        {{
                            path: ["target_entity", "Entity", "uuid"]
                            operator: Equal
                            valueString: "{target_entity_id}"
                        }},
                        {{
                            path: ["relation"]
                            operator: Equal
                            valueString: "{relation}"
                        }}
                    ]
                }}) {{
                    uuid
                }}
            }}
            }}
            """

            relationships_raw = await ww.query_raw(self._client, query)
            get_block = extract_get_block(relationships_raw)

            relationships = []
            if isinstance(get_block, dict):
                relationships = get_block.get("Relationship", []) or []
            else:
                relationships = get_block or []

            if len(relationships) == 0:
                return None

            return relationships[0].get("uuid")

        except Exception as e:
            raise DatabaseError(f"Failed to get existing relationship: {e}")

    async def get_relationship (self, id: str) -> Optional[Relationship]:
        """Get a relationship by ID"""
        last_error = None
        for attempt in range(1, 4):
            try:
                obj = await ww.fetch_full_object_by_id(self._client, "Relationship", id)
                break
            except Exception as e:
                last_error = e
                if attempt >= 3:
                    raise DatabaseError(f"Failed to get relationship {id}: {e}")
                await asyncio.sleep(0.5 * attempt)

        try:
            if not obj:
                return None
            
            # Extract source entity ID
            source_entity_id = ""
            if hasattr(obj, "references") and obj.references and obj.references.get("source_entity"):
                source_refs = obj.references["source_entity"].objects
                if source_refs:
                    source_entity_id = str(source_refs[0].uuid)
            
            # Extract target entity ID
            target_entity_id = ""
            if hasattr(obj, "references") and obj.references and obj.references.get("target_entity"):
                target_refs = obj.references["target_entity"].objects
                if target_refs:
                    target_entity_id = str(target_refs[0].uuid)
            
            # Extract evidence IDs
            evidence_ids = []
            if hasattr(obj, "references") and obj.references and obj.references.get("evidence"):
                evidence_ids = [str(ref.uuid) for ref in obj.references["evidence"].objects]
            
            return parse_relationship(obj)
            
        except Exception as e:
            raise DatabaseError(f"Failed to get relationship {id}: {e}")
    
    async def get_all_relationships (self):
        """Get all relationships in the database using Weaviate v4 pagination"""
        try:
            import logging
            logger = logging.getLogger(__name__)
            
            all_relationships = []
            offset = 0
            limit = 200  # Fetch in batches of 200
            
            while True:
                # Use Weaviate v4 collection API with offset pagination
                relationship_collection = self._client.collections.get("Relationship")
                
                response = await relationship_collection.query.fetch_objects(
                    limit=limit,
                    offset=offset,
                    return_references=[
                        QueryReference(link_on="source_entity"),
                        QueryReference(link_on="target_entity"),
                        QueryReference(link_on="evidence"),
                    ],
                )
                
                if not response.objects:
                    break
                    
                # Parse objects into Relationship models
                batch = []
                for obj in response.objects:
                    try:
                        # Weaviate v4 returns objects with .uuid and .properties
                        # parse_relationship expects either:
                        # 1. An object with .properties and .references (Weaviate v3 style)
                        # 2. A dict with "properties" and "references" keys
                        
                        # Build the format parse_relationship expects
                        data = type('obj', (object,), {})()
                        data.uuid = str(obj.uuid)
                        data.properties = obj.properties
                        data.references = {}
                        
                        # Extract references
                        if hasattr(obj, 'references') and obj.references:
                            for ref_name, ref_objs in obj.references.items():
                                if ref_objs and hasattr(ref_objs, 'objects') and ref_objs.objects:
                                    data.references[ref_name] = ref_objs
                        
                        rel = parse_relationship(data)
                        batch.append(rel)
                    except Exception as e:
                        logger.warning(f"Failed to parse relationship {getattr(obj, 'uuid', '?')}: {e}")
                        continue
                
                all_relationships.extend(batch)
                
                # If we got fewer than limit, we're done
                if len(response.objects) < limit:
                    break
                    
                offset += limit
            
            return all_relationships
        except Exception as e:
            raise DatabaseError(f"Failed to get all relationships: {e}")

    async def update_relationship (self, relationship: Relationship) -> bool:
        """Update a relationship"""
        try:
            properties = {
                "relation": relationship.relation,
                "key_value_store": create_metadata_store(relationship.metadata)
            }
            
            await ww.update_object_properties(self._client, relationship.id, "Relationship", properties)
            return True
            
        except Exception as e:
            raise DatabaseError(f"Failed to update relationship {relationship.id}: {e}")
    
    async def delete_relationship (self, id: str) -> bool:
        """Delete a relationship by ID"""
        try:
            await ww.delete_object(self._client, "Relationship", id)
            return True
        except Exception as e:
            raise DatabaseError(f"Failed to delete relationship {id}: {e}")
    
    async def add_evidence_to_relationship(self, relationship_id: str, evidence_ids: List[str]) -> bool:
        """Add evidence references to a relationship, skipping duplicates."""
        try:
            existing_refs = await ww.get_object_references(self._client, "Relationship", relationship_id, "evidence")
            existing_ids = {str(item.uuid) for item in existing_refs} if existing_refs else set()

            for ev_id in evidence_ids:
                if ev_id not in existing_ids:
                    await ww.add_object_reference(self._client, "Relationship", relationship_id, "evidence", ev_id)
                    existing_ids.add(ev_id)

            return True
        except Exception as e:
            raise DatabaseError(f"Failed to add evidence to relationship {relationship_id}: {e}")
    
    async def find_relationships_by_source (self, source_id: str) -> List[Relationship]:
        """Find relationships where entity is the source"""
        try:
            query = f"""
            {{
            Get {{
                Relationship(where: {{
                    path: ["source_entity", "Entity", "uuid"]
                    operator: Equal
                    valueString: "{source_id}"
                }}){{
                uuid
                }}
            }}
            }}
            """

            relationships_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_relationships(relationships_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find evidence by source {source_id}: {e}")
    
    async def find_relationships_by_target (self, target_id: str) -> List[Relationship]:
        """Find relationships where entity is the target"""
        try:
            query = f"""
            {{
            Get {{
                Relationship(where: {{
                    path: ["target_entity", "Entity", "uuid"]
                    operator: Equal
                    valueString: "{target_id}"
                }}){{
                uuid
                }}
            }}
            }}
            """

            relationships_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_relationships(relationships_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find evidence by source {target_id}: {e}")
    
    async def find_relationships_by_evidence (self, evidence_id: str) -> List[Relationship]:
        """Find relationships that reference specific evidence"""
        try:
            query = f"""
            {{
            Get {{
                Relationship(where: {{
                    path: ["evidence", "uuid"]
                    operator: Equal
                    valueString: "{evidence_id}"
                }}){{
                uuid
                }}
            }}
            }}
            """

            relationships_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_relationships(relationships_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find evidence by evidence {evidence_id}: {e}")
    
    async def find_relationships_by_type (self, relation: str) -> List[Relationship]:
        """Find relationships by type (e.g., 'owns', 'employs')"""
        try:
            query = f"""
            {{
            Get {{
                Relationship(where: {{
                    path: ["relation"]
                    operator: Equal
                    valueString: "{relation}"
                }}){{
                uuid
                }}
            }}
            }}
            """

            relationships_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_relationships(relationships_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find evidence by relation {relation}: {e}")

    async def find_ownership_relationships (self, entity_id: str) -> List[Relationship]:
        """Find ownership relationships"""
        try:
            query = f"""
            {{
            Get {{
                Relationship( where: {{
                    operator: And
                    operands: [
                    {{
                        path: ["is_ownership"]
                        operator: Equal
                        valueBoolean: true
                    }},
                    {{
                        path: ["target_entity", "Entity", "uuid"]
                        operator: Equal
                        valueString: "{entity_id}"
                    }}
                    ]
                }}) {{
                    uuid
                }}
            }}
            }}
            """

            relationships_raw = await ww.query_raw(self._client, query)
            return await self.get_parsed_relationships(relationships_raw)
            
        except Exception as e:
            raise DatabaseError(f"Failed to find ownership relationships: {e}")

    async def get_parsed_relationships(self, relationships_raw) -> List[Relationship]:
        """
        Robustly parse Relationship results.

        Backwards compatible notes:
        - Still accepts whatever the rest of the app currently passes.
        - Now supports BOTH shapes:
            1) a list of relationship rows
            2) a GraphQL-style dict like {"Relationship": [ ... ]}
        """
        get_block = extract_get_block(relationships_raw)

        # ✅ Handle GraphQL-ish dict shape OR list shape
        if isinstance(get_block, dict):
            rel_rows = get_block.get("Relationship", []) or []
        else:
            rel_rows = get_block or []

        parsed: List[Relationship] = []
        for row in rel_rows:
            rid = row.get("uuid") if isinstance(row, dict) else None
            if not rid:
                continue
            try:
                parsed_relationship = await self.get_relationship(rid)
            except Exception:
                logger.warning("Skipping relationship %s after hydration failure", rid, exc_info=True)
                continue
            if parsed_relationship is not None:
                parsed.append(parsed_relationship)

        return parsed

    async def find_common_owners_between_entities(
        self,
        entity_a: EntityOrId,
        entity_b: EntityOrId,
        ownership_only: bool = True,
        max_depth: int = 50,
    ) -> Dict[str, Any]:

        if isinstance(entity_a, dict):
            entity_a_stub = Entity()
            entity_a_stub.deserialize(entity_a)
            entity_a = entity_a_stub

        if isinstance(entity_b, dict):
            entity_b_stub = Entity()
            entity_b_stub.deserialize(entity_b)
            entity_b = entity_b_stub

        return await find_first_mutual_owner_frontier(
            entity_a=entity_a,
            entity_b=entity_b,
            fetch_ownership_relationships=self.find_ownership_relationships,
            fetch_entity=self.get_entity,
            max_depth=max_depth,
        )

    async def find_ownership_tree (
        self,
        entity,
        ownership_tree = None,
        *,
        max_depth: int = 50,
        depth: int = 0,
        visited: Optional[Set[str]] = None,
    ):

        if ownership_tree is None:
            ownership_tree = {
                "target_entity": entity,
                "owner_entities": {},
                "relationships": {}
            }

        if visited is None:
            visited = set()

        entity_id = getattr(entity, "id", None)
        if not entity_id or entity_id in visited or depth >= max_depth:
            return ownership_tree

        visited.add(entity_id)

        owner_relationships = await self.find_ownership_relationships(entity.id)

        if len(owner_relationships) == 0:
            return ownership_tree
        
        for relationship in owner_relationships:

            if relationship.id not in ownership_tree["relationships"].keys():
                ownership_tree["relationships"][relationship.id] = relationship

            if relationship.source_entity_id not in ownership_tree["owner_entities"].keys():
                source_entity = await self.get_entity(relationship.source_entity_id)
                if source_entity is None:
                    continue
                ownership_tree["owner_entities"][relationship.source_entity_id] = source_entity

                await self.find_ownership_tree(
                    source_entity,
                    ownership_tree,
                    max_depth=max_depth,
                    depth=depth + 1,
                    visited=visited,
                )

        return ownership_tree

    async def delete_database (self):
        #await ww.delete_all_collections(self._client)
        pass

    async def close(self):
        if self._client is not None:
            await self._client.close()
            self._client = None

@staticmethod
def parse_article(data):
    parse_obj = data
    if has_attribute(data, "properties"):
        parse_obj = data.properties

    # Extract entity IDs from references
    entity_ids = []
    if has_attribute(data, "references") and data.references and data.references.get("entities"):
        entity_ids = [str(ref.uuid) for ref in data.references["entities"].objects]

    # Extract news site ID
    news_site_id = None
    if has_attribute(data, "references") and data.references and data.references.get("news_site"):
        news_site_refs = data.references["news_site"].objects
        if news_site_refs:
            news_site_id = str(news_site_refs[0].uuid)

    conflicting_relationships = None
    if has_attribute(data, "references") and data.references and data.references.get("conflicting_relationships"):
        conflicting_relationships = [str(ref.uuid) for ref in data.references["conflicting_relationships"].objects]

    return Article(
        id=parse_obj.get("uuid"),
        url=parse_obj.get("url", ""),
        title=parse_obj.get("title"),
        content=parse_obj.get("content"),
        entities=entity_ids,
        news_site_id=news_site_id,
        conflicting_relationships=conflicting_relationships,
        metadata=extract_metadata(parse_obj.get("key_value_store", [])),
        notes=parse_obj.get("notes", "")
    )

@staticmethod
async def parse_entity (client, data):
    parse_obj = data

    if (isinstance(data, weaviate.collections.classes.internal.ObjectSingleReturn)):
        parse_obj = data.properties

    id = parse_obj.get("uuid")

    evidence = await ww.get_object_references(client, "Entity", id, "evidence")
    evidence_ids = []

    if evidence is not None:
        evidence_ids = list({str(item.uuid) for item in evidence})

    entity = Entity(
        id=id,
        name=parse_obj.get("name", ""),
        aliases=parse_obj.get("aliases", []),
        context=parse_obj.get("context", ""),
        tags=parse_obj.get("tags", []),
        entity_type=parse_obj.get("entity_type", ""),
        metadata=extract_metadata(parse_obj.get("key_value_store", [])),
        evidence_ids=evidence_ids,
        notes=parse_obj.get("notes", ""))

    return entity

@staticmethod
def parse_evidence(data):
    parse_obj = data
    if has_attribute(data, "properties"):
        parse_obj = data.properties

    date_obj = None
    if parse_obj.get("date"):
        try:
            date_obj = datetime.fromisoformat(parse_obj["date"].replace("Z", "+00:00"))
        except Exception:
            pass

    return Evidence(
        id=parse_obj.get("uuid"),
        excerpt=parse_obj.get("excerpt", ""),
        source=parse_obj.get("source", ""),
        date=date_obj,
        metadata=extract_metadata(parse_obj.get("key_value_store", [])),
        notes=parse_obj.get("notes", "")
    )

@staticmethod
def parse_news_site (data):
    parse_obj = data
    if has_attribute(data, "properties"):
        parse_obj = data.properties

    entity_ids = []
    if has_attribute(data, "references") and data.references and data.references.get("entity"):
        entity_ids = [str(ref.uuid) for ref in data.references["entity"].objects]

    return NewsSite(
        id=parse_obj.get("uuid"),
        domain=parse_obj.get("domain", ""),
        entity_ids=entity_ids,
        metadata=extract_metadata(parse_obj.get("key_value_store", [])),
        notes=parse_obj.get("notes", "")
    )

@staticmethod
def parse_relationship (data):
    parse_obj = data
    if has_attribute(data, "properties"):
        parse_obj = data.properties

    # Extract source entity ID
    source_entity_id = ""
    if has_attribute(data, "references") and data.references and data.references.get("source_entity"):
        source_refs = data.references["source_entity"].objects
        if source_refs:
            source_entity_id = str(source_refs[0].uuid)

    # Extract target entity ID
    target_entity_id = ""
    if has_attribute(data, "references") and data.references and data.references.get("target_entity"):
        target_refs = data.references["target_entity"].objects
        if target_refs:
            target_entity_id = str(target_refs[0].uuid)

    # Extract evidence IDs
    evidence_ids = []
    if has_attribute(data, "references") and data.references and data.references.get("evidence"):
        evidence_ids = [str(ref.uuid) for ref in data.references["evidence"].objects]

    return Relationship(
        id=parse_obj.get("uuid", str(uuid.uuid4())),
        source_entity_id=source_entity_id,
        target_entity_id=target_entity_id,
        relation=parse_obj.get("relation", ""),
        is_ownership=parse_obj.get("is_ownership", False),
        evidence_ids=evidence_ids,
        metadata=extract_metadata(parse_obj.get("key_value_store", [])),
        notes=parse_obj.get("notes", "")
    )

@staticmethod
def extract_metadata(key_value_store: List[dict]) -> dict:
    """Convert Weaviate key_value_store to simple dict"""
    if not key_value_store:
        return {}
    return {pair.get("key", ""): pair.get("value", "") for pair in key_value_store}

@staticmethod
def create_metadata_store(metadata: dict) -> List[dict]:
    """Convert simple dict to Weaviate key_value_store format"""
    return [{"key": str(k), "value": str(v)} for k, v in metadata.items()]

@staticmethod
def gql_escape(value: str) -> str:
    """Escape for GraphQL string literal."""
    return value.replace("\\", "\\\\").replace('"', '\\"')

@staticmethod
def extract_get_block(graphql_result: Any) -> Dict[str, Any]:
    """
    Normalize GraphQL raw response to {'Get': {...}} dict.
    We gracefully handle various return shapes from the client.
    """
    if isinstance(graphql_result, dict):
        if "data" in graphql_result and isinstance(graphql_result["data"], dict):
            return graphql_result["data"].get("Get", {}) or {}
        if "Get" in graphql_result:
            return graphql_result.get("Get", {}) or {}
        return graphql_result

    data = getattr(graphql_result, "data", None)
    if isinstance(data, dict) and "Get" in data:
        return data["Get"]

    get_attr = getattr(graphql_result, "get", None)
    if isinstance(get_attr, dict):
        if not get_attr:
            return []

        return_val = next(iter(get_attr.values()))

        if return_val is None:
            return []
        return return_val

    return graphql_result
