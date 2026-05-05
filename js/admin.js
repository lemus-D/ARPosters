(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    targets: [],          // [{ index, width, height, dataUrl }]
    assets: [],           // [{ id, name, type, file, relPath, objectUrl }]
    pairings: new Map(),  // targetIndex -> pairing object
    sourceImages: [],     // [{ name, file, dataUrl, img: HTMLImageElement }]
    compiledMind: null,   // { arrayBuffer, blob } once compileImageTargets finishes
    dirHandle: null,
    sceneOptions: {
      mindSrc: './targets.mind',
      maxTrack: 1,
      filterMinCF: 1e-11,
      warmupTolerance: 1
    }
  };

  let assetIdSeq = 0;

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------

  const el = {
    mindInput: document.getElementById('mind-input'),
    srcInput: document.getElementById('src-input'),
    btnCompile: document.getElementById('btn-compile'),
    btnDownloadMind: document.getElementById('btn-download-mind'),
    compileProgress: document.getElementById('compile-progress'),
    compileProgressBar: document.querySelector('#compile-progress .compile-progress-bar > span'),
    compileProgressLabel: document.querySelector('#compile-progress .compile-progress-label'),
    assetInput: document.getElementById('asset-input'),
    targetsGrid: document.getElementById('targets-grid'),
    assetsGrid: document.getElementById('assets-grid'),
    pairingsList: document.getElementById('pairings-list'),
    assetsHint: document.getElementById('assets-hint'),
    statusBar: document.getElementById('status-bar'),
    btnSave: document.getElementById('btn-save'),
    btnLoadConfig: document.getElementById('btn-load-config'),
    btnConnectDir: null,
    btnOpenViewer: document.getElementById('btn-open-viewer'),
    optMaxTrack: document.getElementById('opt-maxTrack'),
    optFilterMinCF: document.getElementById('opt-filterMinCF'),
    optWarmupTolerance: document.getElementById('opt-warmupTolerance'),
    tplTarget: document.getElementById('tpl-target-card'),
    tplAsset: document.getElementById('tpl-asset-card'),
    tplPairing: document.getElementById('tpl-pairing-row')
  };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function setStatus(message, kind) {
    el.statusBar.textContent = message;
    el.statusBar.classList.remove('hidden', 'ok', 'err');
    if (kind) el.statusBar.classList.add(kind);
    if (kind === 'ok' || !kind) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(function () {
        el.statusBar.classList.add('hidden');
      }, 4000);
    }
  }

  function updateDirStatus() {
    // Status indicator kept for future use; currently save always downloads.
    const s = document.getElementById('dir-status');
    if (s) s.style.display = 'none';
  }

  function inferAssetType(name) {
    const n = (name || '').toLowerCase();
    if (n.match(/\.(mp4|webm|mov|m4v)$/)) return 'video';
    if (n.match(/\.(glb|gltf)$/)) return 'model';
    if (n.match(/\.(png|jpe?g|gif|webp|svg|bmp)$/)) return 'image';
    return 'image';
  }

  function subfolderForType(type) {
    if (type === 'video') return 'videos';
    if (type === 'model') return 'models';
    return 'images';
  }

  function relPathFor(type, filename) {
    return 'assets/' + subfolderForType(type) + '/' + filename;
  }

  function sanitizeFilename(name) {
    return name.replace(/[^\w.\- ()]/g, '_');
  }

  // (File System Access API / IndexedDB persistence removed — unreliable on
  //  Windows when files are open in an editor or served by a local dev server.
  //  Save now always downloads index.html + config.json directly.)

  // ---------------------------------------------------------------------------
  // Panel 1: Decode targets.mind into thumbnail cards
  // ---------------------------------------------------------------------------

  function grayscaleToCanvas(imageData, canvas) {
    const w = imageData.width;
    const h = imageData.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(w, h);
    const src = imageData.data;

    // MindAR stores grayscale pixels as Float32Array (0.0–1.0).
    // Plain Uint8 arrays (0–255) are also handled.
    const isFloat = src instanceof Float32Array || src instanceof Float64Array;

    for (let i = 0; i < w * h; i++) {
      const v = isFloat ? Math.round(src[i] * 255) : src[i];
      out.data[i * 4 + 0] = v;
      out.data[i * 4 + 1] = v;
      out.data[i * 4 + 2] = v;
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }

  function extractThumbnail(targetData) {
    if (!targetData) return null;

    // Try all known locations where MindAR versions stash the source image.
    const candidates = [
      targetData.targetImage,
      targetData.trackingImageList && targetData.trackingImageList[0],
      targetData.matchingImageList && targetData.matchingImageList[0],
      targetData.imageList && targetData.imageList[0],
      targetData.trackingData && targetData.trackingData[0] && targetData.trackingData[0].image,
      targetData.matchingData && targetData.matchingData.image
    ];

    for (let i = 0; i < candidates.length; i++) {
      const img = candidates[i];
      if (!img) continue;

      // {width, height, data: TypedArray}  — standard form
      if (img.width && img.height && img.data) return img;

      // HTMLImageElement or HTMLCanvasElement — wrap in an {width, height, data} shim
      if ((img instanceof HTMLImageElement || img instanceof HTMLCanvasElement) && img.width && img.height) {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, img.width, img.height);
        // Convert RGBA → greyscale typed array
        const grey = new Uint8ClampedArray(img.width * img.height);
        for (let p = 0; p < grey.length; p++) {
          grey[p] = Math.round(0.299 * id.data[p * 4] + 0.587 * id.data[p * 4 + 1] + 0.114 * id.data[p * 4 + 2]);
        }
        return { width: img.width, height: img.height, data: grey };
      }
    }
    return null;
  }

  function getMindARCompiler() {
    const candidates = [
      window.MINDAR && window.MINDAR.IMAGE && window.MINDAR.IMAGE.Compiler,
      window.MindAR && window.MindAR.Compiler,
      window.mindar && window.mindar.image && window.mindar.image.Compiler
    ];
    for (let i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === 'function') return candidates[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // In-app target compiler (Panel 1, primary path)
  // Uses MINDAR.IMAGE.Compiler.compileImageTargets() locally in the browser —
  // no upload to mind-ar-js-doc/tools/compile required.
  // ---------------------------------------------------------------------------

  function setCompileProgress(percent, label) {
    if (!el.compileProgress) return;
    if (percent == null) {
      el.compileProgress.classList.add('hidden');
      return;
    }
    el.compileProgress.classList.remove('hidden');
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    if (el.compileProgressBar) el.compileProgressBar.style.width = p + '%';
    if (el.compileProgressLabel) el.compileProgressLabel.textContent = label || ('Compiling\u2026 ' + p + '%');
  }

  function updateCompileButtons() {
    if (el.btnCompile) el.btnCompile.disabled = state.sourceImages.length === 0;
    if (el.btnDownloadMind) el.btnDownloadMind.disabled = !state.compiledMind;
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  function loadHtmlImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not decode image')); };
      img.src = src;
    });
  }

  async function stageSourceImages(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus('Reading ' + files.length + ' image(s)\u2026');
    try {
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        const img = await loadHtmlImage(dataUrl);
        state.sourceImages.push({
          name: file.name,
          file: file,
          dataUrl: dataUrl,
          img: img
        });
      }
      // Show pending preview cards immediately so the user can see what they staged.
      // Each staged image takes the next available index but we mark them pending
      // until compile finishes (no width/height from MindAR yet).
      const previousTargets = state.targets.slice();
      state.targets = state.sourceImages.map(function (s, i) {
        const previous = previousTargets[i];
        return {
          index: i,
          width: s.img.naturalWidth,
          height: s.img.naturalHeight,
          dataUrl: s.dataUrl,
          pending: !state.compiledMind,
          name: s.name,
          // preserve any pairings already wired to this index
          _carryDataUrl: previous && previous.dataUrl
        };
      });
      // Compiled state is invalidated by adding new source images
      state.compiledMind = null;
      updateCompileButtons();
      renderTargets();
      renderPairings();
      setStatus('Staged ' + state.sourceImages.length + ' image(s). Click "Compile targets.mind" to generate.', 'ok');
    } catch (err) {
      console.error(err);
      setStatus('Could not stage images: ' + err.message, 'err');
    }
  }

  async function compileSourceImages() {
    const Compiler = getMindARCompiler();
    if (!Compiler) {
      console.error('[admin] window.MINDAR dump:', window.MINDAR);
      setStatus('MindAR Compiler not found. Check browser console for details.', 'err');
      return;
    }
    if (!state.sourceImages.length) {
      setStatus('Stage at least one target image first.', 'err');
      return;
    }

    if (el.btnCompile) el.btnCompile.disabled = true;
    setCompileProgress(0, 'Compiling\u2026 0%');
    setStatus('Compiling ' + state.sourceImages.length + ' target(s) locally\u2026');

    try {
      const compiler = new Compiler();
      const images = state.sourceImages.map(function (s) { return s.img; });

      await compiler.compileImageTargets(images, function (progress) {
        // MindAR reports progress in 0..100 (sometimes >100 for multi-target jobs)
        const p = typeof progress === 'number' ? progress : 0;
        setCompileProgress(p);
      });

      const buffer = await compiler.exportData();
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      state.compiledMind = { arrayBuffer: buffer, blob: blob };

      // Re-import via the same code path loadMindFile uses, so state.targets has
      // the official width/height/index that MindAR would publish at runtime.
      await compiler.importData(buffer);
      const dataList = compiler.data || compiler.dataList || [];

      const compiledTargets = [];
      for (let i = 0; i < dataList.length; i++) {
        const ti = dataList[i].targetImage || {};
        const src = state.sourceImages[i];
        compiledTargets.push({
          index: i,
          width: ti.width || (src && src.img ? src.img.naturalWidth : 0),
          height: ti.height || (src && src.img ? src.img.naturalHeight : 0),
          dataUrl: src ? src.dataUrl : '',
          pending: false,
          name: src ? src.name : ''
        });
      }
      state.targets = compiledTargets;

      setCompileProgress(100, 'Done');
      setTimeout(function () { setCompileProgress(null); }, 800);

      updateCompileButtons();
      renderTargets();
      renderPairings();
      setStatus('Compiled ' + state.targets.length + ' target(s). Click "Download targets.mind" or "Save & Generate Viewer".', 'ok');
    } catch (err) {
      console.error(err);
      setCompileProgress(null);
      setStatus('Compile failed: ' + err.message, 'err');
    } finally {
      updateCompileButtons();
    }
  }

  function downloadCompiledMind() {
    if (!state.compiledMind) {
      setStatus('Nothing to download yet \u2014 compile first.', 'err');
      return;
    }
    downloadBlob(state.compiledMind.blob, 'targets.mind');
    setStatus('Downloaded targets.mind. Drop it next to index.html in your AR_Poster folder.', 'ok');
  }

  async function loadMindFile(file) {
    const Compiler = getMindARCompiler();
    if (!Compiler) {
      console.error('[admin] window.MINDAR dump:', window.MINDAR);
      setStatus('MindAR Compiler not found. Check browser console for details.', 'err');
      return;
    }
    try {
      setStatus('Decoding targets.mind\u2026');
      const buffer = await file.arrayBuffer();
      const compiler = new Compiler();
      await compiler.importData(buffer);

      const dataList = compiler.data || compiler.dataList || [];
      if (!dataList.length) throw new Error('No targets found in this .mind file.');
      console.log('[admin] targets loaded:', dataList.length);

      // Preserve any reference-image dataUrls the user already picked
      const savedDataUrls = state.targets.map(function (t) { return t.dataUrl || ''; });
      state.targets = [];
      for (let i = 0; i < dataList.length; i++) {
        const ti = dataList[i].targetImage || {};
        state.targets.push({
          index: i,
          width: ti.width || 0,
          height: ti.height || 0,
          dataUrl: savedDataUrls[i] || ''
        });
      }

      // Loading an external .mind invalidates any in-app staged source images:
      // they no longer correspond to the active target indices. Clear them so
      // users don't get confused state.
      state.sourceImages = [];
      state.compiledMind = null;
      updateCompileButtons();

      renderTargets();
      renderPairings();
      setStatus('Loaded ' + state.targets.length + ' target(s).', 'ok');
    } catch (err) {
      console.error(err);
      setStatus('Failed to decode .mind file: ' + err.message, 'err');
    }
  }

  function renderTargets() {
    el.targetsGrid.innerHTML = '';
    if (!state.targets.length) {
      const e = document.createElement('div');
      e.className = 'empty-state';
      e.textContent = 'No targets loaded yet.';
      el.targetsGrid.appendChild(e);
      return;
    }
    state.targets.forEach(function (t) {
      const node = el.tplTarget.content.firstElementChild.cloneNode(true);
      node.dataset.targetIndex = String(t.index);
      node.querySelector('.target-idx').textContent = String(t.index);

      const thumbDiv = node.querySelector('.target-thumb');
      const canvas = node.querySelector('canvas');

      if (t.dataUrl) {
        const img = new Image();
        img.onload = function () {
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
        };
        img.src = t.dataUrl;
        canvas.title = 'Click to change preview image';
      } else {
        // Show placeholder with dimensions
        const placeholder = document.createElement('div');
        placeholder.className = 'thumb-placeholder';
        const dims = (t.width && t.height) ? t.width + ' \u00d7 ' + t.height : 'unknown size';
        placeholder.innerHTML = '<span class="thumb-idx">#' + t.index + '</span><span class="thumb-dims">' + dims + '</span><span class="thumb-hint">Click to add<br>preview image</span>';
        thumbDiv.replaceChild(placeholder, canvas);
      }

      // Click the thumb area to pick a reference photo for this target
      thumbDiv.style.cursor = 'pointer';
      thumbDiv.title = 'Click to set a preview image for this target';
      thumbDiv.addEventListener('click', function () {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'image/*';
        picker.onchange = function () {
          const f = picker.files && picker.files[0];
          if (!f) return;
          const url = URL.createObjectURL(f);
          t.dataUrl = url;
          renderTargets();
          renderPairings();
        };
        picker.click();
      });

      const select = node.querySelector('.target-pair-select');
      rebuildAssetSelect(select, state.pairings.get(t.index));
      select.addEventListener('change', function () {
        if (!select.value) {
          removePairing(t.index);
        } else {
          setPairingAsset(t.index, select.value);
        }
      });

      node.addEventListener('dragover', function (ev) {
        if (ev.dataTransfer && ev.dataTransfer.types.indexOf('application/x-asset-id') !== -1) {
          ev.preventDefault();
          node.classList.add('drag-over');
        }
      });
      node.addEventListener('dragleave', function () { node.classList.remove('drag-over'); });
      node.addEventListener('drop', function (ev) {
        ev.preventDefault();
        node.classList.remove('drag-over');
        const assetId = ev.dataTransfer.getData('application/x-asset-id');
        if (assetId) setPairingAsset(t.index, assetId);
      });

      el.targetsGrid.appendChild(node);
    });
  }

  function rebuildAssetSelect(selectEl, currentPairing) {
    const current = currentPairing ? currentPairing.assetId : '';
    selectEl.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '\u2014 unpaired \u2014';
    selectEl.appendChild(none);
    state.assets.forEach(function (a) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name;
      if (a.id === current) o.selected = true;
      selectEl.appendChild(o);
    });
  }

  // ---------------------------------------------------------------------------
  // Panel 2: Asset upload + staging
  // ---------------------------------------------------------------------------

  async function ingestFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    for (const file of files) {
      const type = inferAssetType(file.name);
      const safeName = sanitizeFilename(file.name);
      const relPath = relPathFor(type, safeName);
      const objectUrl = URL.createObjectURL(file);

      // If a stub already exists for this path (created by applyLoadedConfig),
      // upgrade it in-place so pairings that reference its ID keep working.
      const stub = state.assets.find(function (a) { return a.relPath === relPath; });
      if (stub) {
        if (stub.objectUrl) URL.revokeObjectURL(stub.objectUrl);
        stub.file = file;
        stub.objectUrl = objectUrl;
        stub.written = false;
        stub.type = type;
        stub.name = safeName;
      } else {
        state.assets.push({
          id: 'a' + (++assetIdSeq),
          name: safeName,
          type: type,
          file: file,
          relPath: relPath,
          objectUrl: objectUrl,
          written: false
        });
      }
    }

    setStatus('Staged ' + files.length + ' file(s). Click "Save & Generate Viewer" when ready.');

    renderAssets();
    renderTargets();
    renderPairings();
  }


  function renderAssets() {
    el.assetsGrid.innerHTML = '';
    if (!state.assets.length) {
      const e = document.createElement('div');
      e.className = 'empty-state';
      e.textContent = 'No assets staged yet.';
      el.assetsGrid.appendChild(e);
      return;
    }
    state.assets.forEach(function (a) {
      const node = el.tplAsset.content.firstElementChild.cloneNode(true);
      node.dataset.assetId = a.id;
      const thumb = node.querySelector('.asset-thumb');
      if (a.type === 'image' && a.objectUrl) {
        const img = document.createElement('img');
        img.src = a.objectUrl;
        thumb.appendChild(img);
      } else if (a.type === 'image' && !a.objectUrl) {
        const s = document.createElement('div');
        s.className = 'model-badge';
        s.textContent = 'Upload to preview';
        thumb.appendChild(s);
      } else if (a.type === 'video' && a.objectUrl) {
        const v = document.createElement('video');
        v.src = a.objectUrl;
        v.muted = true;
        v.playsInline = true;
        v.loop = true;
        v.autoplay = true;
        thumb.appendChild(v);
      } else {
        const s = document.createElement('div');
        s.className = 'model-badge';
        s.textContent = '3D model';
        thumb.appendChild(s);
      }
      node.querySelector('.asset-name').textContent = a.name;
      node.querySelector('.asset-type').textContent = a.type;

      node.addEventListener('dragstart', function (ev) {
        node.classList.add('dragging');
        ev.dataTransfer.effectAllowed = 'copyMove';
        ev.dataTransfer.setData('application/x-asset-id', a.id);
        ev.dataTransfer.setData('text/plain', a.name);
      });
      node.addEventListener('dragend', function () { node.classList.remove('dragging'); });

      el.assetsGrid.appendChild(node);
    });
  }


  // ---------------------------------------------------------------------------
  // Panel 3: Pairings + transform editors + mini-preview
  // ---------------------------------------------------------------------------

  function defaultPairing(targetIndex, asset) {
    return {
      targetIndex: targetIndex,
      assetId: asset ? asset.id : null,
      type: asset ? asset.type : 'image',
      src: asset ? asset.relPath : '',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      planeSize: { width: 1, height: 1 },
      tapToEnlarge: true,
      loop: true,
      autoplay: true,
      muted: true
    };
  }

  function setPairingAsset(targetIndex, assetId) {
    const asset = state.assets.find(function (a) { return a.id === assetId; });
    if (!asset) return;
    const existing = state.pairings.get(targetIndex);
    const p = existing ? Object.assign({}, existing) : defaultPairing(targetIndex, asset);
    p.assetId = asset.id;
    p.src = asset.relPath;
    if (!existing) p.type = asset.type;
    state.pairings.set(targetIndex, p);
    renderTargets();
    renderPairings();
  }

  function removePairing(targetIndex) {
    state.pairings.delete(targetIndex);
    renderTargets();
    renderPairings();
  }

  function assetById(id) {
    return state.assets.find(function (a) { return a.id === id; });
  }

  function renderPairings() {
    el.pairingsList.innerHTML = '';
    const keys = Array.from(state.pairings.keys()).sort(function (a, b) { return a - b; });
    if (!keys.length) {
      const e = document.createElement('div');
      e.className = 'empty-state';
      e.textContent = 'Load targets and assets first, then pair them above.';
      el.pairingsList.appendChild(e);
      return;
    }

    keys.forEach(function (idx) {
      const pairing = state.pairings.get(idx);
      const target = state.targets.find(function (t) { return t.index === idx; });
      const asset = assetById(pairing.assetId);
      const row = el.tplPairing.content.firstElementChild.cloneNode(true);
      row.dataset.targetIndex = String(idx);
      row.dataset.type = pairing.type;

      row.querySelector('.pairing-target-idx').textContent = String(idx);
      const rowCanvas = row.querySelector('.pairing-target canvas');
      if (target && target.dataUrl) {
        const img = new Image();
        img.onload = function () {
          rowCanvas.width = img.width;
          rowCanvas.height = img.height;
          rowCanvas.getContext('2d').drawImage(img, 0, 0);
        };
        img.src = target.dataUrl;
      }

      row.querySelector('.pairing-asset-name').textContent = asset ? asset.name : (pairing.src || '(no asset)');
      const typeSel = row.querySelector('.pairing-type');
      typeSel.value = pairing.type;

      const setInput = function (sel, value) { row.querySelector(sel).value = value; };
      setInput('.t-pos-x', pairing.position.x);
      setInput('.t-pos-y', pairing.position.y);
      setInput('.t-pos-z', pairing.position.z);
      setInput('.t-rot-x', pairing.rotation.x);
      setInput('.t-rot-y', pairing.rotation.y);
      setInput('.t-rot-z', pairing.rotation.z);
      setInput('.t-scl-x', pairing.scale.x);
      setInput('.t-scl-y', pairing.scale.y);
      setInput('.t-scl-z', pairing.scale.z);
      setInput('.t-plane-w', pairing.planeSize.width);
      setInput('.t-plane-h', pairing.planeSize.height);
      row.querySelector('.t-tap').checked = !!pairing.tapToEnlarge;
      row.querySelector('.t-loop').checked = !!pairing.loop;
      row.querySelector('.t-autoplay').checked = !!pairing.autoplay;
      row.querySelector('.t-muted').checked = !!pairing.muted;

      const update = function () {
        pairing.type = typeSel.value;
        row.dataset.type = pairing.type;
        pairing.position = {
          x: +row.querySelector('.t-pos-x').value || 0,
          y: +row.querySelector('.t-pos-y').value || 0,
          z: +row.querySelector('.t-pos-z').value || 0
        };
        pairing.rotation = {
          x: +row.querySelector('.t-rot-x').value || 0,
          y: +row.querySelector('.t-rot-y').value || 0,
          z: +row.querySelector('.t-rot-z').value || 0
        };
        pairing.scale = {
          x: +row.querySelector('.t-scl-x').value || 0,
          y: +row.querySelector('.t-scl-y').value || 0,
          z: +row.querySelector('.t-scl-z').value || 0
        };
        pairing.planeSize = {
          width: +row.querySelector('.t-plane-w').value || 0.01,
          height: +row.querySelector('.t-plane-h').value || 0.01
        };
        pairing.tapToEnlarge = row.querySelector('.t-tap').checked;
        pairing.loop = row.querySelector('.t-loop').checked;
        pairing.autoplay = row.querySelector('.t-autoplay').checked;
        pairing.muted = row.querySelector('.t-muted').checked;
        state.pairings.set(idx, pairing);
        updatePreview(row, pairing, target, asset);
      };

      row.querySelectorAll('input, select').forEach(function (input) {
        input.addEventListener('input', update);
        input.addEventListener('change', update);
      });

      row.querySelector('.pairing-remove').addEventListener('click', function () {
        removePairing(idx);
      });

      updatePreview(row, pairing, target, asset);
      el.pairingsList.appendChild(row);
    });
  }

  function updatePreview(row, pairing, target, asset) {
    const stageImg = row.querySelector('.preview-target');
    const overlay = row.querySelector('.preview-overlay');
    if (target && target.dataUrl) stageImg.src = target.dataUrl;

    const stageSize = 220;
    // The target occupies approximately "1 unit" in MindAR space matching the
    // target image aspect. We express the plane as a fraction of the target
    // thumbnail using planeSize (in the same unit space).
    let wFrac = 1, hFrac = 1;
    if (target && target.width && target.height) {
      const ar = target.width / target.height;
      // The MindAR target is normalized to width = 1 on the larger side
      if (ar >= 1) {
        wFrac = pairing.planeSize.width;
        hFrac = pairing.planeSize.height * ar;
      } else {
        wFrac = pairing.planeSize.width / ar;
        hFrac = pairing.planeSize.height;
      }
    } else {
      wFrac = pairing.planeSize.width;
      hFrac = pairing.planeSize.height;
    }

    const pxW = Math.max(4, Math.min(stageSize, wFrac * stageSize));
    const pxH = Math.max(4, Math.min(stageSize, hFrac * stageSize));
    overlay.style.width = pxW + 'px';
    overlay.style.height = pxH + 'px';

    const offX = (pairing.position.x || 0) * stageSize;
    const offY = -(pairing.position.y || 0) * stageSize;
    const rotZ = (pairing.rotation.z || 0);
    overlay.style.transform = 'translate(-50%, -50%) translate(' + offX + 'px,' + offY + 'px) rotate(' + rotZ + 'deg)';

    if (asset && asset.type === 'image') {
      overlay.style.backgroundImage = 'url(' + asset.objectUrl + ')';
      overlay.style.background = 'center / contain no-repeat url(' + asset.objectUrl + ')';
      overlay.style.opacity = '0.9';
    } else if (asset && asset.type === 'video') {
      overlay.style.background = 'rgba(91,156,255,0.25)';
      overlay.textContent = '';
    } else if (asset && asset.type === 'model') {
      overlay.style.background = 'rgba(92,211,138,0.2)';
    } else {
      overlay.style.background = 'rgba(255,255,255,0.15)';
    }
  }

  // ---------------------------------------------------------------------------
  // Viewer HTML generator
  // Produces a self-contained index.html identical in structure to EELabDemos.
  // This is the core fix: static HTML needs no fetch/async at runtime.
  // ---------------------------------------------------------------------------

  function generateViewerHTML(cfg) {
    const opts = cfg;
    const pairings = Array.isArray(cfg.pairings) ? cfg.pairings : [];
    const mindAttr = [
      'imageTargetSrc: ' + (opts.mindSrc || './targets.mind'),
      'maxTrack: ' + (opts.maxTrack || 1),
      'filterMinCF: ' + (opts.filterMinCF || 1e-11),
      'warmupTolerance: ' + (opts.warmupTolerance || 1)
    ].join('; ');

    // Build <a-assets> block
    let assetsHtml = '';
    pairings.forEach(function (p, i) {
      if (!p || !p.src) return;
      const id = 'asset-' + i;
      const src = p.src;
      const type = p.type || 'image';
      if (type === 'video') {
        const loop = p.loop !== false ? 'loop' : '';
        const muted = p.muted !== false ? 'muted' : '';
        const autoplay = p.autoplay !== false ? 'autoplay' : '';
        assetsHtml += `        <video id="${id}" src="${src}" preload="auto" ${loop} ${muted} ${autoplay} playsinline webkit-playsinline crossorigin="anonymous"></video>\n`;
      } else if (type === 'model') {
        assetsHtml += `        <a-asset-item id="${id}" src="${src}"></a-asset-item>\n`;
      } else {
        assetsHtml += `        <img id="${id}" src="${src}" crossorigin="anonymous" />\n`;
      }
    });

    // Build target entity blocks
    let entitiesHtml = '';
    pairings.forEach(function (p, i) {
      if (!p || !p.src || typeof p.targetIndex !== 'number') return;
      const type = p.type || 'image';
      const id = 'asset-' + i;
      const pos = v3(p.position);
      const rot = v3(p.rotation);
      const scl = v3(p.scale, '1 1 1');
      const w = (p.planeSize && p.planeSize.width) || 1;
      const h = (p.planeSize && p.planeSize.height) || 1;

      let inner = '';
      if (type === 'video') {
        inner = `<a-video src="#${id}" width="${w}" height="${h}" position="${pos}" rotation="${rot}" scale="${scl}"></a-video>`;
      } else if (type === 'model') {
        inner = `<a-gltf-model src="#${id}" position="${pos}" rotation="${rot}" scale="${scl}"></a-gltf-model>`;
      } else {
        const clickable = p.tapToEnlarge ? 'class="clickable" popup-on-click' : '';
        inner = `<a-plane ${clickable} src="#${id}" width="${w}" height="${h}" position="${pos}" rotation="${rot}" scale="${scl}" material="transparent: true; alphaTest: 0.01"></a-plane>`;
      }
      entitiesHtml += `      <a-entity mindar-image-target="targetIndex: ${p.targetIndex}">\n        ${inner}\n      </a-entity>\n`;
    });

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AR Poster</title>
    <script src="https://aframe.io/releases/1.5.0/aframe.min.js"><\/script>
    <script src="https://cdn.jsdelivr.net/gh/donmccurdy/aframe-extras@v7.0.0/dist/aframe-extras.min.js"><\/script>
    <script src="https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js"><\/script>

    <style>
      html, body { margin: 0; padding: 0; overflow: hidden; }
      #image-popup-overlay {
        display: none;
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background-color: rgba(0, 0, 0, 0.85);
        z-index: 9999;
        justify-content: center;
        align-items: center;
        cursor: pointer;
      }
      #popup-image {
        max-width: 90%; max-height: 90%;
        object-fit: contain;
        box-shadow: 0px 4px 15px rgba(0,0,0,0.5);
        border-radius: 8px;
      }
    <\/style>

    <script>
      AFRAME.registerComponent('popup-on-click', {
        init: function () {
          const el = this.el;
          const overlay = document.querySelector('#image-popup-overlay');
          const popupImg = document.querySelector('#popup-image');
          el.addEventListener('click', function () {
            const assetId = el.getAttribute('src');
            const assetEl = document.querySelector(assetId);
            if (assetEl) {
              popupImg.src = assetEl.getAttribute('src');
              overlay.style.display = 'flex';
            }
          });
        }
      });
      document.addEventListener('DOMContentLoaded', function () {
        document.querySelector('#image-popup-overlay').addEventListener('click', function () {
          this.style.display = 'none';
          document.querySelector('#popup-image').src = '';
        });
      });
    <\/script>
  </head>
  <body>
    <div id="image-popup-overlay">
      <img id="popup-image" src="" alt="Enlarged Info" />
    </div>

    <a-scene
      mindar-image="${mindAttr}"
      color-space="sRGB"
      renderer="colorManagement: true, physicallyCorrectLights"
      vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: false">

      <a-assets>
${assetsHtml}      </a-assets>

      <a-camera position="0 0 0" look-controls="enabled: false"
        cursor="fuse: false; rayOrigin: mouse;"
        raycaster="near: 0; far: 10000; objects: .clickable">
      </a-camera>

${entitiesHtml}    </a-scene>
  </body>
</html>`;
  }

  function v3(obj, fallback) {
    const f = fallback || '0 0 0';
    if (!obj) return f;
    const x = typeof obj.x === 'number' ? obj.x : 0;
    const y = typeof obj.y === 'number' ? obj.y : 0;
    const z = typeof obj.z === 'number' ? obj.z : 0;
    return x + ' ' + y + ' ' + z;
  }

  // ---------------------------------------------------------------------------
  // Panel 4: Save/Load config.json
  // ---------------------------------------------------------------------------

  function readSceneOptions() {
    return {
      mindSrc: state.sceneOptions.mindSrc,
      maxTrack: +el.optMaxTrack.value || 1,
      filterMinCF: +el.optFilterMinCF.value || 1e-11,
      warmupTolerance: +el.optWarmupTolerance.value || 1
    };
  }

  function buildConfigObject() {
    const opts = readSceneOptions();
    const pairings = [];
    Array.from(state.pairings.keys())
      .sort(function (a, b) { return a - b; })
      .forEach(function (idx) {
        const p = state.pairings.get(idx);
        if (!p || !p.src) return;
        const out = {
          targetIndex: p.targetIndex,
          type: p.type,
          src: p.src,
          position: p.position,
          rotation: p.rotation,
          scale: p.scale,
          planeSize: p.planeSize
        };
        if (p.type === 'image') out.tapToEnlarge = !!p.tapToEnlarge;
        if (p.type === 'video') {
          out.loop = !!p.loop;
          out.autoplay = !!p.autoplay;
          out.muted = !!p.muted;
        }
        pairings.push(out);
      });
    return Object.assign({}, opts, { pairings: pairings });
  }

  async function saveConfig() {
    const cfg = buildConfigObject();
    const json = JSON.stringify(cfg, null, 2);
    const viewerHtml = generateViewerHTML(cfg);

    // Collect any newly-uploaded assets that aren't on disk yet
    const newAssets = state.assets.filter(function (a) { return a.file && !a.written; });
    const hasNewAssets = newAssets.length > 0;
    const hasCompiledMind = !!state.compiledMind;

    if (!hasNewAssets && !hasCompiledMind) {
      // Nothing binary to ship — just the two text files
      downloadBlob(new Blob([viewerHtml], { type: 'text/html' }), 'index.html');
      downloadBlob(new Blob([json], { type: 'application/json' }), 'config.json');
      setStatus('Downloaded index.html + config.json \u2014 drag both into your AR_Poster folder and refresh.', 'ok');
      return;
    }

    // Binary content present (new assets and/or freshly compiled .mind) — zip it.
    if (typeof JSZip === 'undefined') {
      downloadBlob(new Blob([viewerHtml], { type: 'text/html' }), 'index.html');
      downloadBlob(new Blob([json], { type: 'application/json' }), 'config.json');
      if (hasCompiledMind) downloadBlob(state.compiledMind.blob, 'targets.mind');
      setStatus('Downloaded files individually (JSZip unavailable). Place them next to index.html in AR_Poster/.', 'ok');
      return;
    }

    const zip = new JSZip();
    zip.file('index.html', viewerHtml);
    zip.file('config.json', json);
    if (hasCompiledMind) zip.file('targets.mind', state.compiledMind.arrayBuffer);
    for (const a of newAssets) {
      zip.file(a.relPath, a.file);
      a.written = true;
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'AR_Poster-export.zip');
    setStatus('Downloaded AR_Poster-export.zip \u2014 unzip into your AR_Poster folder and refresh.', 'ok');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function loadConfigPrompt() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async function () {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const cfg = JSON.parse(text);
        applyLoadedConfig(cfg);
        setStatus('Loaded existing config.json.', 'ok');
      } catch (err) {
        setStatus('Could not parse config.json: ' + err.message, 'err');
      }
    };
    input.click();
  }

  function applyLoadedConfig(cfg) {
    if (!cfg) return;
    if (typeof cfg.maxTrack === 'number') el.optMaxTrack.value = cfg.maxTrack;
    if (typeof cfg.filterMinCF === 'number') el.optFilterMinCF.value = cfg.filterMinCF;
    if (typeof cfg.warmupTolerance === 'number') el.optWarmupTolerance.value = cfg.warmupTolerance;
    state.pairings = new Map();
    (cfg.pairings || []).forEach(function (p) {
      if (typeof p.targetIndex !== 'number') return;
      // Try to match existing staged asset by relPath; otherwise register a stub.
      const existing = state.assets.find(function (a) { return a.relPath === p.src; });
      let assetId = existing ? existing.id : null;
      if (!existing && p.src) {
        const name = p.src.split('/').pop();
        const stub = {
          id: 'a' + (++assetIdSeq),
          name: name,
          type: p.type || inferAssetType(name),
          file: null,
          relPath: p.src,
          objectUrl: '',
          written: true
        };
        state.assets.push(stub);
        assetId = stub.id;
      }
      state.pairings.set(p.targetIndex, {
        targetIndex: p.targetIndex,
        assetId: assetId,
        type: p.type || 'image',
        src: p.src || '',
        position: p.position || { x: 0, y: 0, z: 0 },
        rotation: p.rotation || { x: 0, y: 0, z: 0 },
        scale: p.scale || { x: 1, y: 1, z: 1 },
        planeSize: p.planeSize || { width: 1, height: 1 },
        tapToEnlarge: p.tapToEnlarge !== false,
        loop: p.loop !== false,
        autoplay: p.autoplay !== false,
        muted: p.muted !== false
      });
    });
    renderAssets();
    renderTargets();
    renderPairings();
  }

  async function tryAutoLoadConfig() {
    try {
      const res = await fetch('./config.json', { cache: 'no-store' });
      if (!res.ok) return;
      const cfg = await res.json();
      if (cfg && Array.isArray(cfg.pairings) && cfg.pairings.length) {
        applyLoadedConfig(cfg);
      } else if (cfg) {
        if (typeof cfg.maxTrack === 'number') el.optMaxTrack.value = cfg.maxTrack;
        if (typeof cfg.filterMinCF === 'number') el.optFilterMinCF.value = cfg.filterMinCF;
        if (typeof cfg.warmupTolerance === 'number') el.optWarmupTolerance.value = cfg.warmupTolerance;
      }
    } catch (err) {
      // ignore - page opened via file:// or config.json absent
    }
  }

  async function tryAutoLoadMind() {
    try {
      const res = await fetch('./targets.mind', { cache: 'no-store' });
      if (!res.ok) return;
      const blob = await res.blob();
      const file = new File([blob], 'targets.mind');
      await loadMindFile(file);
    } catch (err) {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  el.mindInput.addEventListener('change', function () {
    const f = el.mindInput.files && el.mindInput.files[0];
    if (f) loadMindFile(f);
  });

  if (el.srcInput) {
    el.srcInput.addEventListener('change', function () {
      if (el.srcInput.files && el.srcInput.files.length) {
        stageSourceImages(el.srcInput.files);
        el.srcInput.value = '';
      }
    });
  }
  if (el.btnCompile) el.btnCompile.addEventListener('click', compileSourceImages);
  if (el.btnDownloadMind) el.btnDownloadMind.addEventListener('click', downloadCompiledMind);

  document.getElementById('ref-input').addEventListener('change', function () {
    const files = Array.from(this.files || []);
    if (!files.length) return;
    files.forEach(function (f, i) {
      if (i >= state.targets.length) return;
      state.targets[i].dataUrl = URL.createObjectURL(f);
    });
    this.value = '';
    renderTargets();
    renderPairings();
    setStatus('Loaded ' + Math.min(files.length, state.targets.length) + ' reference image(s).', 'ok');
  });
  el.assetInput.addEventListener('change', function () {
    if (el.assetInput.files && el.assetInput.files.length) {
      ingestFiles(el.assetInput.files);
      el.assetInput.value = '';
    }
  });
  el.btnSave.addEventListener('click', saveConfig);
  el.btnLoadConfig.addEventListener('click', loadConfigPrompt);
  el.btnOpenViewer.addEventListener('click', function () {
    window.open('./index.html', '_blank', 'noopener');
  });

  el.assetsHint.textContent += ' Click "Save & Generate Viewer" — index.html and config.json will download automatically.';

  renderTargets();
  renderAssets();
  renderPairings();
  updateCompileButtons();

  (async function boot() {
    await tryAutoLoadMind();
    await tryAutoLoadConfig();
    updateDirStatus();
  })();
})();
