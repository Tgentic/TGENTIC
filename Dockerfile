FROM node:24-alpine AS webbuild
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci 2>/dev/null || npm install
COPY web/ ./
# The dapp shares the SDK's pure detector — the import escapes web/ (../../../sdk/src/),
# so the file must exist in the build context at that path.
COPY sdk/src/flags.js /app/sdk/src/flags.js
ARG VITE_PRIVY_APP_ID
ARG VITE_TGENTIC_ADDRESS
ARG VITE_DEPLOY_BLOCK
ARG VITE_CHAIN_ID
ARG VITE_CHAIN_NAME
ARG VITE_RPC_URL
ARG VITE_EXPLORER
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY gate/package.json gate/package-lock.json* ./gate/
RUN cd gate && npm install --omit=dev
COPY gate/src ./gate/src
# The gate's event detector consumes the canonical flags module from the SDK.
COPY sdk/src/flags.js ./sdk/src/flags.js
COPY --from=webbuild /app/web/dist ./web/dist
ENV WEB_DIST=/app/web/dist
EXPOSE 8788
CMD ["node", "gate/src/main.js"]
