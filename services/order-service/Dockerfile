FROM node:20-alpine
WORKDIR /app
COPY shared/ ./shared/
RUN ln -s /app/shared /shared
COPY order-service/package.json ./package.json
RUN npm install --production
COPY order-service/src/ ./src/
ENV OTEL_SERVICE_NAME=order-service
CMD ["node", "src/index.js"]
