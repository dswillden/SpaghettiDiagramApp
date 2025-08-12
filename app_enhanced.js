// Enhanced Spaghetti Diagram Application - Phase 1 Implementation
// This module extends the base app with improved path drawing and analytics

(function() {
    'use strict';
    
    // Wait for the base app to be loaded
    function waitForBaseApp() {
        if (typeof SpaghettiDiagramApp === 'undefined') {
            setTimeout(waitForBaseApp, 100);
            return;
        }
        initializeEnhancements();
    }
    
    function initializeEnhancements() {
        // Store original methods we'll override
        const originalProto = SpaghettiDiagramApp.prototype;
        const originalHandlePathMouseDown = originalProto.handlePathMouseDown;
        const originalHandlePathMouseMove = originalProto.handlePathMouseMove;
        const originalHandleMouseUp = originalProto.handleMouseUp;
        const originalUpdateAnalytics = originalProto.updateAnalytics;
        const originalRender = originalProto.render;
        
        // Augment prototype only; do not replace the constructor (class constructors can't be called without new)
        // We'll initialize instance properties after the base instance is created.
        
        // Add enhancement methods
        SpaghettiDiagramApp.prototype.initEnhancements = function() {
            this.addSnapToggle();
            this.setupEnhancedAnalytics();
            this.setupImportExport();
        };
        
        SpaghettiDiagramApp.prototype.addSnapToggle = function() {
            const scaleSection = document.getElementById('scaleSection');
            if (scaleSection && !document.getElementById('snapToObject')) {
                const toggleDiv = document.createElement('div');
                toggleDiv.className = 'form-group';
                toggleDiv.innerHTML = `
                    <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="snapToObject" checked style="margin: 0;">
                        <span>Snap paths to objects</span>
                    </label>
                `;
                scaleSection.appendChild(toggleDiv);
                
                document.getElementById('snapToObject').addEventListener('change', (e) => {
                    this.snapToObject = e.target.checked;
                });
            }
        };
        
        SpaghettiDiagramApp.prototype.setupEnhancedAnalytics = function() {
            const analyticsPanel = document.getElementById('analyticsPanel');
            if (analyticsPanel && !document.getElementById('pathEfficiency')) {
                const efficiencyDiv = document.createElement('div');
                efficiencyDiv.className = 'metric';
                efficiencyDiv.innerHTML = `
                    <div class="metric-label">Path Efficiency</div>
                    <div class="metric-value" id="pathEfficiency">--%</div>
                `;
                analyticsPanel.appendChild(efficiencyDiv);
                
                const complexityDiv = document.createElement('div');
                complexityDiv.className = 'metric';
                complexityDiv.innerHTML = `
                    <div class="metric-label">Spaghetti Index</div>
                    <div class="metric-value" id="spaghettiIndex">0</div>
                `;
                analyticsPanel.appendChild(complexityDiv);
            }
        };
        
        SpaghettiDiagramApp.prototype.setupImportExport = function() {
            const exportBtn = document.getElementById('exportData');
            if (exportBtn && !document.getElementById('importData')) {
                const importInput = document.createElement('input');
                importInput.type = 'file';
                importInput.id = 'importData';
                importInput.accept = '.json';
                importInput.className = 'sr-only';
                
                const importLabel = document.createElement('label');
                importLabel.htmlFor = 'importData';
                importLabel.className = 'btn btn--outline';
                importLabel.textContent = 'Import Data';
                importLabel.style.marginRight = '8px';
                
                exportBtn.parentNode.insertBefore(importInput, exportBtn);
                exportBtn.parentNode.insertBefore(importLabel, exportBtn);
                
                importInput.addEventListener('change', this.handleImport.bind(this));
            }
        };
        
        // Override path drawing for snap-to-object
        SpaghettiDiagramApp.prototype.handlePathMouseDown = function() {
            this.isDrawing = true;
            
            let startPoint = { ...this.mousePos };
            
            // Snap to nearest object center if enabled
            if (this.snapToObject) {
                const snapped = this.getSnapPoint(this.mousePos);
                if (snapped) {
                    startPoint = snapped.center;
                    this.showSnapIndicator(snapped.object);
                }
            }
            
            this.currentPath = [startPoint];
        };
        
        // Add snap point detection
        SpaghettiDiagramApp.prototype.getSnapPoint = function(pos, excludeObject = null) {
            if (!this.snapToObject) return null;
            
            let closestObject = null;
            let closestDistance = this.snapThreshold;
            
            for (const obj of this.objects) {
                if (obj === excludeObject) continue;
                
                const center = {
                    x: obj.x + obj.width / 2,
                    y: obj.y + obj.height / 2
                };
                
                const distance = Math.sqrt(
                    Math.pow(pos.x - center.x, 2) + 
                    Math.pow(pos.y - center.y, 2)
                );
                
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestObject = obj;
                }
            }
            
            if (closestObject) {
                return {
                    object: closestObject,
                    center: {
                        x: closestObject.x + closestObject.width / 2,
                        y: closestObject.y + closestObject.height / 2
                    }
                };
            }
            
            return null;
        };
        
        SpaghettiDiagramApp.prototype.showSnapIndicator = function(obj) {
            this.snapIndicatorObject = obj;
            setTimeout(() => {
                this.snapIndicatorObject = null;
                this.render();
            }, 500);
        };
        
        // Override analytics
        SpaghettiDiagramApp.prototype.updateAnalytics = function() {
            originalUpdateAnalytics.call(this);
            this.calculatePathEfficiency();
            this.calculateSpaghettiIndex();
        };
        
        SpaghettiDiagramApp.prototype.calculatePathEfficiency = function() {
            const elem = document.getElementById('pathEfficiency');
            if (!elem) return;
            
            if (this.paths.length === 0) {
                elem.textContent = '--%';
                return;
            }
            
            let totalActual = 0;
            let totalOptimal = 0;
            
            for (const path of this.paths) {
                totalActual += path.length;
                
                if (path.points.length >= 2) {
                    const start = path.points[0];
                    const end = path.points[path.points.length - 1];
                    const optimal = Math.sqrt(
                        Math.pow(end.x - start.x, 2) + 
                        Math.pow(end.y - start.y, 2)
                    );
                    totalOptimal += optimal;
                }
            }
            
            const efficiency = totalOptimal > 0 ? (totalOptimal / totalActual * 100) : 0;
            elem.textContent = `${efficiency.toFixed(1)}%`;
            
            // Color code
            if (efficiency > 80) {
                elem.style.color = 'var(--color-success, #2e7d32)';
            } else if (efficiency > 60) {
                elem.style.color = 'var(--color-warning, #ed6c02)';
            } else {
                elem.style.color = 'var(--color-error, #d32f2f)';
            }
        };
        
        SpaghettiDiagramApp.prototype.calculateSpaghettiIndex = function() {
            const elem = document.getElementById('spaghettiIndex');
            if (!elem) return;
            
            let crossings = 0;
            let totalTurns = 0;
            
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
                
                // Count crossings
                for (let k = i + 1; k < this.paths.length; k++) {
                    const path2 = this.paths[k];
                    crossings += this.countPathCrossings(path1, path2);
                }
            }
            
            const pathCount = this.paths.length || 1;
            const index = Math.min(100, Math.round(
                (totalTurns / pathCount * 5) + (crossings / pathCount * 10)
            ));
            
            elem.textContent = index;
            
            // Color code
            if (index < 20) {
                elem.style.color = 'var(--color-success, #2e7d32)';
            } else if (index < 50) {
                elem.style.color = 'var(--color-warning, #ed6c02)';
            } else {
                elem.style.color = 'var(--color-error, #d32f2f)';
            }
        };
        
        SpaghettiDiagramApp.prototype.calculateAngle = function(p1, p2, p3) {
            const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
            const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
            
            const angle1 = Math.atan2(v1.y, v1.x);
            const angle2 = Math.atan2(v2.y, v2.x);
            
            let angle = (angle2 - angle1) * 180 / Math.PI;
            
            while (angle > 180) angle -= 360;
            while (angle < -180) angle += 360;
            
            return angle;
        };
        
        SpaghettiDiagramApp.prototype.countPathCrossings = function(path1, path2) {
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
        };
        
        // Import functionality
        SpaghettiDiagramApp.prototype.handleImport = async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                if (!data.version || !data.objects || !data.paths) {
                    throw new Error('Invalid file format');
                }
                
                if (confirm('This will replace all current data. Continue?')) {
                    this.objects = data.objects || [];
                    this.paths = data.paths || [];
                    this.obstacles = data.obstacles || [];
                    
                    if (data.scale) {
                        this.units = data.scale.units || 'ft';
                        this.unitsPerPixel = data.scale.unitsPerPixel || 0;
                        this.stepsPerUnit = data.scale.stepsPerUnit || 0;
                        this.gridCellUnits = data.scale.gridCellUnits || 1;
                        this.updateScaleUI();
                    }
                    
                    if (data.backgroundTransform) {
                        this.backgroundTransform = data.backgroundTransform;
                    }
                    
                    this.updateAnalytics();
                    this.render();
                    this.showInfoMessage('Data imported successfully!', 'success');
                }
            } catch (err) {
                this.showInfoMessage(`Import failed: ${err.message}`, 'error');
            }
            
            e.target.value = '';
        };
        
        // Override render to add snap indicator
        SpaghettiDiagramApp.prototype.render = function() {
            originalRender.call(this);
            
            if (this.snapIndicatorObject) {
                this.ctx.save();
                this.ctx.translate(this.pan.x, this.pan.y);
                this.ctx.scale(this.zoom || 1, this.zoom || 1);
                
                const obj = this.snapIndicatorObject;
                const centerX = obj.x + obj.width / 2;
                const centerY = obj.y + obj.height / 2;
                
                // Draw snap indicator
                this.ctx.strokeStyle = '#4CAF50';
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.arc(centerX, centerY, 15, 0, Math.PI * 2);
                this.ctx.stroke();
                
                // Crosshair
                this.ctx.beginPath();
                this.ctx.moveTo(centerX - 10, centerY);
                this.ctx.lineTo(centerX + 10, centerY);
                this.ctx.moveTo(centerX, centerY - 10);
                this.ctx.lineTo(centerX, centerY + 10);
                this.ctx.stroke();
                
                this.ctx.restore();
            }
        };
        
        console.log('✅ Spaghetti Diagram App enhancements loaded (Phase 1)');
    }
    
    // Start waiting for base app, then initialize enhancements on the created instance
    function initOnAppInstance() {
        const inst = window.app;
        if (!inst) { setTimeout(initOnAppInstance, 50); return; }
        // Set default enhancement properties once
        if (inst.__enhancementsInitialized) return;
        inst.snapToObject = true;
        inst.snapThreshold = 20;
        inst.showPathPreview = true;
        inst.pathSmoothing = false;
        inst.pathEfficiency = {};
        inst.heatMapData = [];
        inst.showHeatMap = false;
        if (typeof inst.initEnhancements === 'function') inst.initEnhancements();
        inst.__enhancementsInitialized = true;
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            waitForBaseApp();
            initOnAppInstance();
        });
    } else {
        waitForBaseApp();
        initOnAppInstance();
    }
})();
