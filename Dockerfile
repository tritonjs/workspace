FROM mhart/alpine-node:latest

# Apline specific.
RUN apk add --update --no-cache make gcc g++ python bash git

RUN npm install -g pm2
WORKDIR /workspace

VOLUME /backend/workspace

# Add our files & set working dir
ADD . /workspace

# npm install
RUN npm install
RUN chmod +x ./serviceinit.sh

# expose port 80
EXPOSE 80

CMD ["./serviceinit.sh"]
