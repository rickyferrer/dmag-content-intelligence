/**
 * One-time setup: authorizes the dashboard to access GA4 using your personal
 * Google account (OAuth2 Desktop flow). Saves a refresh token to
 * credentials/ga4-oauth-token.json so the server can call GA4 indefinitely.
 *
 * Run: node scripts/setup-ga4-oauth.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';

const OAUTH_FILE = './credentials/oauth-client.json';
const TOKEN_FILE = './credentials/ga4-oauth-token.json';
const PROPERTY_ID = '320675632';
const REDIRECT_PORT = 4567;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
];

// Load OAuth client credentials
let creds;
try {
  const raw = JSON.parse(readFileSync(OAUTH_FILE, 'utf8'));
  creds = raw.installed || raw.web;
} catch {
  console.error(`\nCould not read ${OAUTH_FILE}`);
  console.error('Download an OAuth2 Desktop App credential from:');
  console.error('https://console.cloud.google.com/apis/credentials\n');
  process.exit(1);
}

const { client_id, client_secret } = creds;

// Build auth URL manually (no googleapis dependency needed here)
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', client_id);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\n=== GA4 OAuth2 Setup ===\n');
console.log('Open this URL in your browser and sign in with your GA4 admin account:\n');
console.log(authUrl.toString());
console.log('\nWaiting for authorization on port', REDIRECT_PORT, '...\n');

// Catch the OAuth callback
const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2 style="font-family:sans-serif;padding:40px">✓ Authorized! You can close this tab and return to the terminal.</h2>');
      server.close();
      resolve(code);
    } else {
      res.end(`<h2>Error: ${error}</h2>`);
      reject(new Error(error || 'No code returned'));
    }
  });
  server.listen(REDIRECT_PORT, '127.0.0.1');
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      reject(new Error(`Port ${REDIRECT_PORT} is already in use. Stop any other process using it and retry.`));
    } else {
      reject(err);
    }
  });
});

// Exchange code for tokens
console.log('Exchanging authorization code for tokens...');
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id,
    client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }),
});

const tokenData = await tokenRes.json();
if (tokenData.error) {
  console.error('Token exchange failed:', tokenData.error, tokenData.error_description);
  process.exit(1);
}

// Save token for the server to use
const tokenFile = {
  client_id,
  client_secret,
  refresh_token: tokenData.refresh_token,
  token_type: 'authorized_user',
};
writeFileSync(TOKEN_FILE, JSON.stringify(tokenFile, null, 2));
console.log(`\n✓ Tokens saved to ${TOKEN_FILE}`);

// Quick test — call GA4 to verify it works
console.log('\nTesting GA4 connection...');
const accessToken = tokenData.access_token;
const testRes = await fetch(
  `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}/metadata`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
const testData = await testRes.json();

if (testRes.ok) {
  console.log(`✓ GA4 connection successful!`);
  console.log(`  ${testData.dimensions?.length} dimensions available`);
  console.log('\nRestart your server — GA4 data will now sync correctly.');
} else {
  console.error('✗ GA4 test failed:', testData.error?.message);
  if (testData.error?.status === 'PERMISSION_DENIED') {
    console.error('\nYour Google account does not have access to GA4 property', PROPERTY_ID);
    console.error('Make sure you signed in with the account that has GA4 Viewer access.');
  }
}
