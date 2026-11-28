# Build context is the REPO ROOT (Railway: dockerfile path agents/auditor/Dockerfile).
# The audit code reuses the gate's heuristics + manifest modules, so those
# trees must be present at the same relative depth they expect (../../gate, ../../sdk).
FROM node:24-alpine
WORKDIR /app
COPY agents/auditor/package.json agents/auditor/package-lock.json* ./agents/auditor/
RUN cd agents/auditor && npm install --omit=dev
COPY agents/auditor/src ./agents/auditor/src
COPY gate/src/heuristics.js gate/src/manifest.js ./gate/src/
COPY sdk/src/flags.js ./sdk/src/
# gate/src files import viem — node resolves upward from the importing file,
# so a root-level viem install serves both the auditor's own tree and gate/src.
RUN npm init -y >/dev/null && npm install viem@^2.58.1 --omit=dev >/dev/null
EXPOSE 4022
CMD ["node", "agents/auditor/src/main.js"]
