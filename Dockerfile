FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY public ./public

ENV HOST=0.0.0.0
EXPOSE 8000
CMD ["node", "server/server.js"]
