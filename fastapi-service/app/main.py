import logging
import threading

from fastapi import FastAPI, status

from app.routers.rag_router import router as rag_router
from app.services.embedding_service import EmbeddingService


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

app = FastAPI(
    title="AI Document Intelligence Service",
    description="Internal document-processing service.",
    version="1.0.0",
)

app.include_router(rag_router)


def _warm_embedding_model() -> None:
    try:
        logging.getLogger(__name__).info("RAG embedding warmup started.")
        EmbeddingService().embed_query("warm up document search")
        logging.getLogger(__name__).info("RAG embedding warmup completed.")
    except Exception:
        logging.getLogger(__name__).exception("RAG embedding warmup failed.")


@app.on_event("startup")
async def warm_rag_models() -> None:
    threading.Thread(
        target=_warm_embedding_model,
        name="rag-embedding-warmup",
        daemon=True,
    ).start()


@app.get(
    "/health",
    tags=["Health"],
    status_code=status.HTTP_200_OK,
    summary="Check service health",
)
async def health_check() -> dict[str, object]:
    return {
        "status": "success",
        "code": status.HTTP_200_OK,
        "data": {
            "service": "fastapi-service",
            "health": "ok",
        },
    }
