# Fernweh Frame

A single monitor (Newsoul 22MT01-S, 22-inch 2560×1440) hides behind an [IKEA RÖDALM frame for 3 pictures](https://www.ikea.com/jp/ja/p/roedalm-frame-for-3-pictures-white-10553726/) (57×30 cm, three 13×18 cm openings), hung in portrait orientation — three 18×13 landscape windows stacked vertically. Each opening becomes a live window: three different YouTube live cameras from around the world, rotating on the hour.

Based on [Fernweh](https://github.com/ubiquitous-o/Fernweh) — the video discovery pipeline (GitHub Actions → YouTube Data API → `videos.json`) is inherited as-is; the frontend is rebuilt as a triptych kiosk view.

**🪟🪟🪟Live Demo:** https://ubiquitous-o.github.io/FernwehFrame/ 🪟🪟🪟

## How it works

```
[GitHub Actions cron (every 2 hours)]
  → YouTube Data API v3 search
  → location resolution (dictionary → Gemini → Nominatim)
  → public/videos.json → git push

[Browser (kiosk, fullscreen behind the frame)]
  → 3 independent YouTube IFrame players
  → each window is a "postcard": real hagaki-size (148×100 mm) textured card
  → 3 postcard designs (stamp / airmail / fullbleed), re-rolled on every switch
    so a window never shows the same design twice in a row
  → rendered area 180×130 mm, aperture 170×120 mm (5 mm bleed on all sides)
  → windows stacked vertically (frame in portrait orientation)
  → window 1 switches at :00, window 2 at :20, window 3 at :40
  → frosted-glass transition per window (fog in → load → clear)
  → no two windows show the same stream
```

## Controls

| Key | Action |
|-----|--------|
| Click a window | Switch that window to the next camera |
| `1` / `2` / `3` | Switch a specific window |
| `Space` / `N` / `→` | Switch all three windows |
| `F` / `F11` | Toggle fullscreen |
| `C` | Toggle calibration mode |

## Postcard designs

Each switch picks a random design for the window — never the same one twice in a row (`public/js/designs.js`):

| Name | Look |
|------|------|
| `stamp` | Stamp-perforation edges + circular postmark (location & camera-local date) |
| `airmail` | Red/blue striped border to the card edge, centered video, title centered on top |
| `fullbleed` | Video across the card with a thin even margin; title top-left, time top-right, location bottom-right |

**Preview mode:** append `?design=<name>` to the URL (e.g. `?design=airmail`) to pin all three windows to one design while tweaking it. Omit the parameter for the normal random rotation.

## Calibration

The three on-screen rectangles default to RÖDALM's real dimensions in portrait orientation (frame 300×570 mm, windows 180×130 mm; assuming even vertical spacing: 45 mm margins/gaps, 60 mm sides), scaled to fit the viewport. To align them with the physical openings, press `C`:

| Key | Action |
|-----|--------|
| `0` | Select the whole frame |
| `1` / `2` / `3` | Select one window |
| Arrow keys | Move selection (`Shift` = ×10) |
| `-` / `=` | Scale (whole frame) / width (window) |
| `[` / `]` | Height (window) |
| `M` | Enter the monitor's visible width in mm → true physical scale (windows become real 180×130 mm) |
| `R` | Reset to defaults |
| `C` / `Esc` | Save & exit |

The layout is saved to `localStorage` and survives reboots. Tip: put a real photo print in one opening while calibrating the others, or just nudge until the green outlines vanish behind the mat.

## Setup

### 1. Get a YouTube Data API v3 Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project
3. Enable **YouTube Data API v3** under APIs & Services > Library
4. Create an API key under APIs & Services > Credentials

### 2. Get a Gemini API Key (Free, optional)

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create an API key (no credit card required)

### 3. Configure GitHub

1. Go to your repo's **Settings > Secrets and variables > Actions**
2. Add secrets:
   - `YOUTUBE_API_KEY` = your YouTube API key
   - `GEMINI_API_KEY` = your Gemini API key (optional — falls back to dictionary-only matching)
3. Go to **Settings > Pages** and set source to the `main` branch
4. Go to **Actions** and manually trigger "Fetch Live Videos" to seed initial data

### 4. Kiosk

Point a fullscreen Chromium at the deployed page (or local server), put the monitor behind the frame, press `C`, and line up the windows.

Production monitor: **Newsoul 22MT01-S** (22-inch, 2560×1440) in portrait orientation. After mounting, press `C` → `M` and enter the measured visible width in mm for true physical scale.

```bash
# Local development
YOUTUBE_API_KEY=your_key node scripts/fetch-videos.js   # fetch videos locally
npx serve public                                        # serve the static site
```

For dedicated hardware (N100 kiosk, Raspberry Pi, etc.) see `setup.sh` / `autostart.sh` / `fernwehframe@.service`.

## Project Structure

```
fernwehframe/
├── public/                       # Static site root
│   ├── index.html                # 3 window containers + calibration UI
│   ├── css/styles.css            # Postcard styling, calibration overlay
│   ├── img/paper.jpg             # Postcard paper texture
│   ├── js/
│   │   ├── main.js               # Entry — 3 windows, staggered hourly rotation
│   │   ├── layout.js             # RÖDALM mm geometry → px rects + persistence
│   │   ├── frameWindow.js        # Per-window controller (player, postcard layout, caption, frost)
│   │   ├── calibration.js        # Keyboard alignment mode
│   │   ├── player.js             # YT.Player wrapper (slot-generic)
│   │   ├── videoPool.js          # Shared pool, watched list, active-ID exclusion
│   │   ├── locations.js          # Runtime location dictionary fallback
│   │   └── input.js              # Click / keyboard handlers
│   └── videos.json               # Video candidates (generated by Actions)
├── scripts/                      # Video discovery pipeline (inherited from Fernweh)
├── .github/workflows/            # fetch-videos.yml (cron) + deploy-pages.yml
└── server.js                     # Express server (optional local/kiosk mode)
```
