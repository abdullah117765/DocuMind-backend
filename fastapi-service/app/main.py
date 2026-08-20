import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status

from app.config.settings import get_settings
from app.routers.rag_router import router as rag_router
from app.services.embedding_service import EmbeddingService
from app.services.ingestion_service import IngestionService
from app.services.llm_service import LlmService
from app.services.qdrant_service import QdrantService
from app.services.reranker_service import RerankerService
from app.services.search_service import SearchService


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


def _initialize_rag_services(app: FastAPI) -> None:
    settings = get_settings()
    app.state.rag_ready = False
    app.state.rag_startup_error = None
    app.state.rag_warming_up = True

    logger.info(
        "RAG startup initializing embedding_model=%s reranker_enabled=%s candidate_k=%s max_context_tokens=%s",
        settings.EMBEDDING_MODEL,
        settings.RAG_RERANKER_ENABLED,
        settings.RAG_INITIAL_CANDIDATE_K,
        settings.RAG_MAX_CONTEXT_TOKENS,
    )

    embedding_service = EmbeddingService()
    qdrant_service = QdrantService()
    reranker_service = RerankerService()

    app.state.embedding_service = embedding_service
    app.state.qdrant_service = qdrant_service
    app.state.reranker_service = reranker_service
    app.state.search_service = SearchService(
        embedding_service=embedding_service,
        qdrant_service=qdrant_service,
        reranker_service=reranker_service,
    )
    app.state.ingestion_service = IngestionService(
        embedding_service=embedding_service,
        qdrant_service=qdrant_service,
    )
    app.state.llm_service = LlmService()


def _warm_rag_services(app: FastAPI) -> None:
    settings = get_settings()
    startup_started = time.perf_counter()

    try:
        stage_started = time.perf_counter()
        logger.info("RAG embedding warmup started model=%s", settings.EMBEDDING_MODEL)
        embedding_service: EmbeddingService = app.state.embedding_service
        embedding_service.embed_query("warm up document search")
        logger.info(
            "RAG embedding model loaded model=%s elapsed_ms=%s",
            settings.EMBEDDING_MODEL,
            int((time.perf_counter() - stage_started) * 1000),
        )

        stage_started = time.perf_counter()
        reranker_service: RerankerService = app.state.reranker_service
        reranker_service.warmup()
        logger.info(
            "RAG reranker startup check completed elapsed_ms=%s",
            int((time.perf_counter() - stage_started) * 1000),
        )

        app.state.rag_ready = True
        app.state.rag_warming_up = False
        logger.info(
            "RAG service ready elapsed_ms=%s",
            int((time.perf_counter() - startup_started) * 1000),
        )
    except Exception as exc:
        app.state.rag_ready = False
        app.state.rag_warming_up = False
        app.state.rag_startup_error = str(exc)[:1000]
        logger.exception(
            "RAG startup warmup failed elapsed_ms=%s",
            int((time.perf_counter() - startup_started) * 1000),
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _initialize_rag_services(app)
    threading.Thread(
        target=_warm_rag_services,
        args=(app,),
        name="rag-model-warmup",
        daemon=True,
    ).start()
    yield


app = FastAPI(
    title="AI Document Intelligence Service",
    description="Internal document-processing service.",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(rag_router)


@app.get(
    "/health",
    tags=["Health"],
    status_code=status.HTTP_200_OK,
    summary="Check service health",
)
def health_check() -> dict[str, object]:
    return {
        "status": "success",
        "code": status.HTTP_200_OK,
        "data": {
            "service": "fastapi-service",
            "health": "ok",
        },
    }


@app.get(
    "/ready",
    tags=["Health"],
    summary="Check whether RAG models are ready",
)
def readiness_check(response: Response) -> dict[str, object]:
    ready = bool(getattr(app.state, "rag_ready", False))
    warming_up = bool(getattr(app.state, "rag_warming_up", False))

    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "success" if ready else "error",
        "code": status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        "data": {
            "service": "fastapi-service",
            "ready": ready,
            "warmingUp": warming_up,
        },
    }
