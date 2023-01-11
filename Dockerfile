FROM node:19-slim@sha256:67a73455d3befb6ff5ab8cafd3481df3ec4c643eac9d15230e2d6f58c443e47c 

WORKDIR /usr/src/app

ARG GIT_SHA

COPY . .

ENV NODE_ENV=production
ENV PORT 4242
ENV GIT_SHA=${GIT_SHA}

EXPOSE ${PORT}

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

CMD ["npm", "start"]
