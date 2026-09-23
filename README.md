# CleanKart – House Help Booking App (Hyderabad)

Modern PWA for booking house cleaning, dishwashing, ironing & more in Hyderabad.

## Features
- Customer + Helper roles
- OTP login (SMS-style)
- Book services, accept jobs, ratings
- Dark / Light mode
- Installable on Android & iOS (PWA)

## Run Locally
```bash
node server.js
```
Open http://localhost:3000

### Demo Accounts
| Role     | Phone      |
|----------|------------|
| Customer | 9876543210 |
| Helper   | 9123456789 |

(OTP will appear on screen in demo mode)

---

## Deploy Free (Public Link)

### Option A – Render.com (Recommended, easiest)

1. Go to https://render.com and sign up (free)
2. Click **New +** → **Web Service**
3. Connect your GitHub repo (or upload the `cleankart` folder)
4. Settings:
   - **Name**: cleankart
   - **Runtime**: Node
   - **Build Command**: leave empty (or `echo "no build"`)
   - **Start Command**: `node server.js`
   - **Instance Type**: Free
5. Click **Create Web Service**
6. Wait 1–2 minutes → you get a public URL like `https://cleankart-xxxx.onrender.com`

Anyone can open that link on phone and install the app.

### Option B – Railway.app
1. Go to https://railway.app
2. New Project → Deploy from GitHub / local folder
3. It auto-detects Node and runs `node server.js`
4. You get a public URL

---

## After Deploy
- Share the public URL with customers & helpers
- They open it in Chrome (Android) or Safari (iPhone)
- Tap **Install App** / **Add to Home Screen**
- App icon appears on their phone

## Tech
- Pure Node.js (zero dependencies)
- PWA (manifest + service worker)
- JSON file database
