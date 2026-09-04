from __future__ import annotations

import asyncio
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, cast

from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant.agent import (
    AgentCompleteEvent,
    AgentDeltaEvent,
    AgentToolEvent,
    AssistantAgent,
)
from app.db.models import ChatMessage as StoredChatMessage
from app.db.models import ChatSession, Document, MessageDocument
from app.db.session import Database
from app.rag.retriever import RetrievalResult, Retriever
from app.schemas.chat import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ChatStreamComplete,
    ChatStreamDelta,
    ChatStreamEvent,
    ChatStreamStatus,
    ChatStreamTool,
    Confidence,
    PipelineStats,
    SourceReference,
    ToolExecution,
)
from app.schemas.document import RetrievedChunk


class ChatSessionNotFound(ValueError):
    """Raised when a chat session is not owned by the current user."""


class DocumentNotAvailable(ValueError):
    """Raised when an attachment is not available to the current user."""


@dataclass(frozen=True, slots=True)
class PreparedChat:
    user_id: uuid.UUID
    assistant_message_id: uuid.UUID
    history: list[ChatMessage]
    document_ids: list[str]
    use_rag: bool


class ChatService:
    def __init__(
        self,
        retriever: Retriever,
        agent: AssistantAgent,
        database: Database,
    ) -> None:
        self._retriever = retriever
        self._agent = agent
        self._database = database

    async def chat(self, request: ChatRequest, user_id: uuid.UUID) -> ChatResponse:
        """Persist and answer one authenticated chat message."""

        prepared = await self._prepare_chat(request, user_id)

        try:
            retrieval = await self._retrieve(request.message, prepared)
            response = await self._generate_response(request, prepared, retrieval)
            await self._save_assistant_message(
                prepared.assistant_message_id,
                status="complete",
                content=response.answer,
                response=response,
            )
            return response
        except Exception:
            await self._save_assistant_message(
                prepared.assistant_message_id,
                status="error",
            )
            raise

    async def stream(
        self,
        request: ChatRequest,
        user_id: uuid.UUID,
    ) -> AsyncIterator[ChatStreamEvent]:
        """Persist a chat while streaming activity and answer text."""

        prepared = await self._prepare_chat(request, user_id)
        answer_parts: list[str] = []
        tools_used: list[ToolExecution] = []

        try:
            if prepared.use_rag:
                yield ChatStreamStatus(
                    stage="retrieving",
                    message="Searching relevant documents",
                )
            retrieval = await self._retrieve(request.message, prepared)

            yield ChatStreamStatus(
                stage="generating",
                message="Generating an answer",
            )
            context = self._retriever.format_context(retrieval.chunks)

            async for agent_event in self._agent.stream(
                request.message,
                history=prepared.history,
                context=context,
            ):
                if isinstance(agent_event, AgentToolEvent):
                    tools_used.append(agent_event.execution)
                    yield ChatStreamTool(tool=agent_event.execution)
                    continue

                if isinstance(agent_event, AgentDeltaEvent):
                    answer_parts.append(agent_event.content)
                    yield ChatStreamDelta(content=agent_event.content)
                    continue

                if isinstance(agent_event, AgentCompleteEvent):
                    response = self._build_response(
                        answer=agent_event.answer,
                        cited_chunk_ids=agent_event.metadata.cited_chunk_ids,
                        confidence=agent_event.metadata.confidence,
                        follow_up_questions=agent_event.metadata.follow_up_questions,
                        tools_used=agent_event.tools_used,
                        model=agent_event.model,
                        used_fallback=agent_event.used_fallback,
                        retrieval=retrieval,
                    )
                    await self._save_assistant_message(
                        prepared.assistant_message_id,
                        status="complete",
                        content=response.answer,
                        response=response,
                    )
                    yield ChatStreamComplete(response=response)
                    return
        except (asyncio.CancelledError, GeneratorExit):
            await self._save_assistant_message(
                prepared.assistant_message_id,
                status="stopped",
                content="".join(answer_parts),
                tools_used=tools_used,
            )
            raise
        except Exception:
            await self._save_assistant_message(
                prepared.assistant_message_id,
                status="error",
                content="".join(answer_parts),
                tools_used=tools_used,
            )
            raise

    async def _prepare_chat(
        self,
        request: ChatRequest,
        user_id: uuid.UUID,
    ) -> PreparedChat:
        """Validate ownership and create the two message records."""

        now = datetime.now(UTC)
        requested_document_ids = list(dict.fromkeys(request.document_ids))

        async with self._database.session() as database_session:
            async with database_session.begin():
                chat_session = await database_session.scalar(
                    select(ChatSession).where(
                        ChatSession.id == request.session_id,
                        ChatSession.user_id == user_id,
                    )
                )
                if chat_session is None:
                    raise ChatSessionNotFound("Chat session not found")

                documents = (
                    await database_session.scalars(
                        select(Document).where(
                            Document.id.in_(requested_document_ids),
                            Document.user_id == user_id,
                            Document.status == "ready",
                            Document.expires_at > now,
                        )
                    )
                ).all()
                if len(documents) != len(requested_document_ids):
                    raise DocumentNotAvailable("One or more documents are unavailable")

                history = await self._load_history(database_session, request.session_id)
                user_message = StoredChatMessage(
                    session_id=request.session_id,
                    role="user",
                    status="complete",
                    content=request.message,
                )
                assistant_message = StoredChatMessage(
                    session_id=request.session_id,
                    role="assistant",
                    status="streaming",
                    content="",
                )
                database_session.add_all([user_message, assistant_message])
                await database_session.flush()

                database_session.add_all(
                    MessageDocument(
                        message_id=user_message.id,
                        document_id=document.id,
                    )
                    for document in documents
                )
                chat_session.updated_at = now
                session_document_ids = await self._load_session_document_ids(
                    database_session,
                    request.session_id,
                    user_id,
                    now,
                )

        return PreparedChat(
            user_id=user_id,
            assistant_message_id=assistant_message.id,
            history=history,
            document_ids=[str(document_id) for document_id in session_document_ids],
            use_rag=chat_session.use_rag and bool(session_document_ids),
        )

    @staticmethod
    async def _load_history(
        database_session: AsyncSession,
        session_id: uuid.UUID,
    ) -> list[ChatMessage]:
        statement = (
            select(StoredChatMessage)
            .where(
                StoredChatMessage.session_id == session_id,
                StoredChatMessage.content != "",
                StoredChatMessage.status.in_(("complete", "stopped")),
            )
            .order_by(
                StoredChatMessage.created_at.desc(),
                case((StoredChatMessage.role == "user", 0), else_=1).desc(),
                StoredChatMessage.id.desc(),
            )
            .limit(20)
        )
        messages = list(reversed((await database_session.scalars(statement)).all()))
        return [
            ChatMessage(
                role=cast(Literal["user", "assistant"], message.role),
                content=message.content,
            )
            for message in messages
        ]

    @staticmethod
    async def _load_session_document_ids(
        database_session: AsyncSession,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        now: datetime,
    ) -> list[uuid.UUID]:
        statement = (
            select(Document.id)
            .join(MessageDocument, MessageDocument.document_id == Document.id)
            .join(
                StoredChatMessage,
                StoredChatMessage.id == MessageDocument.message_id,
            )
            .where(
                StoredChatMessage.session_id == session_id,
                Document.user_id == user_id,
                Document.status == "ready",
                Document.expires_at > now,
            )
            .distinct()
        )
        return list((await database_session.scalars(statement)).all())

    async def _retrieve(
        self,
        question: str,
        prepared: PreparedChat,
    ) -> RetrievalResult:
        if not prepared.use_rag:
            return RetrievalResult(chunks=[], strategy="disabled")
        return await self._retriever.retrieve(
            question,
            user_id=str(prepared.user_id),
            document_ids=prepared.document_ids,
        )

    async def _generate_response(
        self,
        request: ChatRequest,
        prepared: PreparedChat,
        retrieval: RetrievalResult,
    ) -> ChatResponse:
        context = self._retriever.format_context(retrieval.chunks)
        agent_result = await self._agent.run(
            request.message,
            history=prepared.history,
            context=context,
        )
        return self._build_response(
            answer=agent_result.output.answer,
            cited_chunk_ids=agent_result.output.cited_chunk_ids,
            confidence=agent_result.output.confidence,
            follow_up_questions=agent_result.output.follow_up_questions,
            tools_used=agent_result.tools_used,
            model=agent_result.model,
            used_fallback=agent_result.used_fallback,
            retrieval=retrieval,
        )

    def _build_response(
        self,
        *,
        answer: str,
        cited_chunk_ids: list[str],
        confidence: Confidence,
        follow_up_questions: list[str],
        tools_used: list[ToolExecution],
        model: str,
        used_fallback: bool,
        retrieval: RetrievalResult,
    ) -> ChatResponse:
        sources = self._build_sources(cited_chunk_ids, retrieval.chunks)
        return ChatResponse(
            answer=self._format_citations(answer, sources),
            confidence=confidence,
            follow_up_questions=follow_up_questions,
            sources=sources,
            tools_used=tools_used,
            model=model,
            used_fallback=used_fallback,
            pipeline_stats=PipelineStats(
                retrieval_strategy=retrieval.strategy,
                retrieved_chunks=len(retrieval.chunks),
                cited_chunks=len(sources),
                tool_executions=len(tools_used),
            ),
        )

    async def _save_assistant_message(
        self,
        message_id: uuid.UUID,
        *,
        status: str,
        content: str = "",
        response: ChatResponse | None = None,
        tools_used: list[ToolExecution] | None = None,
    ) -> None:
        details = (
            response.model_dump(mode="json", exclude={"answer"})
            if response
            else {
                "tools_used": [
                    tool.model_dump(mode="json") for tool in tools_used or []
                ]
            }
        )
        async with self._database.session() as database_session:
            async with database_session.begin():
                message = await database_session.get(StoredChatMessage, message_id)
                if message is not None:
                    message.status = status
                    message.content = content
                    message.details = details

    @staticmethod
    def _build_sources(
        cited_chunk_ids: list[str],
        retrieved_chunks: list[RetrievedChunk],
    ) -> list[SourceReference]:
        chunks_by_id = {
            chunk.chunk_id: (source_number, chunk)
            for source_number, chunk in enumerate(retrieved_chunks, start=1)
        }
        sources: list[SourceReference] = []
        seen_ids: set[str] = set()

        for chunk_id in cited_chunk_ids:
            source = chunks_by_id.get(chunk_id)
            if source is None or chunk_id in seen_ids:
                continue

            citation_number, chunk = source
            seen_ids.add(chunk_id)
            sources.append(
                SourceReference(
                    citation_number=citation_number,
                    chunk_id=chunk.chunk_id,
                    document_name=chunk.document_name,
                    chunk_index=chunk.chunk_index,
                    score=chunk.score,
                    text=chunk.text,
                )
            )

        return sources

    @staticmethod
    def _format_citations(answer: str, sources: list[SourceReference]) -> str:
        for source in sources:
            citation = f"[{source.citation_number}]"
            answer = answer.replace(f"[{source.chunk_id}]", citation)

        available_numbers = {source.citation_number for source in sources}

        def replace_source_line(match: re.Match[str]) -> str:
            mentioned_numbers = [
                int(number) for number in re.findall(r"\d+", match.group(1))
            ]
            citations = [
                f"[{number}]"
                for number in mentioned_numbers
                if number in available_numbers
            ]
            return " " + "".join(citations) if citations else ""

        answer = re.sub(
            r"\\?\s*\n?\s*\*{0,2}Source:\s*document\s+chunks?\s+"
            r"([\d,\sand]+)\.?\*{0,2}",
            replace_source_line,
            answer,
            flags=re.IGNORECASE,
        )
        return answer.replace("\\\n", "\n")
