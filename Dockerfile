FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./public
RUN mkdir -p /app/data
EXPOSE 3000
ENV DB_PATH=/app/data/crmparser.db
ENV TZ=Europe/Moscow
ENV CRM_TIMEZONE=Europe/Moscow
CMD ["node", "src/index.js"]
