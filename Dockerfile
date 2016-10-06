FROM mhart/alpine-node:latest

# DevOps Aspects
EXPOSE 80
CMD ["./serviceinit.sh"]
WORKDIR /workspace

# Apline specific.
RUN apk add --update --no-cache make gcc g++ python bash git

# Attempt to build images faster.
RUN npm install -g pm2

# Cache npm packages if possible.
COPY package.json /workspace
RUN npm install

# Copy our latest files.
COPY . /workspace

#  make sure ./serviceinit.sh is marked exec
RUN chmod +x ./serviceinit.sh
