FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY public ./public
COPY config ./config

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3010 \
    DATA_DIR=/data

EXPOSE 3010

RUN mkdir -p /data && chown node:node /data

USER node

CMD ["node", "server.js"]
