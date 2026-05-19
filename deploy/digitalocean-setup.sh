#!/bin/bash
# DigitalOcean Deployment Setup Script
# Run this on a fresh DigitalOcean Ubuntu 22.04+ droplet to set up Memorybook Creator AI with SSL/HTTPS
#
# Usage: bash deploy/digitalocean-setup.sh <your-domain.com>
# Example: bash deploy/digitalocean-setup.sh memorybook.example.com

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <domain.com>"
  echo "Example: $0 memorybook.example.com"
  exit 1
fi

DOMAIN=$1
APP_HOME="/home/memorybook/memorybook"
REPO_URL="${REPO_URL:-https://github.com/yourusername/memorybook.git}"

echo "=== Memorybook Creator AI - DigitalOcean Setup ==="
echo "Domain: $DOMAIN"
echo "App directory: $APP_HOME"
echo ""

# 1. System updates
echo "[1/10] Updating system packages..."
sudo apt update
sudo apt upgrade -y

# 2. Install Node.js 22+
echo "[2/10] Installing Node.js 22+..."
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node --version

# 3. Install system dependencies
echo "[3/10] Installing system dependencies (LibreOffice, FFmpeg, Nginx, Certbot)..."
sudo apt install -y libreoffice ffmpeg nginx certbot python3-certbot-nginx git

# 4. Create app user and directory
echo "[4/10] Setting up app user and directories..."
sudo useradd -m -s /bin/bash memorybook 2>/dev/null || echo "User memorybook already exists"
sudo mkdir -p $APP_HOME
sudo chown memorybook:memorybook $APP_HOME

# 5. Clone or pull repository
echo "[5/10] Cloning repository..."
sudo sudo -u memorybook git clone $REPO_URL $APP_HOME 2>/dev/null || (cd $APP_HOME && sudo -u memorybook git pull origin main)

# 6. Install Node dependencies
echo "[6/10] Installing Node.js dependencies..."
cd $APP_HOME
sudo -u memorybook npm install

# 7. Create .env.local from template
echo "[7/10] Setting up environment variables..."
if [ ! -f "$APP_HOME/.env.local" ]; then
  sudo tee $APP_HOME/.env.local > /dev/null << EOF
# Production environment
NODE_ENV=production
PORT=3000

# Gradient API Configuration (Required)
GRADIENT_API_KEY=your_gradient_api_key
GRADIENT_BASE_URL=https://inference.do-ai.run/v1

# AI Model
AI_MODEL_ID=router:knowledge-base-document-intelligence-01
AI_TASK_ID=knowledge-base-customer-support

# Session secret (change this to a random string)
SESSION_SECRET=$(openssl rand -base64 32)

# Debug (disable in production or use strong password)
DEBUG_MODE=false
DEBUG_ADMIN_USER=admin
DEBUG_ADMIN_PASSWORD=$(openssl rand -base64 16)

# FAQ similarity threshold
FAQ_SIMILARITY_THRESHOLD=0.72
EOF
  sudo chown memorybook:memorybook $APP_HOME/.env.local
  sudo chmod 600 $APP_HOME/.env.local
  echo "   Created .env.local - UPDATE with your GRADIENT_API_KEY!"
else
  echo "   .env.local already exists"
fi

# 8. Set up Nginx
echo "[8/10] Configuring Nginx..."
sudo cp deploy/nginx-memorybook.conf /etc/nginx/sites-available/memorybook
sudo sed -i "s/your-domain.com/$DOMAIN/g" /etc/nginx/sites-available/memorybook
sudo ln -sf /etc/nginx/sites-available/memorybook /etc/nginx/sites-enabled/memorybook
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 9. Set up SSL with Let's Encrypt
echo "[9/10] Obtaining SSL certificate with Let's Encrypt..."
sudo certbot certonly --nginx -d $DOMAIN -d www.$DOMAIN --agree-tos -m admin@$DOMAIN --non-interactive
sudo certbot renew --dry-run

# 10. Set up systemd service
echo "[10/10] Installing systemd service..."
sudo cp deploy/memorybook.service /etc/systemd/system/memorybook.service
sudo mkdir -p /var/log/memorybook
sudo chown memorybook:memorybook /var/log/memorybook
sudo systemctl daemon-reload
sudo systemctl enable memorybook
sudo systemctl start memorybook
sudo systemctl status memorybook

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Update .env.local with your GRADIENT_API_KEY:"
echo "   sudo nano $APP_HOME/.env.local"
echo ""
echo "2. Verify your app is running:"
echo "   curl https://$DOMAIN"
echo ""
echo "3. Check logs:"
echo "   sudo tail -f /var/log/memorybook/app.log"
echo "   sudo tail -f /var/log/nginx/memorybook_access.log"
echo ""
echo "4. Auto-renew SSL certificates (already configured via certbot):"
echo "   sudo systemctl list-timers | grep certbot"
echo ""
echo "Your app is now running at: https://$DOMAIN"
