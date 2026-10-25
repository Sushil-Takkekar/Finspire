# Finspire — local investment tracker

A single-page investment dashboard using plain HTML, CSS and JavaScript, with a dependency-free Node.js server for local JSON storage and sign-in.

## Run locally

Requires Node.js 18 or newer (for built-in `fetch`). From this directory:

```sh
npm start
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000). Set `PORT` to change the port. The server binds only to loopback.

## Data and account

Accounts and holdings are stored in `data/db.json` in this folder. Passwords are stored as salted scrypt hashes. Sessions are held in server memory and end when the server restarts. The app is designed for one local machine, not for deployment on a public network. Back up `data/db.json` to preserve your portfolio.

## Supported calculations

- **Stocks:** Add a purchase by units and entered share price. Purchases with the same stock name are combined; invested value increases by units × purchase price. The entered price is also used as the current value estimate.
- **Mutual funds:** Add a purchase by units. Matching AMFI scheme codes are combined, and invested value increases by units × latest NAV. NAV is fetched from [mfapi.in](https://www.mfapi.in/) using the latest-NAV endpoint; use **Refresh** on the dashboard to update saved valuations and calculate due SIP installments from historical NAVs. Enable a monthly SIP with an amount and first SIP date. On refresh, each due installment uses the NAV for its date or the next available NAV date. Purchases are recorded by due date so refreshing again will not add the same installment twice. A network connection is needed.
- **PPF:** Add a one-time rupee contribution to an existing account with the same account label, or create a new account. An optional monthly investment amount and start date calculate scheduled contributions through today on login or refresh without double-counting them. The edit form retains the base balance separately.
- **Fixed deposits:** Estimated maturity value using quarterly compounding and the supplied principal, annual rate, and tenure.
- **Recurring deposits:** Invested amount counts monthly installments due from the open date through the current date, capped at tenure. Estimated current value applies monthly compounding to those installments. Estimates do not account for bank-specific day-count rules, taxes, fees, or rate changes.

All dashboard charts are portfolio snapshots based on the values entered; historical performance data is not collected.
