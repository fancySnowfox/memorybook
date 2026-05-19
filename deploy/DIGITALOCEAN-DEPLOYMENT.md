# DigitalOcean SSL/HTTPS Deployment Guide

## Overview

This guide walks through deploying Memorybook Creator AI on DigitalOcean with:
- ✅ **SSL/HTTPS** via Let's Encrypt (free certificates)
- ✅ **Nginx reverse proxy** (port forwarding from 443 → 3000)
- ✅ **Auto-restart** via systemd service
- ✅ **Auto-renewal** of SSL certificates
- ✅ **Production-hardened** Node.js app

## Prerequisites

1. **DigitalOcean Account** with a new Ubuntu 22.04+ droplet (minimum 2GB RAM, 2 CPU)
2. **Domain Name** pointing to your droplet's IP
3. **SSH access** to your droplet
4. **Gradient API Key** from DigitalOcean Gradient

## Quick Start (Automated)

The fastest way is to run the setup script:

```bash
# SSH into your droplet
ssh root@your-droplet-ip

# Download the repository
git clone https://github.com/yourusername/memorybook.git
cd memorybook

# Run the setup script
chmod +x deploy/digitalocean-setup.sh
bash deploy/digitalocean-setup.sh your-domain.com
```

The script will:
1. Update system packages
2. Install Node.js 22, LibreOffice, FFmpeg, Nginx, Certbot
3. Create app user and directories
4. Clone/pull the repository
5. Install npm dependencies
6. Configure Nginx reverse proxy
7. Obtain SSL certificates (Let's Encrypt)
8. Set up systemd service for auto-start/restart
9. Start the application

## Manual Deployment (Step by Step)

If you prefer manual setup:

### 1. Initial Setup

```bash
ssh root@your-droplet-ip
apt update && apt upgrade -y
```

### 2. Install Dependencies

```bash
# Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# System tools
apt install -y git nginx certbot python3-certbot-nginx libreoffice ffmpeg

# Create app user
useradd -m -s /bin/bash memorybook
```

### 3. Clone Repository

```bash
sudo -u memorybook git clone https://github.com/yourusername/memorybook.git /home/memorybook/memorybook
cd /home/memorybook/memorybook
```

### 4. Install npm Dependencies

```bash
sudo -u memorybook npm install
```

### 5. Configure Environment

```bash
sudo tee /home/memorybook/memorybook/.env.local > /dev/null << 'EOF'
NODE_ENV=production
PORT=3000
GRADIENT_API_KEY=your_actual_key_here
GRADIENT_BASE_URL=https://inference.do-ai.run/v1
SESSION_SECRET=your-random-secret-here
DEBUG_MODE=false
EOF

sudo chown memorybook:memorybook /home/memorybook/memorybook/.env.local
sudo chmod 600 /home/memorybook/memorybook/.env.local
```

### 6. Configure Nginx

```bash
# Copy and customize the nginx config
sudo cp /home/memorybook/memorybook/deploy/nginx-memorybook.conf /etc/nginx/sites-available/memorybook
sudo sed -i 's/your-domain.com/your-actual-domain.com/g' /etc/nginx/sites-available/memorybook

# Enable the site
sudo ln -s /etc/nginx/sites-available/memorybook /etc/nginx/sites-enabled/memorybook
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl restart nginx
```

### 7. Get SSL Certificate

```bash
sudo certbot certonly --nginx -d your-domain.com -d www.your-domain.com \
  --agree-tos -m admin@your-domain.com --non-interactive

# Verify auto-renewal
sudo certbot renew --dry-run
```

### 8. Set Up Systemd Service

```bash
# Install the service
sudo cp /home/memorybook/memorybook/deploy/memorybook.service /etc/systemd/system/memorybook.service

# Create log directory
sudo mkdir -p /var/log/memorybook
sudo chown memorybook:memorybook /var/log/memorybook

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable memorybook
sudo systemctl start memorybook
sudo systemctl status memorybook
```

## Verification

### Check if app is running

```bash
# Check systemd service status
sudo systemctl status memorybook

# Check logs
sudo tail -f /var/log/memorybook/app.log

# Test HTTPS endpoint
curl https://your-domain.com

# Test Nginx reverse proxy
curl -I https://your-domain.com
```

### Verify SSL Certificate

```bash
# Check certificate details
sudo certbot certificates

# Check certificate expiry
echo | openssl s_client -servername your-domain.com -connect your-domain.com:443 2>/dev/null | openssl x509 -noout -dates
```

## Configuration Files

### File Locations

| Component | Location | Purpose |
|-----------|----------|---------|
| App | `/home/memorybook/memorybook/` | Node.js application |
| Nginx config | `/etc/nginx/sites-available/memorybook` | Reverse proxy config |
| SSL certs | `/etc/letsencrypt/live/your-domain.com/` | Let's Encrypt certificates |
| Logs (app) | `/var/log/memorybook/app.log` | Application logs |
| Logs (nginx) | `/var/log/nginx/memorybook_*.log` | Nginx access/error logs |
| Systemd | `/etc/systemd/system/memorybook.service` | Service definition |

### Environment Variables (.env.local)

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | Enables production optimizations |
| `PORT` | `3000` | Internal port (behind nginx) |
| `GRADIENT_API_KEY` | `your_key` | **Required** from DigitalOcean Gradient |
| `GRADIENT_BASE_URL` | `https://inference.do-ai.run/v1` | Gradient API endpoint |
| `SESSION_SECRET` | random string | Use `openssl rand -base64 32` |
| `DEBUG_MODE` | `false` | Disable debug endpoint in production |

## Troubleshooting

### Application won't start

```bash
# Check logs
sudo journalctl -u memorybook -n 50

# Check if port 3000 is already in use
sudo lsof -i :3000

# Verify npm packages are installed
ls /home/memorybook/memorybook/node_modules
```

### SSL certificate not working

```bash
# Check Nginx syntax
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Check certificate files exist
ls -la /etc/letsencrypt/live/your-domain.com/
```

### Nginx reverse proxy issues

```bash
# Check Nginx error log
sudo tail -f /var/log/nginx/memorybook_error.log

# Verify app is running on port 3000
curl http://localhost:3000

# Check Nginx config syntax
sudo nginx -T | grep memorybook
```

### Certificate renewal fails

```bash
# Check certbot logs
sudo tail -f /var/log/letsencrypt/letsencrypt.log

# Manual renewal
sudo certbot renew --force-renewal

# Check renewal timer
sudo systemctl list-timers | grep certbot
```

## Updating the App

To deploy new code:

```bash
# SSH into droplet
ssh root@your-droplet-ip
cd /home/memorybook/memorybook

# Pull latest code
sudo -u memorybook git fetch origin
sudo -u memorybook git pull origin main

# Install any new dependencies
sudo -u memorybook npm install

# Restart service
sudo systemctl restart memorybook

# Check logs
sudo tail -f /var/log/memorybook/app.log
```

## Security Best Practices

1. **Firewall**: Configure UFW to allow only 22 (SSH), 80 (HTTP), 443 (HTTPS)
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

2. **SSH Hardening**: Disable root login, use SSH keys only
   ```bash
   sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
   sudo sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sudo systemctl restart sshd
   ```

3. **Keep system updated**: Run weekly updates
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

4. **Monitor logs**: Set up log rotation and monitoring
   ```bash
   sudo tail -f /var/log/memorybook/app.log
   sudo tail -f /var/log/nginx/memorybook_error.log
   ```

5. **Secrets management**: Use `.env.local` (never commit to Git)
   ```bash
   echo ".env.local" >> .gitignore
   ```

## Performance Tuning

### Nginx Caching
Already configured in nginx config for static assets (7-day cache).

### Node.js Memory
Adjust if needed in `/etc/systemd/system/memorybook.service`:
```
Environment="NODE_OPTIONS=--max-old-space-size=1024"
```

### Database/Session Store
Currently uses JSON file store. For high traffic, consider:
- Redis for session store
- PostgreSQL for persistent data

## Monitoring

### Useful Commands

```bash
# Service status
systemctl status memorybook

# Real-time logs
tail -f /var/log/memorybook/app.log

# CPU/memory usage
top

# Disk space
df -h

# SSL certificate expiry
echo | openssl s_client -servername your-domain.com -connect your-domain.com:443 2>/dev/null | openssl x509 -noout -dates

# Nginx status
curl http://localhost/nginx_status
```

### Uptime Monitoring
Set up external monitoring (e.g., StatusCake, UptimeRobot) to ping:
```
https://your-domain.com/api/health
```

## Support

For issues or questions:
1. Check `/var/log/memorybook/app.log` for app errors
2. Check `/var/log/nginx/memorybook_error.log` for Nginx issues
3. Check `/var/log/letsencrypt/letsencrypt.log` for SSL issues
4. Review the [main README](../README-EXPRESS.md)

---

**Deployed with ❄️ Snowfox Consulting**
