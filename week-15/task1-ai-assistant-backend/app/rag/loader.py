from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

SUPPORTED_EXTENSIONS = {".md", ".pdf", ".txt"}


@dataclass(frozen=True, slots=True)
class LoadedDocument:
    name: str
    text: str


class DocumentLoader:
    async def load(self, path: Path) -> LoadedDocument:
        """Load disk and PDF work in a thread so FastAPI remains responsive."""

        return await asyncio.to_thread(self._load_sync, path)

    def _load_sync(self, path: Path) -> LoadedDocument:
        # Step 1: Validate the file and supported document type.
        if not path.is_file():
            raise FileNotFoundError(f"Document not found: {path}")

        extension = path.suffix.lower()
        if extension not in SUPPORTED_EXTENSIONS:
            supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
            raise ValueError(f"Unsupported document type. Expected one of: {supported}")

        # Step 2: Extract text using the correct reader.
        text = self._read_pdf(path) if extension == ".pdf" else self._read_text(path)

        # Step 3: Remove invalid null bytes and reject empty documents.
        normalized = text.replace("\x00", "").strip()
        if not normalized:
            raise ValueError(f"Document contains no readable text: {path.name}")

        return LoadedDocument(name=path.name, text=normalized)

    @staticmethod
    def _read_text(path: Path) -> str:
        return path.read_text(encoding="utf-8")

    @staticmethod
    def _read_pdf(path: Path) -> str:
        reader = PdfReader(path)
        if reader.is_encrypted and reader.decrypt("") == 0:
            raise ValueError("Password-protected PDFs are not supported")

        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
