from minio import Minio

from app.config.settings import get_settings


class MinioDocumentClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_USE_SSL,
        )

    def read_object(self, bucket: str, key: str) -> bytes:
        response = self.client.get_object(bucket, key)

        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
