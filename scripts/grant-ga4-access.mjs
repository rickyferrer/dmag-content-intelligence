/**
 * One-time script to grant the service account Viewer access to GA4 property 320675632
 * using your personal Google credentials via OAuth2 desktop flow.
 *
 * Prerequisites:
 *   1. Download an OAuth2 Desktop App credential JSON from Google Cloud Console
 *      and save it as credentials/oauth-client.json
 *   2. Ensure Google Analytics Admin API is enabled on the project
 *
 * Run: node scripts/grant-ga4-access.mjs
 */

import { readFileSync } from 'fs';
import { createServer } from 'http';
import { google } from 'googleapis';

const OAUTH_FILE = './credentials/oauth-client.json';
const SERVICE_ACCOUNT_EMAIL = 'dmag-analytics-reader@substantial-mix-495101-i3.iam.gserviceaccount.com';
const PROPERTY_ID = '320675632';
const REDIRECT_PORT = 4567;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

let oauthCreds;
try {
  const raw = JSON.parse(readFileSync(OAUTH_FILE, 'utf8'));
  oauthCreds = raw.installed || raw.web;
} catch {
  console.error(`Could not read ${OAUTH_FILE}. Download an OAuth2 Desktop App credential from:`);
  console.error('https://console.cloud.google.com/apis/credentials');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  oauthCreds.client_id,
  oauthCreds.client_secret,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/analytics.manage.users'],
  prompt: 'consent',
});

console.log('\n=== GA4 Service Account Access Grant ===');
console.log('\nOpen this URL in your browser and sign in with your GA4 admin account:\n');
console.log(authUrl);
console.log('\nWaiting for authorization...');

// Tiny local server to catch the OAuth callback
const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    const code = url.searchParams.get('code');
    if (code) {
      res.end('<h2>Authorized! You can close this tab.</h2>');
      server.close();
      resolve(code);
    } else {
      res.end('<h2>No code found.</h2>');
      reject(new Error('No code in callback'));
    }
  });
  server.listen(REDIRECT_PORT);
  server.on('error', reject);
});

const { tokens } = await oauth2Client.getToken(code);
oauth2Client.setCredentials(tokens);
console.log('\nAuthorized. Granting service account access to GA4 property...');

// accessBindings.create is only available in v1alpha (not v1beta).
const analyticsAdmin = google.analyticsadmin({ version: 'v1alpha', auth: oauth2Client });

try {
  const response = await analyticsAdmin.properties.accessBindings.create({
    parent: `properties/${PROPERTY_ID}`,
    requestBody: {
      user: SERVICE_ACCOUNT_EMAIL,
      roles: ['predefinedRoles/viewer'],
    },
  });
  console.log('\n✓ SUCCESS — service account granted Viewer access');
  console.log('Binding name:', response.data.name);
  console.log('\nRestart your server and trigger an analytics sync — GA4 data should now flow.');
} catch (err) {
  console.error('\n✗ Failed to grant access:', err.message);
  if (err.message.includes('403')) {
    console.error('Your Google account may not have Edit permissions on this GA4 property.');
  }
}
