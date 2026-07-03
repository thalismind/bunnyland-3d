FROM node:22-bookworm-slim AS build

WORKDIR /app/web
COPY --from=bunnyland-ui-web / /bunnyland-ui-web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html admin.html player.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-bookworm
COPY --from=build /app/web/dist /usr/share/nginx/html
