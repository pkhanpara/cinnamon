import threading

import pytest

from app.cache import TTLCache


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def cache(**kw):
    clock = Clock()
    return TTLCache(clock=clock, **kw), clock


def test_hit_within_ttl_calls_the_factory_once():
    c, clock = cache()
    calls = []
    f = lambda: calls.append(1) or "v"
    assert c.get_or_set("k", 10, f).value == "v"
    clock.t = 9.9
    r = c.get_or_set("k", 10, f)
    assert (r.value, r.stale, len(calls)) == ("v", False, 1)


def test_expired_entry_is_refetched():
    c, clock = cache()
    n = iter(range(10))
    assert c.get_or_set("k", 10, lambda: next(n)).value == 0
    clock.t = 10
    assert c.get_or_set("k", 10, lambda: next(n)).value == 1


def test_failure_serves_the_expired_value_flagged_stale():
    c, clock = cache()
    c.get_or_set("k", 10, lambda: "old")
    clock.t = 99

    def boom():
        raise RuntimeError("upstream down")

    r = c.get_or_set("k", 10, boom)
    assert (r.value, r.stale) == ("old", True)


def test_failure_with_nothing_cached_propagates_and_is_not_cached():
    c, _ = cache()

    def boom():
        raise RuntimeError("down")

    with pytest.raises(RuntimeError):
        c.get_or_set("k", 10, boom)
    assert c.get_or_set("k", 10, lambda: "ok").value == "ok"  # next call retries


def test_none_is_a_cacheable_value():
    c, _ = cache()
    calls = []
    f = lambda: calls.append(1)  # returns None
    c.get_or_set("etf-profile", 10, f)
    c.get_or_set("etf-profile", 10, f)
    assert len(calls) == 1


def test_concurrent_misses_share_one_fetch():
    c, _ = cache()
    calls, gate = [], threading.Event()

    def slow():
        calls.append(1)
        gate.wait(2)
        return "v"

    results = []
    threads = [
        threading.Thread(target=lambda: results.append(c.get_or_set("k", 10, slow).value))
        for _ in range(8)
    ]
    for t in threads:
        t.start()
    gate.set()
    for t in threads:
        t.join()
    assert results == ["v"] * 8 and len(calls) == 1


def test_oldest_entries_are_evicted_beyond_the_limit():
    c, _ = cache(max_entries=2)
    for k in ("a", "b", "c"):
        c.get_or_set(k, 100, lambda k=k: k)
    calls = []
    c.get_or_set("a", 100, lambda: calls.append(1) or "a2")  # "a" was evicted -> refetched
    assert calls == [1]


def test_different_keys_do_not_block_each_other():
    c, _ = cache()
    inside = threading.Event()
    release = threading.Event()
    done = []

    def slow():
        inside.set()
        release.wait(2)
        return "slow"

    t = threading.Thread(target=lambda: c.get_or_set("slow", 10, slow))
    t.start()
    inside.wait(2)
    done.append(c.get_or_set("fast", 10, lambda: "fast").value)  # must not wait for "slow"
    release.set()
    t.join()
    assert done == ["fast"]
