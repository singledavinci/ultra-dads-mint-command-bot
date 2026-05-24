# Ultra Dads Mint Command Bot

Standalone Telegram bot for **manual mint, drop mint, block mint, link mint, wallets, and admin**.

## What this bot does

- `/mint`, `/custommint`, `/dropmint`, `/blockmint`
- Contract / link mint flows, SeaDrop, gas and inclusion settings
- Optional web dashboard (`public/` + Express static)

## What this bot does not do

- Whale tracker listener or automint pipeline (use **copy-mint-bot** repo)

## Railway

1. New project → **Deploy from GitHub** → this repo.
2. Start command: `npm start`.
3. Health check path: `/health/mint-command`.
4. Use **mint-dedicated RPC URLs** (no tracker WebSocket required unless you enable detection).

## Telegram

1. Separate BotFather bot (e.g. `@YourMintCommandBot`).
2. Set `MINT_BOT_TOKEN` in Railway.
3. Once: `npm run register`.

## Local

```bash
cp .env.example .env
npm install
npm start
```
