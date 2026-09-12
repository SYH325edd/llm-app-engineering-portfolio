"""PlatformAdapter abstraction for LakeJob platform integrations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class PlatformAdapter(ABC):
    """Neutral interface that product code uses for platform operations."""

    @abstractmethod
    def start(self) -> None:
        """Start adapter runtime resources."""

    @abstractmethod
    def close(self) -> None:
        """Release adapter runtime resources."""

    @abstractmethod
    def search_jobs(self, keyword: str, *, city: str = "全国") -> list[dict[str, Any]]:
        """Search platform jobs and return Core-shaped job dictionaries."""

    @abstractmethod
    def search_candidates(self, keyword: str, *, limit: int = 20) -> list[dict[str, Any]]:
        """Search platform candidates and return Core-shaped dictionaries."""

    @abstractmethod
    def get_job_detail(self, job_url: str) -> dict[str, Any]:
        """Fetch one job detail and return a Core-shaped job dictionary."""

    @abstractmethod
    def get_candidate_detail(self, candidate: dict[str, Any]) -> dict[str, Any]:
        """Fetch one candidate detail and return a Core-shaped dictionary."""

    @abstractmethod
    def apply_to_job(self, job: dict[str, Any], message: str) -> dict[str, Any]:
        """Apply to a job using a platform-specific action."""

    @abstractmethod
    def fetch_conversations(self) -> list[dict[str, Any]]:
        """Fetch platform conversations as Core-shaped dictionaries."""

    @abstractmethod
    def send_message(self, conversation: dict[str, Any], message: str) -> bool:
        """Send one message in a platform conversation."""

    @abstractmethod
    def get_account_status(self) -> dict[str, Any]:
        """Return current account/session status."""
