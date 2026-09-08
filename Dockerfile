# Built from the checked-out tree (not a git clone) so the VPS redeploy poller
# (/opt/nlma-redeploy) deploys exactly the commit it fast-forwarded to.
FROM node:20-slim
WORKDIR /opt/app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3123
CMD ["node", "/opt/app/build/http.js"]
