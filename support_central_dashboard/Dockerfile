ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js
RUN apk add --no-cache nodejs npm bash jq

WORKDIR /app

# Copy package files and install
COPY package.json ./
RUN npm install --production

# Copy application
COPY server.js ./
COPY jssip-entry.js ./
COPY public/ ./public/

# Copy run script
COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]
