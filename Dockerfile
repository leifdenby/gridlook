FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/30-generate-runtime-config.sh /docker-entrypoint.d/30-generate-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/30-generate-runtime-config.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
