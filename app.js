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
    // Path editing / color cycle
    this.editingPath = null;
    this._pathColors = ['#ff1744','#2979ff','#00c853','#ff9100','#8e24aa','#00bfa5','#d500f9','#c0ca33'];
    this._pathColorIndex = 0;
        
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
    this.initPathSidePanel();
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
        // Stop drawing if mouse leaves canvas while drawing a path
        this.canvas.addEventListener('mouseleave', (e) => {
            if (this.currentTool === 'path' && this.isDrawing) {
                if (this.currentPath.length > 1) {
                    this.finalizePath(); // This will set isDrawing = false
                } else {
                    this.currentPath = [];
                    this.render();
                    this.isDrawing = false; // Only set here if we're not calling finalizePath
                }
            }
        });
        // Global mouseup to catch releases outside canvas (prevents path sticking to cursor)
        window.addEventListener('mouseup', (e) => {
            if (this.currentTool === 'path' && this.isDrawing) {
                if (this.currentPath.length > 1) {
                    this.finalizePath();
                } else {
                    this.currentPath = [];
                    this.render();
                    this.isDrawing = false;
                }
                this.isDragging = false;
            }
        });
        
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
    const toggleCalLineChk = document.getElementById('toggleCalibrationLine');
        const persist = () => this.saveScaleToStorage();
        if (unitsSelect) unitsSelect.addEventListener('change', (e) => { this.units = e.target.value; this.updateScaleUI(); this.updateAnalytics(); this.render(); persist(); });
        if (stepsPerUnitInput) stepsPerUnitInput.addEventListener('change', (e) => { this.stepsPerUnit = Math.max(0, parseFloat(e.target.value) || 0); this.updateScaleUI(); this.updateAnalytics(); persist(); });
        if (gridCellUnitsInput) gridCellUnitsInput.addEventListener('change', (e) => { this.gridCellUnits = Math.max(0.01, parseFloat(e.target.value) || 1); this.render(); persist(); });
        if (calibrateBtn) calibrateBtn.addEventListener('click', () => this.beginCalibration());
        if (resetScaleBtn) resetScaleBtn.addEventListener('click', () => { this.resetScale(); persist(); });
        if (toggleCalLineChk) toggleCalLineChk.addEventListener('change', () => {
            this.showCalibrationLine = !!toggleCalLineChk.checked;
            this.render();
        });
        
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
        // Explicit save button listener (robust against form submit issues on subsequent opens)
        const savePathBtn = document.getElementById('savePath');
        if (savePathBtn && !savePathBtn.__bound) {
            savePathBtn.addEventListener('click', () => {
                const f = document.getElementById('pathForm');
                if (f) f.requestSubmit();
            });
            savePathBtn.__bound = true;
        }
        
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
        console.log('[DEBUG] populateObjectPalette() called');
        const palette = document.getElementById('objectPalette');
        console.log('[DEBUG] Palette element found:', palette);
        palette.innerHTML = '';
        
        this.objectTemplates.forEach(template => {
            console.log('[DEBUG] Creating item for template:', template.name);
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
        console.log('[DEBUG] populateObjectPalette() completed. Palette children count:', palette.children.length);
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
    // Clear any previously set inline cursor so CSS class cursor applies (needed for custom path cursor)
    this.canvas.style.cursor = '';
        
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
        console.log('[DEBUG] addObject called with:', typeName, x, y);
        const template = this.objectTemplates.find(t => t.name === typeName);
        if (!template) {
            console.error('[DEBUG] Template not found for:', typeName);
            return;
        }
        
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
        
        console.log('[DEBUG] Created object:', obj);
        this.objects.push(obj);
        console.log('[DEBUG] Objects array now has length:', this.objects.length);
        this.selectedObject = obj;
        this.setTool('select'); // Switch to select tool after adding object
        console.log('[DEBUG] Calling render...');
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
        // If side panel is open with an editingPath, auto-save current values then close
        if (this._pathPanelEl && !this._pathPanelEl.classList.contains('hidden') && this.editingPath) {
            try {
                const d = (this._pathPanelDesc?.value || '').trim();
                const f = Math.max(1, parseInt(this._pathPanelFreq?.value)||1);
                const c = this._pathPanelColor?.value || this.editingPath.color;
                if (d) this.editingPath.description = d;
                this.editingPath.frequency = f;
                this.editingPath.color = c;
                this.editingPath.length = this.calculatePathLength(this.editingPath.points);
                this.updateAnalytics();
            } catch(_) {}
            // Close panel silently
            this._pathPanelEl.classList.add('hidden');
            this.editingPath = null;
        }
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
            this.handlePathMouseMove(e);
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

    handlePathMouseMove(e) {
        // Do not finalize here; wait for mouseup so side panel logic runs consistently
        if (e && e.buttons === 0) {
            // Just ignore movement with no button; mouseup handler will finalize
            return;
        }
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
        
        // Only reset drawing state for non-path tools (path handles this in finalizePath)
        if (this.currentTool !== 'path') {
            this.isDrawing = false;
        }
        this.isDragging = false;
        this.isResizing = false;
        this.isDraggingEndpoint = false;
        this.resizeHandle = null;
        // Only force a default cursor for tools that rely on dynamic inline cursors; 
        // for path mode we clear inline style so the CSS marker cursor shows.
        if (this.currentTool === 'path') {
            this.canvas.style.cursor = '';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }
    
    handleDoubleClick(e) {
        e.preventDefault();
        if (this.currentTool === 'select') {
            const worldPos = this.getMousePos(e);
            // Allow double-click path to edit
            const p = this.getPathAt(worldPos);
            if (p) { this.openPathEditModal(p); return; }
            const obj = this.getObjectAt(worldPos);
            if (obj) { this.selectedObject = obj; this.selectedZone = null; this.selectedObstacle = null; this.openObjectModal(); return; }
            const z = this.getZoneAt(worldPos);
            if (z) { this.selectedZone = z; this.selectedObject = null; this.selectedObstacle = null; this.openZoneModal(); return; }
            const ob = this.getObstacleAt(worldPos);
            if (ob) { this.selectedObstacle = ob; /* could open future obstacle modal */ return; }
        }
    }

    openPathEditModal(path) {
        this.editingPath = path;
        this.tempPathPoints = null; // ensure creation buffer not used
    this.openPathSidePanel(path);
    }
    
    finalizePath() {
        // Prevent multiple calls by checking if we're actually drawing
        if (!this.isDrawing) {
            console.log('[PATH][finalizePath] skipped - not drawing');
            return;
        }
        console.log('[PATH][finalizePath] starting finalization...');
        this.isDrawing = false; // Set early to prevent multiple calls
        
        console.log('[PATH][finalizePath] instant create attempt length:', this.currentPath.length);
        if (this.currentPath.length < 2) { 
            console.log('[PATH][finalizePath] path too short, clearing');
            this.currentPath = []; 
            this.render(); 
            return; 
        }
        const simplified = this.simplifyPath(this.currentPath);
        if (!simplified || simplified.length < 2) { 
            console.log('[PATH][finalizePath] simplified path too short, clearing');
            this.currentPath = []; 
            this.render(); 
            return; 
        }
        // Attach endpoints to nearest object (radius)
        const attachRadius = 30;
        const findAttachment = (pt) => {
            let best=null, bestDist=attachRadius;
            for (const obj of this.objects) {
                const cx=obj.x+obj.width/2, cy=obj.y+obj.height/2;
                const d=Math.hypot(pt.x-cx, pt.y-cy);
                if (d<bestDist){ bestDist=d; best=obj; }
            }
            return best;
        };
        const first = { ...simplified[0] }; const last = { ...simplified[simplified.length-1] };
        const startObj = findAttachment(first); const endObj = findAttachment(last);
        if (startObj){ first.x = startObj.x + startObj.width/2; first.y = startObj.y + startObj.height/2; }
        if (endObj){ last.x = endObj.x + endObj.width/2; last.y = endObj.y + endObj.height/2; }
        simplified[0]=first; simplified[simplified.length-1]=last;
        const color = this._pathColors[this._pathColorIndex % this._pathColors.length];
        this._pathColorIndex++;
        const path = { id: Date.now()+Math.random(), points: simplified, description: `Path ${this.paths.length+1}`, frequency: 1, color, startObjectId: startObj?startObj.id:null, endObjectId: endObj?endObj.id:null, length: this.calculatePathLength(simplified) };
        console.log('[PATH][finalizePath] created path:', path.id);
        this.paths.push(path);
        this.updateObjectVisits(path);
        this.updateAnalytics();
        this.showInfoMessage(`Added ${path.description}`, 'success', 1500);
        this.currentPath = []; // Clear current path immediately
        console.log('[PATH][finalizePath] calling openPathSidePanel...');
        this.openPathSidePanel(path);
        this.render(); // Render after clearing current path and opening panel
        console.log('[PATH][finalizePath] finalization complete');
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
        console.log('[PATH][openPathModal] Opening path modal. tempPathPoints length:', this.tempPathPoints && this.tempPathPoints.length);
        const modal = document.getElementById('pathModal');
        modal.classList.remove('hidden');
        const desc = document.getElementById('pathDescription');
        // Pre-fill a default description if empty (helps users quickly save additional paths)
        if (desc && !desc.value.trim()) {
            desc.value = `Path ${this.paths.length + 1}`;
        }
        // Restore last used frequency or default to 1
        const freqEl = document.getElementById('pathFrequency');
        if (freqEl && !freqEl.value) {
            freqEl.value = this._lastPathFrequency || 1;
        }
        if (desc) desc.focus();
        // Reset submit handled flag for this opening
        this._primaryPathSubmitHandled = false;
        // Ensure Save button operational
        const saveBtn = document.getElementById('savePath');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.removeAttribute('aria-disabled');
            const clickHandler = (ev) => {
                console.log('[PATH][saveBtnClick] Save button clicked');
                const form = document.getElementById('pathForm');
                if (form) {
                    form.requestSubmit();
                } else {
                    console.warn('[PATH][saveBtnClick] pathForm not found');
                }
            };
            if (saveBtn.__sdClick) saveBtn.removeEventListener('click', saveBtn.__sdClick);
            saveBtn.addEventListener('click', clickHandler);
            saveBtn.__sdClick = clickHandler;
        }
        // Global capture fallback (bind once)
        if (!this.__pathFormCaptureBound) {
            document.addEventListener('submit', (ev) => {
                const form = ev.target;
                if (form && form.id === 'pathForm') {
                    console.log('[PATH][captureSubmit] submit event captured. primaryHandled?', this._primaryPathSubmitHandled);
                    if (!this._primaryPathSubmitHandled) {
                        // call primary now
                        this.savePathMetadata(ev);
                    }
                }
            }, true);
            this.__pathFormCaptureBound = true;
        }
        // Ensure form fields are blank each time except color default
        // (form.reset may already have happened on prior close)
    }
    
    closePathModal() {
        console.log('[PATH][closePathModal] Closing path modal. Clearing tempPathPoints.');
        document.getElementById('pathModal').classList.add('hidden');
        document.getElementById('pathForm').reset();
        this.tempPathPoints = null;
    this.editingPath = null;
        // Restore marker cursor if still in path tool
        if (this.currentTool === 'path') {
            this.canvas.style.cursor = '';
        }
    }
    
    savePathMetadata(e) {
        console.log('[PATH][savePathMetadata] Submit handler entered.');
        e.preventDefault();
    // Mark as handled so capture fallback does not double-run
    this._primaryPathSubmitHandled = true;
        const descriptionEl = document.getElementById('pathDescription');
        const frequencyEl = document.getElementById('pathFrequency');
        const colorEl = document.getElementById('pathColor');
        const description = descriptionEl.value.trim();
        const frequency = parseInt(frequencyEl.value);
        const color = colorEl.value;
        console.log('[PATH][savePathMetadata] Collected form data:', { description, frequency, color });
        if (!description || frequency < 1 || Number.isNaN(frequency)) {
            console.warn('[PATH][savePathMetadata] Validation failed.', { description, frequency });
            alert('Please fill in all required fields.');
            return;
        }
        if (this.editingPath) {
            this.editingPath.description = description;
            this.editingPath.frequency = frequency;
            this.editingPath.color = color;
            this.editingPath.length = this.calculatePathLength(this.editingPath.points);
            this._lastPathFrequency = frequency;
            this.updateAnalytics();
        } else {
            // Fallback: create new path from temp buffer if present (legacy flow)
            if (!this.tempPathPoints || this.tempPathPoints.length < 2) { alert('No path to save. Draw a path first.'); return; }
            const attachRadius = 30;
            const findAttachment = (pt) => { let best=null,bestDist=attachRadius; for (const obj of this.objects){ const cx=obj.x+obj.width/2, cy=obj.y+obj.height/2; const d=Math.hypot(pt.x-cx, pt.y-cy); if(d<bestDist){bestDist=d;best=obj;} } return best; };
            const startPt=this.tempPathPoints[0], endPt=this.tempPathPoints[this.tempPathPoints.length-1];
            const startObj=findAttachment(startPt), endObj=findAttachment(endPt);
            if(startObj){ startPt.x=startObj.x+startObj.width/2; startPt.y=startObj.y+startObj.height/2; }
            if(endObj){ endPt.x=endObj.x+endObj.width/2; endPt.y=endObj.y+endObj.height/2; }
            const path={ id:Date.now()+Math.random(), points:[...this.tempPathPoints], description, frequency, color, startObjectId:startObj?startObj.id:null, endObjectId:endObj?endObj.id:null, length:this.calculatePathLength(this.tempPathPoints) };
            this.paths.push(path);
            this._lastPathFrequency = frequency;
            this.updateObjectVisits(path);
            this.updateAnalytics();
        }
        this.closePathModal();
        this.render();
        // Show success feedback
        const info = document.getElementById('canvasInfo');
        const originalText = info.textContent;
        info.textContent = `Path "${description}" saved!`;
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
        console.log('[AUTO][generate] start', startObj.name, 'end', endObj.name, 'cell', cellSize, 'prox', proxWeight);
        const route = this.computeAutoRoute(startObj, endObj, { cellSize, proxWeight });
        if (!route || route.length < 2) { console.warn('[AUTO] No path found, route:', route); this.showInfoMessage('No path found.','error'); return; }
        let smooth = route;
        if (smoothingMode === 'rounded') smooth = this.smoothPolyline(route);
        else if (smoothingMode === 'catmull') smooth = this.catmullRomSpline(route, 8);
        smooth[0] = { x: startObj.x + startObj.width/2, y: startObj.y + startObj.height/2 };
        smooth[smooth.length-1] = { x: endObj.x + endObj.width/2, y: endObj.y + endObj.height/2 };
        const color = '#0074D9';
        const path = { id: Date.now()+Math.random(), auto: true, points: smooth, description: `${startObj.name} → ${endObj.name}`, frequency: 1, color, startObjectId: startObj.id, endObjectId: endObj.id, length: this.calculatePathLength(smooth) };
        console.log('[AUTO][generate] path created points:', smooth.length, 'length:', path.length);
        this.paths.push(path);
        // FIX: clear any drawing state so path is immediately visible without switching tools
        this.isDrawing = false;
        this.currentPath = [];
        // Optionally switch to select to avoid confusion
        this.setTool('select');
        this.updateObjectVisits(path);
        this.updateAnalytics();
        this.render();
        this.showInfoMessage('Auto path added.','success');
    }
    computeAutoRoute(startObj, endObj, opts={}) {
        console.log('[AUTO][compute] Begin');
        const padding = 40;
        const cell = Math.max(5, opts.cellSize || 20);
        const proxWeight = opts.proxWeight || 0; // cost scale for proximity
        // Exclude start & end from blocked rectangles so we can stand on them
        const blockedRects = [
            ...this.objects.filter(o => o !== startObj && o !== endObj),
            ...this.obstacles,
            ...this.zones.filter(z=>z.type==='restricted')
        ];
        const items = blockedRects;
        if (!startObj || !endObj) { console.warn('[AUTO][compute] Missing start/end'); return null; }
        const minX = Math.max(0, Math.min(startObj.x, endObj.x, ...(items.length? items.map(i=>i.x): [startObj.x, endObj.x])) - padding);
        const minY = Math.max(0, Math.min(startObj.y, endObj.y, ...(items.length? items.map(i=>i.y): [startObj.y, endObj.y])) - padding);
        const maxX = Math.max(startObj.x+startObj.width, endObj.x+endObj.width, ...(items.length? items.map(i=>i.x+i.width): [startObj.x+startObj.width, endObj.x+endObj.width])) + padding;
        const maxY = Math.max(startObj.y+startObj.height, endObj.y+endObj.height, ...(items.length? items.map(i=>i.y+i.height): [startObj.y+startObj.height, endObj.y+endObj.height])) + padding;
        const cols = Math.ceil((maxX - minX) / cell);
        const rows = Math.ceil((maxY - minY) / cell);
        if (cols<=0 || rows<=0) { console.warn('[AUTO][compute] Invalid grid size', cols, rows); return null; }
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
        if (!inside(startNode.r,startNode.c)) { console.warn('[AUTO][compute] Start blocked at', startNode); grid[startNode.r]&& (grid[startNode.r][startNode.c]=0); if(!inside(startNode.r,startNode.c)) return null; }
        if (!inside(endNode.r,endNode.c)) { console.warn('[AUTO][compute] End blocked at', endNode); grid[endNode.r]&& (grid[endNode.r][endNode.c]=0); if(!inside(endNode.r,endNode.c)) return null; }
        const h = (r,c)=> Math.hypot(c-endNode.c, r-endNode.r);
        const open = new Map(); const key=(r,c)=>r+','+c; const gScore = new Map(); const fScore = new Map(); const came = new Map();
        const push = (r,c,g)=>{ const f=g+h(r,c); open.set(key(r,c), {r,c,f,g}); gScore.set(key(r,c),g); fScore.set(key(r,c),f); };
        push(startNode.r,startNode.c,0);
        const dirs = [ [1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1] ];
        let iterations = 0;
        while (open.size) {
            iterations++;
            let currentKey=null,current=null,lowest=Infinity; for (const [k,v] of open){ if (v.f<lowest){lowest=v.f;current=v;currentKey=k;} }
            if (!current) break;
            if (current.r===endNode.r && current.c===endNode.c) {
                console.log('[AUTO][compute] Reached goal in', iterations, 'iterations');
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
            if (iterations > 20000) { console.warn('[AUTO][compute] Iteration cap reached'); break; }
        }
        console.warn('[AUTO][compute] Failed to find path');
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
    }    // ---- RECONSTRUCTED / RESTORED CORE METHODS (previously truncated) ----
    render() {
        console.log('[DEBUG] render() called - objects count:', this.objects.length);
        if (!this.ctx) {
            console.error('[DEBUG] No canvas context available');
            return;
        }
        const ctx = this.ctx;
        ctx.save();
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
        // Background fill
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0,0,this.canvas.width,this.canvas.height);

        // Apply pan/zoom
        ctx.translate(this.pan.x, this.pan.y);
        ctx.scale(this.zoom || 1, this.zoom || 1);

        // Draw background image/pdf with orientation transforms
        if (this.backgroundRect && (this.backgroundImage || this.backgroundPdfPageCanvas)) {
            ctx.save();
            const { x, y, width, height } = this.backgroundRect;
            // Translate to center for rotation/flip
            ctx.translate(x + width/2, y + height/2);
            const t = this.backgroundTransform || { rotation:0, flipH:false, flipV:false };
            const rot = (t.rotation||0) * Math.PI/180;
            ctx.rotate(rot);
            ctx.scale(t.flipH? -1:1, t.flipV? -1:1);
            const img = this.backgroundImage || this.backgroundPdfPageCanvas;
            ctx.drawImage(img, -width/2, -height/2, width, height);
            ctx.restore();
        }

        // Grid
        this.drawGrid(ctx);

    // Calibration provisional / finalized measurement line
    if (this.showCalibrationLine && ((this.isCalibrating && this.calibrationPoints.length > 0) || (this.calibrationPoints.length === 2 && (this._pendingCalibrationPx || this._lastCalibrationReal)))) {
            const pts = this.calibrationPoints;
            const a = pts[0];
            // While actively calibrating and only one point chosen, extend line to current mouse position
            const b = (this.isCalibrating && pts.length === 1) ? this.mousePos : (pts[1] || this.mousePos);
            if (a && b) {
                ctx.save();
                ctx.strokeStyle = '#ff9800';
                ctx.fillStyle = '#ff9800';
                ctx.lineWidth = 2 / (this.zoom || 1); // keep roughly constant screen thickness
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                // Endpoints
                const r = 5 / (this.zoom || 1);
                ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI*2); ctx.fill();
                // Length label (pixels + real units if available)
                const dx = b.x - a.x; const dy = b.y - a.y; const dist = Math.hypot(dx, dy);
                const midX = a.x + dx/2; const midY = a.y + dy/2;
                ctx.save();
                ctx.translate(midX, midY);
                // Background box for readability
                let label = `${dist.toFixed(1)} px`;
                if (this.unitsPerPixel>0){
                    const real = dist * this.unitsPerPixel; label += ` / ${real.toFixed(2)} ${this.units}`;
                } else if (this._lastCalibrationReal && this._pendingCalibrationPx){
                    const ratio = this._lastCalibrationReal / this._pendingCalibrationPx; const real = dist * ratio; label += ` / ${real.toFixed(2)} ${this._lastCalibrationUnits||this.units}`;
                }
                ctx.font = `${12 / (this.zoom || 1)}px sans-serif`;
                const metrics = ctx.measureText(label);
                const pad = 4 / (this.zoom || 1);
                const w = metrics.width + pad*2; const h = (12 / (this.zoom || 1)) + pad*2;
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(-w/2, -h/2, w, h);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, 0);
                ctx.restore();
                ctx.restore();
            }
        }

        // Zones
        for (const z of this.zones) this.drawZone(ctx, z);
        // Obstacles
        for (const ob of this.obstacles) this.drawObstacle(ctx, ob);
        // Paths
        for (const p of this.paths) this.drawPath(ctx, p);
        // Current drawing path
        if (this.isDrawing && this.currentTool === 'path' && this.currentPath.length) {
            ctx.save();
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 2; ctx.setLineDash([6,4]);
            ctx.beginPath();
            this.currentPath.forEach((pt,i)=>{ if (!i) ctx.moveTo(pt.x,pt.y); else ctx.lineTo(pt.x,pt.y); });
            ctx.stroke();
            ctx.restore();
        }
        // Provisional path (after mouse up, while metadata modal is open)
        if (!this.isDrawing && this.tempPathPoints && this.tempPathPoints.length > 1) {
            const pathModal = document.getElementById('pathModal');
            if (pathModal && !pathModal.classList.contains('hidden')) {
                ctx.save();
                ctx.strokeStyle = '#0074D9';
                ctx.lineWidth = 2; ctx.setLineDash([10,6]);
                ctx.beginPath();
                this.tempPathPoints.forEach((pt,i)=>{ if (!i) ctx.moveTo(pt.x,pt.y); else ctx.lineTo(pt.x,pt.y); });
                ctx.stroke();
                // Optional length label mid-path for user feedback
                const len = this.calculatePathLength(this.tempPathPoints);
                const mid = this.tempPathPoints[Math.floor(this.tempPathPoints.length/2)];
                if (mid) {
                    ctx.fillStyle = 'rgba(0,0,0,0.55)';
                    ctx.font = '12px sans-serif';
                    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                    const labelUnits = (this.unitsPerPixel>0) ? ` / ${(len*this.unitsPerPixel).toFixed(2)} ${this.units}` : '';
                    ctx.fillText(`${len.toFixed(1)} px${labelUnits}`, mid.x+6, mid.y-6);
                }
                ctx.restore();
            }
        }
        // Current obstacle draw
        if (this.isDrawing && this.currentTool === 'obstacle' && this.currentObstacle) {
            ctx.save(); ctx.fillStyle='rgba(200,60,0,0.25)'; ctx.strokeStyle='rgba(200,60,0,0.9)'; ctx.lineWidth=1.5; const o=this.currentObstacle; ctx.fillRect(o.x,o.y,o.width,o.height); ctx.strokeRect(o.x,o.y,o.width,o.height); ctx.restore();
        }
        // Current zone draw
        if (this.isDrawing && this.currentTool === 'zone' && this.currentZone) {
            const z=this.currentZone; ctx.save(); ctx.fillStyle='rgba(0,160,0,0.20)'; ctx.strokeStyle='rgba(0,100,0,0.9)'; ctx.lineWidth=1.5; ctx.fillRect(z.x,z.y,z.width,z.height); ctx.strokeRect(z.x,z.y,z.width,z.height); ctx.restore();
        }
        // Objects
        for (const o of this.objects) this.drawObject(ctx, o);

        // Selection outlines & resize handles
        const sel = this.selectedObject || this.selectedZone || this.selectedObstacle;
        if (sel) {
            ctx.save();
            ctx.strokeStyle = '#1e88e5';
            ctx.lineWidth = 2; ctx.setLineDash([4,2]);
            ctx.strokeRect(sel.x, sel.y, sel.width, sel.height);
            ctx.setLineDash([]);
            this.drawResizeHandles(ctx, sel);
            ctx.restore();
        }

        // Path endpoints highlight when dragging

        if (this.selectedPath) {
            ctx.save();
            ctx.fillStyle = '#1e88e5';
            const pts = this.selectedPath.points; if (pts && pts.length) {
                const radius = 6;
                ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, radius, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(pts[pts.length-1].x, pts[pts.length-1].y, radius, 0, Math.PI*2); ctx.fill();
            }
            ctx.restore();
        }

        ctx.restore();
    }

    drawGrid(ctx){
        // Determine grid cell size in world units. If scale undefined, use fixed 50px world size.
        const cellWorld = (this.unitsPerPixel>0) ? (this.gridCellUnits/this.unitsPerPixel) : 50;
        if (!cellWorld || cellWorld < 4) return;
        const z = (this.zoom||1);
        // Compute visible world rectangle (inverse of transform)
        const viewWorldX = -this.pan.x / z;
        const viewWorldY = -this.pan.y / z;
        const viewWorldW = this.canvas.width / z;
        const viewWorldH = this.canvas.height / z;
        // Expand by one cell to avoid edge clipping during panning
        const startCol = Math.floor(viewWorldX / cellWorld) - 1;
        const endCol   = Math.ceil((viewWorldX + viewWorldW) / cellWorld) + 1;
        const startRow = Math.floor(viewWorldY / cellWorld) - 1;
        const endRow   = Math.ceil((viewWorldY + viewWorldH) / cellWorld) + 1;
        ctx.save();
        // Keep grid lines visually 1px regardless of zoom
        ctx.lineWidth = 1 / z;
        ctx.strokeStyle = '#e0e0e0';
        ctx.beginPath();
        for (let c = startCol; c <= endCol; c++) {
            const x = c * cellWorld;
            ctx.moveTo(x, viewWorldY - cellWorld*2);
            ctx.lineTo(x, viewWorldY + viewWorldH + cellWorld*2);
        }
        for (let r = startRow; r <= endRow; r++) {
            const y = r * cellWorld;
            ctx.moveTo(viewWorldX - cellWorld*2, y);
            ctx.lineTo(viewWorldX + viewWorldW + cellWorld*2, y);
        }
        ctx.stroke();
        ctx.restore();
    }    drawObject(ctx,o){
        console.log('[DEBUG] drawObject called for:', o.name, 'at position:', o.x, o.y);
        ctx.save();
        ctx.fillStyle = o.color || '#777';
        ctx.strokeStyle = '#333'; ctx.lineWidth=1;
        ctx.fillRect(o.x,o.y,o.width,o.height);
        ctx.strokeRect(o.x,o.y,o.width,o.height);
        ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        const label = o.name || o.type || 'Obj';
        ctx.fillText(label, o.x+o.width/2, o.y+o.height/2);
        ctx.restore();
    }
    drawObstacle(ctx,o){ ctx.save(); ctx.fillStyle='rgba(180,0,0,0.25)'; ctx.strokeStyle='rgba(160,0,0,0.9)'; ctx.lineWidth=1.5; ctx.fillRect(o.x,o.y,o.width,o.height); ctx.strokeRect(o.x,o.y,o.width,o.height); ctx.restore(); }
    drawZone(ctx,z){ const isRestricted = z.type==='restricted'; ctx.save(); ctx.fillStyle = isRestricted? 'rgba(220,0,0,0.18)':'rgba(0,160,0,0.18)'; ctx.strokeStyle = isRestricted? 'rgba(160,0,0,0.9)':'rgba(0,110,0,0.9)'; ctx.lineWidth=1.5; ctx.fillRect(z.x,z.y,z.width,z.height); ctx.strokeRect(z.x,z.y,z.width,z.height); if (z.name){ ctx.fillStyle = '#222'; ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(z.name, z.x+4, z.y+4); } ctx.restore(); }
    drawPath(ctx,p){ if (!p.points || p.points.length<2) return; 
        // Auto-update attached endpoints to object centers
        const adjustEndpoint = (objId, index) => {
            if (!objId) return;
            const obj = this.objects.find(o=>o.id===objId);
            if (!obj) return;
            const center = { x: obj.x + obj.width/2, y: obj.y + obj.height/2 };
            const pt = p.points[index];
            if (!pt || pt.x!==center.x || pt.y!==center.y) { p.points[index] = center; p.length = this.calculatePathLength(p.points); }
        };
        adjustEndpoint(p.startObjectId, 0);
        adjustEndpoint(p.endObjectId, p.points.length-1);
        ctx.save(); ctx.strokeStyle = p.color || '#ff0000'; ctx.lineWidth = 2; ctx.beginPath(); p.points.forEach((pt,i)=>{ if(!i) ctx.moveTo(pt.x,pt.y); else ctx.lineTo(pt.x,pt.y); }); ctx.stroke(); ctx.restore(); }
    drawResizeHandles(ctx, target){ const handles = this.getResizeHandlePositions(target); ctx.save(); ctx.fillStyle='#1e88e5'; handles.forEach(h=>{ ctx.fillRect(h.x-4,h.y-4,8,8); }); ctx.restore(); }

    getResizeHandlePositions(t){ const x=t.x,y=t.y,w=t.width,h=t.height; return [ {name:'nw',x,y},{name:'n',x:x+w/2,y},{name:'ne',x:x+w,y},{name:'e',x:x+w,y:y+h/2},{name:'se',x:x+w,y:y+h},{name:'s',x:x+w/2,y:y+h},{name:'sw',x,y:y+h},{name:'w',x,y:y+h/2} ]; }
    getResizeHandle(pos, target){ const handles=this.getResizeHandlePositions(target); for (const h of handles){ if (Math.abs(pos.x-h.x)<=6 && Math.abs(pos.y-h.y)<=6) return h.name; } return null; }

    getObjectAt(pt){ for (let i=this.objects.length-1;i>=0;i--){ const o=this.objects[i]; if (pt.x>=o.x && pt.x<=o.x+o.width && pt.y>=o.y && pt.y<=o.y+o.height) return o; } return null; }
    getZoneAt(pt){ for (let i=this.zones.length-1;i>=0;i--){ const z=this.zones[i]; if (pt.x>=z.x && pt.x<=z.x+z.width && pt.y>=z.y && pt.y<=z.y+z.height) return z; } return null; }
    getObstacleAt(pt){ for (let i=this.obstacles.length-1;i>=0;i--){ const o=this.obstacles[i]; if (pt.x>=o.x && pt.x<=o.x+o.width && pt.y>=o.y && pt.y<=o.y+o.height) return o; } return null; }

    getPathEndpointAt(pt){ const radius=8; for (const p of this.paths){ const pts=p.points; if (!pts||pts.length<2) continue; const a=pts[0], b=pts[pts.length-1]; if (Math.hypot(pt.x-a.x, pt.y-a.y)<=radius) return { path:p, endpoint:'start' }; if (Math.hypot(pt.x-b.x, pt.y-b.y)<=radius) return { path:p, endpoint:'end' }; } return null; }
    getPathAt(pt){ const threshold=5; for (const p of this.paths){ const pts=p.points; for (let i=0;i<pts.length-1;i++){ if (this.pointSegmentDistance(pt, pts[i], pts[i+1])<=threshold) return p; } } return null; }
    pointSegmentDistance(p,a,b){ const dx=b.x-a.x, dy=b.y-a.y; if (dx===0&&dy===0) return Math.hypot(p.x-a.x,p.y-a.y); const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy); const clamped=Math.max(0,Math.min(1,t)); const proj={x:a.x+clamped*dx,y:a.y+clamped*dy}; return Math.hypot(p.x-proj.x,p.y-proj.y); }

    handleEndpointDrag(){ if (!this.selectedPath||!this.selectedEndpoint) return; const pts=this.selectedPath.points; if (!pts||pts.length<2) return; if (this.selectedEndpoint==='start') pts[0]={...this.mousePos}; else pts[pts.length-1]={...this.mousePos}; this.selectedPath.length = this.calculatePathLength(pts); this.updateAnalytics(); this.render(); }

    smoothPolyline(points, radius=18){ if (!points||points.length<3) return points||[]; const out=[points[0]]; for (let i=1;i<points.length-1;i++){ const p0=points[i-1], p1=points[i], p2=points[i+1]; const v1={x:p0.x-p1.x,y:p0.y-p1.y}; const v2={x:p2.x-p1.x,y:p2.y-p1.y}; const len1=Math.hypot(v1.x,v1.y); const len2=Math.hypot(v2.x,v2.y); if (!len1||!len2){ out.push(p1); continue; } const r=Math.min(radius, len1/2, len2/2); const n1={x:v1.x/len1,y:v1.y/len1}; const n2={x:v2.x/len2,y:v2.y/len2}; const pA={x:p1.x+n1.x*r,y:p1.y+n1.y*r}; const pB={x:p1.x+n2.x*r,y:p1.y+n2.y*r}; out.push(pA); out.push(pB); } out.push(points[points.length-1]); return out; }

    calculatePathLength(points){ if (!points||points.length<2) return 0; let d=0; for (let i=1;i<points.length;i++){ const a=points[i-1], b=points[i]; d+=Math.hypot(b.x-a.x,b.y-a.y); } return d; }
    updateObjectVisits(path){ if (!path||!path.points||path.points.length<2) return; const start=path.points[0], end=path.points[path.points.length-1]; const inc=(pt)=>{ const obj=this.getObjectAt(pt); if (obj) obj.visits=(obj.visits||0)+ (path.frequency||1); }; inc(start); inc(end); }

    // Line intersection function for analytics
    lineIntersectsLine(p1, p2, p3, p4) {
        const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
        if (Math.abs(denom) < 1e-10) return false; // Lines are parallel
        
        const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
        const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
        
        return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    }

    // Path crossings counter for analytics
    countPathCrossings(path1, path2) {
        let crossings = 0;
        for (let i = 0; i < path1.points.length - 1; i++) {
            for (let j = 0; j < path2.points.length - 1; j++) {
                if (this.lineIntersectsLine(
                    path1.points[i],
                    path1.points[i + 1],
                    path2.points[j],
                    path2.points[j + 1]
                )) {
                    crossings++;
                }
            }
        }
        return crossings;
    }

    // Spaghetti index calculation for analytics
    calculateSpaghettiIndex() {
        let totalTurns = 0;
        let crossings = 0;
        
        for (let i = 0; i < this.paths.length; i++) {
            const path1 = this.paths[i];
            
            // Count turns
            for (let j = 1; j < path1.points.length - 1; j++) {
                const angle = this.calculateAngle(
                    path1.points[j - 1],
                    path1.points[j],
                    path1.points[j + 1]
                );
                if (Math.abs(angle) > 30) {
                    totalTurns++;
                }
            }
            
            // Count crossings with other paths
            for (let k = i + 1; k < this.paths.length; k++) {
                const path2 = this.paths[k];
                crossings += this.countPathCrossings(path1, path2);
            }
        }
        
        const pathCount = this.paths.length || 1;
        return Math.min(100, Math.round(
            (totalTurns / pathCount * 5) + (crossings / pathCount * 10)
        ));
    }

    // Angle calculation helper for analytics
    calculateAngle(p1, p2, p3) {
        const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
        const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
        
        const angle1 = Math.atan2(v1.y, v1.x);
        const angle2 = Math.atan2(v2.y, v2.x);
        
        let angle = (angle2 - angle1) * 180 / Math.PI;
        
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        
        return angle;
    }

    updateAnalytics(){ // basic metrics; enhanced file adds more
        const totalPathsEl=document.getElementById('totalPaths');
        const totalDistEl=document.getElementById('totalDistance');
        const totalUnitsEl=document.getElementById('totalDistanceUnits');
        const unitsLabel=document.getElementById('totalDistanceUnitsLabel');
        const stepsEl=document.getElementById('totalSteps');
        const avgLenEl=document.getElementById('avgPathLength');
        const weightedEl=document.getElementById('weightedCost');
        const spaghettiIndexEl=document.getElementById('spaghettiIndex');
        
        let total=0, weighted=0; 
        for (const p of this.paths){ 
            const len=p.length || this.calculatePathLength(p.points); 
            p.length=len; 
            total+=len*(p.frequency||1); 
            weighted+=len*(p.frequency||1); 
        }
        const rawTotal=total; 
        const avg = this.paths.length? (rawTotal/this.paths.length):0;
        
        if (totalPathsEl) totalPathsEl.textContent=this.paths.length;
        if (totalDistEl) totalDistEl.textContent=`${rawTotal.toFixed(1)} px`;
        if (unitsLabel) unitsLabel.textContent=`Total Distance (${this.units})`;
        if (totalUnitsEl) { const units = (this.unitsPerPixel>0)? (rawTotal*this.unitsPerPixel) : 0; totalUnitsEl.textContent = `${units.toFixed(2)} ${this.units}`; }
        if (stepsEl) { const unitsDist = (this.unitsPerPixel>0)? (rawTotal*this.unitsPerPixel):0; const steps = unitsDist * (this.stepsPerUnit||0); stepsEl.textContent = steps? steps.toFixed(1):'0'; }
        if (avgLenEl) avgLenEl.textContent = `${avg.toFixed(1)} px`;
        if (weightedEl) weightedEl.textContent = weighted.toFixed(1);
        
        // Calculate spaghetti index
        if (spaghettiIndexEl) {
            const index = this.calculateSpaghettiIndex();
            spaghettiIndexEl.textContent = index;
            
            // Color code based on complexity
            if (index < 20) {
                spaghettiIndexEl.style.color = 'var(--color-success, #2e7d32)';
            } else if (index < 50) {
                spaghettiIndexEl.style.color = 'var(--color-warning, #ed6c02)';
            } else {
                spaghettiIndexEl.style.color = 'var(--color-error, #d32f2f)';
            }
        }
        
        this.refreshHotspots();
    }

    refreshHotspots(){ const list=document.getElementById('hotspotList'); if (!list) return; const visits = this.objects.map(o=>({name:o.name, v:o.visits||0})).filter(o=>o.v>0).sort((a,b)=>b.v-a.v).slice(0,6); list.innerHTML=''; if (!visits.length){ list.innerHTML='<div class="empty-state">No paths drawn yet</div>'; return;} visits.forEach(v=>{ const div=document.createElement('div'); div.className='hotspot-item'; div.textContent=`${v.name}: ${v.v}`; list.appendChild(div); }); }

    // ---- Path Side Panel (inline path metadata editor) ----
    initPathSidePanel(){
        console.log('[INIT] Initializing path side panel...');
        this._pathPanelEl = document.getElementById('pathSidePanel');
        this._pathPanelDesc = document.getElementById('pathPanelDescription');
        this._pathPanelFreq = document.getElementById('pathPanelFrequency');
        this._pathPanelColor = document.getElementById('pathPanelColor');
        this._pathPanelForm = document.getElementById('pathPanelForm');
        
        console.log('[INIT] Panel elements found:', {
            panel: !!this._pathPanelEl,
            desc: !!this._pathPanelDesc,
            freq: !!this._pathPanelFreq,
            color: !!this._pathPanelColor,
            form: !!this._pathPanelForm
        });
        
        const closeBtn = document.getElementById('pathPanelClose');
        const closeFooter = document.getElementById('pathPanelCloseFooter');
        const saveBtn = document.getElementById('pathPanelSave');
        const closePanel = () => { if (this._pathPanelEl) this._pathPanelEl.classList.add('hidden'); this.editingPath=null; };
        if (closeBtn) closeBtn.addEventListener('click', closePanel);
        if (closeFooter) closeFooter.addEventListener('click', closePanel);
        if (this._pathPanelForm){
            this._pathPanelForm.addEventListener('submit',(e)=>{
                e.preventDefault();
                if (!this.editingPath) { closePanel(); return; }
                const d=(this._pathPanelDesc.value||'').trim();
                const f=Math.max(1, parseInt(this._pathPanelFreq.value)||1);
                const c=this._pathPanelColor.value || this.editingPath.color;
                if (d) this.editingPath.description=d; else this.editingPath.description = this.editingPath.description || `Path`;
                this.editingPath.frequency=f;
                this.editingPath.color=c;
                this.editingPath.length = this.calculatePathLength(this.editingPath.points);
                this.updateAnalytics();
                this.render();
                this.showInfoMessage('Path updated','success',1200);
                closePanel();
            });
        }
        document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && this._pathPanelEl && !this._pathPanelEl.classList.contains('hidden')) closePanel(); });
    }
    openPathSidePanel(path){
        console.log('[PANEL] openPathSidePanel called with path:', path ? path.id : 'null');
        console.log('[PANEL] _pathPanelEl exists:', !!this._pathPanelEl);
        if (!this._pathPanelEl) {
            console.log('[PANEL] No panel element found!');
            return; 
        }
        this.editingPath=path; 
        console.log('[PANEL] Removing hidden class...');
        this._pathPanelEl.classList.remove('hidden');
        console.log('[PANEL] Panel should now be visible');
        if (this._pathPanelDesc) this._pathPanelDesc.value = path.description || `Path ${this.paths.indexOf(path)+1}`;
        if (this._pathPanelFreq) this._pathPanelFreq.value = path.frequency || 1;
        if (this._pathPanelColor) this._pathPanelColor.value = path.color || '#ff0000';
        if (this._pathPanelDesc) this._pathPanelDesc.focus();
        console.log('[PANEL] Panel setup complete');
    }

    // ---- Scale & Calibration (simplified) ----
    loadScaleFromStorage(){ try{ const s=JSON.parse(localStorage.getItem('sdScale')||'null'); if (s){ this.units=s.units||this.units; this.unitsPerPixel=s.unitsPerPixel||0; this.stepsPerUnit=s.stepsPerUnit||0; this.gridCellUnits=s.gridCellUnits||1; } }catch(_){} }
    saveScaleToStorage(){ try{ localStorage.setItem('sdScale', JSON.stringify({ units:this.units, unitsPerPixel:this.unitsPerPixel, stepsPerUnit:this.stepsPerUnit, gridCellUnits:this.gridCellUnits })); }catch(_){} }
    updateScaleUI(){ const info=document.getElementById('gridScaleInfo'); if (info){ if (this.unitsPerPixel>0) info.textContent = `1 pixel = ${(this.unitsPerPixel).toFixed(4)} ${this.units}`; else info.textContent='Scale not set'; } const u=document.getElementById('calibrateUnits'); if (u) u.textContent=this.units; }

    beginCalibration(){
        this.isCalibrating=true; this.calibrationPoints=[]; this._pendingCalibrationPx=null; this.showCalibrationLine = true;
        const chk=document.getElementById('toggleCalibrationLine');
        const wrapper=document.getElementById('calLineToggleWrapper');
        if (chk){ chk.checked=true; }
        if (wrapper){ wrapper.style.display='block'; }
        this.showInfoMessage('Click two points on background to measure distance.','info');
        this.render();
    }
    handleCalibrationClick(){ if (!this.isCalibrating) return; this.calibrationPoints.push({...this.mousePos}); if (this.calibrationPoints.length===2){ const [a,b]=this.calibrationPoints; const px=Math.hypot(b.x-a.x,b.y-a.y); this._pendingCalibrationPx = px; this.openCalibrateModal(px); this.isCalibrating=false; } this.render(); }
    openCalibrateModal(px){ const m=document.getElementById('calibrateModal'); if (m) m.classList.remove('hidden'); const info=document.getElementById('calibrateInfo'); if (info) info.textContent=`Measured pixel distance: ${px.toFixed(2)} px`; const input=document.getElementById('calibrateDistance'); if (input){ input.value=''; input.focus(); } }
    applyCalibrationFromModal(){
        const input=document.getElementById('calibrateDistance'); if (!input) return; const real=parseFloat(input.value);
        if (!real||real<=0||!this._pendingCalibrationPx){ this.showInfoMessage('Enter a valid distance.','warning'); return; }
        this.unitsPerPixel = real/this._pendingCalibrationPx;
        this._lastCalibrationReal = real; this._lastCalibrationUnits = this.units;
        this.saveScaleToStorage(); this.updateScaleUI(); this.updateAnalytics(); this.closeCalibrateModal();
        this.showInfoMessage(`Scale applied: ${real} ${this.units} ↔ ${this._pendingCalibrationPx.toFixed(1)} px`,'success');
        this.render();
    }
    closeCalibrateModal(){ const m=document.getElementById('calibrateModal'); if (m) m.classList.add('hidden'); }
    resetScale(){ this.unitsPerPixel=0; this.stepsPerUnit=0; this.gridCellUnits=1; this.saveScaleToStorage(); this.updateScaleUI(); this.updateAnalytics(); this.render(); }

    // ---- Viewport / background helpers ----
    setZoom(newZoom, anchorScreenX, anchorScreenY){ newZoom=Math.max(0.1, Math.min(8,newZoom)); const oldZoom=this.zoom||1; if (anchorScreenX!==undefined){ const wx = (anchorScreenX - this.pan.x)/oldZoom; const wy=(anchorScreenY - this.pan.y)/oldZoom; this.zoom=newZoom; this.pan.x = anchorScreenX - wx*newZoom; this.pan.y = anchorScreenY - wy*newZoom; } else { this.zoom=newZoom; } this._userViewportChanged=true; this.render(); }
    resetView(){ this.zoom=1; this.pan={x:0,y:0}; this._userViewportChanged=true; this.render(); }
    fitBackground(){ if (!this.backgroundRect) return; const br=this.backgroundRect; const margin=20; const scaleX=(this.canvas.width-2*margin)/br.width; const scaleY=(this.canvas.height-2*margin)/br.height; this.zoom=Math.min(scaleX, scaleY); this.pan.x = (this.canvas.width - br.width*this.zoom)/2; this.pan.y = (this.canvas.height - br.height*this.zoom)/2; this.render(); }
    rotateBackground(delta){ this.backgroundTransform.rotation = ((this.backgroundTransform.rotation||0)+delta)%360; this.render(); }
    flipBackground(axis){ if (axis==='h') this.backgroundTransform.flipH=!this.backgroundTransform.flipH; else if (axis==='v') this.backgroundTransform.flipV=!this.backgroundTransform.flipV; this.render(); }
    resetBackgroundTransform(){ this.backgroundTransform={rotation:0,flipH:false,flipV:false}; this.render(); }

    // ---- Deletion ----
    showDeleteConfirmation(item, type){ const modal=document.getElementById('deleteModal'); const msg=document.getElementById('deleteMessage'); if (msg) msg.textContent=`Delete this ${type}?`; this._pendingDelete={item,type}; if (modal) modal.classList.remove('hidden'); }
    closeDeleteModal(){ const modal=document.getElementById('deleteModal'); if (modal) modal.classList.add('hidden'); this._pendingDelete=null; }
    confirmDelete(){ if (!this._pendingDelete) return; const {item,type}=this._pendingDelete; if (type==='object') this.objects=this.objects.filter(o=>o!==item); else if (type==='path') this.paths=this.paths.filter(p=>p!==item); else if (type==='obstacle') this.obstacles=this.obstacles.filter(o=>o!==item); else if (type==='zone') this.zones=this.zones.filter(z=>z!==item); this.selectedObject=null; this.selectedZone=null; this.selectedObstacle=null; this.selectedPath=null; this.updateAnalytics(); this.render(); this.closeDeleteModal(); }    hideDeleteTooltip(){ if (this.deleteTooltip){ try{ this.deleteTooltip.remove(); }catch(_){} this.deleteTooltip=null; } }

    clearAll(){ if(!confirm('Clear all objects, paths, zones, and obstacles?')) return; this.objects=[]; this.paths=[]; this.obstacles=[]; this.zones=[]; this.selectedObject=null; this.selectedZone=null; this.selectedObstacle=null; this.selectedPath=null; this.updateAnalytics(); this.render(); }

    exportData(){ const data={ version:1, objects:this.objects, paths:this.paths, obstacles:this.obstacles, zones:this.zones, scale:{ units:this.units, unitsPerPixel:this.unitsPerPixel, stepsPerUnit:this.stepsPerUnit, gridCellUnits:this.gridCellUnits }, backgroundTransform:this.backgroundTransform }; const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='spaghetti_diagram.json'; a.click(); URL.revokeObjectURL(a.href); }

    // ----------------------------------------------------------------------
}

// ---- Bootstrap Application (was missing; required for objects & events) ----
(function(){
    if (!window.app) {
        const start = () => { 
            try { 
                console.log('[Bootstrap] Initializing SpaghettiDiagramApp...');
                window.app = new SpaghettiDiagramApp(); 
                console.log('[Bootstrap] App initialized successfully:', window.app);
                console.log('[Bootstrap] Canvas element:', window.app.canvas);
                console.log('[Bootstrap] Canvas context:', window.app.ctx);
                // Removed automatic test object creation to start with a blank canvas per new requirements.
            } catch (e) { 
                console.error('[Bootstrap] Failed to init app:', e); 
            } 
        };
        if (document.readyState === 'loading') {
            console.log('[Bootstrap] DOM still loading, waiting...');
            document.addEventListener('DOMContentLoaded', start); 
        } else {
            console.log('[Bootstrap] DOM ready, starting immediately...');
            start();
        }
    } else {
        console.log('[Bootstrap] App already exists:', window.app);
    }
})();

// Attach a global debug helper after class definition (bootstrap area below may already exist)
(function() {
    const dumpPathsBtn = document.getElementById('dumpPaths');
    if (dumpPathsBtn) {
        dumpPathsBtn.addEventListener('click', () => {
            if (!window.app) return;
            const { paths } = window.app;
            const dumpWindow = window.open('', '_blank');
            if (!dumpWindow) return;
            dumpWindow.document.write('<html><head><title>Paths Dump</title></head><body><pre>');
            dumpWindow.document.write(JSON.stringify(paths, null, 2));
            dumpWindow.document.write('</pre></body></html>');
            dumpWindow.document.close();
        });
    }
})();