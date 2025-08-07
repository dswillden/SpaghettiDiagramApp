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
        this.selectedObject = null;
        this.currentPath = [];
        this.currentObstacle = null;
        this.tempPathPoints = null;
        
        // Mouse state
        this.mousePos = { x: 0, y: 0 };
        this.dragStart = { x: 0, y: 0 };
        this.resizeHandle = null;
        
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
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.populateObjectPalette();
        this.populateObjectTypeSelect();
        this.updateAnalytics();
        this.render();
        
        // Set initial tool
        this.setTool('select');
    }
    
    setupEventListeners() {
        // Canvas events
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
        
        // Prevent context menu on canvas
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Tool buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', this.handleToolChange.bind(this));
        });
        
        // File upload
        document.getElementById('imageUpload').addEventListener('change', this.handleImageUpload.bind(this));
        
        // Action buttons
        document.getElementById('clearAll').addEventListener('click', this.clearAll.bind(this));
        document.getElementById('exportData').addEventListener('click', this.exportData.bind(this));
        
        // Modal events
        this.setupModalEvents();
        
        // Object palette
        document.getElementById('objectPalette').addEventListener('click', this.handleObjectPaletteClick.bind(this));
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
        
        // Close modals on backdrop click
        document.getElementById('pathModal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) this.closePathModal();
        });
        document.getElementById('objectModal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) this.closeObjectModal();
        });
        
        // Close modals on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closePathModal();
                this.closeObjectModal();
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
        
        // Update button states
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeBtn = document.querySelector(`[data-tool="${tool}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
        
        // Update canvas cursor class
        this.canvas.className = '';
        this.canvas.classList.add(`${tool}-mode`);
        
        // Update info text
        const infoText = {
            select: 'Click and drag to move objects. Double-click to edit properties.',
            path: 'Click and drag to draw walking paths between objects.',
            obstacle: 'Click and drag to create obstacle/off-limits zones.'
        };
        document.getElementById('canvasInfo').textContent = infoText[tool] || 'Select a tool to begin.';
        
        this.render();
    }
    
    handleObjectPaletteClick(e) {
        const item = e.target.closest('.object-item');
        if (!item) return;
        
        const objectType = item.dataset.objectType;
        this.addObject(objectType);
    }
    
    addObject(typeName) {
        const template = this.objectTemplates.find(t => t.name === typeName);
        if (!template) return;
        
        const obj = {
            id: Date.now() + Math.random(),
            type: typeName,
            name: `${typeName} ${this.objects.filter(o => o.type === typeName).length + 1}`,
            x: Math.max(50, this.canvas.width / 2 - template.width / 2),
            y: Math.max(50, this.canvas.height / 2 - template.height / 2),
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
    
    handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) {
            alert('Please select a valid image file.');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.backgroundImage = img;
                this.render();
                
                // Show success message
                const info = document.getElementById('canvasInfo');
                const originalText = info.textContent;
                info.textContent = 'Background image loaded successfully!';
                info.style.color = 'var(--color-success)';
                
                setTimeout(() => {
                    info.textContent = originalText;
                    info.style.color = '';
                }, 2000);
            };
            img.onerror = () => {
                alert('Failed to load image. Please try a different file.');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
    
    handleMouseDown(e) {
        e.preventDefault();
        this.mousePos = this.getMousePos(e);
        this.dragStart = { ...this.mousePos };
        
        if (this.currentTool === 'select') {
            this.handleSelectMouseDown();
        } else if (this.currentTool === 'path') {
            this.handlePathMouseDown();
        } else if (this.currentTool === 'obstacle') {
            this.handleObstacleMouseDown();
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
        
        // Check for object selection
        const clickedObject = this.getObjectAt(this.mousePos);
        if (clickedObject) {
            this.selectedObject = clickedObject;
            this.isDragging = true;
        } else {
            this.selectedObject = null;
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
    
    handleMouseMove(e) {
        e.preventDefault();
        this.mousePos = this.getMousePos(e);
        
        if (this.currentTool === 'select') {
            this.handleSelectMouseMove();
        } else if (this.currentTool === 'path' && this.isDrawing) {
            this.handlePathMouseMove();
        } else if (this.currentTool === 'obstacle' && this.isDrawing) {
            this.handleObstacleMouseMove();
        }
    }
    
    handleSelectMouseMove() {
        if (this.isResizing && this.selectedObject && this.resizeHandle) {
            this.handleResize();
            this.render();
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
        
        if (this.currentTool === 'path' && this.isDrawing && this.currentPath.length > 1) {
            this.finalizePath();
        } else if (this.currentTool === 'obstacle' && this.isDrawing) {
            this.finalizeObstacle();
        }
        
        this.isDrawing = false;
        this.isDragging = false;
        this.isResizing = false;
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
        
        // Draw background image if it exists
        if (this.backgroundImage) {
            this.ctx.drawImage(this.backgroundImage, 0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Draw grid
        this.drawGrid();
        
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
    }

    drawGrid() {
        const gridSize = 20;
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#f0f0f0';
        
        for (let x = 0; x < this.canvas.width; x += gridSize) {
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
        }
        
        for (let y = 0; y < this.canvas.height; y += gridSize) {
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
        }
        
        this.ctx.stroke();
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
        const totalPaths = this.paths.length;
        const totalDistance = this.paths.reduce((sum, path) => sum + path.length, 0);
        const weightedCost = this.paths.reduce((sum, path) => sum + (path.length * path.frequency), 0);
        const avgPathLength = totalPaths > 0 ? totalDistance / totalPaths : 0;

        document.getElementById('totalPaths').textContent = totalPaths;
        document.getElementById('totalDistance').textContent = `${Math.round(totalDistance)} px`;
        document.getElementById('weightedCost').textContent = Math.round(weightedCost);
        document.getElementById('avgPathLength').textContent = `${Math.round(avgPathLength)} px`;

        this.updateHotspotList();
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

    clearAll() {
        if (confirm('Are you sure you want to clear everything? This action cannot be undone.')) {
            this.objects = [];
            this.paths = [];
            this.obstacles = [];
            this.backgroundImage = null;
            this.selectedObject = null;
            document.getElementById('imageUpload').value = '';
            this.updateAnalytics();
            this.render();
        }
    }

    exportData() {
        const data = {
            objects: this.objects,
            paths: this.paths,
            obstacles: this.obstacles,
            timestamp: new Date().toISOString()
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "spaghetti-diagram-data.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SpaghettiDiagramApp();
});