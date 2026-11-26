# The Python API, the web app and the customer sites in one image (build from the repo root:
#   docker build -f apps/api-py/Dockerfile -t simplecatch .
# ). One port serves everything (app/server.py); the database is migrated on start.

# 1. The web app (needs the shared package, which stays TypeScript)
FROM node:22-slim AS web
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile --filter @simplecatch/web...
RUN pnpm --filter @simplecatch/shared build && pnpm --filter @simplecatch/web build

# 2. The API
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_COMPILE_BYTECODE=1
RUN pip install --no-cache-dir uv==0.9.*
WORKDIR /srv/api
COPY apps/api-py/pyproject.toml apps/api-py/uv.lock ./
RUN uv sync --frozen --no-dev
COPY apps/api-py/app app
COPY apps/api-py/alembic alembic
COPY apps/api-py/alembic.ini ./
COPY apps/api-py/assets assets
COPY apps/api-py/scripts scripts
COPY --from=web /repo/apps/web/dist /srv/web
ENV WEB_DIST_DIR=/srv/web NODE_ENV=production PATH="/srv/api/.venv/bin:$PATH"
EXPOSE 10000
# The API, plus the messaging worker when MESSAGE_BUS=rabbitmq (D-202; scripts/run_production.py).
CMD ["sh", "-c", "python scripts/prepare_db.py && exec python scripts/run_production.py"]
