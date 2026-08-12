FROM node:22-alpine AS build

WORKDIR /app

# Install deps first so the layer caches on source-only changes
COPY package*.json ./
RUN npm ci

# Copy the rest of the source (node_modules is excluded via .dockerignore)
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
