FROM mhart/alpine-node:latest

# DevOps Aspects
EXPOSE 80
CMD ["./serviceinit.sh"]

# Apline specific.
RUN apk add --update --no-cache make gcc g++ python bash git

# Attempt to build images faster.
RUN npm install -g pm2
WORKDIR /workspace

# Cache npm packages if possible.
COPY package.json /workspace
RUN npm install

# Copy our latest files.
COPY . /workspace

# npm install
RUN chmod +x ./serviceinit.sh
