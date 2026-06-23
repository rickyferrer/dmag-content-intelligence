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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001');
const app = express();

// Auth middleware — only if credentials are configured
const authUser = process.env.DASHBOARD_USER;
const authPass = process.env.DASHBOARD_PASS;
const useAuth = authUser && authPass;

const auth = useAuth
  ? basicAuth({
      users: { [authUser]: authPass },
      challenge: true,
      realm: 'D Magazine Content Intelligence',
    })
  : (req, res, next) => next();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// API routes (auth required)
app.use('/api/content', auth, contentRoutes);
app.use('/api/analytics', auth, analyticsRoutes);
app.use('/api/sync', auth, syncRoutes);
app.use('/api/settings', auth, settingsRoutes);

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
});
