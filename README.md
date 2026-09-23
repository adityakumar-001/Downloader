# 📥 Universal Video Downloader (4K Video + Audio)

Link paste karo — **4K tak Video + Audio merged MP4** download karo.
No login. No length limit. 100% free.

- 🎬 Qualities: `2160p 4K` · `1440p 2K` · `1080p` · `720p` · `480p` · `360p` · `Best (up to 4K)` · `Audio MP3`
- 🔊 Har video quality me **video + audio merged** milta hai (silent video nahi)
- ⚡ Best Merge: highest-bitrate streams, MP4-first, `faststart` + metadata embed
- 🌐 Supported: YouTube, Instagram, Facebook, TikTok, X/Twitter, Vimeo, Dailymotion (+ direct `.mp4` links)
- 🔗 Playlist/Mix links (`&list=...&index=...`) auto-clean hokar single video download hota hai

## 🖥️ Pages (Download API se linked)

| Page | URL | Kaam |
|------|-----|------|
| Home / Downloader | `/` (`docs/index.html`) | Link paste → quality chuno → download. Qualities server se dynamic aati hain (size + 4K badge samet) |
| Share / Download page | `/download.html?url=VIDEO_LINK&quality=720` | Direct shareable download link — khulte hi auto-download shuru. `&quality=2160\|1440\|1080\|720\|480\|360\|best\|audio`, `&auto=0` se auto-start band, `&api=` se alag server |

Dono pages same backend API use karte hain — **API in-build hai, user ko koi setting nahi karni.**
Owner (aap) sirf ek baar `docs/config.js` me `window.VD_DEFAULT_API = "https://aapka-server.onrender.com"` dalo. Uske baad har user auto-connect hoga (same-origin → DEFAULT → fallback). `?api=` sirf share-link override ke liye raha hai.

## 🚀 Quick Start (Windows)

```bat
start.bat
```

Phir browser me kholo: **http://localhost:3000**

Manual:

```bash
npm install
npm start
```

> Node.js LTS chahiye: https://nodejs.org

## 🌍 Website link banao (GitHub Pages) — step by step

Repo ka link bhejne se website **nahi** khulti — pehle Pages ON karna padta hai:

1. GitHub par apna repo kholo → **Settings** (upar tabs me) → **Pages** (left menu).
2. **Build and deployment** me: Source = **Deploy from a branch**.
3. Branch = **main** (ya `master`), folder = **`/docs`** → **Save** dabao.
4. 1–2 min ruko. Fir site khulegi: **`https://USERNAME.github.io/REPO-NAME/`**
   (USERNAME = tumhara GitHub username, REPO-NAME = repo ka naam).
5. Ye link kisi ko bhi bhejo — **Universal Video Downloader** website khulegi, same features ke saath.

> ⚠️ **Jaruri samajh:** GitHub Pages par **sirf website** (frontend) chalti hai. Asli **download** backend (`server.js` + yt-dlp + ffmpeg) se hota hai, jo alag deploy karna padta hai (neeche dekho). Backend bina page khulega par download nahi hoga — page khud hint dikhayega.

## ☁️ Backend deploy (download ke liye — Render free)

1. https://render.com par free account banao → **New +** → **Web Service** → apna GitHub repo connect karo.
2. Settings: **Build Command** = `npm install`, **Start Command** = `npm start`. (PORT Render khud deta hai — code me support hai.)
3. Deploy ke baad URL milega, jaise `https://video-downloader-xyz.onrender.com`.
4. Website ko backend se jodo — **sirf 1 line (in-build, user ko kuch nahi karna):**
   `docs/config.js` kholo aur dalo: `window.VD_DEFAULT_API = "https://video-downloader-xyz.onrender.com";`
   Save + commit + push. Bas — ab har visitor auto-connect hoga, koi ⚙️ setting nahi.

`PORT` env se port set hota hai (default `3000`). Railway/VPS par bhi same: `npm install` → `npm start`.

## 🔌 API Docs

### `GET /api/health`

```bash
curl http://localhost:3000/api/health
# {"ok":true,"message":"Server chal raha hai. No login chahiye."}
```

### `POST /api/info` — title, thumbnail, duration, asli qualities + size

```bash
curl -X POST http://localhost:3000/api/info \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=lDbItmGvzDM&list=RDTnfs0MZsBBE&index=7"}'
```

Response (short):

```json
{
  "title": "BABAM BAM (Full Song)...",
  "thumbnail": "https://i.ytimg.com/...",
  "durationText": "2:17",
  "uploader": "T-Series",
  "maxHeight": 1080,
  "qualities": [
    { "id": "best", "label": "Best Quality ⭐ (up to 4K) • ~11.5 MB" },
    { "id": "1080", "label": "1080p Full HD • ~..." },
    { "id": "audio", "label": "Audio only (MP3)" }
  ]
}
```

### `GET /api/download?url=...&quality=...` — file download (merged MP4 / MP3)

```bash
curl -L "http://localhost:3000/api/download?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DlDbItmGvzDM&quality=720" -o video.mp4
```

| `quality` | Matlab |
|-----------|--------|
| `best` | Best available (up to 4K), video+audio merged |
| `2160` / `4k` | 4K Ultra HD (available ho to), video+audio merged |
| `1440` / `2k` | 2K Quad HD, video+audio merged |
| `1080` / `720` / `480` / `360` | Us height tak best video+audio merged |
| `audio` / `mp3` | Audio only, MP3 (best quality) |

Headers: `Content-Disposition` (sahi filename), `Content-Type` (`video/mp4` / `audio/mpeg`).

## 🧠 How it works

```
Browser (index.html / download.html)
   --fetch /api/*--> server.js (Express)
   --yt-dlp + ffmpeg--> merged MP4/MP3 --> browser download
```

- YouTube links normalize hote hain (`youtu.be`, `/shorts/`, `/embed/`, `music.youtube.com`, `&list=` cleanup).
- Format chain MP4-first hai: `bestvideo[ext=mp4]+bestaudio[ext=m4a]` → fallback `bestvideo+bestaudio` (4K VP9/AV1 samet), phir ffmpeg merge (`faststart` + metadata).
- Merge fail ho to single-file fallback (`best[ext=mp4]/best`).

## ⚠️ Note

- Sirf **public** videos download hote hain. Private/login wale nahi honge.
- Sirf apne ya copyright-free videos download karo.
- YouTube kabhi-kabhi bot-check (HTTP 429) lagata hai — 1–2 min ruk kar retry karo.

## 📄 License

MIT — dekho [LICENSE](LICENSE).
