"""Tiny in-process sliding-window limiter for user-triggered upstream calls.

Not persisted and not shared between processes (same caveat as `cache.py`). Callers ask `check`
before spending an upstream call and `hit` once they do; `check` returns the seconds to wait.
"""

import math
import threading
import time
from collections import deque
from collections.abc import Callable, Hashable


class SlidingWindowLimiter:
    def __init__(
        self,
        limit: int,
        window: float,
        max_keys: int = 4096,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._limit = limit
        self._window = window
        self._max_keys = max_keys
        self._clock = clock
        self._hits: dict[Hashable, deque[float]] = {}
        self._lock = threading.Lock()

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()

    def retry_after(self, key: Hashable) -> int:
        """Whole seconds until `key` may act again; 0 if it may act now."""
        with self._lock:
            now = self._clock()
            hits = self._live(key, now)
            if len(hits) < self._limit:
                return 0
            return max(1, math.ceil(hits[0] + self._window - now))

    def hit(self, key: Hashable) -> None:
        with self._lock:
            now = self._clock()
            self._live(key, now)  # drop expired hits so a busy key can't grow without bound
            self._hits.setdefault(key, deque()).append(now)
            if len(self._hits) > self._max_keys:
                self._prune(now)

    def _live(self, key: Hashable, now: float) -> deque[float]:
        hits = self._hits.get(key)
        if hits is None:
            return deque()
        while hits and now - hits[0] >= self._window:
            hits.popleft()
        return hits

    def _prune(self, now: float) -> None:
        for k in [k for k, h in self._hits.items() if not h or now - h[-1] >= self._window]:
            del self._hits[k]
        while len(self._hits) > self._max_keys:  # still over: drop the oldest-inserted keys
            del self._hits[next(iter(self._hits))]
