// Recovery tool: grant (or restore) the admin role for a specific account
// directly against auth.db, bypassing the app entirely. For when no admin
// account exists to do this through Settings -> Users (e.g. the original
// bootstrapped admin was deleted/demoted, or never landed for this account).
//
// Usage (from the project root, e.g. in Render's Shell tab):
//   node server/scripts/promote-admin.mjs ricky.ferrer@dmagazine.com
import { getUserRecordByUsername, updateUser } from '../authDb.js';

const username = process.argv[2];
if (!username) {
  console.error('Usage: node server/scripts/promote-admin.mjs <username-or-email>');
  process.exit(1);
}

const user = getUserRecordByUsername(username);
if (!user) {
  console.error(`No account found for "${username}". Check the exact email/username shown in the app (case-insensitive match is fine, but it must exist).`);
  process.exit(1);
}
if (!user.password_hash || user.password_hash === '!') {
  console.error(`"${username}" has no password set, so it can't be an admin (anyone who knows the email could sign in as them). Ask them to set one from the account menu, then re-run this.`);
  process.exit(1);
}

updateUser(user.id, { role: 'admin', active: true });
console.log(`Done — "${username}" is now an active admin. They may need to sign out and back in for Settings to appear.`);
