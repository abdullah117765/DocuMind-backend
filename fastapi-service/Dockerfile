FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-writer \
      libreoffice-impress \
      tesseract-ocr \
      tesseract-ocr-eng && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV HF_HOME=/models/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/models/sentence-transformers \
    TRANSFORMERS_CACHE=/models/huggingface \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN addgroup --system appgroup && \
    adduser --system --ingroup appgroup appuser && \
    mkdir -p /models/huggingface /models/sentence-transformers && \
    chown -R appuser:appgroup /app /models

USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
