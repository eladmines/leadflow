"""OpenTelemetry tracing (D-202 phase 3): one message followed across the API, the outbox relay,
RabbitMQ and the messaging worker.

Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`pnpm dev` points it at the local Jaeger in
docker compose). Without an exporter the spans below are no-ops, so the code paths are the same.

Context crosses process boundaries as a W3C `traceparent`:
- webhook → relay: saved on the `inbound_events` row (the relay runs later, maybe elsewhere);
- relay/API → worker: inside the broker message, next to the id (`{"eventId", "trace"}`).

Spans carry ids and kinds only: never message text, phone numbers or tokens (rule 5).
"""

import logging
from typing import Any

from opentelemetry import propagate, trace
from opentelemetry.context import Context

from app.config import Settings

log = logging.getLogger("simplecatch")

tracer = trace.get_tracer("simplecatch")

_configured = False


def setup_tracing(settings: Settings, service_name: str) -> bool:
    """Installs the exporting tracer provider once per process; True when tracing is on."""
    global _configured
    if not settings.OTEL_EXPORTER_OTLP_ENDPOINT:
        return False
    if _configured:
        return True
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    endpoint = settings.OTEL_EXPORTER_OTLP_ENDPOINT.rstrip("/")
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")))
    trace.set_tracer_provider(provider)
    HTTPXClientInstrumentor().instrument()  # calls to Meta, Google, Brevo
    _configured = True
    log.info("tracing on", extra={"service": service_name})
    return True


def instrument_api(app: Any) -> None:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    # Health checks and the SPA's files would only add noise.
    FastAPIInstrumentor.instrument_app(app, excluded_urls="health,assets", exclude_spans=["receive", "send"])


def current_traceparent() -> str | None:
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    return carrier.get("traceparent")


def carrier_of(traceparent: str | None = None) -> dict[str, str]:
    """The context to put in a broker message: the given one, or the current span's."""
    if traceparent:
        return {"traceparent": traceparent}
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    return carrier


def context_of(carrier: Any) -> Context | None:
    """The parent context from a broker message or a stored `traceparent` (None when absent)."""
    if isinstance(carrier, str):
        carrier = {"traceparent": carrier}
    if not isinstance(carrier, dict) or not carrier.get("traceparent"):
        return None
    return propagate.extract({"traceparent": str(carrier["traceparent"])})
