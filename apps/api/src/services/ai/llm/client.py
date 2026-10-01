"""Unified, provider-neutral generation helpers.

All AI text generation in the backend goes through ``generate`` / ``generate_stream`` so the
underlying provider is a config concern, not a code concern. These wrap Pydantic AI's
``Agent`` and translate the app's stored message/attachment formats into Pydantic AI types.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, AsyncGenerator, Optional, Sequence, Type, Union

from pydantic_ai import Agent
from pydantic_ai.messages import (
    BinaryContent,
    DocumentUrl,
    ImageUrl,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    UserPromptPart,
    VideoUrl,
)
from pydantic_ai.settings import ModelSettings

from src.services.ai.llm.provider import build_model

logger = logging.getLogger(__name__)

# Per-request timeouts (seconds). Mirrors the previous hand-rolled asyncio timeouts.
DEFAULT_TIMEOUT = 60.0
STREAM_TIMEOUT = 90.0

# A single user turn: a prompt string plus optional multimodal parts (images/docs/video).
UserPrompt = Union[str, Sequence[Any]]


def to_message_history(stored: Any) -> list[ModelMessage]:
    """Convert stored chat history into Pydantic AI ``ModelMessage`` objects.

    Accepts the Redis JSON format (``[{"role": "user"|"model", "content": str}, ...]``) and
    the legacy object format (``msg.type``/``msg.content``). Unknown entries are skipped.
    """
    messages: list[ModelMessage] = []
    if not stored:
        return messages

    items = getattr(stored, "messages", stored)
    for msg in items:
        if isinstance(msg, dict) and "role" in msg and "content" in msg:
            role, content = msg["role"], msg["content"]
        elif hasattr(msg, "type") and hasattr(msg, "content"):
            role = "user" if msg.type == "human" else "model"
            content = msg.content
        else:
            continue

        if not content:
            continue
        if role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=content)]))
        else:
            messages.append(ModelResponse(parts=[TextPart(content=content)]))
    return messages


def attachments_to_parts(attachments: Any) -> list:
    """Convert ``AttachmentData``-like objects into Pydantic AI multimodal parts.

    Replaces the Gemini-specific ``inline_data``/``file_data`` dicts. Note: video/YouTube and
    URL-based documents are only honored by providers that support them (e.g. Gemini); other
    providers will ignore or reject them — an inherent provider capability difference.
    """
    parts: list = []
    for att in attachments or []:
        a_type = getattr(att, "type", None)
        url = getattr(att, "url", None)
        b64 = getattr(att, "content_base64", None)
        mime = getattr(att, "mime_type", None)

        if a_type == "youtube" and url:
            parts.append(VideoUrl(url=url))
        elif a_type in ("image", "file") and b64 and mime:
            # content_base64 is user-supplied; a malformed/truncated value would
            # raise binascii.Error and surface as an unhandled 500. Skip the bad
            # attachment instead of crashing the whole request.
            try:
                decoded = base64.b64decode(b64)
            except Exception:
                logger.warning("Skipping attachment with invalid base64 content")
                continue
            parts.append(BinaryContent(data=decoded, media_type=mime))
        elif a_type == "image" and url:
            parts.append(ImageUrl(url=url))
        elif a_type == "file" and url:
            parts.append(DocumentUrl(url=url))
    return parts


def _settings(
    max_tokens: Optional[int], temperature: Optional[float], timeout: float
) -> ModelSettings:
    settings: dict = {"timeout": timeout}
    if max_tokens is not None:
        settings["max_tokens"] = max_tokens
    if temperature is not None:
        settings["temperature"] = temperature
    return ModelSettings(**settings)


def _agent(model_name: str, system_prompt: Optional[str], output_type: Any) -> Agent:
    return Agent(
        build_model(model_name),
        output_type=output_type,
        system_prompt=system_prompt or (),
    )


async def generate(
    *,
    model_name: str,
    user_prompt: UserPrompt,
    system_prompt: Optional[str] = None,
    history: Any = None,
    output_type: Type[Any] = str,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """Run a single (non-streaming) generation.

    Returns plain text when ``output_type`` is ``str``, or a validated instance of
    ``output_type`` (a Pydantic model) for structured output.
    """
    agent = _agent(model_name, system_prompt, output_type)
    result = await agent.run(
        user_prompt,
        message_history=to_message_history(history) or None,
        model_settings=_settings(max_tokens, temperature, timeout),
    )
    return result.output


async def generate_stream(
    *,
    model_name: str,
    user_prompt: UserPrompt,
    system_prompt: Optional[str] = None,
    history: Any = None,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    timeout: float = STREAM_TIMEOUT,
) -> AsyncGenerator[str, None]:
    """Stream text deltas for a single generation, yielding chunks as they arrive."""
    agent = _agent(model_name, system_prompt, str)
    async with agent.run_stream(
        user_prompt,
        message_history=to_message_history(history) or None,
        model_settings=_settings(max_tokens, temperature, timeout),
    ) as result:
        async for chunk in result.stream_text(delta=True):
            yield chunk


async def generate_stream_with_tools(
    *,
    model_name: str,
    user_prompt: UserPrompt,
    system_prompt: Optional[str] = None,
    history: Any = None,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    timeout: float = STREAM_TIMEOUT,
    tools: Optional[list] = None,
    deps_type: Optional[type] = None,
    deps: Any = None,
) -> AsyncGenerator[str, None]:
    """
    Stream text deltas from a tool-enabled agent.

    The agent runs the full tool loop: model -> tool calls -> tool results ->
    model -> final answer. Text deltas are yielded across all rounds, so the
    client sees a single continuous stream.

    ``tools`` is a list of tool functions decorated with ``@agent.tool`` or
    plain async functions taking a ``RunContext``. ``deps_type`` and ``deps``
    are passed to the agent so tools can re-authorize.

    Falls back to a plain stream when no tools are provided, so callers can
    use this unconditionally.
    """
    if not tools:
        async for chunk in generate_stream(
            model_name=model_name,
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            history=history,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout,
        ):
            yield chunk
        return

    if deps_type is None:
        raise ValueError("deps_type is required when tools are provided")

    agent = Agent(
        build_model(model_name),
        output_type=str,
        system_prompt=system_prompt or (),
        deps_type=deps_type,
        tools=tools,
    )
    # `run_stream` stops the agent graph as soon as it sees text matching
    # `output_type`, even when that same model response also carries a tool
    # call -- a common shape ("I'll check that." + a function call in one
    # turn). That silently drops the tool call and ends the reply early.
    # `run_stream_events` instead runs the full graph to completion (tool
    # calls included) via `agent.run()` under the hood, while still
    # streaming text deltas as they arrive across every round.
    async with agent.run_stream_events(
        user_prompt,
        message_history=to_message_history(history) or None,
        model_settings=_settings(max_tokens, temperature, timeout),
        deps=deps,
    ) as events:
        async for event in events:
            if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                if event.part.content:
                    yield event.part.content
            elif isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
                if event.delta.content_delta:
                    yield event.delta.content_delta
