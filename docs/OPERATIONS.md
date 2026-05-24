# Split into two repositories

Use this guide when you want **separate GitHub repos**, **separate Railway projects**, **separate Telegram bots**, and **separate RPC providers** — not just two services from one repo.

## Overview

| | Copy mint repo | Mint command repo |
|---|----------------|-------------------|
| **GitHub** | `ultra-dads-copy-mint-bot` | `ultra-dads-mint-command-bot` |
| **Telegram** | BotFather bot A (`COPY_BOT_TOKEN`) | BotFather bot B (`MINT_BOT_TOKEN`) |
| **Railway** | New project, deploy repo A | New project, deploy repo B |
| **RPC** | Tracker WS + execution HTTP (high volume) | Mint/simulation HTTP (no tracker WS) |
| **MongoDB** | Own DB recommended (can share cluster) | Own DB recommended |
| **Health** | `/health/copy-mint` | `/health/mint-command` |

The monorepo remains the **development source**. Export fresh standalone trees when you ship shared engine fixes to both bots.

## Step 1 — Export standalone folders

From this repository (on `main` or your feature branch):

```bash
npm run export:repos
```

Output:

- `standalone/ultra-dads-copy-mint-bot/`
- `standalone/ultra-dads-mint-command-bot/`

Each folder is a complete Node project (`package.json`, `src/`, `tests/`, `railway.json`, `.env.example`).

## Step 2 — Create two GitHub repositories

1. GitHub → **New repository** → `ultra-dads-copy-mint-bot` (empty, no README).
2. Repeat → `ultra-dads-mint-command-bot`.

Push each export (see `standalone/*/PUSH_TO_NEW_REPO.md`):

```bash
cd standalone/ultra-dads-copy-mint-bot
git init && git add . && git commit -m "Initial copy-mint bot import"
git branch -M main
git remote add origin git@github.com:YOUR_ORG/ultra-dads-copy-mint-bot.git
git push -u origin main
```

```bash
cd standalone/ultra-dads-mint-command-bot
# same steps with mint repo remote
```

## Step 3 — Two Railway dashboards

### Copy mint project

1. **New Project** → **Deploy from GitHub** → `ultra-dads-copy-mint-bot`.
2. Variables: copy `deploy/copy-mint-bot/.env.example` → Railway Variables (real secrets only in Railway).
3. Required: `COPY_BOT_TOKEN`, `MNEMONIC`, `PERSONAL_ID`, `GROUP_ID`, `MONGODB_URI`, `API_SECRET`, tracker + execution RPC URLs.
4. Health check path: `/health/copy-mint` (set in `railway.json`).
5. Do **not** point this service at the mint bot’s token.

### Mint command project

1. **New Project** → **Deploy from GitHub** → `ultra-dads-mint-command-bot`.
2. Variables: `MINT_BOT_TOKEN`, shared or separate `MNEMONIC` / Mongo / RPC per your security model.
3. Health check path: `/health/mint-command`.
4. `ENABLE_PENDING_DETECTION=false` is fine — no whale listener on this service.

### Decommission monolith Railway service

After both bots are healthy, **stop or delete** the old single-service deploy that used one `BOT_TOKEN` for everything, to avoid double-polling and duplicate automints.

## Step 4 — Two Telegram bots

1. BotFather → `/newbot` → Copy mint bot → save token → `COPY_BOT_TOKEN` on Railway (copy project only).
2. BotFather → `/newbot` → Mint command bot → `MINT_BOT_TOKEN` on Railway (mint project only).
3. Register menus once per token (from your laptop with `.env`):

```bash
cd standalone/ultra-dads-copy-mint-bot && npm install && npm run register
cd standalone/ultra-dads-mint-command-bot && npm install && npm run register
```

## Step 5 — Separate RPC stacks

**Why:** Tracker pending traffic can saturate a shared endpoint and starve mint commands (or vice versa).

### Copy mint bot (high churn)

| Variable | Purpose |
|----------|---------|
| `TRACKER_WS_RPC_URL` | `eth_subscribe` pending / fast block hints |
| `TRACKER_RPC_URL` | Tracker HTTP (lookups, block fallback) |
| `EXECUTION_RPC_URL` | Automint `eth_sendRawTransaction` |
| `PROVIDER_URL` | Fallback if tracker URLs unset |

Use a provider plan that allows **high pending subscription volume** on the tracker URLs.

### Mint command bot (burst mints)

| Variable | Purpose |
|----------|---------|
| `PROVIDER_URL` | Simulation + broadcast for `/mint`, `/dropmint`, `/blockmint` |
| `EXECUTION_RPC_URL` | Optional dedicated send endpoint |

No `TRACKER_WS_RPC_URL` required unless you intentionally enable detection on this service.

## Step 6 — Database

**Recommended:** Two MongoDB databases (or two Railway Mongo plugins), one per bot, so schema migrations and load are isolated.

**Acceptable:** One cluster, two database names in the connection string (`/copy` vs `/mint`) if you accept shared failure domain.

Both bots can read the same `MNEMONIC` for HD wallets, or use different mnemonics for operational isolation (advanced).

## Step 7 — Verify

| Check | Copy repo | Mint repo |
|-------|-----------|-----------|
| Health URL | `ok`, `service: copy-mint-bot`, `walletTracker: running` | `service: mint-command-bot`, tracker stopped |
| Telegram menu | `/track`, no `/blockmint` | `/blockmint`, no `/track` |
| Logs | `[Tracker] Boot audit` | `[Tracker] Skipped` |
| RPC | Tracker WS connected | Mint RPC only |

## Keeping both repos in sync

1. Fix shared logic in the **monorepo** (`src/engine`, `src/services`, `src/contractMint`).
2. Run `npm run export:repos`.
3. Copy or merge into each GitHub repo (or push export as a commit).
4. Deploy both Railway projects.

Longer term: extract `src/engine` + `src/services` into a private npm package (`@your-org/ultra-dads-core`) consumed by both repos — less duplication, more setup.

## Monorepo vs two repos

| Approach | Pros | Cons |
|----------|------|------|
| **Two services, one repo** (`start:copy` / `start:mint`) | One PR, one CI | Shared Railway project confusion, one git history |
| **Two repos (this guide)** | Clear ownership, separate RPC/secrets/scale | Duplicate `src/` unless you use a shared package |

You asked for **different repos** — use the export script and two Railway projects as above.
