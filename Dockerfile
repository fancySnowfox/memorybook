FROM node:22-alpine

# Install system dependencies
RUN apk add --no-cache libreoffice ffmpeg tini

# Create app user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies as nodejs user
RUN chown -R nodejs:nodejs /app
USER nodejs
RUN npm ci --only=production

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create necessary directories
RUN mkdir -p files/sessions /var/log/memorybook && chown -R nodejs:nodejs files /var/log/memorybook

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use tini to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# Start the app
CMD ["node", "server/index.js"]
