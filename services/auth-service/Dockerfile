FROM node:20-alpine
WORKDIR /app
COPY shared/ ./shared/
RUN ln -s /app/shared /shared
COPY auth-service/package.json ./package.json
RUN npm install --production
COPY auth-service/src/ ./src/
ENV OTEL_SERVICE_NAME=auth-service
# Expose GC for memory leak reset
CMD ["node", "--expose-gc", "src/index.js"]
