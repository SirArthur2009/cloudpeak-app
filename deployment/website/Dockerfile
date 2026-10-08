FROM node:24.13.1-bookworm-slim
WORKDIR /cloudpeak
COPY deployment deployment
COPY public public
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "deployment/website/start.mjs"]
