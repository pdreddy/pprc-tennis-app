FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY sql ./sql
COPY tests ./tests
RUN pip install --no-cache-dir ".[dev]"
RUN useradd --system --uid 1001 pprc
USER pprc
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8000/health', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
