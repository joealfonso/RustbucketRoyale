# The game server and its page in one image, for any host that runs containers. It listens on PORT (8080) for both
# the page and the game; put HTTPS in front with the host's own proxy. Build with the real models in place: they are
# Git LFS files, so run `git lfs pull` first (the check below stops a build of pointer files).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci
COPY . .
RUN head -c 4 assets/models/mechs/ironclad/Mech_Ironclad.glb | grep -q glTF || (echo "The models are Git LFS pointers: run git lfs pull before building." && exit 1)
RUN npm run build
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["npm", "start"]
