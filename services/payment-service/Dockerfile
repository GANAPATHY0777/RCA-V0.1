FROM node:20-alpine
WORKDIR /app
COPY shared/ ./shared/
RUN ln -s /app/shared /shared
COPY payment-service/package.json ./package.json
RUN npm install --production
COPY payment-service/src/ ./src/
ENV OTEL_SERVICE_NAME=payment-service
CMD ["node", "src/index.js"]
