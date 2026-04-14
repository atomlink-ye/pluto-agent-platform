FROM node:22-alpine

RUN apk add --no-cache bash curl git libc6-compat

WORKDIR /workspace

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile --config.confirmModulesPurge=false
