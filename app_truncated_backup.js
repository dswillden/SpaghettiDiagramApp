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
        
        // Auto path state
        this._autoPathStart = null;
        this._autoPathEnd = null;
        
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
                else if (['z','Z'].includes(e.key)) { this.setTool('zone'); }
                else if (['o','O'].includes(e.key)) { this.setTool('obstacle'); }
                else if (['a','A'].includes(e.key)) { this.setTool('autoPath'); }
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
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping) {
                if (this.selectedObject) {
                    e.preventDefault();
                    this.showDeleteConfirmation(this.selectedObject, 'object');
                } else if (this.selectedZone) {
                    e.preventDefault();
                    this.showDeleteConfirmation(this.selectedZone, 'zone');
                } else if (this.selectedObstacle) {
                    e.preventDefault();
                    this.showDeleteConfirmation(this.selectedObstacle, 'obstacle');
                }
            }
        });
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
                else if (['z','Z'].includes(e.key)) { this.setTool('zone'); }
                else if (['o','O'].includes(e.key)) { this.setTool('obstacle'); }
                else if (['a','A'].includes(e.key)) { this.setTool('autoPath'); }
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
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping) {
                if (this.selectedObject) {
                    e.preventDefault();
                    this.showDeleteConfirmation(this.selectedObject, 'object');
                } else if (this.selectedZone) {
                    e.preventDefault();
                    this.showDeleteConfirmation(this.selectedZone, 'zone');
                } else if (this.selectedObstacle) {
                    e.preventDefault();
                    this.showDeleteConfirmation(this.selectedObstacle, 'obstacle');
                }
            }
        });
    }
    
    handleAutoPathMouseDown() {
        const clickedObject = this.getObjectAt(this.mousePos);
        if (!clickedObject) {
            if (!this._autoPathStart) {
                this.showInfoMessage('Click an object to set the Auto Path start.', 'info');
            } else {
                this.showInfoMessage('Click a different object to set destination.', 'info');
            }
            return;
        }
        const startObj = this._autoPathStart;
        const endObj = clickedObject;
        this._autoPathEnd = endObj;
        this.showInfoMessage('Auto Path destination set. Click again to create the path.', 'info');
        
        // Clean up any existing temporary path
        this.clearTempPath();
        
        // Immediate render for feedback
        this.render();
        
        // Debounced path creation
        clearTimeout(this._autoPathDebounce);
        this._autoPathDebounce = setTimeout(() => {
            // Simplified path creation logic
            const pathPoints = this.computeAutoPath(startObj, endObj);
            if (pathPoints && pathPoints.length > 1) {
                const newPath = {
                    id: Date.now() + Math.random(),
                    points: pathPoints, // already smoothed
                    description: `Auto Path: ${startObj.name || 'Start'} → ${endObj.name || 'End'}`,
                    frequency: 1,
                    color: '#ff9800',
                    autoGenerated: true,
                    length: this.calculatePathLength(pathPoints)
                };
                this.paths.push(newPath);
                this.updateObjectVisits(newPath);
                this.updateAnalytics();
                this.showInfoMessage(`Auto path created. Length: ${newPath.length.toFixed(1)} px`, 'success');
            } else {
                this.showInfoMessage('No path found (blocked). Try adjusting obstacles/zones.', 'warning');
            }
            this._autoPathStart = null;
            this._autoPathEnd = null;
            this.render();
        }, 300);
    }
    
    computeAutoPath(startObj, endObj) {
        if (!startObj || !endObj) return null;
        const cell = 20;
        const cols = Math.ceil(this.canvas.width / cell);
        const rows = Math.ceil(this.canvas.height / cell);
        const toCell = (x,y)=>({ cx: Math.max(0, Math.min(cols-1, Math.floor(x/cell))), cy: Math.max(0, Math.min(rows-1, Math.floor(y/cell))) });
        const blocked = Array.from({length:rows},()=>Array(cols).fill(false));
        const markRect = (r)=>{ const x1=Math.floor(r.x/cell),y1=Math.floor(r.y/cell),x2=Math.floor((r.x+r.width)/cell),y2=Math.floor((r.y+r.height)/cell); for(let y=Math.max(0,y1);y<=Math.min(rows-1,y2);y++){for(let x=Math.max(0,x1);x<=Math.min(cols-1,x2);x++){blocked[y][x]=true;}}};
        for (const ob of this.obstacles) markRect(ob);
        for (const z of this.zones) if (z.type && z.type !== 'green') markRect(z);
        for (const o of this.objects) if (o!==startObj && o!==endObj) markRect(o);
        const startCenter={x:startObj.x+startObj.width/2,y:startObj.y+startObj.height/2};
        const endCenter={x:endObj.x+endObj.width/2,y:endObj.y+endObj.height/2};
        const startCell=toCell(startCenter.x,startCenter.y); const endCell=toCell(endCenter.x,endCenter.y);
        const key=(x,y)=>`${x},${y}`; const open=new Map(); const byF=[]; const startNode={x:startCell.cx,y:startCell.cy,g:0,f:0,parent:null}; startNode.f=Math.abs(startNode.x-endCell.cx)+Math.abs(startNode.y-endCell.cy); open.set(key(startNode.x,startNode.y),startNode); byF.push(startNode); const closed=new Set(); const dirs=[[1,0],[-1,0],[0,1],[0,-1]]; let found=null;
        while(byF.length){ byF.sort((a,b)=>a.f-b.f); const current=byF.shift(); if(!current) break; const ck=key(current.x,current.y); if(closed.has(ck)) continue; closed.add(ck); if(current.x===endCell.cx && current.y===endCell.cy){found=current;break;} for(const[dx,dy]of dirs){ const nx=current.x+dx, ny=current.y+dy; if(nx<0||ny<0||nx>=cols||ny>=rows) continue; if(blocked[ny][nx]) continue; const nk=key(nx,ny); if(closed.has(nk)) continue; const g=current.g+1; const h=Math.abs(nx-endCell.cx)+Math.abs(ny-endCell.cy); const f=g+h; let node=open.get(nk); if(!node||g<node.g){ node={x:nx,y:ny,g,f,parent:current}; open.set(nk,node); byF.push(node);} } }
        if(!found) return null; const rev=[]; let cur=found; while(cur){rev.push(cur); cur=cur.parent;} rev.reverse(); let pts=rev.map(n=>({x:n.x*cell+cell/2,y:n.y*cell+cell/2})); if(pts.length){pts[0]=startCenter; pts[pts.length-1]=endCenter;}
        // line-of-sight simplification
        const cellBlocked=(cx,cy)=>blocked[cy]&&blocked[cy][cx];
        const hasLoS=(p1,p2)=>{ const dx=p2.x-p1.x, dy=p2.y-p1.y; const steps=Math.max(Math.abs(dx),Math.abs(dy))/(cell/2); for(let i=0;i<=steps;i++){ const t=i/steps; const x=p1.x+dx*t, y=p1.y+dy*t; const cx=Math.floor(x/cell), cy=Math.floor(y/cell); if(cellBlocked(cx,cy)) return false;} return true; };
        const los=(arr)=>{ if(arr.length<=2) return arr; const out=[]; let i=0; while(i<arr.length-1){ let j=arr.length-1, foundJ=i+1; for(;j>i+1;j--){ if(hasLoS(arr[i],arr[j])){foundJ=j; break;} } out.push(arr[i]); i=foundJ; if(i===arr.length-1) out.push(arr[i]); } return out; };
        pts=los(pts); pts=this.simplifyPath(pts,3); return pts;
    }
// ...existing code...