import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timezone
from app.core.db import (
    DatabaseFactory, get_database,
    Entity, Article, Evidence, NewsSite, Relationship,
    DatabaseError, EntityNotFoundError
)

db = get_database()

print(db.get_all_entities())
print(db.get_all_articles())
print(db.get_all_relationships())
print(db.get_all_evidence())
print(db.get_all_news_sites())
