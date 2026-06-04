FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY .npmrc .npmrc
RUN npm install --legacy-peer-deps && npm install --no-save --legacy-peer-deps @rollup/rollup-linux-x64-gnu

FROM deps AS build
WORKDIR /app
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build:shared && npm --workspace @ledger/web run build

FROM nginx:1.29-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
