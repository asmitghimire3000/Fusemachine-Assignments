from __future__ import annotations

import asyncio

from sentence_transformers import SentenceTransformer


class EmbeddingService:
    """Create normalized local embeddings without blocking the event loop."""

    def __init__(
        self,
        model_name: str,
        *,
        device: str,
        batch_size: int,
        expected_dimension: int,
    ) -> None:
        self._model_name = model_name
        self._device = device
        self._batch_size = batch_size
        self._expected_dimension = expected_dimension
        self._model: SentenceTransformer | None = None
        self._encode_lock = asyncio.Lock()

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Encode a batch on a worker thread and return plain Python vectors."""

        if not texts:
            return []

        # The fallback model is shared, so local encoding runs one batch at a time.
        async with self._encode_lock:
            return await asyncio.to_thread(self._encode, texts)

    async def embed_query(self, text: str) -> list[float]:
        vectors = await self.embed_documents([text])
        return vectors[0]

    def _encode(self, texts: list[str]) -> list[list[float]]:
        # Step 1: Lazily load the model on the first embedding request.
        model = self._get_model()

        # Step 2: Encode a normalized batch for cosine similarity search.
        vectors = model.encode(
            texts,
            batch_size=self._batch_size,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )

        # Step 3: Catch model/configuration mismatches before writing vectors.
        self._validate_dimension(vectors.shape[1])
        return vectors.tolist()

    def _get_model(self) -> SentenceTransformer:
        if self._model is None:
            self._model = SentenceTransformer(self._model_name, device=self._device)
        return self._model

    def _validate_dimension(self, actual_dimension: int) -> None:
        if actual_dimension != self._expected_dimension:
            raise ValueError(
                "Embedding dimension mismatch: "
                f"expected {self._expected_dimension}, got {actual_dimension}"
            )
