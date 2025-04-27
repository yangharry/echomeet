FROM node:19.1.0-alpine

WORKDIR /app

COPY server/package.json ./

RUN npm i

RUN npm i pm2 -g

COPY server/ ./

EXPOSE 3000

CMD ["pm2-runtime", "start", "server.js"]