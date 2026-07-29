FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build

WORKDIR /app/web
COPY package.json package-lock.json ./
RUN npm ci
RUN npm audit --audit-level=high
COPY index.html admin.html player.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM nginx:1.30.4-trixie@sha256:5cf90903deda2c5981b8ad05e7617ac010e389f0dde0ac83487c02c509281de6
RUN chown -R 101:101 /var/cache/nginx /var/run
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101:101
