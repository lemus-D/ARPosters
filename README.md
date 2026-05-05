# AR Poster

A **clone-and-host** AR poster toolkit built on [MindAR](https://hiukim.github.io/mind-ar-js-doc/) and [A-Frame](https://aframe.io/). Upload target images and display content (images, videos, or 3D models), pair them with a drag-and-drop dashboard, commit the result, and host it on GitHub Pages. Visitors scan a QR code, point their phone at a poster, and see the overlay content — no app install, no custom code.

This folder is a drop-in companion to the sibling `EELabDemos/` and `SN020/` examples.

---

## How it works

```
poster images (jpg/png) -->  admin.html (in-browser MindAR compile)
                                       |
                                       +--> targets.mind
                                       +--> config.json
                                       +--> index.html (regenerated)
                                       +--> assets/images|videos|models/

         index.html  --> MindAR + A-Frame scene (static, no fetches)
```

- `admin.html` runs MindAR's compiler **entirely in your browser** to turn your poster images into `targets.mind` — no upload to any external tool needed.
- It also lets you pair each target with display assets (images, videos, glb/gltf models) plus per-pairing position / rotation / scale / plane-size / flags.
- Save & Generate Viewer produces a self-contained `index.html` plus `config.json` (and `targets.mind` + assets when present), bundled as a zip if any binary content is included.
- Commit the resulting files and push — GitHub Pages serves the AR experience immediately.

---

## First-time setup

1. **Clone or fork** this repo.
2. **Enable GitHub Pages** on the repo: Settings -> Pages -> Source = *Deploy from a branch* = `main` (root). Your URL will be `https://<user>.github.io/<repo>/AR_Poster/` (or just `https://<user>.github.io/<repo>/` if `AR_Poster` is your repo root).

## Each time you build a new experience

1. Open `AR_Poster/admin.html` (locally via a static file server such as `npx serve`, or visit the deployed `/admin.html`).
2. **Stage target images** — click the blue button and pick every poster image you want recognised. The order you pick them determines each `targetIndex`.
3. **Click Compile targets.mind**. Watch the progress bar; on a typical laptop a 4-image batch takes 10–60 seconds. The compiled `.mind` is stored in your browser, and your source images double as reference previews on each target card.
4. *(Optional)* **Download targets.mind** if you want a copy on disk before saving.
5. **Upload display assets** (images, mp4 / webm videos, or glb / gltf models). They're staged in the gallery.
6. **Pair each asset to a target** by drag-and-drop onto the target card or via the dropdown on the card. Each new pairing appears in the pairings list with a transform editor:
   - `position` x/y/z (meters, 0 = aligned to the target center).
   - `rotation` x/y/z (degrees).
   - `scale` x/y/z.
   - `plane size` width/height (for image and video overlays).
   - Image-only: **Tap to enlarge** — reuses the full-screen popup from the existing examples.
   - Video-only: loop, autoplay, muted.
   - A mini preview shows the overlay sized against the actual target thumbnail.
7. Tune the scene options in the footer (`maxTrack`, `filterMinCF`, `warmupTolerance`) if needed. Defaults match `EELabDemos/index.html`.
8. **Click Save & Generate Viewer**. You get either:
   - `index.html` + `config.json` as two downloads (when nothing binary is staged), or
   - `AR_Poster-export.zip` containing `index.html`, `config.json`, `targets.mind`, and any new assets.
9. Drop the downloaded files into your local `AR_Poster/` folder, then commit and push:
   ```bash
   git add AR_Poster/index.html AR_Poster/config.json AR_Poster/targets.mind AR_Poster/assets
   git commit -m "Update AR poster content"
   git push
   ```
10. Wait ~30s for Pages to deploy. Your QR code URL (pointing at `AR_Poster/index.html`) now serves the new experience.

### Alternative: use the external compiler

If you'd rather compile elsewhere (e.g. a teammate did it for you), drop their `targets.mind` next to `admin.html` and click **Load targets.mind** instead of staging images. You can also compile at <https://hiukim.github.io/mind-ar-js-doc/tools/compile> and load the result here.

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
├── targets.mind            produced by admin.html in-browser compile (commit this)
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

| Feature                                  | Chromium (Chrome/Edge/Arc) | Firefox | Safari |
|------------------------------------------|:--------------------------:|:-------:|:------:|
| Viewer (`index.html`)                    | yes                        | yes     | yes*   |
| Admin decode + pairings                  | yes                        | yes     | yes    |
| In-browser MindAR compile                | yes                        | yes     | yes    |
| Save / generate viewer (downloads)       | yes                        | yes     | yes    |

\* iOS Safari requires HTTPS (GitHub Pages is HTTPS) and a user tap to start camera.

## Troubleshooting

- **"Could not load config.json"** on the viewer — `config.json` is missing or invalid JSON. Open the admin, pair at least one target, and Save.
- **"No pairings configured yet"** — config loaded but empty. Add pairings and save.
- **Thumbnails don't appear** — your `.mind` file may be from an older MindAR version, or you loaded a `.mind` without staging the matching source images. Re-stage the originals and click Compile, or click a target card to attach a reference image manually.
- **Compile is slow / freezes the tab** — MindAR's compiler is CPU-bound. Stick to ≤8 high-contrast images per batch on mobile, or do the compile on a laptop and just commit the resulting `targets.mind`.
- **Overlay is the wrong size** — tweak `planeSize` on the pairing; width/height are in the same normalized units MindAR uses (the larger side of the target image is ~1 unit).
- **3D model is invisible** — set a larger `scale` (models are in meters, unlike planes). Also confirm the `.glb` includes embedded textures.

---

## Credits

- [MindAR](https://github.com/hiukim/mind-ar-js) by hiukim
- [A-Frame](https://aframe.io/) and [aframe-extras](https://github.com/donmccurdy/aframe-extras)
- [JSZip](https://stuk.github.io/jszip/) for the download fallback
