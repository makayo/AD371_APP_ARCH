# Pulse Data API: Flask + PostgreSQL (psycopg) + MongoDB (pymongo)
FROM python:3.12.8-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv
# Dependencies first: this layer stays cached while only the source changes
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app/ ./app/
COPY tests/ ./tests/

# Unprivileged user
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin appuser
USER 10001

WORKDIR /srv/app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status == 200 else 1)"]
# 2 worker processes; each opens its own DB pool after the fork
CMD ["gunicorn", "--workers", "2", "--bind", "0.0.0.0:8000", "--access-logfile", "-", "app:app"]
