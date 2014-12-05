FROM yodlr/nodejs
MAINTAINER Ross Kukulinski "ross@getyodlr.com"

WORKDIR /src

# Install app dependencies
ADD package.json /src/package.json
RUN npm install

ADD . /src/

CMD ["/usr/bin/nodejs", "index.js"]
