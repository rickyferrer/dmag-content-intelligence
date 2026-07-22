# Deploying to your own VPS

Internal-team dashboard: Node + Express + SQLite + hourly cron, behind a shared
password, served over HTTPS. Assumes an **Ubuntu 22.04+** server with `sudo` and
(ideally) a domain or subdomain pointed at it. Substitute your own values for
`USER`, `SERVER_IP`, and `dashboard.example.com`.

---

## 1. One-time server setup

SSH in, then install Node 20, PM2 (process manager), nginx, and certbot:

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2

# (optional) HTTPS via Let's Encrypt
sudo apt-get install -y certbot python3-certbot-nginx

# firewall: allow web + ssh, do NOT expose the app port (3001) directly
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## 2. Get the code onto the server

This project isn't a git repo, so copy it up with rsync (run from your LOCAL
machine, in the project folder). `node_modules` is excluded — we reinstall on the
server. The build (`client/dist`) and gitignored files ARE included on purpose.

```bash
# from your local project directory:
rsync -av --exclude node_modules --exclude client/node_modules --exclude logs \
  ./ USER@SERVER_IP:/home/USER/dmag-dashboard/
```

> The rsync above already includes your `.env`, `credentials/`, and `content.db`
> (with all synced data, scores, and writers) — so the server starts with a full
> database and won't have to re-sync from scratch.

If you'd rather copy the database cleanly (avoids the SQLite -wal/-shm temp files),
run this locally first, then rsync:

```bash
sqlite3 content.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

---

## 3. Configure secrets / production env

On the server, edit `.env` and make sure it contains **all** of these:

```bash
cd /home/USER/dmag-dashboard
nano .env
```

```ini
NODE_ENV=production
PORT=3001

# Shared login for the team (pick a strong password) — read-only access to
# every analysis tab (Overview, Content, Sections, etc.)
DASHBOARD_USER=dmag
DASHBOARD_PASS=choose-a-strong-password

# Separate, stricter login required for Settings and all mutating actions
# (sync triggers, score recalculation, scoring exclusions, destructive data
# cleanup). Give this only to the small set of people who should administer
# the dashboard, not the whole team. Admin credentials also work for viewing
# (see server/index.js for why), so admins don't need both logins.
ADMIN_USER=dmag-admin
ADMIN_PASS=choose-a-different-strong-password

# GA4 (service account is the primary auth now)
GA4_PROPERTY_ID=320675632
GA4_KEY_FILE=./credentials/ga4-service-account.json

# Search Console (reuses the GA4 service account — must also be granted
# access to the property in Search Console → Settings → Users and permissions)
GSC_SITE_URL=sc-domain:dmagazine.com

# Marfeel
MARFEEL_EMAIL=...
MARFEEL_PASSWORD=...

# Anthropic (User Needs classification)
ANTHROPIC_API_KEY=...
```

Confirm the service-account file made it over and is readable:

```bash
ls -l credentials/ga4-service-account.json
```

---

## 4. Install deps and start

```bash
cd /home/USER/dmag-dashboard
npm ci --omit=dev        # installs server deps only (frontend is prebuilt in client/dist)
mkdir -p logs

pm2 start ecosystem.config.cjs
pm2 save                 # remember this process across reboots
pm2 startup              # run the command it prints, to enable boot startup
```

Check it's healthy:

```bash
pm2 status
curl -s http://localhost:3001/health     # -> {"ok":true,...}
pm2 logs dmag-dashboard --lines 30        # watch for "[Server] Running" and sync logs
```

---

## 5. Put nginx in front (HTTPS + clean URL)

```bash
sudo nano /etc/nginx/sites-available/dmag-dashboard
```

```nginx
server {
    server_name dashboard.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/dmag-dashboard /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# add HTTPS (auto-edits the nginx config + auto-renews)
sudo certbot --nginx -d dashboard.example.com
```

Now visit **https://dashboard.example.com** — the browser will prompt for the
`DASHBOARD_USER` / `DASHBOARD_PASS` login, then load the dashboard.

---

## Updating the app later

From local, after making changes:

```bash
npm run build                                   # rebuild frontend
rsync -av --exclude node_modules --exclude client/node_modules --exclude logs \
  ./ USER@SERVER_IP:/home/USER/dmag-dashboard/
ssh USER@SERVER_IP "cd /home/USER/dmag-dashboard && npm ci --omit=dev && pm2 restart dmag-dashboard"
```

> Tip: to avoid overwriting the server's live database on updates, add
> `--exclude content.db --exclude '*.db-*'` to the update rsync (you only need to
> copy the DB the first time).

---

## How it runs in production

- **PM2** keeps the Node process alive, restarts it on crash, and relaunches on reboot.
- The single Node process serves both the **API** and the **built React app** (because `NODE_ENV=production`).
- The **cron scheduler** runs inside that process: content sync daily at 2:05am, analytics hourly at :20, classification hourly at :40.
- **SQLite** (`content.db`) lives on the server's disk — back it up periodically (`cp content.db backups/…`).
- GA4 uses the **service account**, so auth won't expire.
