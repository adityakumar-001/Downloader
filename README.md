# 📥 Universal Video Downloader (4K Video + Audio)

Paste a link — download **merged video + audio MP4 up to 4K**.
No login. No length limit. 100% free. UI in English with **real-time download progress + file size**.

- 🎬 Qualities: `2160p 4K` · `1440p 2K` · `1080p` · `720p` · `480p` · `360p` · `Best (up to 4K)` · `Audio MP3`
- 🔊 Every video quality comes **merged with audio** (never a silent video)
- 📊 Real-time progress: live `%`, `downloaded / total size (MB/GB)`, `speed`, `ETA`, plus `Merging…` and `Saving…` phases
- ⚡ Best Merge: highest-bitrate streams, MP4-first, `faststart` + embedded metadata
- 🌐 Supported: YouTube, Instagram, Facebook, TikTok, X/Twitter, Vimeo, Dailymotion (+ direct `.mp4` links)
- 🔗 Playlist/Mix links (`&list=...&index=...`) auto-clean to a single-video download

## 🖥️ Pages (linked to the Download API)

| Page | URL | Purpose |
|------|-----|------|
| Home / Downloader | `/` (`docs/index.html`) | Paste link → pick quality → download. Qualities load dynamically from the server (with size + 4K badge). Progress is live with size/speed/ETA. |
| Share / Download page | `/download.html?url=VIDEO_LINK&quality=720` | Direct shareable download link — auto-starts on open. `&quality=2160\|1440\|1080\|720\|480\|360\|best\|audio`, `&auto=0` disables auto-start, `&api=` overrides the server |

Both pages use the same backend API — **the API is built in, users configure nothing.**
The owner only sets `window.VD_DEFAULT_API = "https://your-server.onrender.com"` once in `docs/config.js`. Every visitor then auto-connects (same-origin → DEFAULT → fallback). `?api=` remains only as a share-link override.

## 🚀 Quick Start (Windows)

```bat
start.bat
```

Then open in your browser: **http://localhost:3000**

Manual:

```bash
npm install
npm start
```

> Requires Node.js LTS: https://nodejs.org

## 🌍 Make a website link (GitHub Pages) — step by step

Sending the repo link alone does **not** open the website — first enable Pages:

1. Open your repo on GitHub → **Settings** (top tabs) → **Pages** (left menu).
2. Under **Build and deployment**: Source = **Deploy from a branch**.
3. Branch = **main** (or `master`), folder = **`/docs`** → press **Save**.
4. Wait 1–2 min. Then the site opens at: **`https://USERNAME.github.io/REPO-NAME/`**
   (USERNAME = your GitHub username, REPO-NAME = repo name).
5. Send that link to anyone — the **Universal Video Downloader** website opens with the same features.

> ⚠️ **Important:** GitHub Pages hosts **only the website** (frontend). The actual **download** runs on the backend (`server.js` + yt-dlp + ffmpeg), which must be deployed separately (see below). Without a backend the page opens but downloads fail — the page shows a hint.

## ☁️ Deploy the backend (needed for downloads — free on Render)

1. Create a free account at https://render.com → **New +** → **Web Service** → connect your GitHub repo.
2. Settings: **Build Command** = `npm install`, **Start Command** = `npm start`. (Render provides PORT itself — the code supports it.)
3. After deploy you get a URL like `https://video-downloader-xyz.onrender.com`.
4. Connect the website to the backend — **just 1 line (built-in, users do nothing):**
   Open `docs/config.js` and set: `window.VD_DEFAULT_API = "https://video-downloader-xyz.onrender.com";`
   Save + commit + push. Done — every visitor auto-connects, no ⚙️ settings.

`PORT` sets the port via env (default `3000`). Same on Railway/VPS: `npm install` → `npm start`.

## 🔌 API Docs

### `GET /api/health`

```bash
curl http://localhost:3000/api/health
# {"ok":true,"message":"Server is running. No login required."}
```

### `POST /api/info` — title, thumbnail, duration, real qualities + size

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

### `POST /api/download-start` — start a progress-tracked job (recommended)

```bash
curl -X POST http://localhost:3000/api/download-start \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=lDbItmGvzDM","quality":"720"}'
# {"jobId":"job_...","estimatedSize":12345678,"estimatedSizeText":"11.8 MB"}
```

### `GET /api/progress?jobId=...` — real-time progress with size

```bash
curl "http://localhost:3000/api/progress?jobId=job_..."
# {"jobId":"job_...","status":"downloading","percent":45.2,
#  "downloadedBytes":5612311,"totalBytes":12345678,
#  "downloadedText":"5.4 MB","totalText":"11.8 MB",
#  "speed":"1.2 MB/s","eta":"00:05","detail":"Downloading...","filename":"..."}
```

`status`: `starting` → `downloading` → `merging` → `ready` (or `error`).

### `GET /api/file?jobId=...` — download the finished file

```bash
curl -L "http://localhost:3000/api/file?jobId=job_..." -o video.mp4
```

Headers: `Content-Disposition` (correct filename), `Content-Type` (`video/mp4` / `audio/mpeg`), `Content-Length` (exact size for the progress bar).

### `GET /api/download?url=...&quality=...` — classic single-shot file download (merged MP4 / MP3)

```bash
curl -L "http://localhost:3000/api/download?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DlDbItmGvzDM&quality=720" -o video.mp4
```

| `quality` | Meaning |
|-----------|--------|
| `best` | Best available (up to 4K), video+audio merged |
| `2160` / `4k` | 4K Ultra HD (if available), video+audio merged |
| `1440` / `2k` | 2K Quad HD, video+audio merged |
| `1080` / `720` / `480` / `360` | Best up to that height, video+audio merged |
| `audio` / `mp3` | Audio only, MP3 (best quality) |

Headers: `Content-Disposition` (correct filename), `Content-Type` (`video/mp4` / `audio/mpeg`).

### `POST /api/cookies` — private / login-protected videos (🔑 cookies)

Only videos visible to **your account** will open. Steps:

```bash
curl -X POST http://localhost:3000/api/cookies \
  -H "Content-Type: application/json" \
  -d @cookies.txt
# {"token":"...","expiresIn":1800}
```

1. In Chrome/Edge, export your `youtube.com` cookies with the **"Get cookies.txt LOCALLY"** extension.
2. On the website, attach that `.txt` file in the **🔑 Private / login-protected video?** section (token valid 30 min, then auto-deleted).
3. Then paste the link — the token is added to `info`/`download` automatically.

> ⚠️ Don't open someone else's private videos without permission. If a share link contains a token (`&ct=`), don't send it to anyone.

## 🧠 How it works

```
Browser (index.html / download.html)
   --fetch /api/*--> server.js (Express)
   --yt-dlp + ffmpeg--> merged MP4/MP3 --> browser download
```

- New flow with live progress: `POST /api/download-start` → poll `GET /api/progress` (yt-dlp output parsed live: %, MB/GB downloaded/total, speed, ETA, merging state) → `GET /api/file` streams the finished file with `Content-Length`.
- Interrupted downloads auto-resume: partial files are kept (`--continue`), each retry re-extracts fresh format URLs, retries 10x with pauses, and YouTube retries also switch player client — a "few MBs then error" restarts from where it stopped instead of failing. Merge is stream-copy (remux) only, never re-encoded.
- YouTube links are normalized (`youtu.be`, `/shorts/`, `/embed/`, `music.youtube.com`, `&list=` cleanup).
- Format chain is MP4-first: `bestvideo[ext=mp4]+bestaudio[ext=m4a]` → fallback `bestvideo+bestaudio` (incl. 4K VP9/AV1), then ffmpeg merge (`faststart` + metadata).
- If merging fails, single-file fallback (`best[ext=mp4]/best`).
- The classic `GET /api/download` endpoint is kept for share links / curl.

## ⚠️ Notes

- Only **public** videos download without cookies. Login-protected ones need your own cookies.
- Only download your own or copyright-free videos.
- YouTube sometimes applies bot-checks (HTTP 429) — wait 1–2 min and retry.

## 📄 License

MIT — see [LICENSE](LICENSE).
