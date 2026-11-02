# The app is a single Node process: JSON API plus the built SPA. Node 26 runs `node:sqlite`
# without a flag, which is what the archive uses, so the image pins that major.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    VEX_DATA_DIR=/tmp/vex
WORKDIR /app
# Runtime has no third-party dependencies: the server only imports Node built-ins.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
# Editable counter-rule base: without it the counter engine loads zero rules and every
# prescription degrades silently, so it ships with the image.
COPY --from=build /app/data/counter-rules.json ./data/counter-rules.json
RUN mkdir -p /tmp/vex && chown -R node:node /tmp/vex /app
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
