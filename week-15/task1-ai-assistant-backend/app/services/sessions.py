from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import Select, case, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ChatMessage, ChatSession, Document, MessageDocument
from app.db.session import Database
from app.schemas.session import (
    AttachedDocument,
    SessionCreate,
    SessionDetail,
    SessionSummary,
    SessionUpdate,
    StoredMessage,
)


class SessionNotFound(ValueError):
    """Raised when a session does not exist or belongs to another user."""


class SessionService:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def create(self, user_id: uuid.UUID, data: SessionCreate) -> SessionSummary:
        chat_session = ChatSession(
            user_id=user_id,
            title=data.title,
            use_rag=data.use_rag,
        )

        async with self._database.session() as database_session:
            async with database_session.begin():
                database_session.add(chat_session)

        return SessionSummary.model_validate(chat_session)

    async def list_sessions(self, user_id: uuid.UUID) -> list[SessionSummary]:
        statement = (
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .order_by(ChatSession.updated_at.desc(), ChatSession.id.desc())
        )

        async with self._database.session() as database_session:
            sessions = (await database_session.scalars(statement)).all()

        return [SessionSummary.model_validate(session) for session in sessions]

    async def get(self, user_id: uuid.UUID, session_id: uuid.UUID) -> SessionDetail:
        async with self._database.session() as database_session:
            chat_session = await database_session.scalar(
                self._owned_session_query(user_id, session_id)
            )
            if chat_session is None:
                raise SessionNotFound("Chat session not found")

            messages = (
                await database_session.scalars(
                    select(ChatMessage)
                    .where(ChatMessage.session_id == session_id)
                    .order_by(
                        ChatMessage.created_at,
                        case((ChatMessage.role == "user", 0), else_=1),
                        ChatMessage.id,
                    )
                )
            ).all()
            documents_by_message = await self._load_documents(
                database_session,
                [message.id for message in messages],
            )

        stored_messages = [
            StoredMessage(
                id=message.id,
                role=message.role,
                status=message.status,
                content=message.content,
                details=message.details,
                created_at=message.created_at,
                documents=documents_by_message[message.id],
            )
            for message in messages
        ]
        return SessionDetail(
            **SessionSummary.model_validate(chat_session).model_dump(),
            messages=stored_messages,
        )

    async def update(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        data: SessionUpdate,
    ) -> SessionSummary:
        async with self._database.session() as database_session:
            async with database_session.begin():
                chat_session = await database_session.scalar(
                    self._owned_session_query(user_id, session_id)
                )
                if chat_session is None:
                    raise SessionNotFound("Chat session not found")

                if data.title is not None:
                    chat_session.title = data.title
                if data.use_rag is not None:
                    chat_session.use_rag = data.use_rag

        return SessionSummary.model_validate(chat_session)

    async def delete(self, user_id: uuid.UUID, session_id: uuid.UUID) -> None:
        statement = (
            delete(ChatSession)
            .where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
            )
            .returning(ChatSession.id)
        )

        async with self._database.session() as database_session:
            async with database_session.begin():
                deleted_id = await database_session.scalar(statement)

        if deleted_id is None:
            raise SessionNotFound("Chat session not found")

    @staticmethod
    def _owned_session_query(
        user_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> Select[tuple[ChatSession]]:
        return select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
        )

    @staticmethod
    async def _load_documents(
        database_session: AsyncSession,
        message_ids: list[uuid.UUID],
    ) -> defaultdict[uuid.UUID, list[AttachedDocument]]:
        documents_by_message: defaultdict[uuid.UUID, list[AttachedDocument]] = (
            defaultdict(list)
        )
        if not message_ids:
            return documents_by_message

        statement = (
            select(MessageDocument.message_id, Document)
            .join(Document, Document.id == MessageDocument.document_id)
            .where(MessageDocument.message_id.in_(message_ids))
            .order_by(Document.created_at, Document.id)
        )
        rows = (await database_session.execute(statement)).all()

        for message_id, document in rows:
            documents_by_message[message_id].append(
                AttachedDocument(
                    id=document.id,
                    name=document.name,
                    chunk_count=document.chunk_count,
                )
            )
        return documents_by_message
