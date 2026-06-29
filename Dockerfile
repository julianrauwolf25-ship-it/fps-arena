FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY shared ./shared
EXPOSE 3000
CMD ["node", "server/index.js"]
