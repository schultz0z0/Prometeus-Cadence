FROM mcr.microsoft.com/playwright/python:v1.58.0-noble@sha256:678457c4c323b981d8b4befc57b95366bb1bb6aa30057b1269f6b171e8d9975a AS base

FROM base AS scrapling-build
WORKDIR /build/scrapling
COPY build-requirements.lock /build/
RUN python -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r /build/build-requirements.lock
COPY --from=scrapling /pyproject.toml /README.md /LICENSE ./
COPY --from=scrapling /scrapling ./scrapling
RUN --network=none python -m pip wheel --no-deps --no-build-isolation --no-index --wheel-dir /wheels .

FROM base
WORKDIR /srv/site-browser
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp
COPY requirements.lock ./
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock
RUN --network=none --mount=from=scrapling-build,source=/wheels,target=/wheels \
    python -m pip install --no-cache-dir --no-deps --no-index /wheels/scrapling-*.whl && python -m pip check
COPY renderer.py site_gateway.py service.py ./
USER pwuser
ENTRYPOINT ["python", "service.py"]
CMD ["browser"]
