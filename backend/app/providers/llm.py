"""LLM provider seam (ADR 0008): any OpenAI-compatible /chat/completions server (llama-swap, Ollama, OpenAI).

Like the market-data providers it never touches the database and reports failures as ProviderError.
Messages deliberately never include the API key or the request body (which holds the user's prompt).
"""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, Protocol

import httpx

from app.config import get_settings
from app.providers.base import ProviderError


@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant"]
    content: str


class LlmProvider(Protocol):
    model: str

    def stream_chat(self, messages: list[ChatMessage], *, max_tokens: int) -> Iterator[str]:
        """Yield the answer as text deltas. Raises ProviderError if the model cannot be reached or
        the stream breaks; closing the generator closes the upstream request."""
        ...


class OpenAICompatLlm:
    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout: float = 60,
        disable_thinking: bool = True,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.model = model
        self._disable_thinking = disable_thinking
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        # `timeout` bounds the silence between chunks, so a slow first token is the main case it covers.
        self._client = httpx.Client(
            timeout=httpx.Timeout(connect=5, read=timeout, write=10, pool=5), transport=transport
        )

    def stream_chat(self, messages: list[ChatMessage], *, max_tokens: int) -> Iterator[str]:
        body = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "max_tokens": max_tokens,
        }
        if self._disable_thinking:
            # llama.cpp/llama-swap chat-template switch; a thinking model otherwise spends the whole
            # token budget on reasoning we don't show and answers with nothing (seen on dt-default).
            body["chat_template_kwargs"] = {"enable_thinking": False}
        try:
            with self._client.stream("POST", self._url, json=body, headers=self._headers) as r:
                if r.status_code >= 400:
                    raise ProviderError(
                        f"The language model endpoint answered HTTP {r.status_code}"
                    )
                said = False
                for line in r.iter_lines():
                    if not line.startswith("data:"):
                        continue  # blank separators, comments, other SSE fields
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    text, finish = _parse_chunk(data)
                    if text:
                        said = True
                        yield text
                    if finish == "length":
                        raise ProviderError(
                            "The answer was cut off at the length limit"
                            if said
                            else "The model used its whole token budget without answering "
                            "(raise LLM_MAX_TOKENS; for a thinking model keep LLM_DISABLE_THINKING=true)"
                        )
        except httpx.HTTPError as e:
            # Not str(e): it can carry the URL; the type name is enough ("ReadTimeout", "ConnectError").
            raise ProviderError(f"The language model endpoint failed ({type(e).__name__})") from e


def _parse_chunk(data: str) -> tuple[str, str | None]:
    """(text delta, finish_reason) of one stream chunk."""
    try:
        choices = json.loads(data).get("choices") or []
        choice = choices[0] if choices else {}
        content = (choice.get("delta") or {}).get("content")  # "reasoning_content" is not shown
        finish = choice.get("finish_reason")
    except (ValueError, AttributeError, IndexError, TypeError) as e:
        raise ProviderError("The language model endpoint sent a malformed stream") from e
    return (content if isinstance(content, str) else ""), (
        finish if isinstance(finish, str) else None
    )


@lru_cache
def _llm(
    base_url: str, model: str, api_key: str, timeout: float, disable_thinking: bool
) -> OpenAICompatLlm:
    return OpenAICompatLlm(
        base_url, model, api_key, timeout, disable_thinking
    )  # one pooled client per process


def get_llm_provider() -> LlmProvider | None:
    """FastAPI dependency. None unless both LLM_BASE_URL and LLM_MODEL are set (feature off)."""
    s = get_settings()
    if not (s.llm_base_url and s.llm_model):
        return None
    return _llm(
        s.llm_base_url, s.llm_model, s.llm_api_key, s.llm_timeout_seconds, s.llm_disable_thinking
    )
