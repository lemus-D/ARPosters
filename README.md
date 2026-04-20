# AR Poster

A **clone-and-host** AR poster toolkit built on [MindAR](https://hiukim.github.io/mind-ar-js-doc/) and [A-Frame](https://aframe.io/). Upload target images and display content (images, videos, or 3D models), pair them with a drag-and-drop dashboard, commit the result, and host it on GitHub Pages. Visitors scan a QR code, point their phone at a poster, and see the overlay content — no app install, no custom code.

This folder is a drop-in companion to the sibling `EELabDemos/` and `SN020/` examples.

---

## How it works

```
hiukim compile page -->  targets.mind
                               |
          admin.html  <--------+
             |                   (reads pairings, sizes, flags)
             v
        config.json  ----> index.html --> MindAR + A-Frame scene
             ^
             |
      assets/images/, assets/videos/, assets/models/
```

- `targets.mind` is compiled **once** on the external MindAR tool and dropped into this folder.
- `admin.html` decodes `targets.mind` entirely in the browser, shows a numbered thumbnail for each target, and lets you pair them with your uploaded display assets plus per-pairing position / rotation / scale / plane-size / flags.
- The admin writes everything (or emits a zip) so you can commit **`config.json` + `targets.mind` + `assets/`**.
- `index.html` fetches `config.json` at runtime and programmatically builds the A-Frame scene. End users never edit HTML.

---

## First-time setup

1. **Clone or fork** this repo.
2. **Enable GitHub Pages** on the repo: Settings -> Pages -> Source = *Deploy from a branch* = `main` (root). Your URL will be `https://<user>.github.io/<repo>/AR_Poster/`.
3. **Compile your targets**:
   - Go to <https://hiukim.github.io/mind-ar-js-doc/tools/compile>.
   - Drag in every poster image, **taking note of the order you upload them** (this determines `targetIndex`). The admin will also show you previews so you can verify visually.
   - Click Start, wait for it to finish, click Download. Save the file as `AR_Poster/targets.mind`.

## Each time you build a new experience

1. Open `AR_Poster/admin.html` (locally via `file://`, or visit the deployed `/admin.html`). Chromium browsers (Chrome / Edge / Arc) give you the best experience via the File System Access API — click **Connect repo folder** and pick `AR_Poster/` so uploads write directly to disk.
2. **Load `targets.mind`** (or it will auto-load if you're viewing the deployed site). A numbered thumbnail appears for each target.
3. **Upload display assets** (images, mp4 / webm videos, or glb / gltf models). They're staged in the gallery.
4. **Pair each asset to a target** by drag-and-drop onto the target card or via the dropdown on the card. Each new pairing appears in the pairings list with a transform editor:
   - `position` x/y/z (meters, 0 = aligned to the target center).
   - `rotation` x/y/z (degrees).
   - `scale` x/y/z.
   - `plane size` width/height (for image and video overlays).
   - Image-only: **Tap to enlarge** — reuses the full-screen popup from the existing examples.
   - Video-only: loop, autoplay, muted.
   - A mini preview shows the overlay sized against the actual target thumbnail.
5. Tune the scene options in the footer (`maxTrack`, `filterMinCF`, `warmupTolerance`) if needed. Defaults match `EELabDemos/index.html`.
6. **Click Save**:
   - If you connected the repo folder, `config.json` and all assets are written directly into `AR_Poster/`.
   - Otherwise you get a download (`config.json` by itself, or `AR_Poster-payload.zip` containing `config.json` + `assets/...`). Unzip into `AR_Poster/`.
7. Commit and push:
   ```bash
   git add AR_Poster/config.json AR_Poster/targets.mind AR_Poster/assets
   git commit -m "Update AR poster content"
   git push
   ```
8. Wait ~30s for Pages to deploy. Your QR code URL (pointing at `AR_Poster/index.html`) now serves the new experience.

## Iterating later

- **Open viewer** from the admin top bar smoke-tests the current scene in a new tab.
- **Load existing config.json** rehydrates the entire UI so you can tweak without starting over. On a deployed admin page, this also happens automatically when the page loads.
- Re-pair by selecting a different asset in the target card's dropdown, or remove a pairing with the Remove button on its row.

---

## File layout

```
AR_Poster/
├── index.html              viewer (reads config.json, builds scene)
├── admin.html              dashboard GUI
├── config.json             produced by admin.html (commit this)
├── targets.mind            produced by hiukim compile tool (commit this)
├── js/
│   ├── viewer.js
│   └── admin.js
├── css/admin.css
├── assets/
│   ├── images/             .png / .jpg / .webp
│   ├── videos/             .mp4 / .webm
│   └── models/             .glb / .gltf
├── .nojekyll               so GitHub Pages serves everything as-is
└── README.md               (this file)
```

## `config.json` reference

```json
{
  "mindSrc": "./targets.mind",
  "maxTrack": 1,
  "filterMinCF": 1e-11,
  "warmupTolerance": 1,
  "pairings": [
    {
      "targetIndex": 0,
      "type": "image",
      "src": "assets/images/Poster1.png",
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale":    { "x": 1, "y": 1, "z": 1 },
      "planeSize": { "width": 1, "height": 1 },
      "tapToEnlarge": true
    },
    {
      "targetIndex": 1,
      "type": "video",
      "src": "assets/videos/promo.mp4",
      "loop": true, "autoplay": true, "muted": true,
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale":    { "x": 1, "y": 1, "z": 1 },
      "planeSize": { "width": 4, "height": 3 }
    },
    {
      "targetIndex": 2,
      "type": "model",
      "src": "assets/models/mascot.glb",
      "position": { "x": 0, "y": 0, "z": 0.1 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale":    { "x": 0.5, "y": 0.5, "z": 0.5 }
    }
  ]
}
```

`type` is optional — it's inferred from the file extension if omitted.

---

## Compatibility

| Feature                        | Chromium (Chrome/Edge/Arc) | Firefox | Safari |
|--------------------------------|:--------------------------:|:-------:|:------:|
| Viewer (`index.html`)          | yes                        | yes     | yes*   |
| Admin decode + pairings        | yes                        | yes     | yes    |
| Direct-write to repo folder    | yes                        | no      | no     |
| Zip-download fallback          | yes                        | yes     | yes    |

\* iOS Safari requires HTTPS (GitHub Pages is HTTPS) and a user tap to start camera.

## Troubleshooting

- **"Could not load config.json"** on the viewer — `config.json` is missing or invalid JSON. Open the admin, pair at least one target, and Save.
- **"No pairings configured yet"** — config loaded but empty. Add pairings and save.
- **Thumbnails don't appear** — your `.mind` file may be from a much older MindAR version. Re-compile it on the current hiukim tool.
- **Overlay is the wrong size** — tweak `planeSize` on the pairing; width/height are in the same normalized units MindAR uses (the larger side of the target image is ~1 unit).
- **3D model is invisible** — set a larger `scale` (models are in meters, unlike planes). Also confirm the `.glb` includes embedded textures.

---

## Credits

- [MindAR](https://github.com/hiukim/mind-ar-js) by hiukim
- [A-Frame](https://aframe.io/) and [aframe-extras](https://github.com/donmccurdy/aframe-extras)
- [JSZip](https://stuk.github.io/jszip/) for the download fallback
