FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY ui ./ui
COPY vite.config.mjs jsconfig.json components.json ./
RUN npm run build

FROM node:22.23.4-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm ci --omit=dev && npm cache clean --force
RUN apt-get update && apt-get install -y --no-install-recommends git && npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/seed-proof.mjs scripts/smoke-deployment.mjs ./scripts/
COPY --from=build --chown=node:node /app/dist/ui ./dist/ui
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production SCREENS_HOME=/data SCREENS_HOST=0.0.0.0 PORT=4800
USER node
EXPOSE 4800
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/cli.mjs", "serve"]
