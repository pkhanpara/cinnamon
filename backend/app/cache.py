"""Small in-process TTL cache for slow, rate-limited upstream calls (history, profiles, news).

Not persisted and not shared between processes: fine for a single-process app, and a restart simply
refetches. Quotes use the DB-backed cache in `quotes.py` instead (they feed totals and need to survive restarts).
"""

import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Hashable
from dataclasses import dataclass


@dataclass(frozen=True)
class Cached[T]:
    value: T
    stale: bool  # True when the refresh failed and an expired value was served instead
    fetched_at: float  # time.time() of the fetch


class TTLCache:
    def __init__(self, max_entries: int = 256, clock: Callable[[], float] = time.monotonic) -> None:
        self._data: OrderedDict[Hashable, tuple[float, float, object]] = OrderedDict()
        self._locks: dict[Hashable, threading.Lock] = {}
        self._guard = threading.Lock()
        self._max = max_entries
        self._clock = clock

    def clear(self) -> None:
        with self._guard:
            self._data.clear()
            self._locks.clear()

    def get_or_set[T](self, key: Hashable, ttl: float, factory: Callable[[], T]) -> Cached[T]:
        """Fresh hit -> cached value. Otherwise call `factory` once even if many threads ask at the
        same time (the rest wait and reuse the result). If it raises and an expired value exists,
        that value is returned flagged stale; with nothing cached the exception propagates.
        Failures are never cached."""
        hit = self._fresh(key, ttl)
        if hit is not None:
            return hit
        with self._lock_for(key):
            hit = self._fresh(key, ttl)  # someone may have filled it while we waited
            if hit is not None:
                return hit
            try:
                value = factory()
            except Exception:
                with self._guard:
                    old = self._data.get(key)
                if old is not None:
                    return Cached(old[2], True, old[1])  # type: ignore[arg-type]
                raise
            now_wall = time.time()
            with self._guard:
                self._data[key] = (self._clock(), now_wall, value)
                self._data.move_to_end(key)
                while len(self._data) > self._max:
                    evicted, _ = self._data.popitem(last=False)
                    self._locks.pop(evicted, None)
            return Cached(value, False, now_wall)

    def _fresh(self, key: Hashable, ttl: float) -> Cached | None:
        with self._guard:
            entry = self._data.get(key)
            if entry is not None and self._clock() - entry[0] < ttl:
                self._data.move_to_end(key)
                return Cached(entry[2], False, entry[1])
        return None

    def _lock_for(self, key: Hashable) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())


history_cache = TTLCache(max_entries=256)
company_cache = TTLCache(max_entries=1024)  # profiles, metrics, news, search


def clear_all_caches() -> None:
    history_cache.clear()
    company_cache.clear()
