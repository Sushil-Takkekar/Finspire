const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DB_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
if (process.env.NODE_ENV === 'production' && !useSupabase) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for production.');
const sessions = new Map();

function readDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.users ||= []; db.portfolios ||= {}; db.insurance ||= {}; db.loans ||= {};
    return db;
  } catch { return { users: [], portfolios: {}, insurance: {}, loans: {} }; }
}
function writeDb(db) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
async function supabaseRequest(table, query = '', options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.method === 'POST' || options.method === 'PATCH' ? { Prefer: 'return=representation' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
  return response.status === 204 ? [] : response.json();
}
async function findUserByUsername(username) {
  if (!useSupabase) return readDb().users.find(item => item.username === username) || null;
  const rows = await supabaseRequest('users', `?select=id,username,salt,hash&username=eq.${encodeURIComponent(username)}&limit=1`);
  return rows[0] || null;
}
async function findUserById(id) {
  if (!useSupabase) return readDb().users.find(item => item.id === id) || null;
  const rows = await supabaseRequest('users', `?select=id,username,salt,hash&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}
async function createUser(user) {
  if (!useSupabase) { const db = readDb(); db.users.push(user); db.portfolios[user.id] = []; writeDb(db); return; }
  await supabaseRequest('users', '', { method: 'POST', body: user });
  await supabaseRequest('user_data', '', { method: 'POST', body: { user_id: user.id } });
}
async function getUserCollection(userId, collection) {
  if (!useSupabase) return readDb()[collection]?.[userId] || [];
  const rows = await supabaseRequest('user_data', `?select=${collection}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0]?.[collection] || [];
}
async function setUserCollection(userId, collection, value) {
  if (!useSupabase) { const db = readDb(); db[collection][userId] = value; writeDb(db); return; }
  await supabaseRequest('user_data', `?user_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', body: { [collection]: value } });
}
function send(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function tokenFrom(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}
async function currentUser(req) {
  const session = sessions.get(tokenFrom(req));
  if (!session) return null;
  return findUserById(session.userId);
}
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') });
function safeUser(user) { return { id: user.id, username: user.username }; }
function sessionCookie(token, maxAge = '') {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/${secure}${maxAge}`;
}
function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function isoDateToUtc(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}
function isoUtcDate(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`; }
function scheduledSipDates(startValue, endValue) {
  const start = isoDateToUtc(startValue), end = isoDateToUtc(endValue);
  if (!start || !end || start > end) return [];
  const dates = [], startDay = start.getUTCDate(), firstMonth = start.getUTCFullYear() * 12 + start.getUTCMonth(), lastMonth = end.getUTCFullYear() * 12 + end.getUTCMonth();
  for (let month = firstMonth; month <= lastMonth; month++) {
    const year = Math.floor(month / 12), monthIndex = month % 12;
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const date = isoUtcDate(new Date(Date.UTC(year, monthIndex, Math.min(startDay, lastDay))));
    if (date >= startValue && date <= endValue) dates.push(date);
  }
  return dates;
}
function mfDateToIso(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}
function scheduledEmiCount(startValue, endValue) {
  const start = isoDateToUtc(startValue), end = isoDateToUtc(endValue);
  if (!start || !end || start > end) return 0;
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  let count = 0;
  for (let offset = 0; offset <= months; offset++) {
    const year = start.getUTCFullYear(), month = start.getUTCMonth() + offset;
    const first = new Date(Date.UTC(year, month, 1));
    const day = Math.min(start.getUTCDate(), new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate());
    const due = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day);
    if (due <= end.getTime()) count++;
  }
  return Math.min(count, 1200);
}
function roundMoney(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method;
  if (method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
  if (method === 'POST' && url.pathname === '/api/register') {
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return send(res, 400, { error: 'Username must be 3–32 characters (letters, numbers, dot, underscore or dash).' });
    if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'Password must be at least 8 characters.' });
    if (await findUserByUsername(username)) return send(res, 409, { error: 'That username is already registered.' });
    const creds = hashPassword(password);
    const user = { id: crypto.randomUUID(), username, ...creds };
    await createUser(user);
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { userId: user.id });
    return send(res, 201, { user: safeUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (method === 'POST' && url.pathname === '/api/login') {
    const body = await readBody(req), username = String(body.username || '').trim().toLowerCase(), password = String(body.password || '');
    const user = await findUserByUsername(username);
    if (!user) return send(res, 401, { error: 'Incorrect username or password.' });
    const check = crypto.scryptSync(password, user.salt, 64);
    if (!crypto.timingSafeEqual(check, Buffer.from(user.hash, 'hex'))) return send(res, 401, { error: 'Incorrect username or password.' });
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { userId: user.id });
    return send(res, 200, { user: safeUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (method === 'POST' && url.pathname === '/api/logout') {
    sessions.delete(tokenFrom(req)); return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', '; Max-Age=0') });
  }
  if (method === 'GET' && url.pathname === '/api/me') {
    const user = currentUser(req); return user ? send(res, 200, { user: safeUser(user) }) : send(res, 401, { error: 'Please sign in.' });
  }
    const user = await currentUser(req);
  if (url.pathname.startsWith('/api/')) {
    if (!user) return send(res, 401, { error: 'Please sign in.' });
    if (method === 'GET' && url.pathname === '/api/holdings') return send(res, 200, { holdings: await getUserCollection(user.id, 'portfolios') });
    if (method === 'GET' && url.pathname === '/api/insurance') return send(res, 200, { policies: await getUserCollection(user.id, 'insurance') });
    if (method === 'GET' && url.pathname === '/api/loans') return send(res, 200, { loans: await getUserCollection(user.id, 'loans') });
    if (method === 'POST' && url.pathname === '/api/refresh-loans') {
      await readBody(req);
      const userLoans = await getUserCollection(user.id, 'loans'), today = todayInIndia();
      let updated = 0;
      for (const loan of userLoans) {
        if (loan.status === 'Closed') { loan.outstandingPrincipal = 0; continue; }
        const startingPrincipal = Number(loan.principalAtStart ?? loan.outstandingPrincipal);
        if (!Number.isFinite(startingPrincipal) || startingPrincipal <= 0) continue;
        const dueCount = scheduledEmiCount(loan.emiStartDate, today);
        let balance = startingPrincipal, principalPaid = 0, interestPaid = 0;
        const monthlyRate = Number(loan.interestRate) / 1200, emi = Number(loan.monthlyEmi);
        for (let index = 0; index < dueCount && balance > 0; index++) {
          const interestComponent = roundMoney(balance * monthlyRate);
          const actualPayment = Math.min(emi, balance + interestComponent);
          const principalComponent = roundMoney(actualPayment - interestComponent);
          balance = roundMoney(Math.max(0, balance - principalComponent));
          principalPaid = roundMoney(principalPaid + principalComponent);
          interestPaid = roundMoney(interestPaid + interestComponent);
        }
        loan.principalAtStart = startingPrincipal;
        loan.processedEmis = dueCount;
        loan.outstandingPrincipal = roundMoney(balance);
        loan.principalPaid = principalPaid;
        loan.interestPaid = interestPaid;
        if (loan.outstandingPrincipal === 0) loan.status = 'Closed';
        loan.lastRefreshedDate = today;
        updated++;
      }
      await setUserCollection(user.id, 'loans', userLoans);
      return send(res, 200, { loans: userLoans, updated, asOf: today });
    }
    if (method === 'PUT' && url.pathname === '/api/loans') {
      const body = await readBody(req);
      if (!Array.isArray(body.loans) || body.loans.length > 500) return send(res, 400, { error: 'Invalid loan list.' });
      const clean = body.loans.map(loan => {
        if (!loan || typeof loan.loanType !== 'string' || typeof loan.underlyingAsset !== 'string') throw new Error('Enter a loan type and underlying asset.');
        const outstandingPrincipal = Number(loan.outstandingPrincipal), monthlyEmi = Number(loan.monthlyEmi), interestRate = Number(loan.interestRate), emiStartDate = String(loan.emiStartDate || ''), status = String(loan.status || 'Active');
        if (!['Active', 'Closed'].includes(status)) throw new Error('Loan status must be Active or Closed.');
        if (!Number.isFinite(outstandingPrincipal) || outstandingPrincipal < 0 || (status === 'Active' && outstandingPrincipal <= 0) || !Number.isFinite(monthlyEmi) || monthlyEmi <= 0 || !Number.isFinite(interestRate) || interestRate < 0) throw new Error('Enter valid principal, EMI, and non-negative interest rate amounts.');
        if (!isoDateToUtc(emiStartDate) || !loan.loanType.trim() || !loan.underlyingAsset.trim()) throw new Error('Enter a valid EMI start date, loan type, and underlying asset.');
        const principalAtStart = Number(loan.principalAtStart ?? outstandingPrincipal), principalPaid = Number(loan.principalPaid || 0), interestPaid = Number(loan.interestPaid || 0), processedEmis = Number(loan.processedEmis || 0);
        if (!Number.isFinite(principalAtStart) || principalAtStart < 0 || !Number.isFinite(principalPaid) || !Number.isFinite(interestPaid) || interestPaid < 0 || !Number.isInteger(processedEmis) || processedEmis < 0) throw new Error('Invalid loan repayment history.');
        return { id: String(loan.id || crypto.randomUUID()), loanType: loan.loanType.trim().slice(0, 100), underlyingAsset: loan.underlyingAsset.trim().slice(0, 150), outstandingPrincipal, monthlyEmi, interestRate, emiStartDate, status, principalAtStart, principalPaid, interestPaid, processedEmis };
      });
      await setUserCollection(user.id, 'loans', clean); return send(res, 200, { loans: clean });
    }
    if (method === 'PUT' && url.pathname === '/api/insurance') {
      const body = await readBody(req);
      if (!Array.isArray(body.policies) || body.policies.length > 500) return send(res, 400, { error: 'Invalid insurance policy list.' });
      const kinds = ['Health', 'Term', 'Car', 'House', 'Other'];
      const clean = body.policies.map(policy => {
        if (!policy || typeof policy.insuredPerson !== 'string' || typeof policy.company !== 'string' || typeof policy.policyNumber !== 'string' || !kinds.includes(policy.type)) throw new Error('Complete all insurance policy details.');
        const sumInsured = Number(policy.sumInsured), premium = Number(policy.premium);
        const fromDate = String(policy.fromDate || ''), toDate = String(policy.toDate || '');
        if (!Number.isFinite(sumInsured) || sumInsured <= 0 || !Number.isFinite(premium) || premium <= 0) throw new Error('Sum insured and premium must be positive amounts.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || toDate < fromDate) throw new Error('Enter a valid policy period.');
        return { id: String(policy.id || crypto.randomUUID()), insuredPerson: policy.insuredPerson.trim().slice(0, 100), type: policy.type, company: policy.company.trim().slice(0, 100), policyNumber: policy.policyNumber.trim().slice(0, 100), sumInsured, fromDate, toDate, premium };
      });
      await setUserCollection(user.id, 'insurance', clean); return send(res, 200, { policies: clean });
    }
    if (method === 'PUT' && url.pathname === '/api/holdings') {
      const body = await readBody(req);
      if (!Array.isArray(body.holdings) || body.holdings.length > 500) return send(res, 400, { error: 'Invalid holdings list.' });
      const kinds = ['stock', 'mf', 'ppf', 'fd', 'rd'];
      const clean = body.holdings.map(item => {
        if (!item || !kinds.includes(item.type) || typeof item.name !== 'string') throw new Error('Invalid holding.');
        const allowed = {};
        for (const key of ['units', 'price', 'invested', 'amount', 'rate', 'tenure', 'openDate', 'maturityDate', 'schemeCode', 'nav', 'navDate', 'monthly', 'balance', 'updatedAt', 'sipEnabled', 'sipAmount', 'sipStartDate', 'sipPurchases', 'monthlyEnabled', 'monthlyAmount', 'monthlyStartDate']) {
          if (item[key] !== undefined) allowed[key] = item[key];
        }
        for (const value of Object.values(allowed)) if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) throw new Error('Amounts must be valid non-negative numbers.');
        if (allowed.sipEnabled !== undefined && typeof allowed.sipEnabled !== 'boolean') throw new Error('SIP enabled must be true or false.');
        if (allowed.monthlyEnabled !== undefined && typeof allowed.monthlyEnabled !== 'boolean') throw new Error('Monthly investment enabled must be true or false.');
        if (item.type === 'ppf' && allowed.monthlyEnabled) {
          if (!Number.isFinite(Number(allowed.monthlyAmount)) || Number(allowed.monthlyAmount) <= 0 || !isoDateToUtc(String(allowed.monthlyStartDate || ''))) throw new Error('Enter a valid PPF monthly amount and start date.');
          allowed.monthlyAmount = Number(allowed.monthlyAmount);
          allowed.monthlyStartDate = String(allowed.monthlyStartDate);
        }
        if (allowed.sipPurchases !== undefined) {
          if (!Array.isArray(allowed.sipPurchases) || allowed.sipPurchases.length > 1200) throw new Error('Invalid SIP purchase history.');
          allowed.sipPurchases = allowed.sipPurchases.map(purchase => {
            const dueDate = String(purchase?.dueDate || ''), navDate = String(purchase?.navDate || ''), nav = Number(purchase?.nav), amount = Number(purchase?.amount), units = Number(purchase?.units);
            if (!isoDateToUtc(dueDate) || !isoDateToUtc(navDate) || ![nav, amount, units].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid SIP purchase entry.');
            return { dueDate, navDate, nav, amount, units };
          });
        }
        return { id: String(item.id || crypto.randomUUID()), type: item.type, name: item.name.slice(0, 100), ...allowed };
      });
      await setUserCollection(user.id, 'portfolios', clean); return send(res, 200, { holdings: clean });
    }
    if (method === 'POST' && url.pathname === '/api/refresh-navs') {
      await readBody(req);
      const portfolio = await getUserCollection(user.id, 'portfolios'), funds = portfolio.filter(item => item.type === 'mf');
      if (!funds.length) return send(res, 200, { holdings: portfolio, updated: 0, sipAdded: 0, failed: [] });
      const failed = []; let updated = 0, sipAdded = 0;
      for (let index = 0; index < funds.length; index += 4) {
        const batch = funds.slice(index, index + 4);
        await Promise.all(batch.map(async item => {
          const code = String(item.schemeCode || '');
          if (!/^\d{4,8}$/.test(code)) { failed.push({ name: item.name, error: 'Missing or invalid AMFI scheme code.' }); return; }
          try {
            const latestResponse = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}/latest`, { signal: AbortSignal.timeout(10000) });
            if (!latestResponse.ok) throw new Error('Latest NAV provider unavailable');
            const latestData = await latestResponse.json(), latest = latestData.data?.[0], latestNav = Number(latest?.nav);
            if (!latest || !Number.isFinite(latestNav) || latestNav <= 0) throw new Error('No valid latest NAV was returned.');
            const originalBasis = Number(item.invested) > 0 ? Number(item.invested) : Number(item.units || 0) * Number(item.price || 0);
            item.price = latestNav; item.nav = latestNav; item.navDate = latest.date; item.updatedAt = new Date().toISOString(); updated++;
            if (item.sipEnabled) {
              const sipAmount = Number(item.sipAmount), sipStartDate = String(item.sipStartDate || ''), today = todayInIndia();
              if (!Number.isFinite(sipAmount) || sipAmount <= 0 || !isoDateToUtc(sipStartDate)) throw new Error('SIP is enabled but its amount or first SIP date is invalid.');
              const existingPurchases = Array.isArray(item.sipPurchases) ? item.sipPurchases : [];
              const processed = new Set(existingPurchases.map(purchase => purchase.dueDate));
              const allDates = scheduledSipDates(sipStartDate, today), pendingDates = allDates.filter(date => !processed.has(date));
              if (pendingDates.length) {
                const startDate = pendingDates[0];
                const historyUrl = `https://api.mfapi.in/mf/${encodeURIComponent(code)}?${new URLSearchParams({ startDate, endDate: today })}`;
                const historyResponse = await fetch(historyUrl, { signal: AbortSignal.timeout(20000) });
                if (!historyResponse.ok) throw new Error('Historical NAV provider unavailable for SIP dates.');
                const history = await historyResponse.json();
                const rows = (history.data || []).map(row => ({ date: mfDateToIso(row.date), nav: Number(row.nav) })).filter(row => row.date && row.date >= startDate && row.date <= today && Number.isFinite(row.nav) && row.nav > 0).sort((a, b) => a.date.localeCompare(b.date));
                let rowIndex = 0, basis = originalBasis;
                for (let dateIndex = 0; dateIndex < pendingDates.length; dateIndex++) {
                  const dueDate = pendingDates[dateIndex], scheduleIndex = allDates.indexOf(dueDate), nextDate = allDates[scheduleIndex + 1] || null;
                  while (rowIndex < rows.length && rows[rowIndex].date < dueDate) rowIndex++;
                  const candidate = rows[rowIndex];
                  if (!candidate || candidate.date > today || (nextDate && candidate.date >= nextDate)) {
                    failed.push({ name: item.name, error: `SIP NAV not available yet for ${dueDate}.` });
                    continue;
                  }
                  const units = sipAmount / candidate.nav;
                  item.units = Number(item.units || 0) + units; basis += sipAmount; sipAdded++;
                  existingPurchases.push({ dueDate, navDate: candidate.date, nav: candidate.nav, amount: sipAmount, units });
                  rowIndex++;
                }
                item.sipPurchases = existingPurchases; item.invested = basis;
              } else if (!(Number(item.invested) > 0)) item.invested = originalBasis;
            } else if (!(Number(item.invested) > 0)) item.invested = originalBasis;
          } catch (error) { failed.push({ name: item.name, error: error.message || 'NAV refresh failed.' }); }
        }));
      }
      if (updated || sipAdded) await setUserCollection(user.id, 'portfolios', portfolio);
      return send(res, 200, { holdings: portfolio, updated, sipAdded, failed });
    }
    const navMatch = url.pathname.match(/^\/api\/mf\/([^/]+)$/);
    if (method === 'GET' && navMatch) {
      const code = navMatch[1];
      if (!/^\d{4,8}$/.test(code)) return send(res, 400, { error: 'Enter a valid AMFI scheme code.' });
      try {
        const response = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}/latest`, { signal: AbortSignal.timeout(7000) });
        if (!response.ok) throw new Error('NAV provider unavailable');
        const data = await response.json();
        const latest = data.data?.[0];
        if (!latest) return send(res, 404, { error: 'No NAV was found for that scheme code.' });
        return send(res, 200, { name: data.meta?.scheme_name || 'Mutual fund', nav: Number(latest.nav), date: latest.date, schemeCode: code });
      } catch { return send(res, 502, { error: 'Could not fetch the latest NAV. Check the scheme code and your internet connection.' }); }
    }
    return send(res, 404, { error: 'Not found.' });
  }
  const safePath = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!safePath.startsWith(ROOT + path.sep)) return send(res, 403, { error: 'Forbidden.' });
  fs.readFile(safePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(safePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(content);
  });
}
http.createServer((req, res) => route(req, res).catch(error => {
  console.error(error);
  send(res, error.message?.startsWith('Database request failed') ? 503 : 400, { error: error.message || 'Request failed.' });
})).listen(PORT, HOST, () => console.log(`Finspire listening on ${HOST}:${PORT}`));
