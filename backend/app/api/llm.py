"""News summary and chat for the ticker page (ADR 0008): streamed over SSE from an OpenAI-compatible model.

Everything that needs the request's database session (quote, position) happens before the stream starts;
the generator only talks to the model. Problems known up front are normal HTTP errors, problems after the
first byte become `error` events.
"""

import json
import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select

from app import holdings as agg
from app.api.deps import CurrentUser, DbDep
from app.api.symbols import NEWS_DAYS, NEWS_LIMIT, NEWS_TTL, CompanyDep, QuoteDep, SymbolDep
from app.cache import company_cache
from app.config import get_settings
from app.llm_prompts import PositionFacts, Preset, QuoteFacts, Turn, build_messages
from app.models import Account, Position
from app.providers.base import NewsItem, ProviderError
from app.providers.llm import LlmProvider, get_llm_provider
from app.quotes import get_quotes

log = logging.getLogger(__name__)
router = APIRouter(prefix="/llm", tags=["llm"])

LlmDep = Annotated[LlmProvider | None, Depends(get_llm_provider)]

MESSAGE_MAX = 500
TURN_MAX = 4000
HISTORY_MAX = 10


class StatusOut(BaseModel):
    enabled: bool
    model: str | None


class TurnIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=TURN_MAX)


class ChatIn(BaseModel):
    preset: Preset | None = None
    message: str | None = Field(default=None, max_length=MESSAGE_MAX)
    history: list[TurnIn] = Field(default_factory=list, max_length=HISTORY_MAX)
    include_position: bool = False  # explicit per-request opt-in; never defaults to true

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("message must not be blank")
        return v

    @model_validator(mode="after")
    def _one_of(self) -> "ChatIn":
        if (self.preset is None) == (self.message is None):
            raise ValueError("send exactly one of preset and message")
        return self


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("/status")
def llm_status(_: CurrentUser, llm: LlmDep) -> StatusOut:
    return StatusOut(enabled=llm is not None, model=llm.model if llm else None)


def _stream(llm: LlmProvider, messages, warnings: list[str], max_tokens: int) -> Iterator[str]:
    for w in warnings:
        yield _sse("warning", {"message": w})
    chunks = llm.stream_chat(messages, max_tokens=max_tokens)
    try:
        for text in chunks:
            yield _sse("delta", {"text": text})
    except ProviderError as e:
        yield _sse("error", {"message": str(e)})
        return
    except Exception:  # headers are already sent; never leak internals into the stream
        log.exception("LLM stream failed")
        yield _sse("error", {"message": "The language model request failed."})
        return
    finally:
        close = getattr(
            chunks, "close", None
        )  # on client disconnect this ends the upstream request
        if close:
            close()
    yield _sse("done", {})


@router.post("/{symbol}/chat")
def chat(
    symbol: SymbolDep,
    body: ChatIn,
    user: CurrentUser,
    db: DbDep,
    llm: LlmDep,
    quote_provider: QuoteDep,
    company: CompanyDep,
) -> StreamingResponse:
    if llm is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The language model is not configured (set LLM_BASE_URL and LLM_MODEL).",
        )
    settings = get_settings()
    warnings: list[str] = []
    quotes = get_quotes(db, [symbol], quote_provider, settings.quote_ttl_seconds, warnings)
    quote = quotes.get(symbol)

    news: list[NewsItem] = []
    if company is None:
        warnings.append("News is off: FINNHUB_API_KEY is not set.")
    else:
        try:  # same cache entry as the News section, so this costs no extra Finnhub call
            news = company_cache.get_or_set(
                ("news", symbol), NEWS_TTL, lambda: company.get_news(symbol, NEWS_DAYS, NEWS_LIMIT)
            ).value
        except ProviderError as e:
            warnings.append(f"News unavailable ({e}).")
    if quote is None and not news:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"There is no quote or news for {symbol} to talk about."
        )

    position = None
    if body.include_position:
        held = [
            (p, a)
            for p, a in db.execute(
                select(Position, Account)
                .join(Account, Account.id == Position.account_id)
                .where(Account.user_id == user.id, Position.symbol == symbol)
            )
        ]
        rows, _ = agg.build(held, quotes)
        if rows:
            r = rows[0]
            position = PositionFacts(r.quantity, r.cost_basis, r.value, r.gain)
        else:
            warnings.append(f"You don't hold {symbol}, so no position was shared.")

    messages = build_messages(
        symbol=symbol,
        preset=body.preset,
        message=body.message,
        history=[Turn(t.role, t.content) for t in body.history],
        quote=QuoteFacts(quote.price, quote.prev_close, quote.stale) if quote else None,
        news=news,
        now=datetime.now(UTC),
        max_news_items=settings.llm_max_news_items,
        position=position,
    )
    return StreamingResponse(
        _stream(llm, messages, warnings, settings.llm_max_tokens),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
