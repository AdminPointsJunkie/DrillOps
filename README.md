# DrillOps — Field Operations App

A private web application for importing, viewing, and analysing daily drilling reports.

## Architecture

```
DrillOps/
├── backend/          ← FastAPI + SQLite (deploy to Render)
│   ├── main.py
│   ├── requirements.txt
│   └── render.yaml
└── frontend/         ← Static HTML/JS (deploy to GitHub Pages)
    └── index.html
```

---

## Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/DrillOps.git
git push -u origin main
```

---

## Step 2 — Deploy Backend to Render (free)

1. Go to [render.com](https://render.com) and sign up with GitHub
2. Click **New → Web Service**
3. Connect your `DrillOps` repo
4. Set these settings:
   - **Name:** `drillops-api`
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free
5. Click **Create Web Service**
6. Your API will be live at `https://drillops-api.onrender.com`

> ⚠️ Free Render instances spin down after 15 mins of inactivity.
> Upgrade to the $7/month "Starter" plan to keep it always-on.

---

## Step 3 — Deploy Frontend to GitHub Pages

1. In your GitHub repo, go to **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`, Folder: `/frontend`
4. Click **Save**
5. Your app will be live at `https://YOUR_USERNAME.github.io/DrillOps/`

---

## Step 4 — Make it Private

GitHub Pages on private repos requires **GitHub Pro** ($4/month).

**Free alternative — Cloudflare Access:**
1. Add your site to [Cloudflare](https://one.cloudflare.com) (free for up to 50 users)
2. Create an Access policy with an email allowlist — only your team can get in

---

## Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
# → http://localhost:8000

# Frontend
python -m http.server 3000 --directory frontend
# → http://localhost:3000
```

---

## Database Notes

SQLite is stored at the path set by the `DB_PATH` env var on Render.
Free tier disk resets on redeploy — add a **Render Persistent Disk** ($1/month) for production.
