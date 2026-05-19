# Production Deployment Checklist

Use this checklist to ensure your Memorybook Creator AI is production-ready before deploying to DigitalOcean.

## Pre-Deployment

### 1. Code & Git
- [ ] All code committed to Git
- [ ] Main branch is stable and tested
- [ ] No uncommitted changes on deployment machine
- [ ] `.env.local` is in `.gitignore` (never commit secrets)
- [ ] `.gitignore` includes: `node_modules/`, `*.log`, `uploads/`, `files/sessions/`

### 2. Secrets & Credentials
- [ ] GRADIENT_API_KEY configured and validated
- [ ] SESSION_SECRET is a random 32-character string (`openssl rand -base64 32`)
- [ ] DEBUG_ADMIN_PASSWORD is strong (if DEBUG_MODE is true)
- [ ] All secrets stored in `.env.local` (local) or managed secret store (DigitalOcean)
- [ ] No hardcoded secrets in code or config files

### 3. Application Testing
- [ ] App starts without errors locally: `npm run dev`
- [ ] Chat endpoint responds: `curl http://localhost:3000/api/chat`
- [ ] All file uploads work (PDF, DOCX, PPTX, XLSX)
- [ ] Video conversion works (MOV to MP4)
- [ ] FAQ semantic matching works
- [ ] No console errors or warnings in logs

### 4. Dependencies
- [ ] `npm install` completes successfully
- [ ] `package-lock.json` is committed (for reproducible builds)
- [ ] All dependencies are up-to-date or pinned to known versions
- [ ] No security vulnerabilities: `npm audit`

### 5. Environment Setup
- [ ] `.env.local` template created
- [ ] PORT defaults to 3000
- [ ] NODE_ENV can be set to 'production'
- [ ] All required variables documented
- [ ] Example `.env.production.template` exists

## Deployment Infrastructure

### 6. Domain & DNS
- [ ] Domain name registered
- [ ] DNS A record points to DigitalOcean droplet IP
- [ ] DNS propagation verified: `nslookup your-domain.com`
- [ ] Domain is accessible via IP temporarily

### 7. DigitalOcean Droplet
- [ ] Droplet created (Ubuntu 22.04 LTS, minimum 2GB RAM, 2 vCPU)
- [ ] SSH key configured (not password auth)
- [ ] Root password changed or disabled
- [ ] Firewall rules created (22 SSH, 80 HTTP, 443 HTTPS)
- [ ] Backups enabled (optional but recommended)

### 8. SSL Certificate
- [ ] Let's Encrypt certificate obtained for your domain
- [ ] Certificate renewal set up (certbot auto-renewal)
- [ ] Certificate validity checked: 90 days standard
- [ ] HTTPS redirect configured in Nginx
- [ ] Mixed content warnings eliminated

### 9. Nginx Reverse Proxy
- [ ] Nginx installed and configured
- [ ] Nginx config points to localhost:3000
- [ ] Proxy headers set (X-Forwarded-For, X-Real-IP, etc.)
- [ ] Static asset caching configured
- [ ] Nginx tests without syntax errors: `nginx -t`
- [ ] Security headers added (HSTS, X-Frame-Options, etc.)

### 10. Systemd Service
- [ ] Service file created: `/etc/systemd/system/memorybook.service`
- [ ] Service user created (memorybook)
- [ ] Service enabled: `systemctl enable memorybook`
- [ ] Service auto-restarts on failure
- [ ] Log directory created with correct permissions

### 11. System Dependencies
- [ ] Node.js 22+ installed and verified
- [ ] LibreOffice installed and `soffice --version` works
- [ ] FFmpeg installed and `ffmpeg -version` works
- [ ] Git installed for deployments

## Deployment Execution

### 12. Run Automated Setup (or manual steps)
- [ ] Backup existing data (if updating)
- [ ] Run deployment script or execute manual steps
- [ ] Verify no errors in setup logs
- [ ] Check `/var/log/memorybook/app.log` for startup messages

### 13. Post-Deployment Verification
- [ ] App responds on HTTP (will redirect to HTTPS)
- [ ] App responds on HTTPS: `curl https://your-domain.com`
- [ ] SSL certificate valid: Check browser lock icon
- [ ] API health endpoint works: `curl https://your-domain.com/api/health`
- [ ] Chat endpoint accessible: `curl -X POST https://your-domain.com/api/chat`
- [ ] Static assets load correctly (CSS, JS, images)

### 14. Functionality Testing
- [ ] Homepage loads at `https://your-domain.com`
- [ ] Chat input works and sends messages
- [ ] Assistant responds without errors
- [ ] File upload works in Files & Tools drawer
- [ ] PDF conversion works
- [ ] All routes accessible (/, /chat, /widget-demo)

### 15. Security Verification
- [ ] HTTPS enforced (redirect from HTTP)
- [ ] Mixed content warnings: 0
- [ ] Security headers present (check with browser developer tools)
- [ ] No sensitive data in console logs
- [ ] Debug endpoint disabled or password-protected
- [ ] Session cookies are HttpOnly and Secure

### 16. Performance & Monitoring
- [ ] App responds within 2 seconds
- [ ] No memory leaks (monitor `/var/log/memorybook/app.log`)
- [ ] Nginx reverse proxy latency acceptable
- [ ] Database/file operations complete normally
- [ ] Uptime monitoring configured (optional)

### 17. Logging & Error Handling
- [ ] Application logs enabled
- [ ] Nginx logs rotating properly
- [ ] Error logs reviewed for issues
- [ ] Log retention policy set (e.g., 30 days)

## Post-Deployment

### 18. Monitoring & Maintenance
- [ ] Set up automated backups of files/ directory
- [ ] Monitor `/var/log/memorybook/app.log` for errors
- [ ] Monitor SSL certificate expiry (auto-renewal)
- [ ] Keep system packages updated: `apt update && apt upgrade -y`
- [ ] Check disk space monthly: `df -h`

### 19. Documentation
- [ ] Deployment steps documented for future reference
- [ ] Team has access to server credentials (securely managed)
- [ ] Runbook created for common tasks (restart, logs, update)
- [ ] Incident response plan prepared

### 20. Communication
- [ ] Stakeholders notified of new deployment
- [ ] User communication plan executed (if applicable)
- [ ] Monitoring alerts configured (if using third-party service)

## Rollback Plan

- [ ] Previous version backed up
- [ ] Rollback procedure documented
- [ ] Time needed to rollback estimated
- [ ] Responsible person assigned for rollback
- [ ] Communication plan for rollback scenario

## Sign-Off

- [ ] Deployment lead: _________________ Date: _______
- [ ] DevOps/Infrastructure: ____________ Date: _______
- [ ] Product owner approval: __________ Date: _______

---

## Quick Commands for Production

```bash
# Check app status
systemctl status memorybook

# View logs
tail -f /var/log/memorybook/app.log

# Restart app
systemctl restart memorybook

# Check SSL certificate expiry
echo | openssl s_client -servername your-domain.com -connect your-domain.com:443 2>/dev/null | openssl x509 -noout -dates

# Update code and restart
cd /home/memorybook/memorybook
sudo -u memorybook git pull origin main
sudo -u memorybook npm install
systemctl restart memorybook

# View Nginx logs
tail -f /var/log/nginx/memorybook_access.log
tail -f /var/log/nginx/memorybook_error.log

# Check system resources
htop
df -h
```

---

**Deployment completed on:** _______________

**Deployed by:** _____________________

**Notes:** _____________________________________________

