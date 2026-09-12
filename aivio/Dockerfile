FROM node:22-alpine

WORKDIR /app

COPY apps/api/package*.json ./apps/api/
WORKDIR /app/apps/api
RUN npm install

WORKDIR /app
COPY config ./config
COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN npm run db:generate && npm run build

EXPOSE 8788
CMD ["npm", "run", "start"]
