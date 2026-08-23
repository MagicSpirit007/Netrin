FROM node:22.19.0-alpine

ENV NODE_ENV=production
WORKDIR /app/services/netrin-ai-orchestrator

COPY services/netrin-ai-orchestrator/package.json services/netrin-ai-orchestrator/package-lock.json ./
RUN npm ci --omit=dev

COPY services/netrin-ai-orchestrator/src ./src
COPY supabase/functions/netrin-route-plan/core.ts /app/supabase/functions/netrin-route-plan/core.ts

EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server.ts"]
