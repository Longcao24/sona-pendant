# Nuna food-intake inference server — Hugging Face Space (Docker SDK).
# HF Spaces serve on port 7860.
FROM python:3.11-slim

WORKDIR /app

# CPU-only torch (no CUDA wheels -> image stays small enough for free tier)
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install --no-cache-dir fastapi "uvicorn[standard]" transformers numpy scipy python-multipart

COPY app.py audio_utils.py labels.json ./
COPY model ./model

ENV NUNA_MODEL_DIR=/app/model \
    HF_HOME=/tmp/hf \
    PORT=7860

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
