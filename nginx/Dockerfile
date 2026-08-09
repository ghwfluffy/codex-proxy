FROM node:20-bookworm-slim AS build
ARG VITE_APP_BASE_PATH=
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_APP_BASE_PATH=${VITE_APP_BASE_PATH}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
WORKDIR /workspace/web
COPY web/package*.json ./
COPY vendor/federated-banner/ /workspace/vendor/federated-banner/
RUN npm install
COPY web/ ./
RUN npm run build

FROM nginx:stable-alpine
ENV APP_BASE_PATH=
ENV API_PROXY_TARGET=http://api:8000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/web/dist /usr/share/nginx/html
