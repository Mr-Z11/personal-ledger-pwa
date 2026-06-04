FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY .npmrc .npmrc
RUN npm install --legacy-peer-deps && npm install --no-save --legacy-peer-deps @rollup/rollup-linux-x64-gnu

FROM deps AS build
WORKDIR /app
ENV DATABASE_URL=postgresql://ledger:ledger@postgres:5432/ledger?schema=public
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build:shared && npm --workspace @ledger/api run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client node_modules/@prisma/client
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
EXPOSE 4000
CMD ["sh", "-c", "npm --workspace @ledger/api run prisma:push && npm --workspace @ledger/api run start"]
