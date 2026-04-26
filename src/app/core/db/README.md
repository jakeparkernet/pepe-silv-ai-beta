# Database Abstraction Layer

The database abstraction layer provides a clean, type-safe interface for working with investigation data without needing to know the underlying database implementation.

## Quick Start

```python
from app.core.db import get_database, Entity, Article, Relationship

# Get database (automatically configured via app.toml)
db = get_database()

# Create entities with deterministic IDs
tesla = Entity(name="Tesla Inc.", aliases=["Tesla", "TSLA"], type="company")
tesla_id = db.add_entity(tesla)

# Create articles with URL-based deterministic IDs
article = Article(
    url="https://example.com/tesla-news",
    title="Tesla Stock News"
)
article.add_entity(tesla_id)
article_id = db.add_article(article)

# Use convenience methods
relationships = tesla.get_relationships()
entities = article.get_entity_objects()
```

## Configuration

Add to your `config/app.toml`:

```toml
[database]
adapter = "weaviate"  # Currently only Weaviate supported
```

## Domain Models

### Entity
Represents companies, people, organizations:
- **Deterministic ID**: Based on entity name
- **Properties**: name, aliases, type, metadata
- **Methods**: `get_relationships()`, `get_related_entities()`

### Article
Represents news articles:
- **Deterministic ID**: Based on URL (same URL = same ID)
- **Properties**: url, title, content, entities, news_site_id
- **Methods**: `get_entity_objects()`, `get_news_site()`

### Evidence
Represents supporting evidence:
- **Properties**: excerpt, source, date, metadata
- **Methods**: `get_relationships()`, `is_recent()`

### NewsSite
Represents news publications:
- **Deterministic ID**: Based on domain
- **Properties**: domain, entity_ids
- **Methods**: `get_articles()`, `get_entity_objects()`

### Relationship
Represents connections between entities:
- **Properties**: source_entity_id, target_entity_id, relation, evidence_ids
- **Methods**: `get_source_entity()`, `get_target_entity()`, `get_evidence_objects()`

## Database Operations

### Basic CRUD
```python
# Create
entity_id = db.add_entity(entity)
article_id = db.add_article(article)

# Read
entity = db.get_entity(entity_id)
article = db.get_article(article_id)

# Update
entity.add_alias("New Alias")
db.update_entity(entity)

# Delete
db.delete_entity(entity_id)
```

### Queries
```python
# Find by type/attributes
companies = db.find_entities_by_type("company")
tesla_entities = db.find_entities_by_name("Tesla Inc.")

# Find by relationships
relationships = db.find_relationships_by_source(entity_id)
ownership_rels = db.find_relationships_by_type("OWNS")

# Find by URL/domain
article = db.find_articles_by_url("https://example.com/news")
site = db.find_news_site_by_domain("techcrunch.com")
```

## Convenience Methods

Domain objects include convenience methods that automatically query the database:

```python
# Entity relationships
entity = db.get_entity(entity_id)
all_relationships = entity.get_relationships()
outgoing_only = entity.get_outgoing_relationships()
related_entities = entity.get_related_entities()

# Article entities
article = db.get_article(article_id)
referenced_entities = article.get_entity_objects()
news_site = article.get_news_site()

# Relationship evidence
relationship = db.get_relationship(rel_id)
evidence_list = relationship.get_evidence_objects()
source_entity = relationship.get_source_entity()
```

## Conflict Detection Example

```python
# Find potential conflicts of interest
blackrock = db.find_entities_by_name("BlackRock Inc.")[0]

# Get all entities BlackRock has relationships with
related_entities = blackrock.get_related_entities()

# Check if BlackRock-controlled media covers these entities
techcrunch = db.find_news_site_by_domain("techcrunch.com")
articles = techcrunch.get_articles()

for article in articles:
    article_entities = article.get_entity_objects()
    for entity in article_entities:
        if entity.id in [e.id for e in related_entities]:
            print(f"CONFLICT: BlackRock-related media covers BlackRock investment")
```

## Testing

Run the test suite:
```bash
python test_database_adapter.py
```

Run the demo:
```bash
python demo_database_usage.py
```

## Architecture

```
Application Code
       ↓
DatabaseFactory (Singleton)
       ↓
DatabaseAdapter (Abstract Interface)
       ↓
WeaviateAdapter (Implementation)
       ↓
weaviate_wrapper (Low-level)
       ↓
Weaviate Database
```

## Error Handling

The adapter throws specific exceptions:
- `EntityNotFoundError`
- `ArticleNotFoundError`
- `DatabaseConnectionError`
- `DatabaseError` (base class)

## Future Extensions

The abstraction layer is designed to support additional database backends:
- PostgreSQL adapter
- MongoDB adapter
- In-memory adapter (for testing)

Simply implement the `DatabaseAdapter` interface and update the factory.