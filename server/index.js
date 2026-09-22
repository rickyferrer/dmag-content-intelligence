import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { initScheduler } from './sync/scheduler.js';
import contentRoutes from './routes/content.js';
import analyticsRoutes from './routes/analytics.js';
import syncRoutes from './routes/sync.js';
import settingsRoutes from './routes/settings.js';
import insightsRoutes from './routes/insights.js';
import goalsRoutes from './routes/goals.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import { attachUser, requireAuth, requireAdmin, bootstrapAdmin } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001');
const app = express();

// Without this, any unhandled rejection anywhere in the app — a bad date
// range to an external API, a flaky network call, anything in an async
// route handler or cron job — crashes the entire Node process, taking the
// whole site down for every user until Render restarts it (and right back
// down again if the same request triggers it once more). Log and keep
// running instead; an individual failed request should degrade to that one
// request failing, not an outage. (Route handlers should still catch their
// own expected failure modes for a clean response — this is the last-resort
// net, not a substitute for that.)
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection (process kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (process kept alive):', err);
});

// Individual logins: session-cookie auth (see auth.js / authDb.js). Roles:
//   user  — sees every analytics tab; has their own goals and Insights history.
//   admin — additionally owns Settings (scoring weights, sync triggers,
//           exclusions, cleanup) and user management. All of that sits behind
//           requireAdmin — the UI hiding it is not what protects it.
// The first admin is created from ADMIN_USER/ADMIN_PASS (else DASHBOARD_USER/
// DASHBOARD_PASS) the first time the server starts with no accounts.
app.set('trust proxy', 1); // Render terminates TLS in front of us; needed for req.ip and Secure cookies

// No CORS: the client is always same-origin (Vite proxy in dev, this server in
// prod), and with cookie auth a permissive credentialed CORS policy would let
// other websites make authenticated requests as a signed-in user.
app.use(express.json());
app.use(attachUser);

// Public
app.use('/api/auth', authRoutes);
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Signed-in users
app.use('/api/content', requireAuth, contentRoutes);
app.use('/api/analytics', requireAuth, analyticsRoutes);
app.use('/api/insights', requireAuth, insightsRoutes);
app.use('/api/goals', requireAuth, goalsRoutes);
app.use('/api/sync', requireAuth, syncRoutes); // trigger is admin-only inside sync.js

// Admin only
app.use('/api/settings', requireAuth, settingsRoutes); // GET / is readable by anyone signed in; every other route requires admin internally (see settings.js)
app.use('/api/users', requireAdmin, usersRoutes);

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  // The app shell is public so the sign-in screen can load; every data
  // endpoint above is what's protected.
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Initialize DB
getDb();
console.log('[Server] Database initialized');
bootstrapAdmin();

// Start cron jobs
initScheduler();

app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
