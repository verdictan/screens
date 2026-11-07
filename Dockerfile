FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts
RUN node scripts/prepare-release.mjs

FROM node:22.23.4-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=0
COPY --from=build /app/package.json /app/npm-shrinkwrap.json ./
COPY --from=build /app/scripts ./scripts
RUN npm ci --omit=dev && npm cache clean --force && chmod -R a+rX node_modules/playwright-core/.local-browsers && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/ui ./ui
COPY --from=build --chown=node:node /app/skills ./skills
COPY --from=build --chown=node:node /app/examples ./examples
COPY --from=build --chown=node:node /app/docs ./docs
COPY --from=build --chown=node:node /app/README.md ./README.md
COPY --from=build --chown=node:node /app/Dockerfile /app/.dockerignore /app/compose.yaml /app/vite.config.mjs /app/jsconfig.json /app/components.json ./
COPY --from=build --chown=node:node /app/dist/ui ./dist/ui
RUN chmod +x /app/src/cli.mjs && ln -s /app/src/cli.mjs /usr/local/bin/screens && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production SCREENS_HOME=/data SCREENS_HOST=0.0.0.0 PORT=4800
ENV XDG_CACHE_HOME=/tmp/screens-cache XDG_CONFIG_HOME=/tmp/screens-config
USER node
EXPOSE 4800
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["screens", "serve"]
