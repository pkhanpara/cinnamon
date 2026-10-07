import json

import httpx
import pytest

from app.providers.base import ProviderError
from app.providers.llm import ChatMessage, OpenAICompatLlm

MSGS = [ChatMessage("system", "s"), ChatMessage("user", "u")]


def sse(*events: object) -> bytes:
    out = ""
    for e in events:
        out += "data: " + (e if isinstance(e, str) else json.dumps(e)) + "\n\n"
    return out.encode()


def chunk(**delta):
    return {"choices": [{"delta": delta}]}


def llm(handler, key="", base="http://llm.test/v1/", **kw):
    return OpenAICompatLlm(base, "m1", key, 5, transport=httpx.MockTransport(handler), **kw)


def test_streams_deltas_until_done_and_ignores_reasoning_and_role_chunks():
    seen = {}

    def handler(request):
        seen["url"], seen["body"], seen["auth"] = (
            str(request.url), json.loads(request.content), request.headers.get("authorization"),
        )  # fmt: skip
        body = sse(
            chunk(role="assistant"), chunk(reasoning_content="thinking..."), chunk(content="Hel"),
            chunk(content="lo"), {"choices": []}, "[DONE]", chunk(content="never"),
        )  # fmt: skip
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    assert list(llm(handler).stream_chat(MSGS, max_tokens=77)) == ["Hel", "lo"]
    assert seen["url"] == "http://llm.test/v1/chat/completions"
    assert seen["body"]["stream"] is True and seen["body"]["max_tokens"] == 77
    assert seen["body"]["model"] == "m1"
    assert seen["body"]["messages"] == [
        {"role": "system", "content": "s"},
        {"role": "user", "content": "u"},
    ]
    assert seen["auth"] is None  # no key configured -> no Authorization header


def test_api_key_is_sent_as_bearer():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, content=sse("[DONE]"))

    list(llm(handler, key="sk-secret").stream_chat(MSGS, max_tokens=1))
    assert seen["auth"] == "Bearer sk-secret"


def test_http_error_becomes_provider_error_without_key_or_body():
    def handler(request):
        return httpx.Response(401, text="bad key sk-secret and your prompt u")

    with pytest.raises(ProviderError) as e:
        list(llm(handler, key="sk-secret").stream_chat(MSGS, max_tokens=1))
    assert (
        "401" in str(e.value) and "sk-secret" not in str(e.value) and "prompt" not in str(e.value)
    )


def test_network_failure_and_timeout_become_provider_errors():
    def boom(request):
        raise httpx.ConnectError("refused http://llm.test/v1?key=sk-secret", request=request)

    with pytest.raises(ProviderError) as e:
        list(llm(boom, key="sk-secret").stream_chat(MSGS, max_tokens=1))
    assert "ConnectError" in str(e.value) and "sk-secret" not in str(e.value)

    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(ProviderError, match="ReadTimeout"):
        list(llm(slow).stream_chat(MSGS, max_tokens=1))


def test_malformed_stream_is_a_provider_error():
    def handler(request):
        return httpx.Response(200, content=sse("{not json"))

    with pytest.raises(ProviderError, match="malformed"):
        list(llm(handler).stream_chat(MSGS, max_tokens=1))


def test_closing_the_generator_early_is_clean():
    def handler(request):
        return httpx.Response(200, content=sse(chunk(content="a"), chunk(content="b"), "[DONE]"))

    gen = llm(handler).stream_chat(MSGS, max_tokens=1)
    assert next(gen) == "a"
    gen.close()


def test_thinking_switch_is_sent_unless_turned_off():
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=sse("[DONE]"))

    list(llm(handler).stream_chat(MSGS, max_tokens=1))
    list(llm(handler, disable_thinking=False).stream_chat(MSGS, max_tokens=1))
    assert bodies[0]["chat_template_kwargs"] == {"enable_thinking": False}
    assert "chat_template_kwargs" not in bodies[1]  # e.g. OpenAI, which rejects unknown fields


def finish(reason):
    return {"choices": [{"delta": {}, "finish_reason": reason}]}


def test_running_out_of_tokens_while_thinking_is_an_error_not_an_empty_answer():
    def handler(request):
        body = sse(chunk(reasoning_content="hmm"), finish("length"))
        return httpx.Response(200, content=body)

    with pytest.raises(ProviderError, match="LLM_DISABLE_THINKING"):
        list(llm(handler).stream_chat(MSGS, max_tokens=1))


def test_a_truncated_answer_keeps_its_text_then_errors():
    def handler(request):
        return httpx.Response(200, content=sse(chunk(content="Part"), finish("length")))

    gen = llm(handler).stream_chat(MSGS, max_tokens=1)
    assert next(gen) == "Part"
    with pytest.raises(ProviderError, match="cut off"):
        next(gen)


def test_a_normal_stop_finish_is_not_an_error():
    def handler(request):
        return httpx.Response(200, content=sse(chunk(content="ok"), finish("stop"), "[DONE]"))

    assert list(llm(handler).stream_chat(MSGS, max_tokens=1)) == ["ok"]


def test_defaults_disable_thinking_and_allow_long_answers():
    from app.config import Settings

    s = Settings(_env_file=None)
    assert s.llm_disable_thinking is True and s.llm_max_tokens == 96_000
    assert llm(lambda r: httpx.Response(200, content=sse("[DONE]")))._disable_thinking is True
