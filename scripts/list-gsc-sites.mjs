// Verifies the GA4 service account has been granted Search Console access,
// and lists the exact property URL format to use for GSC_SITE_URL.
//
// Usage: node --env-file=.env scripts/list-gsc-sites.mjs
import { GoogleAuth } from 'google-auth-library';

const KEY_FILE = process.env.GA4_KEY_FILE || './credentials/ga4-service-account.json';

async function main() {
  let authConfig;
  if (process.env.GA4_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(Buffer.from(process.env.GA4_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8'));
    authConfig = { credentials, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] };
  } else {
    authConfig = { keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] };
  }

  const auth = new GoogleAuth(authConfig);
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ Failed: ${res.status} — ${text.slice(0, 300)}`);
    console.error('\nMake sure:');
    console.error('  1. The Search Console API is enabled in your Google Cloud project');
    console.error('  2. The service account email has been added as a user in Search Console');
    console.error('     (search.google.com/search-console → Settings → Users and permissions)');
    process.exit(1);
  }

  const data = await res.json();
  const sites = data.siteEntry || [];

  if (sites.length === 0) {
    console.log('✓ Connected, but the service account has no Search Console properties yet.');
    console.log('  Add its email as a user for your property in Search Console.');
    return;
  }

  console.log(`✓ SUCCESS — service account has access to ${sites.length} propert${sites.length === 1 ? 'y' : 'ies'}:\n`);
  for (const site of sites) {
    console.log(`  ${site.siteUrl}  (${site.permissionLevel})`);
  }
  console.log('\nSet GSC_SITE_URL to the exact value above (e.g. "sc-domain:dmagazine.com" or "https://www.dmagazine.com/").');
}

main().catch(err => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
