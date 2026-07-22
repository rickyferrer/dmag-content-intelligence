import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import basicAuth from 'express-basic-auth';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { initScheduler } from './sync/scheduler.js';
import contentRoutes from './routes/content.js';
import analyticsRoutes from './routes/analytics.js';
import syncRoutes from './routes/sync.js';
import settingsRoutes from './routes/settings.js';
import insightsRoutes from './routes/insights.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001');
const app = express();

// Auth middleware — only if credentials are configured
const authUser = process.env.DASHBOARD_USER;
const authPass = process.env.DASHBOARD_PASS;
const useAuth = authUser && authPass;

const adminUser = process.env.ADMIN_USER;
const adminPass = process.env.ADMIN_PASS;
const useAdminAuth = adminUser && adminPass;

// A request carries exactly one Authorization header, so admin credentials
// must ALSO be accepted by the viewer tier — otherwise the moment an admin
// authenticates for Settings, the browser starts sending those admin
// credentials on every request (Basic Auth is cached per realm+origin, not
// per path), and every other tab in the app would start rejecting them,
// locking the admin out of the very dashboard they're administering.
// Admins can therefore always view; only admin credentials can mutate.
const viewerUsers = { ...(useAuth ? { [authUser]: authPass } : {}), ...(useAdminAuth ? { [adminUser]: adminPass } : {}) };

const auth = Object.keys(viewerUsers).length > 0
  ? basicAuth({
      users: viewerUsers,
      challenge: true,
      realm: 'D Magazine Content Intelligence',
    })
  : (req, res, next) => next();

// Separate, stricter tier for admin/mutating routes (sync triggers, score
// recalculation, scoring exclusions, destructive data cleanup) — distinct
// from the shared viewer credential used for the read-only analysis tabs.
// Mounted AFTER `auth` on admin routes, so a request must satisfy both: the
// viewer challenge (which admin creds already do, per above), then this
// second, stricter challenge that ONLY admin credentials satisfy.
const adminAuth = useAdminAuth
  ? basicAuth({
      users: { [adminUser]: adminPass },
      challenge: true,
      realm: 'D Magazine Admin',
    })
  : (req, res, next) => next();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// API routes (auth required)
app.use('/api/content', auth, contentRoutes);
app.use('/api/analytics', auth, analyticsRoutes);
app.use('/api/sync', auth, adminAuth, syncRoutes);
app.use('/api/settings', auth, adminAuth, settingsRoutes);
app.use('/api/insights', auth, insightsRoutes);

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(auth, express.static(clientDist));
  app.get('*', auth, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Initialize DB
getDb();
console.log('[Server] Database initialized');

// Start cron jobs
initScheduler();

app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  if (!useAuth) console.log('[Server] WARNING: No auth configured (DASHBOARD_USER/DASHBOARD_PASS)');
  if (!useAdminAuth) console.log('[Server] WARNING: No admin auth configured (ADMIN_USER/ADMIN_PASS) — Settings/sync routes are only protected by the shared viewer credential');
});
