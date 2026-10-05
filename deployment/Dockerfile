FROM node:24.13.1-bookworm-slim AS postgrest
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://github.com/PostgREST/postgrest/releases/download/v16.4/postgrest-v16.4-linux-static-x86-64.tar.xz -o /tmp/postgrest.tar.xz \
    && echo 'b47ecc82fce1dcebbbc4183d839e52f07f7630c9d7ad0f54db753d1939299354  /tmp/postgrest.tar.xz' | sha256sum -c - \
    && tar -xJf /tmp/postgrest.tar.xz -C /usr/local/bin

FROM node:24.13.1-bookworm-slim
WORKDIR /cloudpeak
COPY database-service/package*.json database-service/
COPY storage-service/package*.json storage-service/
RUN npm ci --omit=dev --prefix database-service && npm ci --omit=dev --prefix storage-service
COPY --from=postgrest /usr/local/bin/postgrest /usr/local/bin/postgrest
COPY database-service database-service
COPY storage-service storage-service
COPY supabase supabase
COPY deployment deployment
COPY public public
ENV NODE_ENV=production POSTGREST_BIN=/usr/local/bin/postgrest PORT=8080
USER node
EXPOSE 8080
CMD ["node", "deployment/start.mjs"]
