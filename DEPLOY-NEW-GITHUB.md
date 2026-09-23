# Deploy as a brand-new GitHub project

## 1. Create a new repository on GitHub

1. Open https://github.com/new
2. Repository name: `JAGGY-ANALYSER` (or any name you like)
3. Public or Private
4. **Do not** add README / .gitignore / license (this zip already has files)
5. Click **Create repository**

## 2. Upload this project

### Option A — GitHub website (easiest)

1. On the empty repo page, click **uploading an existing file**
2. Drag **all files and folders** from this unzipped project into the browser
   (include `api/`, `src/`, `public/`, `package.json`, `vercel.json`, etc.)
3. Commit message: `Initial Jaggy Analyser deploy`
4. Click **Commit changes**

### Option B — Git on your PC

```bash
cd path/to/this-unzipped-folder
git init
git add .
git commit -m "Initial Jaggy Analyser deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 3. Connect Vercel

1. https://vercel.com → Add New → Project
2. Import the new GitHub repo
3. Framework Preset: Vite
4. Root Directory: `./` (default)
5. Add environment variables (see README.md)
6. Click **Deploy**

## 4. After deploy

1. Open the Vercel URL
2. Sign in with the password you set as `APP_PASSWORD`
3. Hard refresh (Ctrl+F5)

## Telegram (optional)

1. Talk to @BotFather → create bot → copy token → `TELEGRAM_BOT_TOKEN`
2. Get your chat id → `TELEGRAM_CHAT_ID`
3. Redeploy after saving env vars
4. In the app, use Telegram connect / test if available
