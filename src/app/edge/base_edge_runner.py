from abc import ABC, abstractmethod
from typing import Dict, List, Any

class EdgeRunner(ABC):

    @abstractmethod
    def echo_callback(self, job_id: str, message: str) -> str:
        pass

    @abstractmethod
    def brave_search_callback(self, job_id: str, query: str, options: Dict[str, Any] = {}):
        pass

    @abstractmethod
    def scrape_page_callback(self, job_id: str, url: str, options: Dict[str, Any] = {}):
        pass

    @abstractmethod
    def get_llm_response_callback(self, job_id: str, options: Dict[str, Any] = {}):
        pass

    @abstractmethod
    def echo(self, message: str) -> str:
        pass

    @abstractmethod
    def brave_search(self, query: str, max_results: int = None, offset: int = None,
                     retries: int = None, backoff_factor: float = None) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def scrape_page(self, url: str, get_raw: bool = False) -> str:
        pass

    @abstractmethod
    def get_llm_response(self, messages: str = None, system_message: str = None, user_message: str = None,
                         model: str = None, response_format: str = None, endpoint: str = None,
                         parameters: Dict[str, str] = None, post_endpoint: str = None,
                         token_limit: int = None) -> str:
        pass