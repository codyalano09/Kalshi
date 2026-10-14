# Run the Kalshi BTC signal bot on your computer (free)

This shows **BUY / SELL / HOLD** signals for Kalshi's 15-minute Bitcoin market. It does **not** place any trades and needs **no Kalshi account**.

## What you need
- A computer that stays on while you use it
- **Node.js 20 or newer**: download the LTS version from https://nodejs.org and install it
- **Git** (or use GitHub's green "Code → Download ZIP" button and unzip)

## Steps

**1. Get the code**
```bash
git clone https://github.com/codyalano09/Kalshi.git
cd Kalshi
```

**2. Install**
```bash
npm install
```

**3. Create a settings file named `.env.local`** in the project folder, containing these 3 lines
(change the secret to any long random text; make one with `openssl rand -hex 16`, or just mash the keyboard):
```
KALSHI_ENV=demo
DRY_RUN=true
CRON_SECRET=put-a-long-random-text-here
```
On Mac/Linux you can create it in one go:
```bash
printf 'KALSHI_ENV=demo\nDRY_RUN=true\nCRON_SECRET=%s\n' "$(openssl rand -hex 16)" > .env.local
```

**4. Start the dashboard** (leave this terminal open)
```bash
npm run dev
```
Open http://localhost:3000 in your browser.

**5. Start the bot** in a **second** terminal, in the same folder
```bash
npm run bot
```
It checks the market once a minute and prints a line each time. Stop either one with `Ctrl+C`.

## How to read the dashboard
- **Live market right now**: Bitcoin's price vs. the price Kalshi is comparing against (the "strike"), the countdown, and the current Kalshi prices.
- **Signal**
  - **BUY**: the bot sees a good bet that Bitcoin finishes *above* the strike
  - **SELL**: a good bet that it finishes *below* the strike
  - **HOLD**: no good bet. This is the usual answer, since it only looks in the last 5 minutes of each 15-minute window.
- **Why**: one line explaining the decision.

## Good to know
- Signals only appear while the bot is running, so keep both terminals open (and the computer awake).
- This is information, not financial advice. It is untested against real results, and most people lose money trading these markets.
- Trading for real needs a Kalshi account, an API key, and turning off the safety setting. Don't do that without understanding the risks and the fees; start with the Kalshi demo account.

## Something wrong?
- `npm: command not found` → install Node.js (above) and reopen the terminal.
- Dashboard says "Live feed error" → check your internet connection, then refresh.
- Bot says `request failed` → the dashboard (step 4) isn't running.
- Bot says `unauthorized` → `CRON_SECRET` in `.env.local` is missing. Restart both terminals after editing it.
