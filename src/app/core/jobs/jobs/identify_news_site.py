import asyncio
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.scrape_page import scrape_page
from app.util.set_timeout import set_timeout
from pydantic import Field, PrivateAttr
from app.util.domain_from_url import domain_from_url
from app.core.db.models.newssite import NewsSite
from app.core.db.models.entity import Entity
from app.core.db.database_service import DatabaseService
from app.functions.clean_brave_results import clean_results
from app.functions.get_entity_async import get_entity_async
from app.util.markers import returns_awaitable
import json
from app.util.make_json_safe import make_json_safe

@Job.register(name="identify_news_site")
class IdentifyNewsSiteByURL(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "net": 1
    }

    label: str = "Identify News Site"
    description: str = "Identifies a news site based on a url"

    _domain: str = PrivateAttr(default="")

    async def run(self, platform: str):
        await super().run(platform)

        url = self.input["url"]
        self._domain = domain_from_url(url)

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {"url": url},
        })
        
        # check weaviate for news site by domain
        site_id = NewsSite.get_uuid_from_domain(self._domain)

        service = DatabaseService.get()

        news_site = await service.get_news_site(site_id)
        if news_site is not None:
            entities = await news_site.get_entity_objects()

            if len(entities) != 0:
                entity = entities[0]
                self.set_output({
                    "news_site": news_site,
                    "entity": entity
                })
                self.complete()
                return
        
        search_spec = {
            "type": "search_callback",
            "params": {
                "parent_id": self.id,
                "input": {
                    "query": self._domain,
                    "options": {
                        "num_pages": 1
                    }
                },
            },
            "metadata": {
                "view_data": {
                    "note": "identify news site - search"
                }
            }
        }

        self.create_child_job(
            child_label="search_pass",
            spec=search_spec,
            on_update=self.update_handler,
            on_complete=self.on_search_pass,
        )

    def update_handler(self, event):
        pass

    def on_search_pass(self, search_pass_job):
        cleaned_results = clean_results(search_pass_job.output)
        self.get_site_name_from_llm(cleaned_results)

    def get_site_name_from_llm(self, search_results):

        identify_from_search_spec = {
            "type": "identify_from_search",
            "dedupe_key": f"identify_from_search :: {self._domain}",
            "params": {
                "parent_id": self.id,
                "input": {
                    "domain": self._domain,
                    "search_results": search_results,
                },
            },
            "metadata": {
                "view_data": {
                    "note": "identify news site - llm",
                }
            }
        }

        self.create_child_job(
            child_label="identify_from_search",
            spec=identify_from_search_spec,
            on_update=self.update_handler,
            on_complete=self.on_identify_from_search_wrapper,
        )

    @returns_awaitable
    async def on_identify_from_search_wrapper(self, result):
        return await self.on_identify_from_search(result)

    async def on_identify_from_search (self, identify_from_search_job):
        service = DatabaseService.get()

        news_site = NewsSite(
            domain=self._domain
        )

        name = identify_from_search_job.output["name"]
        entity = await get_entity_async(options={
            "name": name
        })

        if entity is None:
            tags = identify_from_search_job.output["tags"]

            entity = Entity(
                        name=name,
                        tags=tags,
                        entity_type="ORG",
                        metadata={
                            "identify_from_data_output_raw": str(identify_from_search_job.output)
                        }
                    )
            entity_id = await service.add_entity(entity)
        else:
            entity_id = entity.id

        news_site.add_entity(entity_id)
        await service.add_news_site(news_site)

        self.set_output({
            "news_site": news_site,
            "entity": entity
        })
        self.complete()


