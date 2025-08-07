// Enhanced Spaghetti Diagram App with Path Deletion
let canvas, ctx;
let isDrawing = false;
let deleteMode = false;
let paths = []; // Array to store all drawn paths
let currentPath = null;

// Initialize the application
function initApp() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    
    // Set canvas size
    resizeCanvas();
    
    // Add event listeners
    setupEventListeners();
    
    console.log('Spaghetti Diagram App initialized with delete functionality');
}

// Setup all event listeners
function setupEventListeners() {
    // Canvas drawing events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    
    // Canvas click for delete mode
    canvas.addEventListener('click', handleCanvasClick);
    
    // Button events
    document.getElementById('deleteBtn').addEventListener('click', toggleDeleteMode);
    document.getElementById('clearBtn').addEventListener('click', clearAllPaths);
    
    // Window resize
    window.addEventListener('resize', resizeCanvas);
}

// Drawing functions
function startDrawing(e) {
    if (deleteMode) return;
    
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    createNewPath(x, y);
}

function draw(e) {
    if (!isDrawing || deleteMode) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    addPointToCurrentPath(x, y);
    drawCurrentPath();
}

function stopDrawing() {
    if (isDrawing) {
        isDrawing = false;
        finishCurrentPath();
    }
}

// Path management functions
function createNewPath(startX, startY) {
    currentPath = {
        points: [{x: startX, y: startY}],
        color: getCurrentColor(),
        width: getCurrentLineWidth(),
        timestamp: Date.now(),
        id: generatePathId()
    };
}

function addPointToCurrentPath(x, y) {
    if (currentPath) {
        currentPath.points.push({x: x, y: y});
    }
}

function finishCurrentPath() {
    if (currentPath && currentPath.points.length > 1) {
        paths.push(currentPath);
        currentPath = null;
    }
}

function drawCurrentPath() {
    if (!currentPath || currentPath.points.length < 2) return;
    
    const lastPoint = currentPath.points[currentPath.points.length - 2];
    const currentPoint = currentPath.points[currentPath.points.length - 1];
    
    ctx.strokeStyle = currentPath.color;
    ctx.lineWidth = currentPath.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(currentPoint.x, currentPoint.y);
    ctx.stroke();
}

// Delete mode functions
function toggleDeleteMode() {
    deleteMode = !deleteMode;
    const deleteBtn = document.getElementById('deleteBtn');
    
    if (deleteMode) {
        deleteBtn.textContent = 'Exit Delete Mode';
        deleteBtn.classList.add('delete-active');
        canvas.style.cursor = 'crosshair';
        canvas.classList.add('delete-mode');
    } else {
        deleteBtn.textContent = 'Delete Paths';
        deleteBtn.classList.remove('delete-active');
        canvas.style.cursor = 'default';
        canvas.classList.remove('delete-mode');
    }
}

function handleCanvasClick(event) {
    if (!deleteMode) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Find path to delete (check from top to bottom)
    for (let i = paths.length - 1; i >= 0; i--) {
        if (isPointNearPath(x, y, paths[i])) {
            highlightPath(paths[i]);
            setTimeout(() => {
                if (confirm('Delete this path?')) {
                    deletePath(i);
                } else {
                    redrawCanvas();
                }
            }, 100);
            break;
        }
    }
}

function isPointNearPath(x, y, path, threshold = 15) {
    for (let i = 0; i < path.points.length - 1; i++) {
        const p1 = path.points[i];
        const p2 = path.points[i + 1];
        
        const distance = distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y);
        if (distance <= threshold) {
            return true;
        }
    }
    return false;
}

function distanceToLineSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
    const projection = {
        x: x1 + t * dx,
        y: y1 + t * dy
    };
    
    return Math.sqrt((px - projection.x) ** 2 + (py - projection.y) ** 2);
}

function highlightPath(path) {
    redrawCanvas();
    
    // Draw highlighted version
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = path.width + 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (path.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        
        for (let i = 1; i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.stroke();
    }
}

function deletePath(pathIndex) {
    if (pathIndex >= 0 && pathIndex < paths.length) {
        paths.splice(pathIndex, 1);
        redrawCanvas();
        updatePathCount();
    }
}

function clearAllPaths() {
    if (paths.length === 0) {
        alert('No paths to clear!');
        return;
    }
    
    if (confirm(`Are you sure you want to delete all ${paths.length} paths?`)) {
        paths = [];
        redrawCanvas();
        updatePathCount();
    }
}

// Canvas management
function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Redraw all paths
    paths.forEach(path => {
        drawPath(path);
    });
}

function drawPath(path) {
    if (path.points.length < 2) return;
    
    ctx.strokeStyle = path.color;
    ctx.lineWidth = path.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    
    for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.stroke();
}

function resizeCanvas() {
    const container = document.querySelector('.canvas-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    redrawCanvas();
}

// Utility functions
function getCurrentColor() {
    return document.getElementById('colorPicker')?.value || '#000000';
}

function getCurrentLineWidth() {
    return parseInt(document.getElementById('lineWidth')?.value) || 2;
}

function generatePathId() {
    return 'path_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function updatePathCount() {
    const countElement = document.getElementById('pathCount');
    if (countElement) {
        countElement.textContent = `Paths: ${paths.length}`;
    }
}

// Export functions for potential external use
function exportPaths() {
    return JSON.stringify(paths);
}

function importPaths(pathsJson) {
    try {
        const importedPaths = JSON.parse(pathsJson);
        paths = importedPaths;
        redrawCanvas();
        updatePathCount();
    } catch (error) {
        alert('Error importing paths: ' + error.message);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
