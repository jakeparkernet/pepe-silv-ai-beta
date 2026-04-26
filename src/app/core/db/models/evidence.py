from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from .base import BaseModel

@dataclass
class Evidence(BaseModel):
    """Represents evidence supporting relationships or claims"""
    excerpt: str = ""
    source: str = ""
    date: Optional[datetime] = None

    async def get_relationships (self) -> list['Relationship']:
        """Get all relationships that reference this evidence"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        return await service.find_relationships_by_evidence(self.id)
    
    def is_recent(self, days: int = 30) -> bool:
        """Check if evidence is recent (within specified days)"""
        if not self.date:
            return False

        now = datetime.now(timezone.utc)
        date = self.date

        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)

        cutoff = now - timedelta(days=days)
        return date >= cutoff
        
    def get_source_domain (self) -> Optional[str]:
        """Extract domain from source if it's a URL"""
        if not self.source:
            return None
        
        try:
            from urllib.parse import urlparse
            if self.source.startswith(('http://', 'https://')):
                parsed = urlparse(self.source)
                return parsed.netloc
        except Exception:
            pass
        
        return None

    async def sync_to_database (self):
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        await service.update_evidence(self)

    def to_serializeable_object (self):
        super_obj = super().to_serializeable_object()        
        return super_obj | {
            "excerpt": self.excerpt,
            "source": self.source,
            "date": str(self.date) if self.date else None
        }

    def deserialize (self, obj):
        super().deserialize(obj)

        if isinstance(obj, str):
            obj = loads(obj)

        self.excerpt = obj["excerpt"]
        self.source = obj["source"]
        self.date = obj["date"]