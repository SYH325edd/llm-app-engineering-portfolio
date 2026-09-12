FROM m.daocloud.io/docker.io/library/node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY claim-task.js ./
COPY cloudbase-client.js ./
COPY document-snapshot.js ./
COPY task-watcher.js ./
COPY hard-problem-training-runtime.js ./
COPY shared ./shared
COPY runtime ./runtime

EXPOSE 8080
CMD ["npm", "start"]
