"""D-202 phase 3: one message is one trace across the webhook, the outbox relay, the broker and the
worker, and spans hold ids, never message text or phone numbers."""

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import app.modules.outbound.service as outbound
from app.integrations.queue import INBOUND, OUTBOUND
from app.modules.inbound.service import publish_pending
from tests.conftest import req
from tests.test_inbound import worker as inbound_worker
from tests.test_outbound import app, bus, settings, wa  # noqa: F401 (fixtures: broker mode)
from tests.test_whatsapp import BUSINESS_ID, connected, customer, leads_of, post, text_event, thread_url

_exporter = InMemorySpanExporter()


@pytest.fixture(scope="module", autouse=True)
def spans_in_memory():
    """Installs an in-memory provider once (the global provider can only be set once)."""
    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):
        provider = TracerProvider()
        trace.set_tracer_provider(provider)
    provider.add_span_processor(SimpleSpanProcessor(_exporter))
    yield


@pytest.fixture(autouse=True)
def fresh():
    _exporter.clear()


def by_name(name):
    found = [s for s in _exporter.get_finished_spans() if s.name == name]
    assert found, f"no span {name!r}"
    return found[-1]


def no_pii(*values):
    for span in _exporter.get_finished_spans():
        text = repr(dict(span.attributes or {}))
        for value in values:
            assert value not in text, f"{value!r} in span {span.name}"


async def test_an_incoming_message_is_one_trace_from_webhook_to_worker(app, client, db, bus):  # noqa: F811
    await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "היי, אפשר תור?"))
    await publish_pending(app.state)
    assert "trace" in bus.published[INBOUND][0]  # the context rides next to the id
    await bus.drain(inbound_worker(app), INBOUND)

    accept = by_name("webhook accept")
    publish = by_name("outbox publish")
    process = by_name("process inbound event")
    assert accept.context.trace_id == publish.context.trace_id == process.context.trace_id
    assert publish.parent.span_id == accept.context.span_id  # continued from the stored row
    assert process.parent.span_id == publish.context.span_id  # continued from the broker message
    assert process.kind == trace.SpanKind.CONSUMER
    assert process.attributes["messaging.provider"] == "whatsapp"
    no_pii("972501112233", "היי, אפשר תור?")


async def test_a_reply_is_one_trace_from_dispatch_to_send(app, client, db, bus, wa):  # noqa: F811
    owner = await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "היי"))
    await publish_pending(app.state)
    await bus.drain(inbound_worker(app), INBOUND)
    (lead,) = await leads_of(client, owner["token"])
    _exporter.clear()

    await req(client, "POST", thread_url(BUSINESS_ID, lead["id"]), owner["token"], {"text": "מתי נוח?"})
    await bus.drain(lambda body: outbound.handle(app.state, body), OUTBOUND)

    dispatch = by_name("dispatch outbound")
    consume = by_name("send queued messages")
    send = by_name("send message")
    assert dispatch.context.trace_id == consume.context.trace_id == send.context.trace_id
    assert consume.parent.span_id == dispatch.context.span_id
    assert send.parent.span_id == consume.context.span_id
    assert send.attributes["outbound.result"] == "sent"
    assert send.attributes["outbound.kind"] == "text"
    assert send.attributes["messaging.channel"] == "whatsapp"
    no_pii("972501112233", "מתי נוח?")


async def test_a_failed_send_is_marked_as_an_error(app, client, db, bus, wa):  # noqa: F811
    from app.integrations.whatsapp import WhatsAppSendError

    await connected(client, db)
    number = await customer(db)
    from tests.test_outbound import queue

    await queue(app, number, "תיכשל")
    wa.fail_with = WhatsAppSendError(400, 131047)
    await outbound.flush_number(app.state, number.id)
    send = by_name("send message")
    assert send.attributes["outbound.result"] == "failed"
    assert send.status.status_code == trace.StatusCode.ERROR
