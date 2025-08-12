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
        this.zones = [];
        this.backgroundImage = null;
        this.backgroundPdfPageCanvas = null; // offscreen canvas for rendered PDF page
        this.backgroundTransform = { rotation: 0, flipH: false, flipV: false };
        // New: persistent world-space rectangle for background (image or pdf page)
        this.backgroundRect = null; // { x, y, width, height } in world coords
        this.selectedObject = null;
        this.currentPath = [];
        this.currentObstacle = null;
        this.currentZone = null;
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
        
        this.initAutoPathUI();
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
        
        // Background orientation controls (removed direct individual listeners to avoid double calls; now handled by delegated click handler below)
        // document.getElementById('rotateLeft').addEventListener('click', () => this.rotateBackground(-90));
        // document.getElementById('rotateRight').addEventListener('click', () => this.rotateBackground(90));
        // document.getElementById('flipH').addEventListener('click', () => this.flipBackground('h'));
        // document.getElementById('flipV').addEventListener('click', () => this.flipBackground('v'));
        // document.getElementById('resetOrientation').addEventListener('click', () => this.resetBackgroundTransform());
        
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
        
        // Delete Confirmation Modal
        document.getElementById('closeDeleteModal').addEventListener('click', this.closeDeleteModal.bind(this));
        document.getElementById('cancelDelete').addEventListener('click', this.closeDeleteModal.bind(this));
        document.getElementById('confirmDelete').addEventListener('click', this.confirmDelete.bind(this));

        // Zone modal
        const closeZone = document.getElementById('closeZoneModal');
        const deleteZoneBtn = document.getElementById('deleteZone');
        const zoneForm = document.getElementById('zoneForm');
        if (closeZone) closeZone.addEventListener('click', this.closeZoneModal.bind(this));
        if (deleteZoneBtn) deleteZoneBtn.addEventListener('click', this.deleteSelectedZone.bind(this));
        if (zoneForm) zoneForm.addEventListener('submit', this.saveZoneMetadata.bind(this));
        
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
        document.getElementById('deleteModal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) this.closeDeleteModal();
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
            zone: 'Click and drag to draw a rectangular zone (Green or Restricted). Double-click to edit properties.',
            obstacle: 'Click and drag to create obstacle/off-limits zones.',
            delete: 'Click on an object, path, zone, or obstacle to delete it. A confirmation dialog will appear.'
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

        this.refreshAutoPathSelects();
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
    
    getAnyRectAt(point) {
        // Objects on top, then zones, then obstacles (matching existing delete logic priority)
        const obj = this.getObjectAt(point);
        if (obj) return { item: obj, type: 'object' };
        const zone = this.getZoneAt(point);
        if (zone) return { item: zone, type: 'zone' };
        const obstacle = this.getObstacleAt(point);
        if (obstacle) return { item: obstacle, type: 'obstacle' };
        return null;
    }
    
    handleMouseDown(e) {
        e.preventDefault();
        this.mousePos = this.getMousePos(e);
        this.dragStart = { ...this.mousePos };
        if (this.isCalibrating) { this.handleCalibrationClick(); return; }
        // Determine hover targets BEFORE deciding to pan so resize/drag takes precedence
        const rectHit = this.getAnyRectAt(this.mousePos);
        const endpointInfo = this.getPathEndpointAt(this.mousePos);
        // Check for any resize handle under cursor (selected item or hovered item)
        let resizeCandidate = null;
        const candidateTarget = (rectHit && rectHit.item) || this.selectedObject || this.selectedZone || this.selectedObstacle;
        if (candidateTarget) resizeCandidate = this.getResizeHandle(this.mousePos, candidateTarget);
        const wantPan = (e.button === 1 || e.button === 2 || (e.button === 0 && this.currentTool === 'select' && !rectHit && !endpointInfo && !resizeCandidate));
        if (wantPan) {
            this.isPanning = true;
            this.lastClientPos = { x: e.clientX, y: e.clientY };
            return;
        }
        if (this.currentTool === 'select') {
            this.handleSelectMouseDown();
        } else if (this.currentTool === 'path') {
            this.handlePathMouseDown();
        } else if (this.currentTool === 'zone') {
            this.handleZoneMouseDown();
        } else if (this.currentTool === 'obstacle') {
            this.handleObstacleMouseDown();
        } else if (this.currentTool === 'delete') {
            this.handleDeleteMouseDown();
        }
    }
    
    handleSelectMouseDown() {
        // Check for resize handles for currently selected rectangle (object/zone/obstacle)
        const rectTarget = this.selectedObject || this.selectedZone || this.selectedObstacle;
        if (rectTarget) {
            const handle = this.getResizeHandle(this.mousePos, rectTarget);
            if (handle) {
                this.isResizing = true;
                this.resizeHandle = handle;
                return;
            }
        }
        // Path endpoint first
        const endpointInfo = this.getPathEndpointAt(this.mousePos);
        if (endpointInfo) {
            this.selectedPath = endpointInfo.path;
            this.selectedEndpoint = endpointInfo.endpoint;
            this.isDraggingEndpoint = true;
            this.selectedObject = null;
            this.selectedZone = null;
            this.selectedObstacle = null;
            this.render();
            return;
        }
        // Object selection
        const clickedObject = this.getObjectAt(this.mousePos);
        if (clickedObject) {
            const clickedHandle = this.getResizeHandle(this.mousePos, clickedObject);
            this.selectedObject = clickedObject;
            this.selectedZone = null;
            this.selectedObstacle = null;
            this.selectedPath = null;
            this.selectedEndpoint = null;
            if (clickedHandle) {
                this.isResizing = true; this.resizeHandle = clickedHandle; return;
            }
            this.isDragging = true; this.dragStart = { ...this.mousePos }; this.render(); return;
        }
        // Zone selection
        const clickedZone = this.getZoneAt(this.mousePos);
        if (clickedZone) {
            const clickedHandle = this.getResizeHandle(this.mousePos, clickedZone);
            this.selectedZone = clickedZone;
            this.selectedObject = null;
            this.selectedObstacle = null;
            this.selectedPath = null;
            this.selectedEndpoint = null;
            if (clickedHandle) { this.isResizing = true; this.resizeHandle = clickedHandle; return; }
            this.isDragging = true; this.dragStart = { ...this.mousePos }; this.render(); return;
        }
        // Obstacle selection
        const clickedObstacle = this.getObstacleAt(this.mousePos);
        if (clickedObstacle) {
            const clickedHandle = this.getResizeHandle(this.mousePos, clickedObstacle);
            this.selectedObstacle = clickedObstacle;
            this.selectedObject = null;
            this.selectedZone = null;
            this.selectedPath = null;
            this.selectedEndpoint = null;
            if (clickedHandle) { this.isResizing = true; this.resizeHandle = clickedHandle; return; }
            this.isDragging = true; this.dragStart = { ...this.mousePos }; this.render(); return;
        }
        // If nothing clicked clear selections
        this.selectedObject = null; this.selectedZone = null; this.selectedObstacle = null; this.selectedPath = null; this.selectedEndpoint = null; this.render();
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

    // Zone drawing (rectangle for now)
    handleZoneMouseDown() {
        this.isDrawing = true;
        this.currentZone = {
            x: this.mousePos.x,
            y: this.mousePos.y,
            width: 0,
            height: 0,
            id: null,
            name: 'Zone',
            type: 'green' // default
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
                // Check for zones
                const clickedZone = this.getZoneAt(point);
                if (clickedZone) {
                    itemToDelete = clickedZone;
                    deleteType = 'zone';
                } else {
                    // Check for obstacles
                    const clickedObstacle = this.getObstacleAt(point);
                    if (clickedObstacle) {
                        itemToDelete = clickedObstacle;
                        deleteType = 'obstacle';
                    }
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
        } else if (this.currentTool === 'zone' && this.isDrawing) {
            this.handleZoneMouseMove();
        } else if (this.currentTool === 'obstacle' && this.isDrawing) {
            this.handleObstacleMouseMove();
        } else if (this.currentTool === 'delete') {
            this.handleDeleteMouseMove(e);
        }
    }
    
    handleSelectMouseMove() {
        if (this.isResizing && this.resizeHandle) {
            this.handleResize(); this.render(); return;
        } else if (this.isDraggingEndpoint && this.selectedPath && this.selectedEndpoint) {
            this.handleEndpointDrag(); return;
        } else if (this.isDragging) {
            const dx = this.mousePos.x - this.dragStart.x; const dy = this.mousePos.y - this.dragStart.y;
            const target = this.selectedObject || this.selectedZone || this.selectedObstacle;
            if (target) {
                target.x = Math.max(0, Math.min(this.canvas.width - target.width, target.x + dx));
                target.y = Math.max(0, Math.min(this.canvas.height - target.height, target.y + dy));
            }
            this.dragStart = { ...this.mousePos }; this.render(); return;
        } else {
            const hovered = this.getObjectAt(this.mousePos) || this.getZoneAt(this.mousePos) || this.getObstacleAt(this.mousePos) || this.selectedObject || this.selectedZone || this.selectedObstacle;
            const handle = hovered ? this.getResizeHandle(this.mousePos, hovered) : null;
            if (handle) {
                const cursorMap = { 'nw':'nwse-resize','se':'nwse-resize','ne':'nesw-resize','sw':'nesw-resize','n':'ns-resize','s':'ns-resize','w':'ew-resize','e':'ew-resize'};
                this.canvas.style.cursor = cursorMap[handle] || 'default';
            } else if (hovered) { this.canvas.style.cursor = 'move'; }
            else if (this.getPathEndpointAt(this.mousePos)) { this.canvas.style.cursor = 'pointer'; }
            else { this.canvas.style.cursor = 'default'; }
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

    handleZoneMouseMove() {
        if (this.currentZone) {
            this.currentZone.width = this.mousePos.x - this.currentZone.x;
            this.currentZone.height = this.mousePos.y - this.currentZone.y;
            this.render();
        }
    }
    
    handleResize() {
        const target = this.selectedObject || this.selectedZone || this.selectedObstacle; if (!target) return;
        const handle = this.resizeHandle; const dx = this.mousePos.x - this.dragStart.x; const dy = this.mousePos.y - this.dragStart.y; const minSize = 10;
        if (handle.includes('e')) target.width = Math.max(minSize, target.width + dx);
        if (handle.includes('w')) { const newWidth = Math.max(minSize, target.width - dx); const diff = target.width - newWidth; target.width = newWidth; target.x += diff; }
        if (handle.includes('s')) target.height = Math.max(minSize, target.height + dy);
        if (handle.includes('n')) { const newHeight = Math.max(minSize, target.height - dy); const diffH = target.height - newHeight; target.height = newHeight; target.y += diffH; }
        this.dragStart = { ...this.mousePos };
    }
    
    handleMouseUp(e) {
        e.preventDefault();
        
        if (this.isPanning) {
            this.isPanning = false;
        }
        
        if (this.currentTool === 'path' && this.isDrawing && this.currentPath.length > 1) {
            this.finalizePath();
        } else if (this.currentTool === 'zone' && this.isDrawing) {
            this.finalizeZone();
        } else if (this.currentTool === 'obstacle' && this.isDrawing) {
            this.finalizeObstacle();
        }
        
        this.isDrawing = false;
        this.isDragging = false;
        this.isResizing = false;
        this.isDraggingEndpoint = false;
        this.resizeHandle = null;
        this.canvas.style.cursor = 'default'; // Reset cursor on mouse up
    }
    
    handleDoubleClick(e) {
        e.preventDefault();
        if (this.currentTool === 'select') {
            const worldPos = this.getMousePos(e);
            const obj = this.getObjectAt(worldPos);
            if (obj) { this.selectedObject = obj; this.selectedZone = null; this.selectedObstacle = null; this.openObjectModal(); return; }
            const z = this.getZoneAt(worldPos);
            if (z) { this.selectedZone = z; this.selectedObject = null; this.selectedObstacle = null; this.openZoneModal(); return; }
            const ob = this.getObstacleAt(worldPos);
            if (ob) { this.selectedObstacle = ob; /* could open future obstacle modal */ return; }
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
            this.selectedObstacle = this.obstacles[this.obstacles.length - 1];
            // Switch to select to immediately allow drag/resize
            this.setTool('select');
        }
        this.currentObstacle = null;
        this.render();
    }

    finalizeZone() {
        if (this.currentZone && Math.abs(this.currentZone.width) > 10 && Math.abs(this.currentZone.height) > 10) {
            // Normalize
            if (this.currentZone.width < 0) { this.currentZone.x += this.currentZone.width; this.currentZone.width = Math.abs(this.currentZone.width); }
            if (this.currentZone.height < 0) { this.currentZone.y += this.currentZone.height; this.currentZone.height = Math.abs(this.currentZone.height); }
            this.currentZone.id = Date.now() + Math.random();
            this.zones.push({ ...this.currentZone });
            this.selectedZone = this.zones[this.zones.length - 1];
            // Open zone modal, but keep immediate select/resize behavior
            this.openZoneModal();
            this.setTool('select');
        }
        this.currentZone = null;
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
    
    openZoneModal() {
        if (!this.selectedZone) return;
        const z = this.selectedZone;
        const nameEl = document.getElementById('zoneName');
        const typeEl = document.getElementById('zoneType');
        if (nameEl) nameEl.value = z.name || '';
        if (typeEl) typeEl.value = z.type || 'green';
        const modal = document.getElementById('zoneModal');
        if (modal) modal.classList.remove('hidden');
        if (nameEl) nameEl.focus();
    }

    closeZoneModal() {
        const modal = document.getElementById('zoneModal');
        if (modal) modal.classList.add('hidden');
        const form = document.getElementById('zoneForm');
        if (form) form.reset();
    }

    saveZoneMetadata(e) {
        e.preventDefault();
        if (!this.selectedZone) return;
        const name = (document.getElementById('zoneName')?.value || '').trim();
        const type = document.getElementById('zoneType')?.value || 'green';
        if (!name) { alert('Zone name is required.'); return; }
        this.selectedZone.name = name;
        this.selectedZone.type = type;
        this.closeZoneModal();
        this.render();
    }

    deleteSelectedZone() {
        if (!this.selectedZone) return;
        this.showDeleteConfirmation(this.selectedZone, 'zone');
        this.closeZoneModal();
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
        
        this.showDeleteConfirmation(this.selectedObject, 'object');
        this.closeObjectModal(); // Close the object properties modal
    }
    
    initAutoPathUI() {
        this.autoPathStartEl = document.getElementById('autoPathStart');
        this.autoPathEndEl = document.getElementById('autoPathEnd');
        this.generateAutoPathBtn = document.getElementById('generateAutoPath');
        this.autoPathCellSizeEl = document.getElementById('autoPathCellSize');
        this.autoPathProximityEl = document.getElementById('autoPathProximity');
        this.autoPathSmoothingEl = document.getElementById('autoPathSmoothing');
        const validate = () => {
            if (!this.generateAutoPathBtn) return;
            const ok = this.autoPathStartEl?.value && this.autoPathEndEl?.value && this.autoPathStartEl.value !== this.autoPathEndEl.value;
            this.generateAutoPathBtn.disabled = !ok;
        };
        if (this.autoPathStartEl) this.autoPathStartEl.addEventListener('change', validate);
        if (this.autoPathEndEl) this.autoPathEndEl.addEventListener('change', validate);
        if (this.generateAutoPathBtn) {
            this.generateAutoPathBtn.addEventListener('click', () => this.handleGenerateAutoPath());
        }
        this.refreshAutoPathSelects();
        validate();
    }
    refreshAutoPathSelects() {
        if (!this.autoPathStartEl || !this.autoPathEndEl) return;
        const optsHtml = this.objects.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
        const startVal = this.autoPathStartEl.value;
        const endVal = this.autoPathEndEl.value;
        this.autoPathStartEl.innerHTML = `<option value="" disabled ${startVal? '' : 'selected'}>Select start</option>` + optsHtml;
        this.autoPathEndEl.innerHTML = `<option value="" disabled ${endVal? '' : 'selected'}>Select end</option>` + optsHtml;
        if (startVal) this.autoPathStartEl.value = startVal;
        if (endVal) this.autoPathEndEl.value = endVal;
        // trigger validation if button exists
        if (this.generateAutoPathBtn) this.generateAutoPathBtn.disabled = !(this.autoPathStartEl.value && this.autoPathEndEl.value && this.autoPathStartEl.value !== this.autoPathEndEl.value);
    }
    handleGenerateAutoPath() {
        if (!this.autoPathStartEl || !this.autoPathEndEl) return;
        const startId = parseFloat(this.autoPathStartEl.value);
        const endId = parseFloat(this.autoPathEndEl.value);
        if (!startId || !endId || startId === endId) { this.showInfoMessage('Select two different objects.','warning'); return; }
        const startObj = this.objects.find(o => o.id === startId);
        const endObj = this.objects.find(o => o.id === endId);
        if (!startObj || !endObj) { this.showInfoMessage('Objects not found.','error'); return; }
        const cellSize = Math.max(5, parseInt(this.autoPathCellSizeEl?.value)||20);
        const proxWeight = Math.max(0, parseFloat(this.autoPathProximityEl?.value)||0);
        const smoothingMode = this.autoPathSmoothingEl?.value || 'rounded';
        const route = this.computeAutoRoute(startObj, endObj, { cellSize, proxWeight });
        if (!route || route.length < 2) { this.showInfoMessage('No path found.','error'); return; }
        let smooth = route;
        if (smoothingMode === 'rounded') smooth = this.smoothPolyline(route);
        else if (smoothingMode === 'catmull') smooth = this.catmullRomSpline(route, 8);
        const color = '#0074D9';
        const path = { id: Date.now()+Math.random(), auto: true, points: smooth, description: `${startObj.name} → ${endObj.name}`, frequency: 1, color, length: this.calculatePathLength(smooth) };
        this.paths.push(path);
        this.updateObjectVisits(path);
        this.updateAnalytics();
        this.render();
        this.showInfoMessage('Auto path added.','success');
    }
    computeAutoRoute(startObj, endObj, opts={}) {
        const padding = 40;
        const cell = Math.max(5, opts.cellSize || 20);
        const proxWeight = opts.proxWeight || 0; // cost scale for proximity
        const blockedRects = [...this.objects, ...this.obstacles, ...this.zones.filter(z=>z.type==='restricted')];
        const items = blockedRects;
        const minX = Math.max(0, Math.min(startObj.x, endObj.x, ...items.map(i=>i.x)) - padding);
        const minY = Math.max(0, Math.min(startObj.y, endObj.y, ...items.map(i=>i.y)) - padding);
        const maxX = Math.max(startObj.x+startObj.width, endObj.x+endObj.width, ...items.map(i=>i.x+i.width)) + padding;
        const maxY = Math.max(startObj.y+startObj.height, endObj.y+endObj.height, ...items.map(i=>i.y+i.height)) + padding;
        const cols = Math.ceil((maxX - minX) / cell);
        const rows = Math.ceil((maxY - minY) / cell);
        const grid = new Array(rows).fill(0).map(()=>new Array(cols).fill(0));
        const markBlocked = (rX, rY, rW, rH) => {
            const c1 = Math.floor((rX - minX)/cell); const c2 = Math.floor((rX + rW - minX)/cell);
            const r1 = Math.floor((rY - minY)/cell); const r2 = Math.floor((rY + rH - minY)/cell);
            for (let r=r1; r<=r2; r++) for (let c=c1; c<=c2; c++) if (r>=0&&r<rows&&c>=0&&c<cols) grid[r][c]=1;
        };
        blockedRects.forEach(o=>markBlocked(o.x-6,o.y-6,o.width+12,o.height+12));
        // Precompute proximity field if needed
        let prox=null; if (proxWeight>0){
            prox = new Array(rows).fill(0).map(()=>new Array(cols).fill(0));
            const maxDistCells = 6; // influence radius
            for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
                if (grid[r][c]===1){ prox[r][c]=1; continue; }
                let best = maxDistCells+1;
                for (let rr=Math.max(0,r-maxDistCells); rr<=Math.min(rows-1,r+maxDistCells); rr++) {
                    for (let cc=Math.max(0,c-maxDistCells); cc<=Math.min(cols-1,c+maxDistCells); cc++) {
                        if (grid[rr][cc]===1) {
                            const d = Math.max(Math.abs(rr-r), Math.abs(cc-c));
                            if (d<best) best=d;
                        }
                    }
                }
                if (best<=maxDistCells) prox[r][c] = (maxDistCells - best)/maxDistCells; else prox[r][c]=0;
            }
        }
        const start = { x: startObj.x + startObj.width/2, y: startObj.y + startObj.height/2 };
        const end = { x: endObj.x + endObj.width/2, y: endObj.y + endObj.height/2 };
        const startNode = { c: Math.floor((start.x - minX)/cell), r: Math.floor((start.y - minY)/cell) };
        const endNode = { c: Math.floor((end.x - minX)/cell), r: Math.floor((end.y - minY)/cell) };
        const inside = (r,c)=> r>=0&&r<rows&&c>=0&&c<cols && grid[r][c]===0;
        if (!inside(startNode.r,startNode.c) || !inside(endNode.r,endNode.c)) return null;
        const h = (r,c)=> Math.hypot(c-endNode.c, r-endNode.r);
        const open = new Map(); const key=(r,c)=>r+','+c; const gScore = new Map(); const fScore = new Map(); const came = new Map();
        const push = (r,c,g)=>{ const f=g+h(r,c); open.set(key(r,c), {r,c,f,g}); gScore.set(key(r,c),g); fScore.set(key(r,c),f); };
        push(startNode.r,startNode.c,0);
        const dirs = [ [1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1] ];
        while (open.size) {
            let currentKey=null,current=null,lowest=Infinity; for (const [k,v] of open){ if (v.f<lowest){lowest=v.f;current=v;currentKey=k;} }
            if (!current) break;
            if (current.r===endNode.r && current.c===endNode.c) {
                const pts=[]; let ck=currentKey;
                while (ck){ const [rr,cc]=ck.split(',').map(Number); pts.push({x: minX+cc*cell+cell/2, y: minY+rr*cell+cell/2}); ck=came.get(ck); }
                pts.reverse(); return pts;
            }
            open.delete(currentKey);
            for (const [dr,dc] of dirs) {
                const nr=current.r+dr, nc=current.c+dc; if (!inside(nr,nc)) continue;
                if (dr!==0 && dc!==0) { if (!inside(current.r, nc) || !inside(nr, current.c)) continue; }
                let stepCost = Math.hypot(dr,dc);
                if (prox && proxWeight>0) stepCost += prox[nr][nc]*proxWeight; 
                const tentative = current.g + stepCost;
                const nk=key(nr,nc);
                if (tentative < (gScore.get(nk) ?? Infinity)) { came.set(nk,currentKey); push(nr,nc,tentative); }
            }
        }
        return null;
    }
    catmullRomSpline(points, segmentsPer=6) {
        if (!points || points.length < 3) return points || [];
        const pts = points.map(p=>({x:p.x,y:p.y}));
        if (pts.length === 3) pts.splice(0,0,pts[0]); // duplicate first if minimal
        const out=[];
        for (let i=0;i<pts.length-3;i++){
            const p0=pts[i], p1=pts[i+1], p2=pts[i+2], p3=pts[i+3];
            for (let j=0;j<=segmentsPer;j++){
                const t=j/segmentsPer; const t2=t*t; const t3=t2*t;
                const x=0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3);
                const y=0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3);
                if (!out.length || Math.hypot(x-out[out.length-1].x,y-out[out.length-1].y) > 2) out.push({x,y});
            }
        }
        // ensure last point
        const last=pts[pts.length-2]; if (!out.length || out[out.length-1].x!==last.x || out[out.length-1].y!==last.y) out.push({x:last.x,y:last.y});
        return out;
    }
    // ...existing code...
}
// ...existing code...