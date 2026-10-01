FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt requirements-dev.txt ./
ARG WITH_TESTS=0
RUN pip install --no-cache-dir -r requirements.txt && \
    if [ "$WITH_TESTS" = "1" ]; then pip install --no-cache-dir -r requirements-dev.txt; fi
COPY app ./app
COPY tests ./tests
RUN useradd -r -u 10001 compat
USER compat
EXPOSE 2358
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:2358/health',timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "2358", "--no-access-log", "--no-server-header"]
