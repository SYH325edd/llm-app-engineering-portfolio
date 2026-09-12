FROM m.daocloud.io/docker.io/library/node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 3100 8080
CMD ["node", "server/index.js"]
