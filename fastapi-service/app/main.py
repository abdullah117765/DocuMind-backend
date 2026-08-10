from fastapi import FastAPI, status

from app.routers.rag_router import router as rag_router


app = FastAPI(
    title="AI Document Intelligence Service",
    description="Internal document-processing service.",
    version="1.0.0",
)

app.include_router(rag_router)


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
