from __future__ import annotations

from uuid import NAMESPACE_URL, uuid5

from app.schemas.document import DocumentChunk


class TextChunker:
    def __init__(self, chunk_size: int, chunk_overlap: int) -> None:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")

        if chunk_overlap < 0 or chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be between 0 and chunk_size")

        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap

    def split(
        self,
        text: str,
        *,
        document_id: str,
        user_id: str,
        document_name: str,
    ) -> list[DocumentChunk]:
        """Split text into overlapping chunks near readable boundaries.

        For example, an overlap can repeat the phrase "programming language"
        between two neighboring chunks so its meaning is not cut in half.
        """

        chunks: list[DocumentChunk] = []
        start = 0

        while start < len(text):
            # Step 1: Prefer a paragraph, sentence, or word boundary.
            hard_end = min(start + self._chunk_size, len(text))
            end = self._find_natural_boundary(text, start, hard_end)

            # Step 2: Build a clean chunk with stable source metadata.
            chunk = self._build_chunk(
                text[start:end],
                source_start=start,
                chunk_index=len(chunks),
                document_id=document_id,
                user_id=user_id,
                document_name=document_name,
            )
            if chunk is not None:
                chunks.append(chunk)

            # Step 3: Move forward while retaining the configured overlap.
            if end >= len(text):
                break
            start = max(start + 1, end - self._chunk_overlap)

        return chunks

    @staticmethod
    def _build_chunk(
        raw_text: str,
        *,
        source_start: int,
        chunk_index: int,
        document_id: str,
        user_id: str,
        document_name: str,
    ) -> DocumentChunk | None:
        clean_text = raw_text.strip()
        if not clean_text:
            return None

        leading_whitespace = len(raw_text) - len(raw_text.lstrip())
        char_start = source_start + leading_whitespace
        chunk_id = str(uuid5(NAMESPACE_URL, f"{document_id}:{chunk_index}"))

        return DocumentChunk(
            chunk_id=chunk_id,
            document_id=document_id,
            user_id=user_id,
            document_name=document_name,
            chunk_index=chunk_index,
            text=clean_text,
            char_start=char_start,
            char_end=char_start + len(clean_text),
        )

    def _find_natural_boundary(self, text: str, start: int, hard_end: int) -> int:
        if hard_end == len(text):
            return hard_end

        # Search in the second half of the chunk for natural boundary
        # Preference is:
        # 1. paragraph boundary
        # 2. sentence boundary
        # 3. word boundary
        # 4. otherwise hard cut
        earliest_boundary = start + self._chunk_size // 2
        for separator in ("\n\n", ". ", " "):
            position = text.rfind(separator, earliest_boundary, hard_end)
            if position != -1:
                return position + len(separator)

        return hard_end
