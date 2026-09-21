FROM node:22-alpine AS build

WORKDIR /app

# Install deps first so the layer caches on source-only changes
COPY package*.json ./
RUN npm ci

# Copy the rest of the source (node_modules is excluded via .dockerignore)
COPY . .

# vite.config.js fails a production build when either of these is unset, so a
# frontend that talks to nothing can never ship. The build runs inside this
# container, so the values have to be handed in as build args -- setting them
# on the CI step does not reach in here, which is exactly how the docker-build
# job kept failing while the plain `npm run build` job passed.
#
# No default on purpose: a default would silently bake a placeholder into a
# real deployment image, which is the failure the guard exists to prevent.
# CI passes throwaway values because it only proves the image builds; a real
# image build must pass the real URLs, and VITE_WS_URL must use wss://.
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
