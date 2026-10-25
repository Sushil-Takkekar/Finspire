# Finspire

A single-page investment dashboard built with plain HTML, CSS, and JavaScript, with a dependency-free Node.js server. It supports local JSON storage for local use and Supabase Postgres for hosted use.

## Run locally

Requires Node.js 20 or newer. From this directory:

```sh
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The local account and portfolio data are stored in `data/db.json`. Back up that file to preserve local data.

## Deploy with Render and Supabase

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
2. Import the current local accounts and records before switching to the hosted database. In a local terminal, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then run:

   ```sh
   npm run migrate:supabase
   ```

   The import keeps existing account IDs and password hashes. The service role key is a secret: use it only in your terminal and Render environment settings; never put it in browser code or commit it.
3. Push the app to GitHub, then create a Render Blueprint from the repository. Render reads [`render.yaml`](render.yaml); enter `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` when prompted.
4. Open the Render URL and sign in with an imported account, or create a new account.

Render hosts the Node server. The server uses the Supabase service role key to access the private tables; browser requests never receive that key. Set both Supabase environment variables in production. Locally, if they are unset, Finspire continues using `data/db.json`.

Sessions are held in server memory, so signing in again may be required after a server restart or deploy. The app uses secure cookies when `NODE_ENV=production`.

## Supported calculations

- **Stocks:** Add a purchase by units and entered share price. Purchases with the same stock name are combined; invested value increases by units × purchase price. The entered price is also used as the current value estimate.
- **Mutual funds:** Add a purchase by units. Matching AMFI scheme codes are combined, and invested value increases by units × latest NAV. NAV is fetched from [mfapi.in](https://www.mfapi.in/); use **Refresh** to update valuations and calculate due SIP installments from historical NAVs. A network connection is needed.
- **PPF:** Add a one-time rupee contribution to an existing account with the same account label, or create a new account. Optional monthly contributions are calculated through today without double-counting them.
- **Fixed deposits:** Estimated maturity value using quarterly compounding and supplied principal, annual rate, and tenure.
- **Recurring deposits:** Invested amount counts monthly installments due from the open date through today, capped at tenure. Estimates use monthly compounding and do not account for bank-specific day-count rules, taxes, fees, or rate changes.

Dashboard charts are portfolio snapshots based on entered values; historical performance data is not collected.
