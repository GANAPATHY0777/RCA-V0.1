FROM node:20-alpine
WORKDIR /app
COPY shared/ ./shared/
RUN ln -s /app/shared /shared
COPY frontend-gateway/package.json ./package.json
RUN npm install --production
COPY frontend-gateway/src/ ./src/
ENV OTEL_SERVICE_NAME=frontend-gateway
CMD ["node", "src/index.js"]
