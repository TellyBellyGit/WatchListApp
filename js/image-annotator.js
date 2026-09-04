// ============================================================================
// IMAGE ANNOTATOR — Drawing tools for pasted images
// ============================================================================
// Opens a canvas-based modal on top of a pasted image so the user can annotate
// it (pen, highlighter, arrow, rectangle, ellipse, text, eraser, undo/redo)
// before it is inserted into the editor. The annotations are flattened onto
// the image at full working resolution and the result is returned as a PNG
// blob — the editor data model, storage, and export flows stay unchanged.
//
// Coordinate handling: the canvas backing store is fixed at the image's
// natural resolution (capped at ANNOTATOR_MAX_DIM) and the element is shown
// CSS-scaled to fit the modal. Pointer positions are mapped into canvas space
// with a RATIO (canvas.width / rect.width), never a delta — so devicePixelRatio,
// browser zoom, and window resizing can never cause strokes to drift.
//
// Usage (from the Quill paste handlers):
//   const blob = await imageAnnotator.annotate(pastedBlob);
//   if (blob) { /* upload `blob` and insert into the editor */ }
//   // blob === null means the user cancelled → drop the paste.
// ============================================================================

const ANNOTATOR_MAX_DIM = 1600;

class ImageAnnotator {
  constructor() {
    // DOM refs (markup lives in index.html)
    this._overlay = document.getElementById('image-annotator-overlay');
    this._canvas = document.getElementById('image-annotator-canvas');
    this._ctx = this._canvas.getContext('2d');
    this._wrap = document.getElementById('image-annotator-canvas-wrap');
    this._toolbar = document.getElementById('image-annotator-toolbar');
    this._colorInput = document.getElementById('image-annotator-color');
    this._widthInput = document.getElementById('image-annotator-width');
    this._undoBtn = document.getElementById('image-annotator-undo');
    this._redoBtn = document.getElementById('image-annotator-redo');
    this._clearBtn = document.getElementById('image-annotator-clear');

    // State
    this._img = null;           // HTMLImageElement of the pasted image
    this._sourceBlob = null;    // original pasted blob (for "Insert as-is")
    this._naturalW = 0;         // canvas backing-store size
    this._naturalH = 0;
    this._fontSize = 20;
    this._strokes = [];         // committed strokes (draw order = render order)
    this._redoStack = [];       // strokes removed by Undo (for Redo)
    this._currentStroke = null; // stroke being drawn right now
    this._tool = 'pen';
    this._color = '#ff3b30';
    this._width = 4;
    this._drawing = false;
    this._resolve = null;       // promise resolver from annotate()
    this._replaceMode = false;  // true when re-annotating an image already in an editor
    this._pendingAnnotate = null; // { quill, img, getFolderId, onChanged } for the hover button
    this._hoverBtn = null;      // floating "✏️ annotate" button over existing editor images
    this._attachedQuills = new WeakSet(); // Quill editors already wired for existing-image editing

    // Offscreen annotation layer — eraser only affects annotations, never the photo.
    this._annotCanvas = document.createElement('canvas');
    this._annotCtx = this._annotCanvas.getContext('2d');

    this._bindEvents();
    this._updateToolbarState();
  }

  // ---- Public API ----
  // Returns Promise<Blob|null>: annotated PNG blob (or original blob when the
  // user picked "Insert as-is"), or null when the paste was cancelled/dropped.
  annotate(blob, opts) {
    if (this._overlay.style.display === 'flex') {
      // Already annotating — drop the extra paste rather than overlap modals.
      return Promise.resolve(null);
    }
    this._replaceMode = !!(opts && opts.replace);
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._sourceBlob = blob;
      this._loadImage(blob);
    });
  }

  // ---- Image loading ----
  _loadImage(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);

      // Cap the working resolution so huge screenshots stay manageable.
      // (storage.js already downscales pasted images to 1200px on upload.)
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const maxDim = Math.max(w, h);
      if (maxDim > ANNOTATOR_MAX_DIM) {
        const ratio = ANNOTATOR_MAX_DIM / maxDim;
        w = Math.max(1, Math.round(w * ratio));
        h = Math.max(1, Math.round(h * ratio));
      }

      this._img = img;
      this._naturalW = w;
      this._naturalH = h;
      this._fontSize = Math.max(14, Math.round(w / 40));

      // Backing store = natural resolution. NEVER changes after this — window
      // resizes only adjust the CSS size via _fitCanvas(), so content survives.
      this._canvas.width = w;
      this._canvas.height = h;
      this._annotCanvas.width = w;
      this._annotCanvas.height = h;

      this._strokes = [];
      this._redoStack = [];
      this._currentStroke = null;
      this._drawing = false;

      this._show();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this._finish(null);
    };
    img.src = url;
  }

  // ---- Annotate images already inserted in an editor ----
  // Attaches a hover "✏️" button over images inside the given Quill editor.
  // Clicking it loads the existing image (CORS-enabled via cors.json), opens
  // the annotator, and replaces the image embed in place with the annotated
  // PNG once saved. Cancel leaves the image untouched.
  attachEditorImageEditing(quill, getFolderId, onChanged) {
    if (!quill || !quill.root) return;
    if (this._attachedQuills.has(quill)) return;
    this._attachedQuills.add(quill);

    // One reusable floating button shared by all editors
    if (!this._hoverBtn) {
      this._hoverBtn = document.createElement('button');
      this._hoverBtn.type = 'button';
      this._hoverBtn.className = 'ql-editor-annotate-btn';
      this._hoverBtn.title = 'Annotate image';
      this._hoverBtn.setAttribute('aria-label', 'Annotate image');
      this._hoverBtn.textContent = '✏️';
      this._hoverBtn.style.display = 'none';
      document.body.appendChild(this._hoverBtn);
      this._hoverBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      this._hoverBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const job = this._pendingAnnotate;
        this._pendingAnnotate = null;
        this._hideHoverButton();
        if (job) this._annotateExisting(job.quill, job.img, job.getFolderId, job.onChanged);
      });
    }

    const showFor = (img) => {
      if (this._isOpen()) return;
      this._pendingAnnotate = { quill, img, getFolderId, onChanged };
      this._positionHoverButton(img);
    };
    const hide = () => this._hideHoverButton();

    quill.root.addEventListener('pointerover', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG') showFor(t);
      else hide();
    });
    quill.root.addEventListener('pointerout', (e) => {
      const rt = e.relatedTarget;
      if (rt && (rt === this._hoverBtn || (this._hoverBtn && this._hoverBtn.contains(rt)))) return;
      hide();
    });
    // Hide the button while the editor content scrolls
    quill.root.addEventListener('scroll', hide, true);
  }

  _positionHoverButton(img) {
    if (!this._hoverBtn || !img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const size = 32;
    const left = Math.min(Math.max(8, rect.right - size - 4), window.innerWidth - size - 8);
    const top = Math.max(8, rect.top + 8);
    this._hoverBtn.style.left = left + 'px';
    this._hoverBtn.style.top = top + 'px';
    this._hoverBtn.style.display = 'flex';
  }

  _hideHoverButton() {
    if (this._hoverBtn) this._hoverBtn.style.display = 'none';
  }

  // Loads the hovered image, opens the annotator, uploads the annotated PNG
  // to the review folder, and replaces the image embed in place.
  async _annotateExisting(quill, img, getFolderId, onChanged) {
    const url = img.currentSrc || img.src;
    if (!url) return;

    // Load the existing image as a blob. cors.json allows * origins, so the
    // fetched blob is CORS-clean and can never taint the annotation canvas.
    let blob;
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      blob = await resp.blob();
      if (!blob || !blob.type.startsWith('image/')) throw new Error('Response is not an image');
    } catch (err) {
      console.error('[ImageAnnotator] Could not load existing image:', url, err.message || err);
      this._toast('Could not load image for annotation — it may be offline or deleted');
      return;
    }

    // Open the annotator in replace mode (no "Insert as-is" — Save replaces,
    // Cancel leaves the original image untouched).
    const annotatedBlob = await this.annotate(blob, { replace: true });
    if (!annotatedBlob) return;

    try {
      const folderId = getFolderId ? getFolderId() : 'general';
      const downloadUrl = await imageStorage.uploadImage(annotatedBlob, folderId);
      if (!downloadUrl || downloadUrl.startsWith('data:')) {
        throw new Error('Upload returned a data URI instead of Storage URL');
      }
      this._replaceImageEmbed(quill, img, downloadUrl);
      if (onChanged) onChanged();
      this._toast('Image updated with annotations', 'success');
    } catch (err) {
      console.error('[ImageAnnotator] Annotated image upload failed:', err.message || err);
      this._toast('Annotation upload failed — check Firebase Storage is enabled and CORS is configured');
    }
  }

  // Replaces an image embed in the Quill delta so auto-save persists the change.
  _replaceImageEmbed(quill, imgNode, newUrl) {
    if (typeof Quill !== 'undefined') {
      try {
        const blot = Quill.find(imgNode);
        if (blot) {
          const index = quill.getIndex(blot);
          quill.deleteText(index, 1);
          quill.insertEmbed(index, 'image', newUrl);
          quill.setSelection(index + 1);
          return;
        }
      } catch (err) {
        console.warn('[ImageAnnotator] Quill embed replacement failed, falling back to src swap:', err.message || err);
      }
    }
    // Fallback: swap the src attribute directly
    imgNode.src = newUrl;
  }

  _toast(msg, type) {
    if (typeof Utils !== 'undefined' && Utils.showToast) {
      Utils.showToast(msg, type);
    } else {
      console.warn('[ImageAnnotator]', msg);
    }
  }

  // ---- Show / hide ----
  _show() {
    this._overlay.style.display = 'flex';
    document.body.classList.add('overlay-open');
    // Re-annotating an existing image has no "Insert as-is" option.
    const rawBtn = document.getElementById('image-annotator-raw');
    if (rawBtn) rawBtn.style.display = this._replaceMode ? 'none' : '';
    this._hideHoverButton();
    this._fitCanvas();
    this._render();
    this._updateToolbarState();
    // Re-fit when the window changes size (backing store is untouched).
    window.addEventListener('resize', this._onResize);
  }

  _hide() {
    window.removeEventListener('resize', this._onResize);
    this._overlay.style.display = 'none';
    document.body.classList.remove('overlay-open');
  }

  _finish(resultBlob) {
    this._hide();
    const resolve = this._resolve;
    this._resolve = null;
    this._img = null;
    this._sourceBlob = null;
    this._replaceMode = false;
    if (resolve) resolve(resultBlob);
  }

  _isOpen() {
    return this._overlay.style.display === 'flex';
  }

  _onResize = () => {
    if (this._isOpen()) this._fitCanvas();
  };

  // ---- Canvas display sizing ----
  // Only the CSS size changes here; the backing store is fixed at natural res.
  _fitCanvas() {
    const availW = this._wrap.clientWidth || Math.round(window.innerWidth * 0.9);
    const maxW = Math.max(120, availW - 24);
    const maxH = Math.max(200, window.innerHeight * 0.62);
    const scale = Math.min(1, maxW / this._naturalW, maxH / this._naturalH);
    this._canvas.style.width = Math.max(1, Math.round(this._naturalW * scale)) + 'px';
    this._canvas.style.height = Math.max(1, Math.round(this._naturalH * scale)) + 'px';
  }

  // ---- Pointer → canvas coordinate mapping ----
  // Pure ratio mapping: devicePixelRatio and CSS scaling cancel out entirely.
  _pos(e) {
    const rect = this._canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) * (this._naturalW / rect.width),
      y: (e.clientY - rect.top) * (this._naturalH / rect.height)
    };
  }

  // ---- Event binding ----
  _bindEvents() {
    // Tool selection
    this._toolbar.querySelectorAll('.annot-tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => this._selectTool(btn.dataset.tool));
    });

    // Color / width
    this._colorInput.addEventListener('input', () => { this._color = this._colorInput.value; });
    this._widthInput.addEventListener('input', () => {
      this._width = parseInt(this._widthInput.value, 10) || 4;
    });

    // Undo / redo / clear
    this._undoBtn.addEventListener('click', () => this._undo());
    this._redoBtn.addEventListener('click', () => this._redo());
    this._clearBtn.addEventListener('click', () => {
      this._strokes = [];
      this._redoStack = [];
      this._currentStroke = null;
      this._render();
      this._updateToolbarState();
    });

    // Header actions
    document.getElementById('image-annotator-save').addEventListener('click', () => this._save());
    document.getElementById('image-annotator-raw').addEventListener('click', () => {
      this._finish(this._sourceBlob);
    });
    document.getElementById('image-annotator-cancel').addEventListener('click', () => this._finish(null));

    // Canvas drawing (Pointer Events + capture → smooth mouse & touch)
    this._canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this._canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this._canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this._canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    this._canvas.addEventListener('pointerleave', (e) => {
      if (this._drawing) this._onPointerUp(e);
    });

    // Keyboard: Escape = cancel, Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z / Ctrl+Y = redo.
    // Registered before app.js's handlers (script order), and stopImmediatePropagation
    // prevents other overlays from reacting to Escape while the annotator is open.
    document.addEventListener('keydown', (e) => {
      if (!this._isOpen()) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._finish(null);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.shiftKey) this._redo();
        else this._undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._redo();
      }
    });
  }

  _selectTool(tool) {
    this._tool = tool;
    this._toolbar.querySelectorAll('.annot-tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    // Sensible default widths per tool
    if (tool === 'highlighter' && this._width < 12) {
      this._width = 18;
      this._widthInput.value = '18';
    } else if (tool === 'eraser' && this._width < 8) {
      this._width = 16;
      this._widthInput.value = '16';
    } else if (tool === 'text') {
      this._width = this._fontSize;
    }
    this._updateToolbarState();
  }

  // ---- Pointer handlers ----
  _onPointerDown(e) {
    if (!this._img) return;
    e.preventDefault();
    const p = this._pos(e);

    // Text tool: click to place (prompt for content, no drag needed)
    if (this._tool === 'text') {
      const text = window.prompt('Enter annotation text:', '');
      if (text && text.trim()) {
        this._strokes.push({
          tool: 'text',
          color: this._color,
          text: text.trim(),
          x: p.x,
          y: p.y,
          fontSize: this._fontSize
        });
        this._redoStack = [];
        this._render();
        this._updateToolbarState();
      }
      return;
    }

    try { this._canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this._drawing = true;

    if (this._tool === 'pen' || this._tool === 'highlighter' || this._tool === 'eraser') {
      this._currentStroke = {
        tool: this._tool,
        color: this._color,
        width: this._width,
        points: [p]
      };
    } else {
      // arrow | rect | ellipse
      this._currentStroke = {
        tool: this._tool,
        color: this._color,
        width: this._width,
        x1: p.x, y1: p.y,
        x2: p.x, y2: p.y
      };
    }
    this._render();
  }

  _onPointerMove(e) {
    if (!this._drawing || !this._currentStroke) return;
    e.preventDefault();
    const p = this._pos(e);
    if (this._currentStroke.points) {
      this._currentStroke.points.push(p);
    } else {
      this._currentStroke.x2 = p.x;
      this._currentStroke.y2 = p.y;
    }
    this._render();
  }

  _onPointerUp(e) {
    if (!this._drawing) return;
    this._drawing = false;
    try { this._canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    if (this._currentStroke) {
      this._strokes.push(this._currentStroke);
      this._currentStroke = null;
      this._redoStack = []; // new stroke invalidates redo history
      this._updateToolbarState();
    }
    this._render();
  }

  // ---- Undo / redo ----
  _undo() {
    if (!this._strokes.length) return;
    this._redoStack.push(this._strokes.pop());
    this._currentStroke = null;
    this._render();
    this._updateToolbarState();
  }

  _redo() {
    if (!this._redoStack.length) return;
    this._strokes.push(this._redoStack.pop());
    this._currentStroke = null;
    this._render();
    this._updateToolbarState();
  }

  _updateToolbarState() {
    this._undoBtn.disabled = this._strokes.length === 0;
    this._redoBtn.disabled = this._redoStack.length === 0;
    this._clearBtn.disabled = this._strokes.length === 0;
  }

  // ---- Rendering ----
  _render() {
    const ctx = this._ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._naturalW, this._naturalH);
    if (this._img) {
      ctx.drawImage(this._img, 0, 0, this._naturalW, this._naturalH);
    }

    // Rebuild the annotation layer from scratch — eraser strokes depend on
    // being rendered after the strokes they erase.
    const actx = this._annotCtx;
    actx.setTransform(1, 0, 0, 1, 0, 0);
    actx.clearRect(0, 0, this._naturalW, this._naturalH);
    for (const s of this._strokes) this._drawStroke(actx, s);
    ctx.drawImage(this._annotCanvas, 0, 0);

    // Live preview of the in-progress stroke (drawn directly on top)
    if (this._currentStroke) this._drawStroke(ctx, this._currentStroke);
  }

  _drawStroke(ctx, s) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (s.tool === 'eraser') {
      // Erases only the annotation layer (never the photo).
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = s.width;
      this._strokePath(ctx, s);
    } else if (s.tool === 'pen') {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      this._strokePath(ctx, s);
    } else if (s.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = Math.max(s.width, 12);
      this._strokePath(ctx, s);
    } else if (s.tool === 'arrow') {
      const x1 = s.x1, y1 = s.y1, x2 = s.x2, y2 = s.y2;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (len > 1) {
        const angle = Math.atan2(dy, dx);
        const head = Math.max(10, s.width * 3.2);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    } else if (s.tool === 'rect') {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      const x = Math.min(s.x1, s.x2);
      const y = Math.min(s.y1, s.y2);
      ctx.strokeRect(x, y, Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    } else if (s.tool === 'ellipse') {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      const cx = (s.x1 + s.x2) / 2;
      const cy = (s.y1 + s.y2) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.tool === 'text') {
      ctx.font = `${Math.max(12, Math.round(s.fontSize))}px Inter, 'Segoe UI', sans-serif`;
      ctx.fillStyle = s.color;
      // Soft outline so text stays readable over light/dark image areas
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = Math.max(2, Math.round(s.fontSize / 12));
      ctx.strokeText(s.text, s.x, s.y);
      ctx.fillText(s.text, s.x, s.y);
    }
    ctx.restore();
  }

  _strokePath(ctx, s) {
    if (!s.points || !s.points.length) return;
    const pts = s.points;
    if (pts.length === 1) {
      // Single tap → dot
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, s.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  // ---- Save / flatten ----
  _save() {
    if (!this._img) return;

    // Commit an in-progress stroke first
    if (this._currentStroke) {
      this._strokes.push(this._currentStroke);
      this._currentStroke = null;
      this._updateToolbarState();
    }
    this._render();

    // Composite base image + annotations at full working resolution → PNG.
    const out = document.createElement('canvas');
    out.width = this._naturalW;
    out.height = this._naturalH;
    const octx = out.getContext('2d');
    octx.drawImage(this._img, 0, 0, this._naturalW, this._naturalH);
    octx.drawImage(this._annotCanvas, 0, 0);

    out.toBlob((blob) => {
      this._finish(blob);
    }, 'image/png');
  }
}

// Global singleton
const imageAnnotator = new ImageAnnotator();
