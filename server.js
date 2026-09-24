// Video Downloader Server - No login, No length limit
// Just paste a link and download the video (video + audio merged)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');

// Resolve the yt-dlp binary (works on Windows .exe and Linux/macOS)
let YT_DLP_PATH = null;
try {
  const c = require('youtube-dl-exec/src/constants');
  if (c && c.YOUTUBE_DL_PATH) YT_DLP_PATH = c.YOUTUBE_DL_PATH;
} catch { /* ignore */ }
if (!YT_DLP_PATH || !fs.existsSync(YT_DLP_PATH)) {
  const candidates = [
    path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'),
    path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) { YT_DLP_PATH = p; break; }
  }
}

console.log('ffmpeg:', ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'docs')));

// Is the URL valid?
function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Is it a direct video/audio file? (.mp4, .mp3 ...)
function isDirectFile(url) {
  return /\.(mp4|webm|mkv|mov|m4a|mp3|wav|ogg|flv|avi)(\?|#|$)/i.test(url);
}

// Normalize a YouTube link to a single-video URL.
// Example: watch?v=ID&list=...&index=7  ->  watch?v=ID
// This avoids extra playlist/Mix (RD...) tab extraction and
// always downloads the exact video the user opened.
// youtu.be/ID, /shorts/ID, /embed/ID, /live/ID, music.youtube.com supported.
function normalizeUrl(raw) {
  try {
    const str = String(raw || '').trim();
    const u = new URL(str);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const isYT =
      host === 'youtube.com' || host === 'm.youtube.com' ||
      host === 'music.youtube.com' || host === 'youtu.be' ||
      host.endsWith('.youtube.com');
    if (!isYT) return str;

    // youtu.be/VIDEOID
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{6,}$/.test(id)) {
        return 'https://www.youtube.com/watch?v=' + id;
      }
      return str;
    }

    // /shorts/ID, /embed/ID, /live/ID, /v/ID
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([a-zA-Z0-9_-]{6,})/);
    if (m) {
      return 'https://www.youtube.com/watch?v=' + m[2];
    }

    // Normal watch URL: sirf v (aur t-time) rakho, list/index hatao
    const vid = u.searchParams.get('v');
    if (vid && /^[a-zA-Z0-9_-]{6,}$/.test(vid)) {
      const t = u.searchParams.get('t') || u.searchParams.get('start');
      return 'https://www.youtube.com/watch?v=' + vid + (t ? '&t=' + encodeURIComponent(t) : '');
    }
    return str;
  } catch {
    return String(raw || '').trim();
  }
}

// Common yt-dlp options (used on every call)
// NOTE: do not override player_client — in YouTube's SABR experiment the
// android client has missing https URLs and quality gets capped at 360p.
// yt-dlp's default clients (web/visionos/m3u8 fallback) give the best result.
function baseYtDlpOpts(extra) {
  return Object.assign({
    noCheckCertificates: true,
    noWarnings: true,
    noPlaylist: true,
    // Node ko JS runtime banao (yt-dlp ka "No supported JavaScript runtime" warning fix)
    jsRuntimes: 'node',
    // Strong retry profile: YouTube throttles fragments (403/slowdowns), so
    // retry patiently instead of failing after a few MBs.
    retries: 10,
    fragmentRetries: 10,
    retrySleep: 'fragment:5',
    // Resume partial files: a dropped connection continues where it stopped
    // instead of restarting from zero (or failing outright).
    continue: true,
    socketTimeout: 30,
  }, extra || {});
}

// Is it a YouTube URL? (fallback only applies to YouTube)
function isYouTubeUrl(u) {
  try {
    const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    return h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com');
  } catch { return false; }
}

// Server-IP block / extraction failure? (retry with an alternate player client on these)
function isBlockError(msg) {
  return /sign in to confirm|not a bot|429|too many requests|403|failed to extract|unable to extract|player response|nsig|throttl|po.?token|did not get video|unable to download api|http error/i.test(String(msg || ''));
}

// Only server-side allowlisted clients (never put raw user input into
// extractorArgs — protects against CLI injection)
const CLIENT_ARGS = {
  android: 'youtube:player_client=android',
};
function clientArgsFor(id, url) {
  if (id === 'android' && isYouTubeUrl(url)) return { extractorArgs: CLIENT_ARGS.android };
  return {};
}

// Extract info: default client first, android fallback on blocks.
// Returns { info, client } — downloads must reuse the same client.
async function fetchInfoWithFallback(normUrl, ckFile) {
  const yt = isYouTubeUrl(normUrl);
  const ids = yt ? [null, 'android'] : [null];
  let lastErr = null, info = null, usedClient = null;
  for (const id of ids) {
    try {
      info = await youtubedl(normUrl, baseYtDlpOpts({
        dumpSingleJson: true,
        skipDownload: true,
        ...(ckFile ? { cookies: ckFile } : {}),
        ...clientArgsFor(id, normUrl),
      }));
      usedClient = id;
      break;
    } catch (e) {
      lastErr = e;
      const m = String((e && (e.stderr || e.message)) || '');
      if (!isBlockError(m)) break; // real error (private/deleted/unsupported) — retrying is useless
    }
  }
  if (!info) throw lastErr;
  return { info, client: usedClient };
}

// Build a safe filename
function safeFilename(name, ext) {
  let base = (name || 'video').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 100);
  if (!base) base = 'video';
  if (ext && !base.toLowerCase().endsWith(ext.toLowerCase())) base += ext;
  return base;
}

// Quality -> yt-dlp format string (Best Merge: highest-bitrate video+audio, up to 4K)
// Video+audio is ALWAYS requested so the result never comes out silent.
// MP4 (H264+AAC) is preferred first so it plays everywhere,
// then fallback VP9/AV1+Opus (most 4K is in these) -> merged to MP4 via ffmpeg.
// No length limit - 10 seconds or 10 hours, everything works.
function qualityToFormat(q) {
  const chain = (h) => h
    ? `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/bestvideo+bestaudio/best`
    : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
  switch (q) {
    case '2160':
    case '4k':
      return chain(2160);
    case '1440':
    case '2k':
      return chain(1440);
    case '1080':
      return chain(1080);
    case '480':
      return chain(480);
    case '360':
      return chain(360);
    case 'audio':
    case 'mp3':
      return 'bestaudio[ext=m4a]/bestaudio/best';
    case 'best':
      return chain(0);
    case '720':
    default:
      return chain(720);
  }
}

// Fallback format when merging fails: single progressive file that ALREADY
// contains audio — but still capped at the REQUESTED height so a 4K/1080p
// choice never silently degrades to 720p/360p. Stream-copy only, no re-encode.
function fallbackFormat(q) {
  if (q === 'audio' || q === 'mp3') return 'bestaudio/best';
  const H = { '2160': 2160, '4k': 2160, '1440': 1440, '2k': 1440 }[q]
    || parseInt(q, 10) || 0;
  return H
    ? `best[height<=${H}][ext=mp4]/best[height<=${H}]/best[ext=mp4]/best`
    : 'best[ext=mp4]/best';
}

// Temp folder (files download here first for merging, then stream to the user)
const TMP_DIR = path.join(__dirname, 'temp');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch { /* ignore */ }

function tmpBase() {
  return path.join(TMP_DIR, 'dl_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex'));
}

function cleanupFiles(base) {
  try {
    const dir = path.dirname(base);
    const prefix = path.basename(base);
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

// ---- Cookie sessions (for private / login-protected YouTube videos) ----
// The user sends a cookies.txt exported from their browser (Netscape format).
// Only videos visible to THAT account can be accessed.
// Tokens stay valid for 30 min, then the file is auto-deleted. Cookie contents are never logged.
const cookieSessions = new Map();
const COOKIE_TTL = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [tok, s] of cookieSessions) {
    if (s.exp <= now) {
      try { fs.unlinkSync(s.file); } catch { /* ignore */ }
      cookieSessions.delete(tok);
    }
  }
}, 5 * 60 * 1000).unref();

function saveCookies(content) {
  const text = String(content || '');
  if (text.length < 20 || text.length > 200000) return null;
  if (!/youtube\.com|youtu\.be|google\.com|#\s*Netscape/i.test(text)) return null;
  const token = crypto.randomBytes(16).toString('hex');
  const file = path.join(TMP_DIR, 'ck_' + token + '.txt');
  fs.writeFileSync(file, text, 'utf8');
  cookieSessions.set(token, { file, exp: Date.now() + COOKIE_TTL });
  return token;
}

function resolveCookies(token) {
  if (!token) return { file: null, invalid: false };
  const key = String(token);
  const s = cookieSessions.get(key);
  if (!s || s.exp <= Date.now()) {
    if (s) { try { fs.unlinkSync(s.file); } catch { /* ignore */ } cookieSessions.delete(key); }
    return { file: null, invalid: true };
  }
  return { file: s.file, invalid: false };
}

function bestQuality(q) {
  const map = { '2160': '2160p', '4k': '2160p', '1440': '1440p', '2k': '1440p', '1080': '1080p', '720': '720p', '480': '480p', '360': '360p', 'audio': 'audio', 'mp3': 'audio', 'best': 'best' };
  return map[q] || 'best';
}

// Show bytes as MB/GB
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return null;
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function fsize(f) {
  return f.filesize || f.filesize_approx || 0;
}

// Estimated file size for a quality (video+audio merged total)
function estimateSize(formats, q) {
  if (!Array.isArray(formats) || !formats.length) return 0;
  if (q === 'audio' || q === 'mp3') {
    let best = 0;
    for (const f of formats) {
      if ((!f.height || f.vcodec === 'none') && f.acodec !== 'none') {
        best = Math.max(best, fsize(f));
      }
    }
    return best;
  }
  const H = q === 'best' ? Infinity : parseInt(q, 10) || 720;
  let bestV = 0, bestA = 0, bestCombined = 0;
  for (const f of formats) {
    const s = fsize(f);
    const hasV = f.vcodec && f.vcodec !== 'none';
    const hasA = f.acodec && f.acodec !== 'none';
    const h = f.height || 0;
    if (hasV && hasA && h <= H) bestCombined = Math.max(bestCombined, s);
    if (hasV && !hasA && h <= H && h > 0) bestV = Math.max(bestV, s);
    if (!hasV && hasA) bestA = Math.max(bestA, s);
  }
  return Math.max(bestCombined, bestV + bestA);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Server is running. No login required.' });
});

// ---- Cookie upload (for private / login-protected videos) ----
// Body: { content: "<full text of cookies.txt>" } -> { token, expiresIn }
// Send the token as {cookiesToken} to /api/info and ?cookiesToken= to /api/download.
app.post('/api/cookies', (req, res) => {
  try {
    const token = saveCookies((req.body || {}).content);
    if (!token) {
      return res.status(400).json({ error: 'Please provide a valid cookies.txt file (export youtube.com cookies with a browser extension and paste the full text).' });
    }
    res.json({ token, expiresIn: COOKIE_TTL / 1000 });
  } catch (e) {
    res.status(500).json({ error: 'Could not save cookies.' });
  }
});

// ---- STEP 1: Get link info (title, thumbnail, duration) ----
app.post('/api/info', async (req, res) => {
  try {
    const { url, cookiesToken } = req.body || {};
    if (!url || !isValidUrl(url)) {
      return res.status(400).json({ error: 'Please paste a valid video link (https://...)' });
    }
    const ck = resolveCookies(cookiesToken);
    if (ck.invalid) {
      return res.status(400).json({ error: '🔑 Cookies have expired (30 min limit). Please upload cookies.txt again.' });
    }

    // Direct .mp4 link needs no yt-dlp (get size via HEAD)
    if (isDirectFile(url)) {
      const name = url.split('/').pop().split('?')[0] || 'video.mp4';
      let sizeText = null, size = null;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const head = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
        clearTimeout(t);
        const len = parseInt(head.headers.get('content-length') || '0', 10);
        if (len > 0) { size = len; sizeText = formatBytes(len); }
      } catch { /* size stays unknown */ }
      const qlabel = sizeText ? `Original Quality • ~${sizeText}` : 'Original Quality';
      return res.json({
        direct: true,
        client: null,
        title: name,
        thumbnail: null,
        duration: null,
        durationText: 'Direct file',
        uploader: null,
        qualities: [
          { id: 'best', label: qlabel, size, sizeText },
          { id: 'audio', label: 'Audio only (MP3)', size: null, sizeText: null },
        ],
      });
    }

    const { info, client: usedClient } = await fetchInfoWithFallback(normalizeUrl(url), ck.file);

    // Duration: no limit, just display it
    let durationText = 'Live / Unknown';
    if (info.duration) {
      const s = Math.floor(info.duration);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      durationText = h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${m}:${String(sec).padStart(2, '0')}`;
    } else if (info.is_live) {
      durationText = 'LIVE';
    }

    let thumbnail = null;
    if (info.thumbnail) thumbnail = info.thumbnail;
    else if (Array.isArray(info.thumbnails) && info.thumbnails.length) {
      thumbnail = info.thumbnails[info.thumbnails.length - 1].url;
    }

    // Detect which qualities are available from the formats
    const heights = new Set();
    if (Array.isArray(info.formats)) {
      for (const f of info.formats) {
        if (f.height && f.vcodec !== 'none') heights.add(f.height);
      }
    }
    const qdefs = [{ id: 'best', label: 'Best Quality ⭐ (up to 4K)' }];
    for (const h of [2160, 1440, 1080, 720, 480, 360]) {
      if ([...heights].some((x) => x >= h - 60)) {
        const name = h === 2160 ? '2160p 4K Ultra HD'
          : h === 1440 ? '1440p 2K Quad HD'
          : h === 1080 ? '1080p Full HD'
          : h === 720 ? '720p HD' : h + 'p';
        qdefs.push({ id: String(h), label: name });
      }
    }
    // If formats reveal nothing, offer standard options (including 4K)
    if (qdefs.length <= 1) {
      qdefs.push(
        { id: '2160', label: '2160p 4K Ultra HD' },
        { id: '1440', label: '1440p 2K Quad HD' },
        { id: '1080', label: '1080p Full HD' },
        { id: '720', label: '720p HD' },
        { id: '480', label: '480p' },
        { id: '360', label: '360p' },
      );
    }
    qdefs.push({ id: 'audio', label: 'Audio only (MP3)' });

    // Attach an estimated size (MB/GB) to every quality
    const qualities = qdefs.map((q) => {
      const bytes = estimateSize(info.formats, q.id);
      const sizeText = formatBytes(bytes);
      return {
        id: q.id,
        label: sizeText ? `${q.label} • ~${sizeText}` : q.label,
        size: bytes || null,
        sizeText: sizeText || null,
      };
    });

    res.json({
      direct: false,
      client: usedClient || null,
      title: info.title || 'Untitled Video',
      thumbnail,
      duration: info.duration || null,
      durationText,
      uploader: info.uploader || info.channel || null,
      webpage: info.webpage_url || url,
      maxHeight: heights.size ? Math.max(...heights) : null,
      qualities,
    });
  } catch (e) {
    console.error('INFO ERROR:', e.message);
    const msg = String((e && (e.stderr || e.message)) || '');
    if (/private video/i.test(msg)) {
      return res.status(400).json({ error: 'This video is private. 🔑 Add cookies from your YouTube account — only videos visible to your account will open.' });
    }
    if (/members.only|join this channel|channel membership/i.test(msg)) {
      return res.status(400).json({ error: 'This video is for channel MEMBERS only. Add 🔑 cookies from a member account to open it.' });
    }
    if (/confirm your age|age.restrict|age.gate/i.test(msg)) {
      return res.status(400).json({ error: 'This video is age-restricted (18+). Add 🔑 cookies from an adult YouTube account.' });
    }
    if (/unavailable|deleted|has been removed|not available/i.test(msg)) {
      return res.status(400).json({ error: 'This video is not available on YouTube (it may be deleted, private, or region-blocked). Please check the link.' });
    }
    if (/login required|log in to confirm|please log in/i.test(msg)) {
      return res.status(400).json({ error: 'This video requires login. 🔑 Add cookies from your YouTube account.' });
    }
    if (isBlockError(msg)) {
      return res.status(502).json({ error: 'YouTube blocked this request (server IP bot-check, alternate method also failed). Wait 1-2 minutes and retry, or 🔑 add your cookies — that usually works instantly.' });
    }
    if (msg.includes('Unsupported URL') || msg.includes('not a valid URL')) {
      return res.status(400).json({ error: 'This link is not supported. Try a public link from YouTube, Instagram, Facebook, TikTok, X, Vimeo, or Dailymotion.' });
    }
    res.status(500).json({ error: 'Could not fetch video info. Check the link and try again. (If it is a YouTube link that keeps failing, try adding your 🔑 cookies.txt.)' });
  }
});

// ---- STEP 2: Real-time download jobs (server-side progress + size) ----
// Flow: POST /api/download-start -> { jobId } -> poll GET /api/progress?jobId
// -> when ready, GET /api/file?jobId to save the file.
// This gives REAL-TIME progress (yt-dlp output parsed live) with size,
// instead of a stuck bar while the server works.
const downloadJobs = new Map();
// Long 4K downloads can run for hours on a slow server — only expire idle jobs.
const JOB_TTL = 3 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of downloadJobs) {
    if (now - j.createdAt > JOB_TTL) {
      try { if (j.filePath && fs.existsSync(j.filePath)) fs.unlinkSync(j.filePath); } catch { /* ignore */ }
      try { if (j.base) cleanupFiles(j.base); } catch { /* ignore */ }
      downloadJobs.delete(id);
    }
  }
}, 60 * 1000).unref();

function parseSizeToBytes(str) {
  if (str == null) return 0;
  if (typeof str === 'number') return Math.floor(str) || 0;
  const m = String(str).trim().match(/^([\d.]+)\s*([KMGT]?i?B)?(\/s)?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]) || 0;
  const unit = (m[2] || 'B').toUpperCase();
  const mult =
    unit === 'B' ? 1 :
    unit === 'KB' || unit === 'KIB' ? 1024 :
    unit === 'MB' || unit === 'MIB' ? 1024 * 1024 :
    unit === 'GB' || unit === 'GIB' ? 1024 * 1024 * 1024 :
    unit === 'TB' || unit === 'TIB' ? 1024 * 1024 * 1024 * 1024 : 1;
  return Math.floor(num * mult);
}

// Parse one yt-dlp progress chunk. Mutates job in place.
// Progress is monotonic: a retried attempt restarts its own lines near 0%,
// but the bar must never move backwards while partial files are resumed.
function parseYtDlpChunk(job, chunk) {
  const floorPct = job.percent || 0;
  const floorDl = job.downloadedBytes || 0;
  const text = String(chunk || '');
  // yt-dlp progress uses \r — split on both \r and \n
  const lines = text.split(/[\r\n]+/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/\[download\].*destination:/i.test(line)) {
      job.destCount = (job.destCount || 0) + 1;
      if (job.destCount === 2 && !job.baseOffset) job.baseOffset = 45;
      job.status = 'downloading';
      job.detail = job.destCount > 1
        ? `Downloading part ${job.destCount}…`
        : 'Downloading…';
      continue;
    }
    if (/\[merger\]|merging formats/i.test(line)) {
      job.status = 'merging';
      job.percent = Math.max(job.percent || 0, 95);
      job.detail = 'Merging video + audio…';
      continue;
    }
    if (/\[extractaudio\]|\[postprocess\]|converting|embedding/i.test(line)) {
      job.status = 'merging';
      job.percent = Math.max(job.percent || 0, 95);
      job.detail = 'Processing audio…';
      continue;
    }
    const pm = line.match(/(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+\s*[KMGT]?i?B)/i);
    if (pm && /\[download\]/.test(line)) {
      const filePct = Math.min(100, Math.max(0, parseFloat(pm[1]) || 0));
      const totalB = parseSizeToBytes(pm[2]);
      const speedM = line.match(/at\s+([\d.]+\s*[KMGT]?i?B\/s)/i);
      const etaM = line.match(/ETA\s+([\d:]+)/i);
      job.status = 'downloading';
      if (totalB > 0) {
        job.totalBytes = totalB;
        job.totalText = formatBytes(totalB);
        job.downloadedBytes = Math.floor((filePct / 100) * totalB);
        job.downloadedText = formatBytes(job.downloadedBytes);
      }
      if (speedM) job.speed = speedM[1].trim();
      if (etaM) job.eta = etaM[1].trim();
      // Map file percent to overall percent (reserve tail for merge)
      const base = job.baseOffset || 0;
      const span = 90 - base;
      job.percent = Math.min(94, base + (filePct / 100) * span);
      if ((job.destCount || 1) > 1) job.detail = `Downloading part ${job.destCount}…`;
      else job.detail = 'Downloading…';
      continue;
    }
    // Fragmented / HLS style: "[download] Got fragment 12 ..."
    const fragM = line.match(/fragment\s+(\d+)(?:\s+of\s+(\d+))?/i);
    if (fragM && /\[download\]/.test(line)) {
      job.status = 'downloading';
      job.detail = 'Downloading fragments…';
    }
  }
  if ((job.percent || 0) < floorPct) job.percent = floorPct;
  if ((job.downloadedBytes || 0) < floorDl) {
    job.downloadedBytes = floorDl;
    job.downloadedText = formatBytes(floorDl);
  }
}

function buildYtDlpArgs({ format, outputTemplate, isAudio, ckFile, dlClient }) {
  const a = [
    '--no-check-certificates',
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes', 'node',
    // Patient retry profile: YouTube throttles fragments mid-download
    // (403 / slowdowns). Retry with pauses instead of dying after a few MBs.
    '--retries', '10',
    '--fragment-retries', '10',
    '--retry-sleep', 'fragment:5',
    // Resume partial (.part) files: a dropped connection continues where it
    // stopped instead of restarting from zero.
    '--continue',
    '--socket-timeout', '30',
    '--newline',
    '--progress',
    '--ffmpeg-location', ffmpegPath,
    '--concurrent-fragments', '4',
  ];
  if (format) { a.push('-f', format); }
  if (outputTemplate) { a.push('-o', outputTemplate); }
  if (ckFile) { a.push('--cookies', ckFile); }
  if (dlClient === 'android') { a.push('--extractor-args', 'youtube:player_client=android'); }
  if (isAudio) {
    a.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    a.push(
      '--merge-output-format', 'mp4',
      '--remux-video', 'mp4',
      '--embed-metadata',
      '--postprocessor-args', 'Merger:-movflags +faststart'
    );
  }
  return a;
}

function findBuiltFile(base) {
  try {
    const prefix = path.basename(base);
    for (const f of fs.readdirSync(TMP_DIR)) {
      if (!f.startsWith(prefix)) continue;
      // Skip in-progress/resume helper files — only finished outputs count.
      if (/\.(part|ytdl|temp)$/i.test(f)) continue;
      const full = path.join(TMP_DIR, f);
      try { if (fs.statSync(full).isFile()) return full; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return null;
}

// "Requested format is not available" means the format choice (not the video)
// is the problem — retry with the compatible fallback instead of failing.
function isFormatUnavailableError(msg) {
  return /requested format.*not available|format.*not available|no video formats found/i.test(String(msg || ''));
}

function friendlyDownloadError(m) {
  const s = String(m || '');
  if (/private video/i.test(s)) return 'This video is private. Add your YouTube cookies (only videos visible to your account will open).';
  if (/members.only|join this channel|channel membership/i.test(s)) return 'This video is for channel MEMBERS only. Add cookies from a member account.';
  if (/confirm your age|age.restrict|age.gate/i.test(s)) return 'This video is age-restricted (18+). Add cookies from an adult account.';
  if (/unavailable|not available|deleted|has been removed/i.test(s)) return 'This video is not available on YouTube (deleted/private/region-blocked).';
  if (/login required|log in|sign in to confirm|not a bot|429|too many requests|403|failed to extract|unable to extract|player response|nsig|throttl|po.?token|http error/i.test(s)) return 'YouTube blocked this request (server IP bot-check). Try again with your cookies, or use localhost (start.bat).';
  return 'Download failed: ' + (s.slice(0, 300) || 'unknown error');
}

// Background worker: downloads + merges while updating job progress live.
async function runYtDlpJob(job) {
  const { url, quality, ckFile, dlClient } = job;
  const base = tmpBase();
  job.base = base;
  try {
    // Direct file -> stream straight to disk (never buffer whole files in
    // RAM — that OOM-crashes the server on large videos and kills the
    // download after a few MBs). Progress stays live via byte counting.
    if (isDirectFile(url)) {
      job.status = 'downloading';
      job.detail = 'Downloading…';
      const name = safeFilename(url.split('/').pop().split('?')[0], '');
      job.filename = name;
      const headLen = job.totalBytes || 0;
      const r = await fetch(url);
      if (!r.ok) throw new Error('File download failed (HTTP ' + r.status + ')');
      const total = parseInt(r.headers.get('content-length') || String(headLen || '0'), 10) || 0;
      if (total > 0) { job.totalBytes = total; job.totalText = formatBytes(total); }
      const ext = (name.split('.').pop() || '').toLowerCase();
      const outFile = base + '.' + (ext || 'mp4');
      const ws = fs.createWriteStream(outFile);
      let got = 0;
      try {
        for await (const chunk of Readable.fromWeb(r.body)) {
          ws.write(chunk);
          got += chunk.length;
          job.downloadedBytes = got;
          job.downloadedText = formatBytes(got);
          job.percent = total ? Math.min(99, (got / total) * 100) : Math.min(95, got / 500000);
        }
        await new Promise((resolve, reject) => {
          ws.on('error', reject);
          ws.end(resolve);
        });
      } catch (e) {
        try { ws.destroy(); } catch { /* ignore */ }
        throw e;
      }
      job.filePath = outFile;
      job.fileSize = fs.statSync(outFile).size;
      job.fileSizeText = formatBytes(job.fileSize);
      job.status = 'ready';
      job.percent = 100;
      job.detail = 'Ready';
      return;
    }

    const isAudio = quality === 'audio' || quality === 'mp3';
    const format = qualityToFormat(quality);

    // Resolve a title for the filename
    let title = 'video';
    try {
      const meta = await youtubedl(url, baseYtDlpOpts({
        getFilename: true,
        output: '%(title)s',
        ...(ckFile ? { cookies: ckFile } : {}),
        ...clientArgsFor(dlClient, url),
      }));
      title = String(meta).trim().split('\n')[0] || 'video';
    } catch { /* ignore, default name is used */ }
    job.filename = safeFilename(title, isAudio ? '.mp3' : '.mp4');
    job.status = 'downloading';
    job.detail = 'Starting download…';

    if (!YT_DLP_PATH || !fs.existsSync(YT_DLP_PATH)) {
      throw new Error('Downloader binary is missing on the server.');
    }

    const outputTemplate = base + '.%(ext)s';
    const attempt = (fmt, client) => new Promise((resolve, reject) => {
      const args = buildYtDlpArgs({
        format: fmt, outputTemplate, isAudio, ckFile, dlClient: client,
      });
      const child = spawn(YT_DLP_PATH, [...args, '--', url], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderrTail = '';
      child.stdout.on('data', (d) => parseYtDlpChunk(job, d.toString()));
      child.stderr.on('data', (d) => {
        const s = d.toString();
        stderrTail = (stderrTail + s).slice(-4000);
        parseYtDlpChunk(job, s);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderrTail.slice(-1500) || ('yt-dlp exited with code ' + code)));
      });
    });

    // Retry plan for mid-download failures (the "few MBs then error" case).
    // Partial .part files are KEPT between attempts so --continue resumes them,
    // and every attempt re-extracts FRESH format URLs (stale googlevideo URLs
    // returning 403/404 is the most common mid-download killer).
    //   1) requested format + info-step client
    //   2) same format + alternate client (YouTube throttles/blocks are often
    //      client-specific; quality choice is preserved)
    //   3) height-capped compatible single file (never below requested quality)
    const yt = isYouTubeUrl(url);
    const altClient = yt ? (dlClient === 'android' ? null : 'android') : dlClient;
    const fb = fallbackFormat(quality);
    const plan = [{ fmt: format, client: dlClient, note: 'Downloading…' }];
    if (altClient !== dlClient) {
      plan.push({ fmt: format, client: altClient, note: 'Connection interrupted — retrying with alternate connection…' });
    }
    if (fb !== format) {
      plan.push({ fmt: fb, client: dlClient, note: 'Retrying with compatible format…' });
    }

    let lastErr = null;
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      if (i > 0) {
        job.detail = step.note;
        job.status = 'downloading';
      }
      try {
        await attempt(step.fmt, step.client);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const em = String((e && (e.stderr || e.message)) || '');
        console.error(`DOWNLOAD ATTEMPT ${i + 1}/${plan.length} FAIL:`, em.slice(0, 500));
        // "Format not available" will fail identically on the alternate client —
        // skip straight to the compatible-format attempt.
        if (isFormatUnavailableError(em)) {
          const fbIdx = plan.findIndex((p) => p.fmt === fb);
          if (fbIdx > i) { i = fbIdx - 1; continue; }
        }
      }
    }
    if (lastErr) throw lastErr;

    const file = findBuiltFile(base);
    if (!file || !fs.existsSync(file)) {
      cleanupFiles(base);
      throw new Error('Download failed (output file was not created)');
    }
    job.filePath = file;
    job.fileSize = fs.statSync(file).size;
    job.fileSizeText = formatBytes(job.fileSize);
    // Final totals: the merged file is the truth (progress lines only saw
    // single streams, so never report total < downloaded).
    job.totalBytes = Math.max(job.totalBytes || 0, job.fileSize);
    job.totalText = formatBytes(job.totalBytes);
    job.downloadedBytes = job.fileSize;
    job.downloadedText = job.fileSizeText;
    job.status = 'ready';
    job.percent = 100;
    job.detail = 'Ready';
  } catch (e) {
    console.error('JOB FAIL:', e && e.message);
    try { if (base) cleanupFiles(base); } catch { /* ignore */ }
    job.status = 'error';
    job.error = friendlyDownloadError((e && (e.stderr || e.message)) || e);
    job.detail = 'Failed';
  }
}

// Start a download job (returns immediately with a jobId for polling)
app.post('/api/download-start', async (req, res) => {
  try {
    const { url: rawUrl, quality = 'best', cookiesToken, client } = req.body || {};
    if (!rawUrl || !isValidUrl(rawUrl)) {
      return res.status(400).json({ error: 'Please provide a valid video link.' });
    }
    const ck = resolveCookies(cookiesToken);
    if (ck.invalid) {
      return res.status(400).json({ error: '🔑 Cookies have expired (30 min limit). Please upload cookies.txt again.' });
    }
    if (downloadJobs.size > 50) {
      return res.status(429).json({ error: 'Server is busy. Please wait a moment and try again.' });
    }
    const url = normalizeUrl(rawUrl);
    const allowedQ = ['best', '2160', '4k', '1440', '2k', '1080', '720', '480', '360', 'audio', 'mp3'];
    const q = allowedQ.includes(String(quality)) ? String(quality) : 'best';
    const dlClient = (client === 'android' && isYouTubeUrl(url)) ? 'android' : null;

    // Estimated size (for instant UI feedback before live bytes arrive)
    let estimatedSize = null, estimatedSizeText = null;
    if (!isDirectFile(url)) {
      try {
        const { info } = await fetchInfoWithFallback(url, ck.file);
        const bytes = estimateSize(info.formats, q);
        if (bytes > 0) { estimatedSize = bytes; estimatedSizeText = formatBytes(bytes); }
      } catch { /* estimate stays empty, live progress still works */ }
    } else {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const head = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
        clearTimeout(t);
        const len = parseInt(head.headers.get('content-length') || '0', 10);
        if (len > 0) { estimatedSize = len; estimatedSizeText = formatBytes(len); }
      } catch { /* ignore */ }
    }

    const jobId = 'job_' + Date.now().toString(36) + '_' + crypto.randomBytes(6).toString('hex');
    const job = {
      id: jobId,
      url, quality: q, ckFile: ck.file || null, dlClient,
      status: 'starting', percent: 1,
      downloadedBytes: 0, totalBytes: estimatedSize || 0,
      downloadedText: formatBytes(0), totalText: estimatedSizeText,
      estimatedSize, estimatedSizeText,
      speed: null, eta: null, detail: 'Starting…',
      filename: 'video' + (q === 'audio' ? '.mp3' : '.mp4'),
      filePath: null, fileSize: null, fileSizeText: null,
      error: null, destCount: 0, baseOffset: 0, base: null,
      createdAt: Date.now(),
    };
    downloadJobs.set(jobId, job);
    runYtDlpJob(job); // background — progress via /api/progress
    res.json({ jobId, estimatedSize, estimatedSizeText });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not start download: ' + (e.message || '') });
  }
});

// Poll real-time progress for a job
app.get('/api/progress', (req, res) => {
  const { jobId } = req.query || {};
  const job = jobId && downloadJobs.get(String(jobId));
  if (!job) return res.status(404).json({ error: 'Download job not found or expired.' });
  res.json({
    jobId: job.id,
    status: job.status,
    percent: Math.round((job.percent || 0) * 10) / 10,
    downloadedBytes: job.downloadedBytes || 0,
    totalBytes: job.totalBytes || job.estimatedSize || 0,
    downloadedText: job.downloadedBytes ? formatBytes(job.downloadedBytes) : '0 B',
    totalText: job.totalText || job.estimatedSizeText || null,
    estimatedSize: job.estimatedSize || null,
    estimatedSizeText: job.estimatedSizeText || null,
    speed: job.speed || null,
    eta: job.eta || null,
    detail: job.detail || null,
    filename: job.filename || null,
    fileSize: job.fileSize || null,
    fileSizeText: job.fileSizeText || null,
    error: job.error || null,
  });
});

// Download the finished file for a job
app.get('/api/file', (req, res) => {
  const { jobId } = req.query || {};
  const job = jobId && downloadJobs.get(String(jobId));
  if (!job) return res.status(404).send('Download job not found or expired.');
  if (job.status === 'error') return res.status(500).send(job.error || 'Download failed.');
  if (job.status !== 'ready' || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(425).send('File is not ready yet. Keep polling /api/progress.');
  }
  const isAudio = job.quality === 'audio' || job.quality === 'mp3';
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(job.filename)}`);
  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Content-Length', String(job.fileSize || fs.statSync(job.filePath).size));
  res.setHeader('X-Filename', encodeURIComponent(job.filename));
  res.setHeader('X-File-Size', String(job.fileSize || ''));
  res.sendFile(path.resolve(job.filePath), (err) => {
    if (err) console.error('SEND ERROR:', err.message);
    // Keep the file briefly for retries, then clean up
    setTimeout(() => {
      try { if (job.filePath && fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath); } catch { /* ignore */ }
      try { if (job.base) cleanupFiles(job.base); } catch { /* ignore */ }
      downloadJobs.delete(job.id);
    }, 5 * 60 * 1000);
  });
});

// ---- STEP 2 (classic): Direct video download (video + audio MERGED) ----
// Kept for share links / curl. The website now uses /api/download-start
// + /api/progress + /api/file for real-time progress with size.
app.get('/api/download', async (req, res) => {
  const base = tmpBase();
  try {
    const { url: rawUrl, quality = 'best', cookiesToken, client } = req.query;
    if (!rawUrl || !isValidUrl(rawUrl)) {
      return res.status(400).send('Please provide a valid video link.');
    }
    const ck = resolveCookies(cookiesToken);
    if (ck.invalid) {
      return res.status(400).send('🔑 Cookies have expired (30 min limit). Please upload cookies.txt again.');
    }
    const ckOpt = ck.file ? { cookies: ck.file } : {};
    // Clean &list=&index= YouTube links into a single-video URL
    const url = normalizeUrl(rawUrl);
    // Reuse the client used in the info step (allowlist-checked)
    const dlClientArgs = clientArgsFor(client, url);

    // Direct file -> stream it straight through to the client (never buffer
    // whole files in RAM — that OOM-crashes the server on large videos).
    if (isDirectFile(url)) {
      const name = safeFilename(url.split('/').pop().split('?')[0], '');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      const r = await fetch(url);
      if (!r.ok) return res.status(502).send('File download failed.');
      res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
      const len = r.headers.get('content-length');
      if (len) res.setHeader('Content-Length', len);
      try {
        for await (const chunk of Readable.fromWeb(r.body)) {
          if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
        }
        return res.end();
      } catch (e) {
        console.error('DIRECT STREAM ERROR:', e.message);
        try { res.end(); } catch { /* ignore */ }
        return;
      }
    }

    const isAudio = quality === 'audio' || quality === 'mp3';
    const format = qualityToFormat(quality);

    // First resolve the title (for the filename)
    let title = 'video';
    try {
      const meta = await youtubedl(url, baseYtDlpOpts({
        getFilename: true,
        output: '%(title)s',
        ...ckOpt,
        ...dlClientArgs,
      }));
      title = String(meta).trim().split('\n')[0] || 'video';
    } catch { /* ignore, default name is used */ }

    const filename = safeFilename(title, isAudio ? '.mp3' : '.mp4');

    // Download to a TEMP FILE via yt-dlp + merge with ffmpeg (fixes audio).
    // Merge is stream-copy (remux) only — no re-encode, no quality loss.
    const outputTemplate = base + '.%(ext)s';
    const postArgs = isAudio
      ? { extractAudio: true, audioFormat: 'mp3', audioQuality: 0 }
      : {
          // Best Merge: merge highest-bitrate video+audio into MP4
          // (audio plays in every player + faststart for instant playback)
          mergeOutputFormat: 'mp4',
          remuxVideo: 'mp4',
          embedMetadata: true,
          postprocessorArgs: 'Merger:-movflags +faststart',
        };
    const mkArgs = (fmt, cArgs) => baseYtDlpOpts({
      format: fmt,
      output: outputTemplate,
      quiet: true,
      ffmpegLocation: ffmpegPath,
      concurrentFragments: 4,
      ...ckOpt,
      ...cArgs,
      ...postArgs,
    });
    // Alternate player client for the retry (allowlist-checked). YouTube
    // throttles/blocks are often client-specific — same format, other client.
    const altClientArgs = clientArgsFor(client === 'android' ? null : 'android', url);
    const sameClient = JSON.stringify(altClientArgs) === JSON.stringify(dlClientArgs);
    const fb = fallbackFormat(quality);

    // Same 3-step retry plan as the job path: partials are KEPT so --continue
    // resumes them, and each attempt re-extracts fresh format URLs.
    try {
      await youtubedl(url, mkArgs(format, dlClientArgs));
    } catch (e1) {
      console.error('TRY 1 FAIL:', String((e1 && (e1.stderr || e1.message)) || '').slice(0, 500));
      const fmtUnavailable = isFormatUnavailableError((e1 && (e1.stderr || e1.message)) || '');
      if (!sameClient && !fmtUnavailable) {
        try {
          await youtubedl(url, mkArgs(format, altClientArgs));
        } catch (e2) {
          console.error('TRY 2 FAIL:', String((e2 && (e2.stderr || e2.message)) || '').slice(0, 500));
          await youtubedl(url, mkArgs(fb, dlClientArgs));
        }
      } else {
        // Same client anyway, or format itself unavailable -> compatible fallback.
        await youtubedl(url, mkArgs(fb, dlClientArgs));
      }
    }

    // Find the built file (dl_xxx.mp4 / .mp3 / .webm ...)
    let file = null;
    try {
      const prefix = path.basename(base);
      for (const f of fs.readdirSync(TMP_DIR)) {
        if (f.startsWith(prefix)) { file = path.join(TMP_DIR, f); break; }
      }
    } catch { /* ignore */ }
    if (!file || !fs.existsSync(file)) {
      cleanupFiles(base);
      return res.status(500).send('Download failed (output file was not created).');
    }

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('X-Filename', encodeURIComponent(filename));

    res.sendFile(file, (err) => {
      cleanupFiles(base); // delete temp files after sending
      if (err) console.error('SEND ERROR:', err.message);
    });
  } catch (e) {
    console.error(e);
    cleanupFiles(base);
    if (!res.headersSent) {
      const m = String((e && (e.stderr || e.message)) || '');
      if (/private video/i.test(m)) {
        res.status(400).send('This video is private. Add your YouTube cookies (only videos visible to your account will open).');
      } else if (/members.only|join this channel|channel membership/i.test(m)) {
        res.status(400).send('This video is for channel MEMBERS only. Add cookies from a member account.');
      } else if (/confirm your age|age.restrict|age.gate/i.test(m)) {
        res.status(400).send('This video is age-restricted (18+). Add cookies from an adult account.');
      } else if (/unavailable|not available|deleted|has been removed/i.test(m)) {
        res.status(400).send('This video is not available on YouTube (deleted/private/region-blocked).');
      } else if (/login required|log in|sign in to confirm|not a bot|429|too many requests|403|failed to extract|unable to extract|player response|nsig|throttl|po.?token|http error/i.test(m)) {
        res.status(502).send('YouTube blocked this request (server IP bot-check). Try again with your cookies, or use localhost (start.bat).');
      } else {
        res.status(500).send('Download error: ' + (e.message || ''));
      }
    }
  }
});

// ---- FRONTEND LINK ----
// Serve docs/index.html on the web (this folder becomes the website on GitHub Pages)
// CHAIN: Browser (index.html) --fetch /api/*--> server.js (this file) --yt-dlp+ffmpeg--> video
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

// SPA fallback: serve index.html for every non-API GET (works on Express 4 + 5)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
  if (req.path.includes('.') && req.path !== '/') return next(); // let missed static files pass
  res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Video Downloader running at: http://localhost:${PORT}`);
  console.log(`  No login required. Just paste a link and download.\n`);
});
