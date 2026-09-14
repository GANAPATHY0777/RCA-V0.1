FROM node:20-alpine
WORKDIR /app
COPY shared/ ./shared/
RUN ln -s /app/shared /shared
COPY analysis-engine/package.json ./package.json
RUN npm install --production
COPY analysis-engine/src/ ./src/
ENV OTEL_SERVICE_NAME=analysis-engine
CMD ["node", "src/index.js"]
