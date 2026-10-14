# syntax=docker/dockerfile:1

# Build stage: install everything, build the client and bundle the server.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY e2e/package.json e2e/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Runtime stage: production dependencies of the server only.
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev --ignore-scripts --workspace server --include-workspace-root=false \
  && npm cache clean --force
# `shared` and `server` directories mark the repository root for the server at runtime.
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
RUN mkdir -p shared /data/uploads && chown -R node:node /data
ENV PORT=5000 UPLOAD_DIR=/data/uploads
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
