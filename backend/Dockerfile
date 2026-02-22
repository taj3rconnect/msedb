FROM node:22-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ .
COPY version.json ./version.json
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache tini wget
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup \
    && addgroup -g 988 -S docker && addgroup appuser docker
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
RUN mkdir -p /app/logs && chown appuser:appgroup /app/logs
USER appuser
EXPOSE 8010
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
