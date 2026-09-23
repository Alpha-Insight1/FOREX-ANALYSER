# Jaggy Analyser

Professional forex / gold / indices SMC scanner by **JAGGY**.

- Prop-firm mode: only high-conviction setups (confidence ≥ 85%)
- Markets separated: **Forex** · **Gold (XAU/USD)** · **Indices**
- Gold: 4H trend, 1m + 5m entry
- Indices: 4H + Daily trend, 5m / 15m / 30m entry
- Forex: 4H structure, 1H confirmation
- Trade book with live P/L, break-even at +2R
- Telegram TRADE TAKEN alerts (deduped)

## Deploy on Vercel (recommended)

1. Push this folder to a **new GitHub repository**.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import that repo.
3. Framework: **Vite** (auto-detected).
4. Add **Environment Variables** (Project → Settings → Environment Variables):

| Name | Value |
|------|--------|
| `APP_PASSWORD` | Your login password |
| `APP_ACCESS_SECRET` | Long random string (e.g. 32+ characters) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat id |

5. Deploy. Open the Vercel URL and sign in with `APP_PASSWORD`.

## Local development

```bash
npm install
npm run dev
```

## Notes

- Scanner API: `/api/forex-analysis` (Edge)
- Auth: `/api/auth-login`, `/api/auth-verify`
- Telegram: `/api/telegram-notify`
