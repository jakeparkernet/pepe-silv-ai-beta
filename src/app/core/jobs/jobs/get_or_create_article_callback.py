from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.util.get_value_safe import get_value_safe
from app.core.db.database_service import DatabaseService
from app.core.db import Article
import uuid

@Job.register(name="get_or_create_article_callback")
class GetOrCreateArticleCallback(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Get or Create an Article"
    description: str = "Gets or creates the article from Weaviate."

    async def run(self, platform: str):
        await super().run(platform)

        url = get_value_safe(self.input, "url", None)
        service = DatabaseService.get()
            
        article_id = str(uuid.uuid5(uuid.NAMESPACE_URL, url))
        article = await service.get_article(article_id)

        if article is None:
            article = Article(
                url=url
            )

            await service.add_article(article)

        self._set_output({"result": article})
        self.complete()
