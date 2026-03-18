ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js and dependencies (Debian/Ubuntu)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        nodejs \
        npm \
        bash \
        jq \
        curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY package.json ./
RUN if [ -f package.json ]; then npm install --production; fi

# Copy application
COPY server.js ./
COPY jssip-entry.js ./
COPY public/ ./public/

# Copy run script
COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]
