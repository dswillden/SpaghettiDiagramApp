// Spaghetti Diagram Application
class SpaghettiDiagramApp {
    constructor() {
        this.canvas = document.getElementById('workspaceCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentTool = 'select';
        this.isDrawing = false;
        this.isDragging = false;
        this.isResizing = false;
        
        // Application state
        this.objects = [];
        this.paths = [];
        this.obstacles = [];
        this.backgroundImage = null;
        this.backgroundPdfPageCanvas = null; // offscreen canvas for rendered PDF page
        this.backgroundTransform = { rotation: 0, flipH: false, flipV: false };
        // New: persistent world-space rectangle for background (image or pdf page)
        this.backgroundRect = null; // { x, y, width, height } in world coords
        this.selectedObject = null;
        this.currentPath = [];
        this.currentObstacle = null;
        this.tempPathPoints = null;
        
        // Flag to ensure we only apply the deferred initial reset once
        // this._initialViewApplied = false; // Removed _initialViewApplied flag (no longer needed)
        // Track if user has manually changed viewport (pan/zoom) to avoid auto recenters later
        this._userViewportChanged = false;
        
        // Path endpoint selection state
        this.selectedPath = null;
        this.selectedEndpoint = null; // 'start' or 'end'
        this.isDraggingEndpoint = false;
        
        // Mouse state
        this.mousePos = { x: 0, y: 0 };
        this.dragStart = { x: 0, y: 0 };
        this.resizeHandle = null;
        
        // Delete mode state
        this.hoveredDeleteItem = null;
        this.deleteTooltip = null;
        this.deleteHighlight = null; // { item, type }
        
        // Accessibility / help modal state
        this._lastFocusedBeforeHelp = null;
        this._helpFocusHandler = null;
        
        // Predefined object templates
        this.objectTemplates = [
            {name: "Desk", width: 60, height: 30, color: "#8B4513"},
            {name: "Machine", width: 40, height: 40, color: "#696969"},
            {name: "Shelf", width: 20, height: 80, color: "#DEB887"},
            {name: "Chair", width: 25, height: 25, color: "#654321"},
            {name: "Toolbox", width: 30, height: 20, color: "#FF6347"},
            {name: "Workstation", width: 50, height: 40, color: "#4682B4"},
            {name: "Storage", width: 35, height: 35, color: "#9ACD32"},
            {name: "Equipment", width: 45, height: 35, color: "#DC143C"}
        ];
        
        // Debug flag (enable via ?debug=1 in URL)
        const params = new URLSearchParams(window.location.search || '');
        this.debug = params.get('debug') === '1';
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.populateObjectPalette();
        this.populateObjectTypeSelect();
        this.updateAnalytics();
        
        // Default scale settings
        this.units = 'ft'; // 'ft' or 'm'
        this.unitsPerPixel = 0; // real-world units per pixel (0 = undefined)
        this.stepsPerUnit = 0; // steps per unit (e.g., 0.4 steps/ft)
        this.gridCellUnits = 1; // default 1 unit per grid cell
        this.isCalibrating = false;
        this.calibrationPoints = [];
        
        // Initialize viewport with proper defaults BEFORE loading from storage
        this.zoom = 1;
        this.pan = { x: 0, y: 0 }; // in screen pixels
        this.isPanning = false;
        this.lastClientPos = { x: 0, y: 0 };
        
        this.loadScaleFromStorage();
        this.updateScaleUI();
        
        // Initial render BEFORE any background so grid visible immediately
        this.render();
        // Palette reliability: schedule a few RAF retries
        this.ensureObjectPalette();
        let _paletteRetries = 0;
        const _retryPalette = () => {
            this.ensureObjectPalette();
            if (++_paletteRetries < 3) requestAnimationFrame(_retryPalette);
        };
        requestAnimationFrame(_retryPalette);
        
        // No deferred reset; only fit when background arrives
        this.setTool('select');
        
        console.log('[Init] App ready (no deferred reset).');
    }
    
    setLoading(isLoading, message) {
        const overlay = document.getElementById('loadingOverlay');
        if (!overlay) return;
        if (isLoading) {
            overlay.classList.remove('hidden');
            overlay.setAttribute('aria-busy', 'true');
            const textEl = overlay.querySelector('.loading-text');
            if (textEl && message) textEl.textContent = message;
        } else {
            overlay.classList.add('hidden');
            overlay.setAttribute('aria-busy', 'false');
        }
    }

    showInfoMessage(msg, type = 'info', timeout = 3500) {
        // Types: info, success, warning, error
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.style.position = 'fixed';
            container.style.top = '12px';
            container.style.right = '12px';
            container.style.zIndex = 3000;
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '8px';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.setAttribute('role', 'status');
        toast.style.padding = '8px 12px';
        toast.style.borderRadius = '6px';
        toast.style.fontSize = '13px';
        toast.style.fontWeight = '500';
        toast.style.fontFamily = 'inherit';
        toast.style.color = '#fff';
        toast.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';
        toast.style.backdropFilter = 'blur(4px)';
        const colors = {
            info: 'var(--color-primary, #2979ff)',
            success: 'var(--color-success, #2e7d32)',
            warning: 'var(--color-warning, #ed6c02)',
            error: 'var(--color-error, #d32f2f)'
        };
        toast.style.background = colors[type] || colors.info;
        toast.textContent = msg;
        container.appendChild(toast);
        if (timeout > 0) {
            setTimeout(() => {
                toast.style.transition = 'opacity 250ms ease';
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 260);
            }, timeout);
        }
        return toast;
    }
    
    setupEventListeners() {
        // Canvas events
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
        
        // Prevent context menu on canvas
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Enable HTML5 drag-over/drop on canvas (and overlay) to place objects
        const allowDrop = (ev) => { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'; };
        const handleDrop = this.handleCanvasDrop.bind(this);
        this.canvas.addEventListener('dragover', allowDrop);
        this.canvas.addEventListener('drop', handleDrop);
        const overlayEl = document.getElementById('canvasOverlay');
        if (overlayEl) {
            overlayEl.addEventListener('dragover', allowDrop);
            overlayEl.addEventListener('drop', handleDrop);
        }
        
        // Tool buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', this.handleToolChange.bind(this));
        });
        
        // Scale controls
        const unitsSelect = document.getElementById('unitsSelect');
        const stepsPerUnitInput = document.getElementById('stepsPerUnit');
        const gridCellUnitsInput = document.getElementById('gridCellUnits');
        const calibrateBtn = document.getElementById('calibrateScale');
        const resetScaleBtn = document.getElementById('resetScale');
        const persist = () => this.saveScaleToStorage();
        if (unitsSelect) unitsSelect.addEventListener('change', (e) => { this.units = e.target.value; this.updateScaleUI(); this.updateAnalytics(); this.render(); persist(); });
        if (stepsPerUnitInput) stepsPerUnitInput.addEventListener('change', (e) => { this.stepsPerUnit = Math.max(0, parseFloat(e.target.value) || 0); this.updateScaleUI(); this.updateAnalytics(); persist(); });
        if (gridCellUnitsInput) gridCellUnitsInput.addEventListener('change', (e) => { this.gridCellUnits = Math.max(0.01, parseFloat(e.target.value) || 1); this.render(); persist(); });
        if (calibrateBtn) calibrateBtn.addEventListener('click', () => this.beginCalibration());
        if (resetScaleBtn) resetScaleBtn.addEventListener('click', () => { this.resetScale(); persist(); });
        
        // File upload (image or PDF)
        document.getElementById('backgroundUpload').addEventListener('change', this.handleBackgroundUpload.bind(this));
        
        // Background orientation controls
        document.getElementById('rotateLeft').addEventListener('click', () => this.rotateBackground(-90));
        document.getElementById('rotateRight').addEventListener('click', () => this.rotateBackground(90));
        document.getElementById('flipH').addEventListener('click', () => this.flipBackground('h'));
        document.getElementById('flipV').addEventListener('click', () => this.flipBackground('v'));
        document.getElementById('resetOrientation').addEventListener('click', () => this.resetBackgroundTransform());
        
        // Zoom controls (refactored to use setZoom with anchor centering)
        this.zoom = this.zoom || 1;
        const zoomInBtn = document.getElementById('zoomIn');
        const zoomOutBtn = document.getElementById('zoomOut');
        const resetZoomBtn = document.getElementById('resetZoom');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.setZoom(this.zoom * 1.2));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.setZoom(this.zoom / 1.2));
        if (resetZoomBtn) resetZoomBtn.addEventListener('click', () => this.setZoom(1));
        const resetViewBtn = document.getElementById('resetView');
        if (resetViewBtn) resetViewBtn.addEventListener('click', () => { this.resetView(); });

        // Defensive: delegate clicks for header buttons in case individual listeners fail to bind
        document.addEventListener('click', (ev) => {
            const btn = ev.target.closest('#rotateLeft, #rotateRight, #flipH, #flipV, #resetOrientation, #zoomIn, #zoomOut, #resetZoom, #resetView, #clearAll, #exportData');
            if (!btn) return;
            switch (btn.id) {
                case 'rotateLeft': return this.rotateBackground(-90);
                case 'rotateRight': return this.rotateBackground(90);
                case 'flipH': return this.flipBackground('h');
                case 'flipV': return this.flipBackground('v');
                case 'resetOrientation': return this.resetBackgroundTransform();
                case 'zoomIn': return this.setZoom(this.zoom * 1.2);
                case 'zoomOut': return this.setZoom(this.zoom / 1.2);
                case 'resetZoom': return this.setZoom(1);
                case 'resetView': return this.resetView();
                case 'clearAll': return this.clearAll();
                case 'exportData': return this.exportData();
            }
        });
        
        // Mouse wheel zoom (no modifier) with cursor focus - refactored to use setZoom anchoring
        this.canvas.addEventListener('wheel', (ev) => {
            ev.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const screenX = ev.clientX - rect.left;
            const screenY = ev.clientY - rect.top;
            const factor = ev.deltaY > 0 ? 1/1.1 : 1.1;
            this.setZoom((this.zoom || 1) * factor, screenX, screenY);
        }, { passive: false });
        
        
        // Action buttons
        document.getElementById('clearAll').addEventListener('click', this.clearAll.bind(this));
        document.getElementById('exportData').addEventListener('click', this.exportData.bind(this));
        
        // Modal events
        this.setupModalEvents();
        
        // Object palette (guarded in case element is missing)
        const paletteEl = document.getElementById('objectPalette');
        if (paletteEl) {
            paletteEl.addEventListener('click', this.handleObjectPaletteClick.bind(this));
            // Drag start from palette
            paletteEl.addEventListener('dragstart', this.handlePaletteDragStart.bind(this));
        } else {
            console.warn('[Init] #objectPalette not found at startup. Palette click handler not bound.');
        }

        // Help / Shortcuts modal buttons
        const openHelpBtn = document.getElementById('openHelp');
        const closeHelpBtn = document.getElementById('closeHelpModal');
        const closeHelpFooterBtn = document.getElementById('closeHelpFooter');
        const helpModal = document.getElementById('helpModal');
        if (openHelpBtn) openHelpBtn.addEventListener('click', () => this.openHelpModal());
        if (closeHelpBtn) closeHelpBtn.addEventListener('click', () => this.closeHelpModal());
        if (closeHelpFooterBtn) closeHelpFooterBtn.addEventListener('click', () => this.closeHelpModal());
        if (helpModal) helpModal.addEventListener('click', (e) => { if (e.target === helpModal) this.closeHelpModal(); });

        // Global keyboard shortcuts (tools, help, etc.) added in modal setup for consolidation
    }
    
    setupModalEvents() {
        // Path modal
        document.getElementById('closePathModal').addEventListener('click', this.closePathModal.bind(this));
        document.getElementById('cancelPath').addEventListener('click', this.closePathModal.bind(this));
        document.getElementById('pathForm').addEventListener('submit', this.savePathMetadata.bind(this));
        
        // Object modal
        document.getElementById('closeObjectModal').addEventListener('click', this.closeObjectModal.bind(this));
        document.getElementById('deleteObject').addEventListener('click', this.deleteSelectedObject.bind(this));
        document.getElementById('objectForm').addEventListener('submit', this.updateObjectMetadata.bind(this));
        
        // Calibration modal
        const calibModal = document.getElementById('calibrateModal');
        const closeCalib = document.getElementById('closeCalibrateModal');
        const cancelCalib = document.getElementById('cancelCalibration');
        const confirmCalib = document.getElementById('confirmCalibration');
        const redoCalib = document.getElementById('redoCalibration');
        if (closeCalib) closeCalib.addEventListener('click', this.closeCalibrateModal.bind(this));
        if (cancelCalib) cancelCalib.addEventListener('click', this.closeCalibrateModal.bind(this));
        if (redoCalib) redoCalib.addEventListener('click', () => { this.calibrationPoints = []; this.updateCalibrateInfo(0); this.closeCalibrateModal(); this.beginCalibration(); });
        if (confirmCalib) confirmCalib.addEventListener('click', this.applyCalibrationFromModal.bind(this));
        if (calibModal) calibModal.addEventListener('click', (e) => { if (e.target.classList.contains('modal')) this.closeCalibrateModal(); });
        
        // Close modals on backdrop click
        document.getElementById('pathModal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) this.closePathModal();
        });
        document.getElementById('objectModal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) this.closeObjectModal();
        });
        
        // Close modals on Escape key and handle Delete key + global shortcuts
        document.addEventListener('keydown', (e) => {
            const target = e.target;
            const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
            const helpModal = document.getElementById('helpModal');
            const helpOpen = helpModal && !helpModal.classList.contains('hidden');
            const anyOtherModalOpen = ['pathModal','objectModal','calibrateModal','deleteModal'].some(id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
            
            // Tool shortcuts (ignore while typing inside form fields or when other modals are open)
            if (!isTyping && !anyOtherModalOpen) {
                if (['s','S'].includes(e.key)) { this.setTool('select'); }
                else if (['p','P'].includes(e.key)) { this.setTool('path'); }
                else if (['o','O'].includes(e.key)) { this.setTool('obstacle'); }
                else if (['d','D'].includes(e.key)) { this.setTool('delete'); }
                else if (e.key === '?') { // Toggle help
                    e.preventDefault();
                    if (helpOpen) this.closeHelpModal(); else this.openHelpModal();
                    return;
                }
            }

            if (e.key === 'Escape') {
                // If help open, close and return
                if (helpOpen) { this.closeHelpModal(); return; }
                // Cancel drawing first if applicable
                if (this.isDrawing) {
                    this.isDrawing = false;
                    this.currentPath = [];
                    this.currentObstacle = null;
                    this.render();
                }
                // Existing modal closures
                this.closePathModal();
                this.closeObjectModal();
                this.closeDeleteModal();
                this.closeCalibrateModal();
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedObject && !isTyping) {
                e.preventDefault();
                this.showDeleteConfirmation(this.selectedObject, 'object');
            }
        });
    }
    
    populateObjectPalette() {
        const palette = document.getElementById('objectPalette');
        palette.innerHTML = '';
        
        this.objectTemplates.forEach(template => {
            const item = document.createElement('div');
            item.className = 'object-item';
            item.dataset.objectType = template.name;
            item.setAttribute('tabindex','0');
            item.setAttribute('role','button');
            item.setAttribute('aria-label', `Add ${template.name}`);
            // Make draggable for drag-and-drop to canvas
            item.setAttribute('draggable', 'true');
            
            const preview = document.createElement('div');
            preview.className = 'object-preview';
            preview.style.backgroundColor = template.color;
            
            const label = document.createElement('div');
            label.textContent = template.name;
            
            item.appendChild(preview);
            item.appendChild(label);
            palette.appendChild(item);
        });
    }
    
    // New: safeguard to restore object palette if it becomes empty or was not rendered
    ensureObjectPalette() {
        const palette = document.getElementById('objectPalette');
        if (!palette) { console.warn('[Palette] #objectPalette not found.'); return; }
        const hasItem = palette.querySelector('.object-item');
        if (!hasItem) {
            console.info('[Palette] Empty palette detected – repopulating.');
            this.populateObjectPalette();
        }
    }
    
    populateObjectTypeSelect() {
        const select = document.getElementById('objectType');
        select.innerHTML = '';
        
        this.objectTemplates.forEach(template => {
            const option = document.createElement('option');
            option.value = template.name;
            option.textContent = template.name;
            select.appendChild(option);
        });
    }
    
    handleToolChange(e) {
        const toolBtn = e.target.closest('.tool-btn');
        if (!toolBtn) return;
        
        const tool = toolBtn.dataset.tool;
        this.setTool(tool);
    }
    
    setTool(tool) {
        this.currentTool = tool;
        
        // Clear any ongoing operations
        this.isDrawing = false;
        this.isDragging = false;
        this.isResizing = false;
        this.currentPath = [];
        this.currentObstacle = null;
        
        // Clear delete mode state when switching tools
        this.hoveredDeleteItem = null;
        this.deleteHighlight = null;
        this.hideDeleteTooltip();
        
        // Update button states
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        });
        
        const activeBtn = document.querySelector(`[data-tool="${tool}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.setAttribute('aria-pressed', 'true');
        }
        
        // Update canvas cursor class and container class for delete mode
        this.canvas.className = '';
        this.canvas.classList.add(`${tool}-mode`);
        
        const canvasContainer = document.querySelector('.canvas-container');
        canvasContainer.classList.remove('delete-mode');
        if (tool === 'delete') {
            canvasContainer.classList.add('delete-mode');
        }
        
        // Update info text
        const infoText = {
            select: 'Click and drag to move objects. Double-click to edit properties. Press Delete key to delete selected objects.',
            path: 'Click and drag to draw walking paths between objects.',
            obstacle: 'Click and drag to create obstacle/off-limits zones.',
            delete: 'Click on an object, path, or obstacle to delete it. A confirmation dialog will appear.'
        };
        document.getElementById('canvasInfo').textContent = infoText[tool] || 'Select a tool to begin.';

        // Active tool indicator (aria-live)
        const toolKeyMap = { select: 'S', path: 'P', obstacle: 'O', delete: 'D' };
        const indicator = document.getElementById('activeToolIndicator');
        if (indicator) indicator.textContent = `Active Tool: ${tool.charAt(0).toUpperCase()+tool.slice(1)} (${toolKeyMap[tool] || ''})`;
        
        this.render();
    }
    
    handleObjectPaletteClick(e) {
        const item = e.target.closest('.object-item');
        if (!item) return;
        
        const objectType = item.dataset.objectType;
        this.addObject(objectType);
    }
    
    // Drag from palette to canvas
    handlePaletteDragStart(e) {
        const item = e.target.closest('.object-item');
        if (!item) return;
        const objectType = item.dataset.objectType;
        // Package drag data
        const payload = { kind: 'object', objectType };
        if (e.dataTransfer) {
            e.dataTransfer.setData('application/json', JSON.stringify(payload));
            e.dataTransfer.effectAllowed = 'copy';
            // Try to set a simple drag image
            const previewEl = item.querySelector('.object-preview') || item;
            if (previewEl && e.dataTransfer.setDragImage) {
                // Create a tiny canvas snapshot to use as drag image
                try {
                    const dCanvas = document.createElement('canvas');
                    dCanvas.width = 40; dCanvas.height = 30;
                    const dctx = dCanvas.getContext('2d');
                    dctx.fillStyle = getComputedStyle(previewEl).backgroundColor || '#888';
                    dctx.fillRect(0,0,40,30);
                    dctx.strokeStyle = '#333'; dctx.strokeRect(0,0,40,30);
                    e.dataTransfer.setDragImage(dCanvas, 20, 15);
                } catch (_) {}
            }
        }
        // Track current dragging type
        this._draggingObjectType = objectType;
    }

    handleCanvasDrop(e) {
        e.preventDefault();
        let payload = null;
        if (e.dataTransfer) {
            const json = e.dataTransfer.getData('application/json');
            if (json) {
                try { payload = JSON.parse(json); } catch (_) { payload = null; }
            }
        }
        const objectType = payload && payload.kind === 'object' ? payload.objectType : this._draggingObjectType;
        if (!objectType) return;
        // Compute drop position in world coordinates
        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldX = (screenX - this.pan.x) / (this.zoom || 1);
        const worldY = (screenY - this.pan.y) / (this.zoom || 1);
        // Place object centered at drop point
        const template = this.objectTemplates.find(t => t.name === objectType);
        const x = template ? worldX - template.width / 2 : worldX;
        const y = template ? worldY - template.height / 2 : worldY;
        this.addObject(objectType, x, y);
        // Clear dragging state
        this._draggingObjectType = null;
    }
    
    addObject(typeName, x, y) {
        const template = this.objectTemplates.find(t => t.name === typeName);
        if (!template) return;
        
        const obj = {
            id: Date.now() + Math.random(),
            type: typeName,
            name: `${typeName} ${this.objects.filter(o => o.type === typeName).length + 1}`,
            x: x !== undefined ? x : Math.max(50, this.canvas.width / 2 - template.width / 2),
            y: y !== undefined ? y : Math.max(50, this.canvas.height / 2 - template.height / 2),
            width: template.width,
            height: template.height,
            color: template.color,
            visits: 0
        };
        
        this.objects.push(obj);
        this.selectedObject = obj;
        this.setTool('select'); // Switch to select tool after adding object
        this.render();
    }
    
    async handleBackgroundUpload(e) {
        const inputEl = e.target;
        const file = inputEl.files[0];
        if (!file) {
            // Ensure value reset so re-selecting same file later will fire change
            inputEl.value = '';
            return;
        }
        
        // Reset existing background sources
        this.backgroundImage = null;
        this.backgroundPdfPageCanvas = null;
        this.resetBackgroundTransform();
        
        const type = file.type || '';
        try {
            console.log('[Upload] Selected file:', { name: file.name, type: file.type, size: file.size });
            if (type.startsWith('image/')) {
                await this.loadBackgroundImage(file);
                this.resetView(); // Ensure image is visible
                this.showInfoMessage('Background image loaded successfully!', 'success');
            } else if (type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                await this.loadBackgroundPdf(file);
                // resetView() is now called inside loadBackgroundPdf
                this.showInfoMessage('Background PDF loaded (first page).', 'success');
            } else {
                alert('Please select an image or PDF file.');
            }
        } catch (err) {
            console.error('[Upload] Failed to load background:', err);
            this.showInfoMessage(`Failed to load background: ${err && err.message ? err.message : err}`, 'error');
        } finally {
            // Clear input so choosing the same file again triggers change
            try { inputEl.value = ''; } catch (_) {}
        }
    }

    async loadBackgroundPdf(file) {
        this.debugLog('[PDF] Starting PDF load process', { fileName: file.name, fileSize: file.size });
        
        // Enhanced diagnostics & fallback logic
        if (!window.pdfjsLib) {
            this.debugLog('[PDF] pdfjsLib missing. Attempting dynamic load.');
            this.showInfoMessage('PDF library not loaded, attempting fallback...', 'warning');
            await this._attemptDynamicPdfJsLoad();
        }
        if (!window.pdfjsLib) {
            const msg = 'PDF.js library not available. Check console for details.';
            console.error('[PDF]', msg);
            throw new Error(msg);
        }

        const arrayBuffer = await file.arrayBuffer();
        this.setLoading(true, 'Rendering PDF...');
        const t0 = performance.now();
        
        try {
            // Ensure worker is set
            if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdfjs/pdf.worker.min.js';
                this.debugLog('[PDF] Worker source set');
            }
            
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            
            loadingTask.onPassword = (updatePassword, reason) => {
                this.showInfoMessage('Password-protected PDF not supported.', 'warning');
            };
            
            loadingTask.onProgress = (p) => {
                if (p && p.total) {
                    const pct = Math.min(100, ((p.loaded || 0) / p.total) * 100).toFixed(0);
                    const overlay = document.querySelector('#loadingOverlay .loading-text');
                    if (overlay) overlay.textContent = `Rendering PDF (${pct}%)...`;
                }
            };
            
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            const vp = page.getViewport({ scale: 1 });
            const targetW = this.canvas.width * 0.95;
            const targetH = this.canvas.height * 0.95;
            const scale = Math.min(targetW / vp.width, targetH / vp.height);
            const viewport = page.getViewport({ scale });
            
            const offscreen = document.createElement('canvas');
            offscreen.width = Math.ceil(viewport.width);
            offscreen.height = Math.ceil(viewport.height);
            const offctx = offscreen.getContext('2d');
            
            if (!offctx) {
                throw new Error('Failed to get 2D context for offscreen canvas');
            }
            
            await page.render({ canvasContext: offctx, viewport }).promise;
            
            // Basic content verification (lightweight)
            try {
                const sample = offctx.getImageData(0, 0, Math.min(50, offscreen.width), Math.min(50, offscreen.height));
                const nonZero = sample.data.find(v => v !== 0);
                if (!nonZero) this.debugLog('[PDF] Warning: sample region blank');
            } catch (_) {}
            
            this.backgroundPdfPageCanvas = offscreen;
            this.backgroundImage = null;
            this.resetBackgroundTransform();
            this.backgroundRect = { x: 0, y: 0, width: offscreen.width, height: offscreen.height };
            this.fitBackground(); // single fit (removed duplicate resetView)
            this.render();
            this.showInfoMessage('PDF loaded successfully.', 'success');
            this.ensureObjectPalette();
            this.debugLog('[PDF] PDF loading process completed', { elapsedMs: Math.round(performance.now() - t0) });
        } catch (err) {
            console.error('[PDF] Render error:', err);
            throw new Error(err && err.message ? err.message : 'Unknown PDF render error');
        } finally {
            this.setLoading(false);
        }
    }

    loadBackgroundImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    this.backgroundImage = img;
                    this.backgroundPdfPageCanvas = null;
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    this.backgroundRect = { x: 0, y: 0, width: w, height: h };
                    this.resetBackgroundTransform();
                    this.fitBackground();
                    this.ensureObjectPalette();
                    resolve();
                };
                img.onerror = () => reject(new Error('Image load error'));
                img.src = ev.target.result;
            };
            reader.onerror = () => reject(new Error('File read error'));
            reader.readAsDataURL(file);
        });
    }

    // Lightweight debug logger
    debugLog(...args) { if (this.debug) console.log(...args); }
    
    async _attemptDynamicPdfJsLoad() {
        if (window.__pdfjsDynamicLoadAttempted) return; // prevent loops
        window.__pdfjsDynamicLoadAttempted = true;
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.crossOrigin = 'anonymous';
        const loadPromise = new Promise((resolve) => {
            script.onload = () => {
                console.log('[PDF] Dynamic pdf.js loaded');
                try { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch (_) {}
                resolve();
            };
            script.onerror = () => {
                console.error('[PDF] Dynamic pdf.js load failed');
                this.showInfoMessage('Unable to load PDF engine (offline?).', 'error', 6000);
                resolve();
            };
        });
        document.head.appendChild(script);
        await loadPromise;
    }
    
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Account for pan (screen px) and zoom
        const x = (e.clientX - rect.left - this.pan.x) / (this.zoom || 1);
        const y = (e.clientY - rect.top - this.pan.y) / (this.zoom || 1);
        return { x, y };
    }
    
    handleMouseDown(e) {
        e.preventDefault();
        this.mousePos = this.getMousePos(e);
        this.dragStart = { ...this.mousePos };
        
        // Calibration click handling has priority
        if (this.isCalibrating) {
            this.handleCalibrationClick();
            return;
        }
        
        // Start panning with middle or right mouse, or left-click on empty space in select mode
        if (e.button === 1 || e.button === 2 || (e.button === 0 && this.currentTool === 'select' && !this.getObjectAt(this.mousePos) && !this.getPathEndpointAt(this.mousePos))) {
            this.isPanning = true;
            this.lastClientPos = { x: e.clientX, y: e.clientY };
            return;
        }
        
        if (this.currentTool === 'select') {
            this.handleSelectMouseDown();
        } else if (this.currentTool === 'path') {
            this.handlePathMouseDown();
        } else if (this.currentTool === 'obstacle') {
            this.handleObstacleMouseDown();
        } else if (this.currentTool === 'delete') {
            this.handleDeleteMouseDown();
        }
    }
    
    handleSelectMouseDown() {
        // Check for resize handles first
        if (this.selectedObject) {
            const handle = this.getResizeHandle(this.mousePos, this.selectedObject);
            if (handle) {
                this.isResizing = true;
                this.resizeHandle = handle;
                return;
            }
        }
        
        // Check for path endpoint selection
        const endpointInfo = this.getPathEndpointAt(this.mousePos);
        if (endpointInfo) {
            this.selectedPath = endpointInfo.path;
            this.selectedEndpoint = endpointInfo.endpoint;
            this.isDraggingEndpoint = true;
            this.selectedObject = null;
            this.render();
            return;
        }
        
        // Check for object selection
        const clickedObject = this.getObjectAt(this.mousePos);
        if (clickedObject) {
            this.selectedObject = clickedObject;
            this.selectedPath = null;
            this.selectedEndpoint = null;
            this.isDragging = true;
        } else {
            this.selectedObject = null;
            this.selectedPath = null;
            this.selectedEndpoint = null;
        }
        
        this.render();
    }
    
    handlePathMouseDown() {
        this.isDrawing = true;
        this.currentPath = [{ ...this.mousePos }];
    }
    
    handleObstacleMouseDown() {
        this.isDrawing = true;
        this.currentObstacle = {
            x: this.mousePos.x,
            y: this.mousePos.y,
            width: 0,
            height: 0
        };
    }
    
    handleDeleteMouseDown() {
        const point = this.mousePos;
        let itemToDelete = null;
        let deleteType = null;

        // Check for objects first, as they are on top
        const clickedObject = this.getObjectAt(point);
        if (clickedObject) {
            itemToDelete = clickedObject;
            deleteType = 'object';
        } else {
            // Check for paths
            const clickedPath = this.getPathAt(point);
            if (clickedPath) {
                itemToDelete = clickedPath;
                deleteType = 'path';
            } else {
                // Check for obstacles
                const clickedObstacle = this.getObstacleAt(point);
                if (clickedObstacle) {
                    itemToDelete = clickedObstacle;
                    deleteType = 'obstacle';
                }
            }
        }

        if (itemToDelete) {
            this.showDeleteConfirmation(itemToDelete, deleteType);
        } else {
            // Show helpful message when nothing is clicked
            this.showInfoMessage('Click on an object, path, or obstacle to delete it.', 'info');
        }
        
        // Hide tooltip after click and clear highlight state
        this.hideDeleteTooltip();
        this.deleteHighlight = null;
        this.render();
    }
    
    handleMouseMove(e) {
        e.preventDefault();
        // Handle panning first
        if (this.isPanning) {
            const dx = e.clientX - this.lastClientPos.x;
            const dy = e.clientY - this.lastClientPos.y;
            this.pan.x += dx;
            this.pan.y += dy;
            this.lastClientPos = { x: e.clientX, y: e.clientY };
            this._userViewportChanged = true;
            this.render();
            return;
        }
        
        this.mousePos = this.getMousePos(e);
        
        if (this.isCalibrating) {
            // Redraw to show provisional line within transformed space
            this.render();
            return;
        }
        
        if (this.currentTool === 'select') {
            this.handleSelectMouseMove();
        } else if (this.currentTool === 'path' && this.isDrawing) {
            this.handlePathMouseMove();
        } else if (this.currentTool === 'obstacle' && this.isDrawing) {
            this.handleObstacleMouseMove();
        } else if (this.currentTool === 'delete') {
            this.handleDeleteMouseMove(e);
        }
    }
    
    handleSelectMouseMove() {
        if (this.isResizing && this.selectedObject && this.resizeHandle) {
            this.handleResize();
            this.render();
        } else if (this.isDraggingEndpoint && this.selectedPath && this.selectedEndpoint) {
            this.handleEndpointDrag();
        } else if (this.isDragging && this.selectedObject) {
            const dx = this.mousePos.x - this.dragStart.x;
            const dy = this.mousePos.y - this.dragStart.y;
            
            // Keep object within canvas bounds
            this.selectedObject.x = Math.max(0, Math.min(this.canvas.width - this.selectedObject.width, this.selectedObject.x + dx));
            this.selectedObject.y = Math.max(0, Math.min(this.canvas.height - this.selectedObject.height, this.selectedObject.y + dy));
            
            this.dragStart = { ...this.mousePos };
            this.render();
        }
    }
    
    handlePathMouseMove() {
        if (this.currentPath.length > 0) {
            // Add point if moved enough distance
            const lastPoint = this.currentPath[this.currentPath.length - 1];
            const distance = Math.sqrt(
                Math.pow(this.mousePos.x - lastPoint.x, 2) + 
                Math.pow(this.mousePos.y - lastPoint.y, 2)
            );
            
            if (distance > 5) { // Minimum distance between points
                this.currentPath.push({ ...this.mousePos });
                this.render();
            }
        }
    }
    
    handleObstacleMouseMove() {
        if (this.currentObstacle) {
            this.currentObstacle.width = this.mousePos.x - this.currentObstacle.x;
            this.currentObstacle.height = this.mousePos.y - this.currentObstacle.y;
            this.render();
        }
    }
    
    handleResize() {
        const obj = this.selectedObject;
        const handle = this.resizeHandle;
        const dx = this.mousePos.x - this.dragStart.x;
        const dy = this.mousePos.y - this.dragStart.y;
        
        const minSize = 10;
        
        if (handle.includes('e')) {
            obj.width = Math.max(minSize, obj.width + dx);
        }
        if (handle.includes('w')) {
            const newWidth = Math.max(minSize, obj.width - dx);
            const widthDiff = obj.width - newWidth;
            obj.width = newWidth;
            obj.x += widthDiff;
        }
        if (handle.includes('s')) {
            obj.height = Math.max(minSize, obj.height + dy);
        }
        if (handle.includes('n')) {
            const newHeight = Math.max(minSize, obj.height - dy);
            const heightDiff = obj.height - newHeight;
            obj.height = newHeight;
            obj.y += heightDiff;
        }
        
        this.dragStart = { ...this.mousePos };
    }
    
    handleMouseUp(e) {
        e.preventDefault();
        
        if (this.isPanning) {
            this.isPanning = false;
        }
        
        if (this.currentTool === 'path' && this.isDrawing && this.currentPath.length > 1) {
            this.finalizePath();
        } else if (this.currentTool === 'obstacle' && this.isDrawing) {
            this.finalizeObstacle();
        }
        
        this.isDrawing = false;
        this.isDragging = false;
        this.isResizing = false;
        this.isDraggingEndpoint = false;
        this.resizeHandle = null;
    }
    
    handleDoubleClick(e) {
        e.preventDefault();
        
        if (this.currentTool === 'select') {
            const clickedObject = this.getObjectAt(this.getMousePos(e));
            if (clickedObject) {
                this.selectedObject = clickedObject;
                this.openObjectModal();
            }
        }
    }
    
    finalizePath() {
        if (this.currentPath.length < 2) {
            this.currentPath = [];
            this.render();
            return;
        }
        
        // Simplify path to reduce point count
        const simplified = this.simplifyPath(this.currentPath);
        if (simplified.length >= 2) {
            this.tempPathPoints = simplified;
            this.openPathModal();
        }
        
        this.currentPath = [];
        this.render();
    }
    
    finalizeObstacle() {
        if (this.currentObstacle && Math.abs(this.currentObstacle.width) > 10 && Math.abs(this.currentObstacle.height) > 10) {
            // Normalize negative dimensions
            if (this.currentObstacle.width < 0) {
                this.currentObstacle.x += this.currentObstacle.width;
                this.currentObstacle.width = Math.abs(this.currentObstacle.width);
            }
            if (this.currentObstacle.height < 0) {
                this.currentObstacle.y += this.currentObstacle.height;
                this.currentObstacle.height = Math.abs(this.currentObstacle.height);
            }
            
            this.currentObstacle.id = Date.now() + Math.random();
            this.obstacles.push({ ...this.currentObstacle });
        }
        this.currentObstacle = null;
        this.render();
    }
    
    simplifyPath(path, tolerance = 8) {
        if (path.length <= 2) return path;
        
        const simplified = [path[0]];
        
        for (let i = 1; i < path.length - 1; i++) {
            const point = path[i];
            const lastPoint = simplified[simplified.length - 1];
            const distance = Math.sqrt(
                Math.pow(point.x - lastPoint.x, 2) + Math.pow(point.y - lastPoint.y, 2)
            );
            
            if (distance >= tolerance) {
                simplified.push(point);
            }
        }
        
        // Always include the last point
        simplified.push(path[path.length - 1]);
        return simplified;
    }
    
    openPathModal() {
        document.getElementById('pathModal').classList.remove('hidden');
        document.getElementById('pathDescription').focus();
    }
    
    closePathModal() {
        document.getElementById('pathModal').classList.add('hidden');
        document.getElementById('pathForm').reset();
        this.tempPathPoints = null;
    }
    
    savePathMetadata(e) {
        e.preventDefault();
        
        if (!this.tempPathPoints || this.tempPathPoints.length < 2) {
            alert('Invalid path data.');
            return;
        }
        
        const description = document.getElementById('pathDescription').value.trim();
        const frequency = parseInt(document.getElementById('pathFrequency').value);
        const color = document.getElementById('pathColor').value;
        
        if (!description || frequency < 1) {
            alert('Please fill in all required fields.');
            return;
        }
        
        const path = {
            id: Date.now() + Math.random(),
            points: [...this.tempPathPoints],
            description,
            frequency,
            color,
            length: this.calculatePathLength(this.tempPathPoints)
        };
        
        this.paths.push(path);
        this.updateObjectVisits(path);
        this.updateAnalytics();
        this.closePathModal();
        this.render();
        
        // Show success feedback
        const info = document.getElementById('canvasInfo');
        const originalText = info.textContent;
        info.textContent = `Path "${description}" added successfully!`;
        info.style.color = 'var(--color-success)';
        
        setTimeout(() => {
            info.textContent = originalText;
            info.style.color = '';
        }, 2000);
    }
    
    openObjectModal() {
        if (!this.selectedObject) return;
        
        const obj = this.selectedObject;
        document.getElementById('objectName').value = obj.name;
        document.getElementById('objectType').value = obj.type;
        document.getElementById('objectModal').classList.remove('hidden');
        document.getElementById('objectName').focus();
    }
    
    closeObjectModal() {
        document.getElementById('objectModal').classList.add('hidden');
        document.getElementById('objectForm').reset();
    }
    
    updateObjectMetadata(e) {
        e.preventDefault();
        
        if (!this.selectedObject) return;
        
        const name = document.getElementById('objectName').value.trim();
        const type = document.getElementById('objectType').value;
        
        if (!name) {
            alert('Object name is required.');
            return;
        }
        
        const template = this.objectTemplates.find(t => t.name === type);
        
        this.selectedObject.name = name;
        this.selectedObject.type = type;
        if (template) {
            this.selectedObject.color = template.color;
        }
        
        this.closeObjectModal();
        this.render();
    }
    
    deleteSelectedObject() {
        if (!this.selectedObject) return;
        
        if (confirm(`Delete "${this.selectedObject.name}"? This action cannot be undone.`)) {
            const index = this.objects.indexOf(this.selectedObject);
            if (index > -1) {
                this.objects.splice(index, 1);
                this.selectedObject = null;
                this.closeObjectModal();
                this.updateAnalytics();
                this.render();
            }
        }
    }
    
    getObjectAt(point) {
        // Check objects in reverse order (top to bottom)
        for (let i = this.objects.length - 1; i >= 0; i--) {
            const obj = this.objects[i];
            if (point.x >= obj.x && point.x <= obj.x + obj.width &&
                point.y >= obj.y && point.y <= obj.y + obj.height) {
                return obj;
            }
        }
        return null;
    }
    
    getObstacleAt(point) {
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const obs = this.obstacles[i];
            if (point.x >= obs.x && point.x <= obs.x + obs.width &&
                point.y >= obs.y && point.y <= obs.y + obs.height) {
                return obs;
            }
        }
        return null;
    }

    getResizeHandle(point, obj) {
        const tolerance = 8;
        const handles = {
            'nw': { x: obj.x, y: obj.y },
            'ne': { x: obj.x + obj.width, y: obj.y },
            'sw': { x: obj.x, y: obj.y + obj.height },
            'se': { x: obj.x + obj.width, y: obj.y + obj.height }
        };
        
        for (const [handle, pos] of Object.entries(handles)) {
            if (Math.abs(point.x - pos.x) <= tolerance && Math.abs(point.y - pos.y) <= tolerance) {
                return handle;
            }
        }
        return null;
    }

    getPathAt(point, threshold = 5) {
        for (const path of this.paths) {
            for (let i = 0; i < path.points.length - 1; i++) {
                const p1 = path.points[i];
                const p2 = path.points[i + 1];
                const distance = this.pointToSegmentDistance(point, p1, p2);
                if (distance <= threshold) {
                    return path;
                }
            }
        }
        return null;
    }

    pointToSegmentDistance(p, p1, p2) {
        const l2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
        if (l2 === 0) return Math.sqrt((p.x - p1.x) ** 2 + (p.y - p1.y) ** 2);
        
        let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        
        const projectionX = p1.x + t * (p2.x - p1.x);
        const projectionY = p1.y + t * (p2.y - p1.y);
        
        return Math.sqrt((p.x - projectionX) ** 2 + (p.y - projectionY) ** 2);
    }
    
    getPathEndpointAt(point, threshold = 12) {
        for (const path of this.paths) {
            if (path.points.length < 2) continue;
            
            // Check start point
            const startPoint = path.points[0];
            const startDistance = Math.sqrt(
                Math.pow(point.x - startPoint.x, 2) + 
                Math.pow(point.y - startPoint.y, 2)
            );
            if (startDistance <= threshold) {
                return { path, endpoint: 'start' };
            }
            
            // Check end point
            const endPoint = path.points[path.points.length - 1];
            const endDistance = Math.sqrt(
                Math.pow(point.x - endPoint.x, 2) + 
                Math.pow(point.y - endPoint.y, 2)
            );
            if (endDistance <= threshold) {
                return { path, endpoint: 'end' };
            }
        }
        return null;
    }
    
    checkPathCollision(newPoint, path) {
        // Check collision with objects
        for (const obj of this.objects) {
            if (this.pointIntersectsRect(newPoint, obj)) {
                return { type: 'object', item: obj };
            }
        }
        
        // Check collision with obstacles
        for (const obstacle of this.obstacles) {
            if (this.pointIntersectsRect(newPoint, obstacle)) {
                return { type: 'obstacle', item: obstacle };
            }
        }
        
        return null;
    }
    
    pointIntersectsRect(point, rect) {
        return point.x >= rect.x && 
               point.x <= rect.x + rect.width &&
               point.y >= rect.y && 
               point.y <= rect.y + rect.height;
    }
    
    checkPathSegmentCollision(p1, p2) {
        // Check collision with objects
        for (const obj of this.objects) {
            if (this.lineIntersectsRect(p1, p2, obj)) {
                return { type: 'object', item: obj };
            }
        }
        
        // Check collision with obstacles
        for (const obstacle of this.obstacles) {
            if (this.lineIntersectsRect(p1, p2, obstacle)) {
                return { type: 'obstacle', item: obstacle };
            }
        }
        
        return null;
    }
    
    lineIntersectsRect(p1, p2, rect) {
        // Check if line segment intersects with rectangle
        const rectLeft = rect.x;
        const rectRight = rect.x + rect.width;
        const rectTop = rect.y;
        const rectBottom = rect.y + rect.height;
        
        // Check intersection with each edge of the rectangle
        return this.lineIntersectsLine(p1, p2, {x: rectLeft, y: rectTop}, {x: rectRight, y: rectTop}) ||     // top
               this.lineIntersectsLine(p1, p2, {x: rectRight, y: rectTop}, {x: rectRight, y: rectBottom}) ||  // right
               this.lineIntersectsLine(p1, p2, {x: rectRight, y: rectBottom}, {x: rectLeft, y: rectBottom}) || // bottom
               this.lineIntersectsLine(p1, p2, {x: rectLeft, y: rectBottom}, {x: rectLeft, y: rectTop}) ||     // left
               (this.pointIntersectsRect(p1, rect) || this.pointIntersectsRect(p2, rect)); // endpoints inside rect
    }
    
    lineIntersectsLine(p1, p2, p3, p4) {
        // Check if line segment p1-p2 intersects with line segment p3-p4
        const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
        if (denom === 0) return false; // parallel lines
        
        const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
        const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
        
        return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    }
    
    handleEndpointDrag() {
        if (!this.selectedPath || !this.selectedEndpoint) return;
        
        const newPoint = { ...this.mousePos };
        
        // Keep endpoint within canvas bounds
        newPoint.x = Math.max(0, Math.min(this.canvas.width, newPoint.x));
        newPoint.y = Math.max(0, Math.min(this.canvas.height, newPoint.y));
        
        // Check for collisions with objects and obstacles
        const collision = this.checkPathCollision(newPoint, this.selectedPath);
        if (collision) {
            // Show warning but allow movement (don't block it completely)
            this.showInfoMessage(`Cannot move path endpoint over ${collision.type}: ${collision.item.name || 'item'}`, 'warning');
            return;
        }
        
        // Update the endpoint position
        if (this.selectedEndpoint === 'start') {
            this.selectedPath.points[0] = newPoint;
        } else if (this.selectedEndpoint === 'end') {
            this.selectedPath.points[this.selectedPath.points.length - 1] = newPoint;
        }
        
        // Recalculate path length and update analytics
        this.selectedPath.length = this.calculatePathLength(this.selectedPath.points);
        this.updateAnalytics();
        
        this.render();
    }
    
    updateObjectVisits(path) {
        const startObject = this.getObjectAt(path.points[0]);
        const endObject = this.getObjectAt(path.points[path.points.length - 1]);
        
        if (startObject) {
            startObject.visits = (startObject.visits || 0) + path.frequency;
        }
        if (endObject) {
            endObject.visits = (endObject.visits || 0) + path.frequency;
        }
    }

    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Apply pan (in screen pixels) then zoom for all rendering
        this.ctx.save();
        this.ctx.translate(this.pan.x, this.pan.y);
        this.ctx.scale(this.zoom || 1, this.zoom || 1);
        
        console.log('[Render] Current view state:', { 
            zoom: this.zoom, 
            pan: this.pan, 
            canvasSize: { width: this.canvas.width, height: this.canvas.height }
        });
        
        const bgSource = this.backgroundPdfPageCanvas || this.backgroundImage;
        if (bgSource) {
            console.log('[Render] Drawing background:', { 
                type: this.backgroundPdfPageCanvas ? 'PDF' : 'Image',
                width: bgSource.width, 
                height: bgSource.height,
                canvasWidth: this.canvas.width,
                canvasHeight: this.canvas.height,
                zoom: this.zoom,
                pan: this.pan
            });
            this.drawBackgroundWithTransform(bgSource);
            
            // Add visual confirmation in canvas info
            const infoEl = document.getElementById('canvasInfo');
            if (infoEl && !infoEl.textContent.includes('Background loaded')) {
                const bgType = this.backgroundPdfPageCanvas ? 'PDF' : 'Image';
                infoEl.textContent = `Background loaded: ${bgType}. ${infoEl.textContent}`;
            }
        } else {
            console.log('[Render] No background source available');
            // Remove background indicator if no background
            const infoEl = document.getElementById('canvasInfo');
            if (infoEl && infoEl.textContent.includes('Background loaded')) {
                infoEl.textContent = infoEl.textContent.replace(/Background loaded: \w+\. /, '');
            }
        }
        
        // Draw grid
        this.drawGrid();
        
        // Draw calibration points/line if calibrating (in world coordinates)
        if (this.isCalibrating && this.calibrationPoints.length > 0) {
            this.ctx.save();
            this.ctx.fillStyle = '#6c5ce7';
            this.ctx.strokeStyle = '#6c5ce7';
            for (const p of this.calibrationPoints) {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                this.ctx.fill();
            }
            this.ctx.setLineDash([6,4]);
            this.ctx.lineWidth = 2;
            if (this.calibrationPoints.length === 2) {
                this.ctx.beginPath();
                this.ctx.moveTo(this.calibrationPoints[0].x, this.calibrationPoints[0].y);
                this.ctx.lineTo(this.calibrationPoints[1].x, this.calibrationPoints[1].y);
                this.ctx.stroke();
            } else if (this.calibrationPoints.length === 1) {
                // Provisional line to current mouse position
                this.ctx.beginPath();
                this.ctx.moveTo(this.calibrationPoints[0].x, this.calibrationPoints[0].y);
                this.ctx.lineTo(this.mousePos.x, this.mousePos.y);
                this.ctx.stroke();
            }
            this.ctx.restore();
        }
        
        // Draw obstacles
        this.obstacles.forEach(obstacle => this.drawObstacle(obstacle));
        
        // Draw paths
        this.paths.forEach(path => this.drawPath(path));
        
        // Draw objects
        this.objects.forEach(obj => this.drawObject(obj));
        
        // Draw current path being drawn
        if (this.isDrawing && this.currentTool === 'path' && this.currentPath.length > 1) {
            this.drawPath({ points: this.currentPath, color: '#FFA500' });
        }
        
        // Draw current obstacle being drawn
        if (this.isDrawing && this.currentTool === 'obstacle' && this.currentObstacle) {
            this.drawObstacle(this.currentObstacle, true);
        }
        
        // Draw selection handles if an object is selected
        if (this.selectedObject) {
            this.drawSelectionHandles(this.selectedObject);
        }
        
        // Draw path endpoint handles if a path is selected
        if (this.selectedPath) {
            this.drawPathEndpointHandles(this.selectedPath);
        }
        
        // Draw delete hover highlight inside transformed space so it aligns with pan/zoom
        if (this.currentTool === 'delete' && this.deleteHighlight && this.deleteHighlight.item) {
            const { item, type } = this.deleteHighlight;
            if (type === 'object') this.drawDeleteHighlight(item);
            else if (type === 'path') this.drawPathDeleteHighlight(item);
            else if (type === 'obstacle') this.drawObstacleDeleteHighlight(item);
        }
        
        // Restore zoom transform
        this.ctx.restore();
    }

    drawBackgroundWithTransform(source) {
        if (!this.backgroundRect) return;
        const { rotation, flipH, flipV } = this.backgroundTransform;
        const rect = this.backgroundRect;
        this.ctx.save();
        if (rotation !== 0 || flipH || flipV) {
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            this.ctx.translate(cx, cy);
            if (rotation) this.ctx.rotate((rotation % 360) * Math.PI / 180);
            this.ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
            this.ctx.drawImage(source, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
        } else {
            this.ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
        }
        this.ctx.restore();
    }
    
    drawGrid() {
        // Determine pixel spacing from real unit per cell if scale is set
        let gridSizePx = 20;
        if (this.unitsPerPixel > 0 && this.gridCellUnits > 0) {
            gridSizePx = this.gridCellUnits / this.unitsPerPixel;
            // Clamp to reasonable pixel sizes
            gridSizePx = Math.max(8, Math.min(200, gridSizePx));
        }
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#f0f0f0';
        
        for (let x = 0; x < this.canvas.width; x += gridSizePx) {
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
        }
        
        for (let y = 0; y < this.canvas.height; y += gridSizePx) {
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
        }
        
        this.ctx.stroke();
        
        // Display grid scale info below grid (in UI element)
        const gridInfoEl = document.getElementById('gridScaleInfo');
        if (gridInfoEl) {
            if (this.unitsPerPixel > 0) {
                const unitsPerCell = this.unitsPerPixel * gridSizePx;
                gridInfoEl.textContent = `Grid: ${unitsPerCell.toFixed(3)} ${this.units} per cell`;
            } else {
                gridInfoEl.textContent = 'Grid scale not set';
            }
        }
    }

    drawObject(obj) {
        this.ctx.fillStyle = obj.color;
        this.ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        
        this.ctx.strokeStyle = '#000';
        this.ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
        
        // Draw object name
        this.ctx.fillStyle = '#000';
        this.ctx.textAlign = 'center';
        this.ctx.font = '12px Arial';
        this.ctx.fillText(obj.name, obj.x + obj.width / 2, obj.y - 5);
    }

    drawPath(path) {
        if (path.points.length < 2) return;
        
        this.ctx.beginPath();
        this.ctx.strokeStyle = path.color;
        this.ctx.lineWidth = path.frequency ? Math.min(1 + path.frequency / 2, 10) : 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        this.ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
            this.ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        this.ctx.stroke();
    }

    drawObstacle(obstacle, isDrawing = false) {
        this.ctx.fillStyle = isDrawing ? 'rgba(255, 0, 0, 0.2)' : 'rgba(255, 0, 0, 0.4)';
        this.ctx.strokeStyle = '#FF0000';
        this.ctx.lineWidth = 1;
        
        const x = obstacle.width < 0 ? obstacle.x + obstacle.width : obstacle.x;
        const y = obstacle.height < 0 ? obstacle.y + obstacle.height : obstacle.y;
        const w = Math.abs(obstacle.width);
        const h = Math.abs(obstacle.height);
        
        this.ctx.fillRect(x, y, w, h);
        this.ctx.strokeRect(x, y, w, h);
    }

    drawSelectionHandles(obj) {
        const handleSize = 8;
        this.ctx.strokeStyle = '#007bff';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
        this.ctx.setLineDash([]);

        this.ctx.fillStyle = '#FFF';
        this.ctx.strokeStyle = '#007bff';
        
        const handles = this.getResizeHandles(obj);
        for (const handle in handles) {
            const pos = handles[handle];
            this.ctx.fillRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
            this.ctx.strokeRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
        }
    }

    getResizeHandles(obj) {
        return {
            'nw': { x: obj.x, y: obj.y },
            'ne': { x: obj.x + obj.width, y: obj.y },
            'sw': { x: obj.x, y: obj.y + obj.height },
            'se': { x: obj.x + obj.width, y: obj.y + obj.height },
        };
    }
    
    drawPathEndpointHandles(path) {
        if (path.points.length < 2) return;
        
        const handleRadius = 6;
        
        // Highlight the entire path when selected
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#28a745';
        this.ctx.lineWidth = Math.max(4, (path.frequency ? Math.min(1 + path.frequency / 2, 10) : 2) + 2);
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.setLineDash([5, 5]);
        
        this.ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
            this.ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        
        // Draw start endpoint handle
        const startPoint = path.points[0];
        this.ctx.beginPath();
        this.ctx.arc(startPoint.x, startPoint.y, handleRadius, 0, 2 * Math.PI);
        this.ctx.fillStyle = '#28a745';
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        
        // Add "S" for start
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 10px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('S', startPoint.x, startPoint.y + 3);
        
        // Draw end endpoint handle
        const endPoint = path.points[path.points.length - 1];
        this.ctx.beginPath();
        this.ctx.arc(endPoint.x, endPoint.y, handleRadius, 0, 2 * Math.PI);
        this.ctx.fillStyle = '#dc3545';
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        
        // Add "E" for end
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 10px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('E', endPoint.x, endPoint.y + 3);
    }

    calculatePathLength(points) {
        let length = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i-1].x;
            const dy = points[i].y - points[i-1].y;
            length += Math.sqrt(dx*dx + dy*dy);
        }
        return length;
    }

    updateAnalytics() {
        // Reset and recalculate object visits from scratch based on current paths
        this.objects.forEach(obj => obj.visits = 0);
        this.paths.forEach(path => this.updateObjectVisits(path));

        const totalPaths = this.paths.length;
        const totalDistancePx = this.paths.reduce((sum, path) => sum + path.length, 0);
        const weightedCost = this.paths.reduce((sum, path) => sum + (path.length * path.frequency), 0);
        const avgPathLengthPx = totalPaths > 0 ? totalDistancePx / totalPaths : 0;

        // Update existing px metrics
        document.getElementById('totalPaths').textContent = totalPaths;
        document.getElementById('totalDistance').textContent = `${Math.round(totalDistancePx)} px`;
        document.getElementById('weightedCost').textContent = Math.round(weightedCost);
        document.getElementById('avgPathLength').textContent = `${Math.round(avgPathLengthPx)} px`;

        // New units + steps metrics
        const unitsLabelEl = document.getElementById('totalDistanceUnitsLabel');
        const unitsValEl = document.getElementById('totalDistanceUnits');
        const stepsValEl = document.getElementById('totalSteps');
        if (unitsLabelEl) unitsLabelEl.textContent = `Total Distance (${this.units})`;
        if (this.unitsPerPixel > 0) {
            const totalDistanceUnits = totalDistancePx * this.unitsPerPixel;
            if (unitsValEl) unitsValEl.textContent = `${totalDistanceUnits.toFixed(2)} ${this.units}`;
            if (stepsValEl) stepsValEl.textContent = `${(totalDistanceUnits * (this.stepsPerUnit || 0)).toFixed(0)}`;
        } else {
            if (unitsValEl) unitsValEl.textContent = `0 ${this.units}`;
            if (stepsValEl) stepsValEl.textContent = '0';
        }

        this.updateHotspotList();
    }
    
    beginCalibration() {
        this.isCalibrating = true;
        this.calibrationPoints = [];
        this.showInfoMessage('Calibration: click two points with a known real distance.', 'info');
        // Ensure modal shows the correct units label
        const unitsEl = document.getElementById('calibrateUnits');
        if (unitsEl) unitsEl.textContent = this.units;
        this.updateCalibrateInfo(0);
    }

    handleCalibrationClick() {
        // Debounce identical consecutive clicks
        const last = this.calibrationPoints[this.calibrationPoints.length - 1];
        if (last && Math.hypot(this.mousePos.x - last.x, this.mousePos.y - last.y) < 2) return;
        
        this.calibrationPoints.push({ x: this.mousePos.x, y: this.mousePos.y });
        if (this.calibrationPoints.length === 2) {
            const dx = this.calibrationPoints[1].x - this.calibrationPoints[0].x;
            const dy = this.calibrationPoints[1].y - this.calibrationPoints[0].y;
            const pxDist = Math.sqrt(dx*dx + dy*dy);
            if (pxDist <= 0.0001) {
                this.showInfoMessage('Calibration points are too close. Please click points farther apart.', 'warning');
                this.calibrationPoints = [];
                return;
            }
            // Open calibration modal with measured px distance
            this.openCalibrateModal(pxDist);
        }
    }

    resetScale() {
        this.units = this.units || 'ft';
        this.unitsPerPixel = 0;
        this.stepsPerUnit = 0;
        this.gridCellUnits = 1;
        this.isCalibrating = false;
        this.calibrationPoints = [];
        this.saveScaleToStorage();
        this.updateScaleUI();
        this.updateAnalytics();
        this.render();
    }

    updateScaleUI() {
        const unitsSelect = document.getElementById('unitsSelect');
        const stepsPerUnitInput = document.getElementById('stepsPerUnit');
        const gridCellUnitsInput = document.getElementById('gridCellUnits');
        if (unitsSelect) unitsSelect.value = this.units;
        if (stepsPerUnitInput) stepsPerUnitInput.value = this.stepsPerUnit || '';
        if (gridCellUnitsInput) gridCellUnitsInput.value = this.gridCellUnits || 1;
    }

    openCalibrateModal(pxDist) {
        const modal = document.getElementById('calibrateModal');
        if (!modal) {
            // Fallback to prompt if modal missing
            const distanceStr = prompt(`Enter real distance between points in ${this.units}:`, '10');
            const realDistance = distanceStr ? parseFloat(distanceStr) : NaN;
            if (!isNaN(realDistance) && realDistance > 0) {
                this.unitsPerPixel = realDistance / pxDist;
                this.saveScaleToStorage();
                this.updateScaleUI();
                this.updateAnalytics();
                this.render();
                this.showInfoMessage(`Scale set: ${this.unitsPerPixel.toFixed(4)} ${this.units}/px`, 'success');
            } else {
                this.showInfoMessage('Calibration canceled or invalid distance.', 'warning');
            }
            this.isCalibrating = false;
            this.calibrationPoints = [];
            return;
        }
        this._pendingPxDist = pxDist;
                             this.updateCalibrateInfo(pxDist);
        modal.classList.remove('hidden');
        const input = document.getElementById('calibrateDistance');
        if (input) { input.value = ''; input.focus(); }
    }

    closeCalibrateModal() {
        const modal = document.getElementById('calibrateModal');
        if (modal) modal.classList.add('hidden');
        this.isCalibrating = false;
        this.calibrationPoints = [];
        this._pendingPxDist = undefined;
    }

    updateCalibrateInfo(pxDist) {
        const infoEl = document.getElementById('calibrateInfo');
        if (infoEl) infoEl.textContent = `Measured pixel distance: ${pxDist.toFixed ? pxDist.toFixed(2) : pxDist} px`;
        const unitsEl = document.getElementById('calibrateUnits');
        if (unitsEl) unitsEl.textContent = this.units;
    }

    applyCalibrationFromModal() {
        const input = document.getElementById('calibrateDistance');
        const raw = input ? String(input.value).trim() : '';
        const val = parseFloat(raw);
        if (!raw || isNaN(val) || val <= 0) {
            this.showInfoMessage('Please enter a valid distance greater than zero.', 'warning');
            if (input) input.focus();
            return;
        }
        const pxDist = this._pendingPxDist || 0;
        if (pxDist <= 0.0001) {

            this.showInfoMessage('Calibration points are invalid. Please redo calibration.', 'warning');
            this.closeCalibrateModal();
            return;
        }
        this.unitsPerPixel = val / pxDist;
        this.saveScaleToStorage();
        this.updateScaleUI();
        this.updateAnalytics();
        this.render();
        this.showInfoMessage(`Scale set: ${this.unitsPerPixel.toFixed(4)} ${this.units}/px`, 'success');
        this.closeCalibrateModal();
    }

    saveScaleToStorage() {
        try {
            const payload = {
                units: this.units,
                unitsPerPixel: this.unitsPerPixel,
                stepsPerUnit: this.stepsPerUnit,
                gridCellUnits: this.gridCellUnits,
                zoom: this.zoom || 1
            };
            localStorage.setItem('spaghetti.scale', JSON.stringify(payload));
        } catch (_) {}
    }

    loadScaleFromStorage() {
        try {
            const raw = localStorage.getItem('spaghetti.scale');
            if (raw) {
                const data = JSON.parse(raw);
                if (data && typeof data === 'object') {
                    if (data.units) this.units = data.units;
                    if (typeof data.unitsPerPixel === 'number') this.unitsPerPixel = data.unitsPerPixel;
                    if (typeof data.stepsPerUnit === 'number') this.stepsPerUnit = data.stepsPerUnit;
                    if (typeof data.gridCellUnits === 'number') this.gridCellUnits = data.gridCellUnits;
                    // Don't load zoom/pan on initialization - let resetView() handle this
                    // if (typeof data.zoom === 'number') this.zoom = data.zoom;
                }
            }
        } catch (_) {}
    }
    
    updateHotspotList() {
        const hotspotList = document.getElementById('hotspotList');
        hotspotList.innerHTML = '';

        const visitCounts = {};
        this.objects.forEach(obj => {
            visitCounts[obj.name] = obj.visits || 0;
        });

        const sortedHotspots = Object.entries(visitCounts)
            .sort(([,a],[,b]) => b-a)
            .filter(([,count]) => count > 0)
            .slice(0, 5);

        if (sortedHotspots.length === 0) {
            hotspotList.innerHTML = '<div class="empty-state">No paths drawn yet</div>';
            return;
        }

        sortedHotspots.forEach(([name, count]) => {
            const item = document.createElement('div');
            item.className = 'hotspot-item';
            item.innerHTML = `<span>${name}</span> <span>${count} visits</span>`;
            hotspotList.appendChild(item);
        });
    }

    // Delete hover functionality methods
    handleDeleteMouseMove(e) {
        const point = this.mousePos;
        let hoveredItem = null;
        let hoverType = null;
        let hoverName = null;

        // Check for objects first, as they are on top
        const hoveredObject = this.getObjectAt(point);
        if (hoveredObject) {
            hoveredItem = hoveredObject;
            hoverType = 'object';
            hoverName = hoveredObject.name;
        } else {
            // Check for paths
            const hoveredPath = this.getPathAt(point);
            if (hoveredPath) {
                hoveredItem = hoveredPath;
                hoverType = 'path';
                hoverName = hoveredPath.description || 'Unnamed Path';
            } else {
                // Check for obstacles
                const hoveredObstacle = this.getObstacleAt(point);
                if (hoveredObstacle) {
                    hoveredItem = hoveredObstacle;
                    hoverType = 'obstacle';
                    hoverName = 'Obstacle';
                }
            }
        }

        // Update hover state
        if (hoveredItem && hoveredItem !== this.hoveredDeleteItem) {
            this.hoveredDeleteItem = hoveredItem;
            this.showDeleteTooltip(e, hoverType, hoverName);
            // Set highlight state and re-render so it draws in transformed space
            this.deleteHighlight = { item: hoveredItem, type: hoverType };
            this.render();
        } else if (!hoveredItem && this.hoveredDeleteItem) {
            this.hoveredDeleteItem = null;
            this.deleteHighlight = null;
            this.hideDeleteTooltip();
            this.render(); // Remove highlighting
        } else if (hoveredItem === this.hoveredDeleteItem) {
            // Update tooltip position
            this.updateDeleteTooltipPosition(e);
        }
    }
    
    showDeleteTooltip(e, type, name) {
        this.hideDeleteTooltip();
        
        this.deleteTooltip = document.createElement('div');
        this.deleteTooltip.className = 'delete-tooltip';
        this.deleteTooltip.innerHTML = `
            <div class="delete-tooltip-content">
                <span class="delete-tooltip-icon">🗑️</span>
                <span class="delete-tooltip-text">Delete ${type}: <strong>${name}</strong></span>
            </div>
        `;
        
        document.body.appendChild(this.deleteTooltip);
        this.updateDeleteTooltipPosition(e);
    }
    
    updateDeleteTooltipPosition(e) {
        if (!this.deleteTooltip) return;
        
        const tooltip = this.deleteTooltip;
        const offset = 15;
        
        // Position tooltip to the right and below cursor
        let x = e.clientX + offset;
        let y = e.clientY + offset;
        
        // Prevent tooltip from going off screen
        const rect = tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        if (x + rect.width > viewportWidth) {
            x = e.clientX - rect.width - offset;
        }
        if (y + rect.height > viewportHeight) {
            y = e.clientY - rect.height - offset;
        }
        
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
    }
    
    hideDeleteTooltip() {
        if (this.deleteTooltip) {
            this.deleteTooltip.remove();
            this.deleteTooltip = null;
        }
    }
    
    highlightDeleteTarget(obj, type) {
        // Fixed: was referencing undefined variable `item`
        this.deleteHighlight = { item: obj, type };
        this.render();
    }
    
    drawDeleteHighlight(obj) {
        const padding = 4;
        this.ctx.strokeStyle = '#ff4757';
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([8, 4]);
        this.ctx.strokeRect(
            obj.x - padding, 
            obj.y - padding, 
            obj.width + padding * 2, 
            obj.height + padding * 2
        );
        this.ctx.setLineDash([]);
        
        // Add pulsing effect background
        this.ctx.fillStyle = 'rgba(255, 71, 87, 0.1)';
        this.ctx.fillRect(
            obj.x - padding, 
            obj.y - padding, 
            obj.width + padding * 2, 
            obj.height + padding * 2
        );
    }
    
    drawPathDeleteHighlight(path) {
        if (path.points.length < 2) return;
        
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#ff4757';
        this.ctx.lineWidth = Math.max(6, (path.frequency ? Math.min(1 + path.frequency / 2, 10) : 2) + 3);
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.setLineDash([10, 5]);
        
        this.ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
            this.ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }
    
    drawObstacleDeleteHighlight(obstacle) {
        const padding = 4;
        this.ctx.fillStyle = 'rgba(255, 71, 87, 0.2)';
        this.ctx.strokeStyle = '#ff4757';
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([8, 4]);
        
        const x = obstacle.width < 0 ? obstacle.x + obstacle.width : obstacle.x;
        const y = obstacle.height < 0 ? obstacle.y + obstacle.height : obstacle.y;
        const w = Math.abs(obstacle.width);
        const h = Math.abs(obstacle.height);
        
        this.ctx.fillRect(x - padding, y - padding, w + padding * 2, h + padding * 2);
        this.ctx.strokeRect(x - padding, y - padding, w + padding * 2, h + padding * 2);
        this.ctx.setLineDash([]);
    }

    // Background transformation methods
    rotateBackground(degrees) {
        this.backgroundTransform.rotation += degrees;
        this.backgroundTransform.rotation = this.backgroundTransform.rotation % 360;
        this.render();
    }

    flipBackground(direction) {
        if (direction === 'h') {
            this.backgroundTransform.flipH = !this.backgroundTransform.flipH;
        } else if (direction === 'v') {
            this.backgroundTransform.flipV = !this.backgroundTransform.flipV;
        }
        this.render();
    }

    resetBackgroundTransform() {
        this.backgroundTransform = { rotation: 0, flipH: false, flipV: false };
        this.render();
    }

    setZoom(newZoom, anchorX, anchorY) {
        const oldZoom = this.zoom || 1;
        newZoom = Math.max(0.05, Math.min(20, newZoom));
        if (!anchorX && !anchorY) {
            // center of canvas as default anchor
            anchorX = this.canvas.width / 2;
            anchorY = this.canvas.height / 2;
        }
        // Compute world point under anchor before zoom
        const worldX = (anchorX - this.pan.x) / oldZoom;
        const worldY = (anchorY - this.pan.y) / oldZoom;
        this.zoom = newZoom;
        // Adjust pan so the same world point stays under cursor
        this.pan.x = anchorX - worldX * this.zoom;
        this.pan.y = anchorY - worldY * this.zoom;
        this._userViewportChanged = true;
        this._updateZoomUI();
        this.render();
    }
    
    _updateZoomUI() {
        const btn = document.getElementById('resetZoom');
        if (btn) btn.textContent = `${Math.round((this.zoom || 1) * 100)}%`;
    }
    
    fitBackground() {
        if (!this.backgroundRect) { this.render(); return; }
        const bw = this.backgroundRect.width;
        const bh = this.backgroundRect.height;
        if (bw <= 0 || bh <= 0) { this.zoom = 1; this.pan = { x:0, y:0 }; this._updateZoomUI(); this.render(); return; }
        const margin = 0.95;
        this.zoom = Math.min(this.canvas.width / bw, this.canvas.height / bh) * margin;
        const screenBw = bw * this.zoom;
        const screenBh = bh * this.zoom;
        this.pan.x = (this.canvas.width - screenBw) / 2 - this.backgroundRect.x * this.zoom;
        this.pan.y = (this.canvas.height - screenBh) / 2 - this.backgroundRect.y * this.zoom;
        this._userViewportChanged = false;
        this._updateZoomUI();
        this.render();
    }
    
    resetView() {
        if (this.backgroundRect) { this.fitBackground(); return; }
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this._userViewportChanged = false;
        this._updateZoomUI();
        this.render();
    }

    // Missing methods that were being called
    clearAll() {
        if (this.objects.length === 0 && this.paths.length === 0 && this.obstacles.length === 0) {
            this.showInfoMessage('Nothing to clear!', 'info');
            return;
        }
        
        if (confirm('Clear all objects, paths, and obstacles? This action cannot be undone.')) {
            this.objects = [];
            this.paths = [];
            this.obstacles = [];
            this.selectedObject = null;
            this.selectedPath = null;
            this.currentPath = [];
            this.currentObstacle = null;
            this.updateAnalytics();
            this.render();
            this.showInfoMessage('All data cleared successfully.', 'success');
        }
    }

    exportData() {
        const data = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            objects: this.objects,
            paths: this.paths,
            obstacles: this.obstacles,
            scale: {
                units: this.units,
                unitsPerPixel: this.unitsPerPixel,
                stepsPerUnit: this.stepsPerUnit,
                gridCellUnits: this.gridCellUnits
            },
            backgroundTransform: this.backgroundTransform
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `spaghetti-diagram-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showInfoMessage('Data exported successfully!', 'success');
    }

    showDeleteConfirmation(item, type) {
        const name = item.name || item.description || `${type} ${item.id}`;
        if (confirm(`Delete ${type}: "${name}"? This action cannot be undone.`)) {
            if (type === 'object') {
                const index = this.objects.indexOf(item);
                if (index > -1) {
                    this.objects.splice(index, 1);
                    if (this.selectedObject === item) this.selectedObject = null;
                }
            } else if (type === 'path') {
                const index = this.paths.indexOf(item);
                if (index > -1) {
                    this.paths.splice(index, 1);
                    if (this.selectedPath === item) this.selectedPath = null;
                }
            } else if (type === 'obstacle') {
                const index = this.obstacles.indexOf(item);
                if (index > -1) {
                    this.obstacles.splice(index, 1);
                }
            }
            this.updateAnalytics();
            this.render();
            this.showInfoMessage(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully.`, 'success');
        }
    }

    closeDeleteModal() {
        // This method is called but there's no delete modal in the HTML
        // Just ensure any delete state is cleared
        this.hoveredDeleteItem = null;
        this.deleteHighlight = null;
        this.hideDeleteTooltip();
    }

    openHelpModal() {
        const modal = document.getElementById('helpModal');
        if (modal) {
            modal.classList.remove('hidden');
            // Store the previously focused element
            this._lastFocusedBeforeHelp = document.activeElement;
            // Focus the close button for keyboard accessibility
            const closeBtn = modal.querySelector('#closeHelpModal');
            if (closeBtn) closeBtn.focus();
        }
    }

    closeHelpModal() {
        const modal = document.getElementById('helpModal');
        if (modal) {
            modal.classList.add('hidden');
            // Restore focus to the previously focused element
            if (this._lastFocusedBeforeHelp && this._lastFocusedBeforeHelp.focus) {
                this._lastFocusedBeforeHelp.focus();
            }
            this._lastFocusedBeforeHelp = null;
        }
    }
}

// Global app instance for modal callbacks
let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new SpaghettiDiagramApp();
    // Expose globally so inline handlers in generated modals can call methods
    try { window.app = app; } catch (_) {}
    // Re-check palette on window focus (covers hot reloads or dynamic content issues)
    window.addEventListener('focus', () => { if (window.app) window.app.ensureObjectPalette(); });
});