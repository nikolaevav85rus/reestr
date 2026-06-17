# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Frontend image: build the Vite/React SPA, then serve it with nginx.
# nginx also reverse-proxies /api to the backend (replaces the dev Vite proxy).
# ---------------------------------------------------------------------------

# --- Stage 1: build the static bundle -------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps from the lockfile first (cached unless package*.json changes).
# npm ci installs devDependencies too — tsc/vite live there and are needed for the build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `npm run build` == `tsc -b && vite build`; outputs to /app/dist.
RUN npm run build

# --- Stage 2: serve via nginx ---------------------------------------------
FROM nginx:1.27-alpine AS runtime

# SPA static assets.
COPY --from=build /app/dist /usr/share/nginx/html
# Reverse-proxy + SPA-fallback config (LF-only, see .gitattributes).
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# nginx default CMD already runs in the foreground; no override needed.
