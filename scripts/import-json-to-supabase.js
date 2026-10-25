const fs = require('node:fs');
const path = require('node:path');

const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const file = path.join(__dirname, '..', 'data', 'db.json');

if (!baseUrl || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing.');
if (!fs.existsSync(file)) throw new Error('Local data/db.json was not found.');

async function request(table, body, conflict = 'id') {
  const headers = {
    apikey: serviceKey,
    'Content-Type': 'application/json',
    ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}),
    Prefer: 'resolution=merge-duplicates,return=minimal'
  };
  const response = await fetch(`${baseUrl}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Import to ${table} failed (${response.status}).`);
}

async function main() {
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const users = Array.isArray(db.users) ? db.users : [];
  const userData = users.map(user => ({
    user_id: user.id,
    portfolios: db.portfolios?.[user.id] || [],
    insurance: db.insurance?.[user.id] || [],
    loans: db.loans?.[user.id] || []
  }));
  if (users.length) {
    await request('users', users.map(({ id, username, salt, hash }) => ({ id, username, salt, hash })));
    await request('user_data', userData, 'user_id');
  }
  console.log(`Imported ${users.length} account(s) and their Finspire records.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
