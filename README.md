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
| Home / Downloader | `/` (`public/index.html`) | Link paste → quality chuno → download. Qualities server se dynamic aati hain (size + 4K badge samet) |
| Share / Download page | `/download.html?url=VIDEO_LINK&quality=720` | Direct shareable download link — khulte hi auto-download shuru. `&quality=2160\|1440\|1080\|720\|480\|360\|best\|audio`, `&auto=0` se auto-start band, `&api=` se alag server |

Dono pages same backend API use karte hain. Agar frontend alag host (jaise GitHub Pages) par hai to page me **⚙️ API setting** me backend URL save karo, ya link me `?api=https://aapka-server.com` jodo.

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

## ☁️ Deploy (public backend ke liye)

`PORT` env se port set hota hai (default `3000`).

- **Render / Railway / VPS:** repo push karo → `npm install` → `npm start` → mile hue public URL ko frontend ki API setting me daalo.
- **GitHub Pages (frontend only):** `public/` folder host karo, aur `index.html` / `download.html` me `?api=YOUR_BACKEND_URL` use karo (backend bina download kaam nahi karega — yt-dlp + ffmpeg server par chalta hai).

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
