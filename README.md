# 📥 Video Downloader — Link Paste Karo, Download Karo

Sirf link paste karne se video download hota hai (Video + Audio ek saath 🔊).
- ✅ **Koi login nahi chahiye**
- ✅ **Video kitna bhi lamba ho** (10 sec ya 10 ghante — koi limit nahi)
- ✅ **100% Free**

## 🚀 Chalane ka tarika

**`start.bat`** par double-click karo, phir browser me kholo: **http://localhost:3000**

Ya terminal me:
```
npm start
```

(Pehli baar `npm install` ho chuka hai. Python install karne ki jarurat nahi hai.)

## 📱 Use kaise kare?

1. Kisi bhi app (YouTube, Instagram, TikTok, Facebook...) se video ka **Share → Copy Link** karo
2. Link **paste** karo, quality chuno, **Download Now** dabao — bas!
   (Title, duration aur andazan size MB/GB me khud dikhega, phir file save hogi.)

## 🔗 Code structure (connection)

```
Browser
  ↓  (khulta hai)
public/index.html  (HTML + CSS + JS)
  ↓  fetch()  POST /api/info , GET /api/download  (http://localhost:3000)
server.js  (Local Backend: Express)
  ↓  youtube-dl-exec
yt-dlp.exe + ffmpeg  (video + audio merge)
  ↑
  start.bat --(npm start)--> node server.js
```

## ✅ Kaunsi sites chalengi?

YouTube (video, Shorts, Music), Instagram (Reel, Post), Facebook, TikTok,
X/Twitter, Vimeo, Dailymotion, Reddit, Pinterest + 1000 aur sites (yt-dlp ki wajah se).

Note: Sirf **public videos** download honge. Private ya login wale videos nahi honge.
Sirf apne ya copyright-free videos download karo.

## 📁 Files

- `server.js` — Backend (Express + yt-dlp + ffmpeg, Video + Audio merged)
- `public/index.html` — Website (design + logic)
- `start.bat` — Double-click se server start karo
- `package.json` — Dependencies

## ⚙️ Port badalna ho to

```
set PORT=5000 && npm start
```
Phir kholo: http://localhost:5000
