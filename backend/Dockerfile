# Build the API image:   docker build -t pprc-api backend
# Test image (adds pytest): docker build --target test -t pprc-api-tests backend
FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
RUN pip install .
COPY clerk_auth.py docker-entrypoint.sh ./
COPY sql ./sql
COPY scripts ./scripts
RUN chmod +x docker-entrypoint.sh && useradd --system --uid 1001 pprc

FROM base AS test
COPY tests ./tests
RUN pip install ".[dev]"
USER pprc

FROM base AS runtime
USER pprc
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 CMD python -c "import os,urllib.request as u; u.urlopen('http://localhost:%s/health' % os.environ.get('PORT','8000'), timeout=2)"
ENTRYPOINT ["./docker-entrypoint.sh"]
