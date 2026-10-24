/**
 * CLEANROOM IMPLEMENTATION DECLARATION
 * Component: RPA Video Editor - Master Studio Controller (Studio Pro Cleanroom Edition)
 * Specification: SPEC-EDT-004 (Master Orchestrator, Multi-Layer, Tools, GPU Accel)
 * Authors: Cleanroom Development Team
 * License: Private Cleanroom Software Suite
 */

class RpaStudioApp {
    constructor() {
        this.timeline = new window.RpaTimeline();
        this.canvas = document.getElementById('previewCanvas');
        this.compositor = new window.RpaCompositor(this.canvas);
        this.recorder = new window.RpaScreenRecorder();
        this.sfxGenerator = new window.RpaSfxGenerator();

        this.isPlaying = false;
        this.lastFrameTimestamp = 0;
        this.playheadTime = 0.0;
        this.isDraggingPlayhead = false;
        this.isVoiceNarrating = false;
        this.voiceRecorder = null;
        this.voiceChunks = [];
        this.timelineHeightMode = 'normal'; // 'normal' | 'compact' | 'tall'

        // Audio Analyser for VU Meter
        this.vuAudioContext = null;
        this.vuAnalyser = null;
        this.vuDataArray = null;

        // Clipboard, Media Bin & Project Dirty State
        this.clipboardClip = null;
        this.mediaBin = [];
        this.isDirty = false;

        this.initUI();
        this.setupPlayheadDragging();
        this.setupKeyboardShortcuts();
        this.setupCanvasInteraction();
        this.setupDemoContent();
        this.startRenderLoop();
    }

    initUI() {
        // 1. Play / Pause / Steps
        document.getElementById('btnPlayPause').onclick = () => this.togglePlayback();
        document.getElementById('btnStepBack').onclick = () => this.seek(Math.max(0, this.playheadTime - 1.0));
        document.getElementById('btnStepForward').onclick = () => this.seek(this.playheadTime + 1.0);

        // 2. Timeline Undo & Redo Action Buttons
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        if (btnUndo) btnUndo.onclick = () => { this.timeline.undo(); this.updateUndoRedoUI(); };
        if (btnRedo) btnRedo.onclick = () => { this.timeline.redo(); this.updateUndoRedoUI(); };

        // 3. Timeline Action Buttons
        document.getElementById('btnAddTrack').onclick = () => {
            const track = this.timeline.addTrack();
            this.renderTimeline();
            this.updateTimelineRuler();
        };
        document.getElementById('btnSplitClip').onclick = () => this.splitSelectedClip();
        const btnCopy = document.getElementById('btnCopyClip');
        if (btnCopy) btnCopy.onclick = () => this.copySelectedClip();
        const btnPaste = document.getElementById('btnPasteClip');
        if (btnPaste) btnPaste.onclick = () => this.pasteClip();
        document.getElementById('btnCutSelection').onclick = () => this.cutRangeSelection();
        document.getElementById('btnDeleteClip').onclick = () => this.deleteSelectedClip();
        document.getElementById('btnAddMarker').onclick = () => this.addMarkerAtPlayhead();

        // Native Desktop Close & Unsaved State Interception
        if (window.rpaNative && window.rpaNative.onPromptSaveBeforeClose) {
            window.rpaNative.onPromptSaveBeforeClose(async () => {
                try {
                    await this.saveProject(true);
                } catch (err) {
                    console.error('[Prompt Save Error]', err);
                } finally {
                    if (window.rpaNative.confirmSaveComplete) {
                        window.rpaNative.confirmSaveComplete(true);
                    }
                }
            });
        }
        window.addEventListener('beforeunload', (e) => {
            if (!window.rpaNative && this.isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        // Separate Video and Audio buttons
        const separateHandler = () => {
            if (!this.timeline.selectedClipId) {
                alert('Please select a video clip on the timeline first.');
                return;
            }
            const result = this.timeline.separateAudioAndVideo(this.timeline.selectedClipId);
            if (result) {
                this.renderTimeline();
                this.updateTimelineRuler();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            } else {
                alert('Selected clip is not a video or has no audio component.');
            }
        };
        document.getElementById('btnSeparateAudioVideo').onclick = separateHandler;
        document.getElementById('btnSeparateAudioTimeline').onclick = separateHandler;

        // Timeline Height Toggle (Normal, Compact, Tall)
        document.getElementById('btnToggleTimelineHeight').onclick = () => {
            const sec = document.getElementById('timelineSection');
            if (sec) sec.style.height = ''; // Clear custom drag height so class takes effect
            if (this.timelineHeightMode === 'normal') {
                this.timelineHeightMode = 'tall';
                if (sec) sec.className = 'timeline-section tall';
            } else if (this.timelineHeightMode === 'tall') {
                this.timelineHeightMode = 'compact';
                if (sec) sec.className = 'timeline-section compact';
            } else {
                this.timelineHeightMode = 'normal';
                if (sec) sec.className = 'timeline-section';
            }
            this.resizeCanvas();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        // Pull-to-Extend Timeline Resizer Bar
        this.initTimelineResizer();

        // Zoom Slider
        document.getElementById('rngTimelineZoom').oninput = (e) => {
            this.timeline.pixelsPerSecond = parseInt(e.target.value, 10);
            this.updateTimelineRuler();
            this.renderTimeline();
            this.updatePlayheadPosition();
            this.updateSelectionRangeUI();
        };

        // Fullscreen Toggle
        document.getElementById('btnFullscreen').onclick = () => {
            const container = document.getElementById('canvasContainer');
            if (!document.fullscreenElement) {
                container.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        };

        // 3. Collapsible Panels Logic (Minimal UI)
        const sidebar = document.getElementById('sidebarPanel');
        const inspector = document.getElementById('inspectorPanel');
        const btnCollapseSidebar = document.getElementById('btnCollapseSidebar');
        const btnExpandSidebar = document.getElementById('btnExpandSidebar');
        const btnCollapseInspector = document.getElementById('btnCollapseInspector');
        const btnExpandInspector = document.getElementById('btnExpandInspector');

        btnCollapseSidebar.onclick = () => {
            sidebar.classList.add('collapsed');
            btnExpandSidebar.classList.remove('hidden');
        };
        btnExpandSidebar.onclick = () => {
            sidebar.classList.remove('collapsed');
            btnExpandSidebar.classList.add('hidden');
        };

        btnCollapseInspector.onclick = () => {
            inspector.classList.add('collapsed');
            btnExpandInspector.classList.remove('hidden');
        };
        btnExpandInspector.onclick = () => {
            inspector.classList.remove('collapsed');
            btnExpandInspector.classList.add('hidden');
        };

        // 4. Sidebar Tabs (All 11 Tabs including Studio SFX Pack)
        const tabKeys = ['media', 'annotations', 'transitions', 'behaviors', 'animations', 'cursor', 'visual', 'audio', 'sfx', 'captions', 'narration'];
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const selectedKey = tab.dataset.tab;
                tabKeys.forEach(key => {
                    const el = document.getElementById(`tab${key.charAt(0).toUpperCase() + key.slice(1)}`);
                    if (el) el.style.display = key === selectedKey ? 'block' : 'none';
                });
            };
        });

        // Studio SFX Pack Instant Synthesizer Previews
        document.querySelectorAll('.sfx-play-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const sfxId = btn.dataset.sfxId;
                if (this.sfxGenerator && sfxId) {
                    this.sfxGenerator.preview(sfxId);
                    btn.classList.add('playing');
                    setTimeout(() => btn.classList.remove('playing'), 500);
                }
            };
        });

        // 5. Canvas Interaction Tools (Pointer, Pan, Crop, Zoom)
        const setCanvasTool = (tool) => {
            this.compositor.activeCanvasTool = tool;
            document.getElementById('toolPointer').classList.toggle('active', tool === 'pointer');
            document.getElementById('toolHand').classList.toggle('active', tool === 'hand');
            document.getElementById('toolCrop').classList.toggle('active', tool === 'crop');
            if (this.canvas) {
                if (tool === 'hand') this.canvas.style.cursor = 'grab';
                else if (tool === 'crop') this.canvas.style.cursor = 'crosshair';
                else this.canvas.style.cursor = 'default';
            }
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('toolPointer').onclick = () => setCanvasTool('pointer');
        document.getElementById('toolHand').onclick = () => setCanvasTool('hand');
        document.getElementById('toolCrop').onclick = () => setCanvasTool('crop');

        document.getElementById('selCanvasZoom').onchange = (e) => {
            const val = e.target.value;
            const container = document.getElementById('canvasContainer');
            if (val === 'fit') {
                container.style.maxWidth = '960px';
                this.compositor.canvasZoom = 1.0;
            } else {
                container.style.maxWidth = `${Math.round(960 * parseFloat(val))}px`;
                this.compositor.canvasZoom = parseFloat(val);
            }
        };

        // 6. Project Settings Modal (Solid & Transparent Backgrounds)
        document.getElementById('btnOpenProjectSettings').onclick = () => {
            const isTrans = this.compositor.projectSettings?.backgroundColor === 'transparent';
            const selBgMode = document.getElementById('selProjectBackgroundMode');
            const colBg = document.getElementById('colProjectBackground');
            if (selBgMode) selBgMode.value = isTrans ? 'transparent' : 'solid';
            if (colBg) colBg.style.opacity = isTrans ? '0.35' : '1.0';
            document.getElementById('projectSettingsModal').classList.remove('hidden');
        };
        const selBgMode = document.getElementById('selProjectBackgroundMode');
        if (selBgMode) {
            selBgMode.onchange = (e) => {
                const colBg = document.getElementById('colProjectBackground');
                if (colBg) colBg.style.opacity = e.target.value === 'transparent' ? '0.35' : '1.0';
            };
        }
        document.getElementById('selProjectPreset').onchange = (e) => {
            const val = e.target.value;
            if (val === '3840x2160') {
                document.getElementById('numProjectWidth').value = 3840;
                document.getElementById('numProjectHeight').value = 2160;
            } else if (val === '1920x1080') {
                document.getElementById('numProjectWidth').value = 1920;
                document.getElementById('numProjectHeight').value = 1080;
            } else if (val === '1280x720') {
                document.getElementById('numProjectWidth').value = 1280;
                document.getElementById('numProjectHeight').value = 720;
            } else if (val === '1080x1920') {
                document.getElementById('numProjectWidth').value = 1080;
                document.getElementById('numProjectHeight').value = 1920;
            } else if (val === '1080x1080') {
                document.getElementById('numProjectWidth').value = 1080;
                document.getElementById('numProjectHeight').value = 1080;
            }
        };
        document.getElementById('btnApplyProjectSettings').onclick = () => {
            const w = parseInt(document.getElementById('numProjectWidth').value, 10);
            const h = parseInt(document.getElementById('numProjectHeight').value, 10);
            const fps = parseInt(document.getElementById('selProjectFps').value, 10);
            const bgMode = document.getElementById('selProjectBackgroundMode')?.value || 'solid';
            const bg = bgMode === 'transparent' ? 'transparent' : document.getElementById('colProjectBackground').value;
            this.compositor.setProjectSettings(w, h, fps, bg);
            document.getElementById('lblCanvasDimensions').innerText = `${w}x${h} (${fps}fps)`;
            document.getElementById('projectSettingsModal').classList.add('hidden');
            this.compositor.renderFrame(this.timeline, this.playheadTime);
            this.markDirty(true);
        };

        // Pre-recording Live Setup Preview Engine
        this.setupRecordingPreview();

        // Video Output Destination Folder Picker
        const btnBrowseOutput = document.getElementById('btnBrowseOutputFolder');
        const txtOutputFolder = document.getElementById('txtExportOutputFolder');
        if (btnBrowseOutput && txtOutputFolder) {
            btnBrowseOutput.onclick = async () => {
                if (window.rpaNative && window.rpaNative.selectDirectory) {
                    const dir = await window.rpaNative.selectDirectory({ title: 'Select Video Export Folder' });
                    if (dir) txtOutputFolder.value = dir;
                } else {
                    alert('Custom output folder selection is available in the desktop application.');
                }
            };
        }

        // Project Output Location Folder Pickers (Save Modal & Canvas Settings)
        this.projectOutputDir = localStorage.getItem('rpa_project_output_dir') || '';
        const txtProjFolder = document.getElementById('txtProjectOutputFolder');
        const txtCanvasProjFolder = document.getElementById('txtCanvasProjectOutputFolder');
        if (txtProjFolder && this.projectOutputDir) txtProjFolder.value = this.projectOutputDir;
        if (txtCanvasProjFolder && this.projectOutputDir) txtCanvasProjFolder.value = this.projectOutputDir;

        const updateSavedProjectDir = (dir) => {
            if (!dir) return;
            this.projectOutputDir = dir;
            localStorage.setItem('rpa_project_output_dir', dir);
            if (txtProjFolder) txtProjFolder.value = dir;
            if (txtCanvasProjFolder) txtCanvasProjFolder.value = dir;
            const lblStatus = document.getElementById('lblProjectFolderStatus');
            if (lblStatus) lblStatus.innerText = 'Custom Folder Active';
            const lblCanvasStatus = document.getElementById('lblCanvasProjectFolderStatus');
            if (lblCanvasStatus) lblCanvasStatus.innerText = 'Custom Folder Active';
        };

        const btnBrowseProj = document.getElementById('btnBrowseProjectFolder');
        if (btnBrowseProj) {
            btnBrowseProj.onclick = async () => {
                if (window.rpaNative && window.rpaNative.selectDirectory) {
                    const dir = await window.rpaNative.selectDirectory({ title: 'Select Project Output Folder', defaultPath: this.projectOutputDir });
                    if (dir) updateSavedProjectDir(dir);
                } else {
                    const customPath = prompt('Enter project destination folder:', this.projectOutputDir || '');
                    if (customPath) updateSavedProjectDir(customPath.trim());
                }
            };
        }

        const btnBrowseCanvasProj = document.getElementById('btnBrowseCanvasProjectFolder');
        if (btnBrowseCanvasProj) {
            btnBrowseCanvasProj.onclick = async () => {
                if (window.rpaNative && window.rpaNative.selectDirectory) {
                    const dir = await window.rpaNative.selectDirectory({ title: 'Select Default Project Save Folder', defaultPath: this.projectOutputDir });
                    if (dir) updateSavedProjectDir(dir);
                } else {
                    const customPath = prompt('Enter project destination folder:', this.projectOutputDir || '');
                    if (customPath) updateSavedProjectDir(customPath.trim());
                }
            };
        }

        const btnConfirmSave = document.getElementById('btnConfirmSaveProject');
        if (btnConfirmSave) {
            btnConfirmSave.onclick = async () => {
                const title = (document.getElementById('txtSaveProjectTitle')?.value || 'RPA_Workflow_Video').trim();
                const targetDir = document.getElementById('txtProjectOutputFolder')?.value?.trim() || this.projectOutputDir || null;
                const format = document.getElementById('selSaveProjectFormat')?.value || 'rpavideo';
                document.getElementById('saveProjectModal').classList.add('hidden');
                await this.executeSaveProject(title, targetDir, format, false);
            };
        }

        const btnSaveAsNative = document.getElementById('btnSaveProjectAsNative');
        if (btnSaveAsNative) {
            btnSaveAsNative.onclick = async () => {
                const cleanTitle = (document.getElementById('txtSaveProjectTitle')?.value || 'RPA_Workflow_Video').trim();
                if (window.rpaNative && window.rpaNative.showSaveProjectDialog) {
                    const filePath = await window.rpaNative.showSaveProjectDialog({
                        defaultName: cleanTitle,
                        defaultPath: this.projectOutputDir ? `${this.projectOutputDir}\\${cleanTitle}.rpavideo` : undefined
                    });
                    if (filePath) {
                        document.getElementById('saveProjectModal').classList.add('hidden');
                        await this.writeProjectToPath(filePath, cleanTitle);
                    }
                } else {
                    const targetDir = document.getElementById('txtProjectOutputFolder')?.value?.trim() || this.projectOutputDir || null;
                    const format = document.getElementById('selSaveProjectFormat')?.value || 'rpavideo';
                    document.getElementById('saveProjectModal').classList.add('hidden');
                    await this.executeSaveProject(cleanTitle, targetDir, format, false);
                }
            };
        }

        // 7. GPU & Hardware Acceleration Modal
        document.getElementById('btnOpenGpuSettings').onclick = () => {
            const gpu = this.compositor.gpuInfo;
            document.getElementById('lblGpuRenderer').innerText = gpu.renderer || 'Hardware Accelerated GPU';
            document.getElementById('lblGpuVendor').innerText = `${gpu.vendor || 'Graphic Driver'} - ${gpu.accelerated ? 'DirectX / Vulkan GPU Active' : 'Software Fallback'}`;
            document.getElementById('gpuSettingsModal').classList.remove('hidden');
        };

        // 8. Version History Modal
        const openHistory = () => document.getElementById('historyModal').classList.remove('hidden');
        const btnOpenHist = document.getElementById('btnOpenHistoryModal');
        if (btnOpenHist) btnOpenHist.onclick = openHistory;
        const btnVerPill = document.getElementById('btnVersionPill');
        if (btnVerPill) btnVerPill.onclick = openHistory;

        // 9. Multi-Resolution Export Modal
        document.getElementById('btnOpenExportModal').onclick = () => {
            document.getElementById('exportModal').classList.remove('hidden');
        };
        document.getElementById('btnExecuteExport').onclick = () => this.executeCustomExport();
        // Properties Sub-Menu Dropdown & Accordion
        const selPropsSubMenu = document.getElementById('selPropertiesSubMenu');
        if (selPropsSubMenu) {
            selPropsSubMenu.onchange = () => {
                const cur = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                if (cur) this.renderProperties(cur);
            };
        }

        document.querySelectorAll('.inspector-section-title').forEach(titleEl => {
            if (!titleEl.dataset.accordionInit) {
                titleEl.dataset.accordionInit = 'true';
                if (!titleEl.querySelector('.accordion-chevron')) {
                    const chv = document.createElement('span');
                    chv.className = 'accordion-chevron';
                    chv.innerText = '▼';
                    chv.style.fontSize = '9px';
                    chv.style.opacity = '0.7';
                    titleEl.appendChild(chv);
                }
                titleEl.onclick = () => {
                    const sec = titleEl.closest('.inspector-section');
                    if (sec) {
                        const isCollapsed = sec.classList.toggle('collapsed');
                        const chv = titleEl.querySelector('.accordion-chevron');
                        if (chv) chv.innerText = isCollapsed ? '▶' : '▼';
                    }
                };
            }
        });


        // Custom Export Resolution UI Wiring
        const selExportRes = document.getElementById('selExportResolution');
        const grpExportCustom = document.getElementById('grpExportCustomResolution');
        const txtExportWidth = document.getElementById('txtExportCustomWidth');
        const txtExportHeight = document.getElementById('txtExportCustomHeight');
        const chkExportAspectLock = document.getElementById('chkExportAspectLock');

        if (selExportRes) {
            selExportRes.onchange = () => {
                if (grpExportCustom) {
                    grpExportCustom.style.display = (selExportRes.value === 'custom') ? 'block' : 'none';
                }
            };
        }

        let lockedAspect = 1920 / 1080;
        if (txtExportWidth && txtExportHeight) {
            txtExportWidth.oninput = () => {
                if (chkExportAspectLock && chkExportAspectLock.checked) {
                    const w = parseInt(txtExportWidth.value, 10) || 1920;
                    const h = Math.round(w / lockedAspect / 2) * 2;
                    txtExportHeight.value = Math.max(128, h);
                }
            };
            txtExportHeight.oninput = () => {
                if (chkExportAspectLock && chkExportAspectLock.checked) {
                    const h = parseInt(txtExportHeight.value, 10) || 1080;
                    const w = Math.round(h * lockedAspect / 2) * 2;
                    txtExportWidth.value = Math.max(128, w);
                }
            };
        }

        document.querySelectorAll('.btn-ratio-preset').forEach(btn => {
            btn.onclick = () => {
                const ratioStr = btn.dataset.ratio;
                if (!ratioStr || !txtExportWidth || !txtExportHeight) return;
                const [rw, rh] = ratioStr.split(':').map(Number);
                lockedAspect = rw / rh;
                const curW = parseInt(txtExportWidth.value, 10) || 1920;
                const newH = Math.round(curW / lockedAspect / 2) * 2;
                txtExportHeight.value = Math.max(128, newH);
            };
        });

        // About Modal Button
        const btnOpenAbout = document.getElementById('btnOpenAboutModal');
        if (btnOpenAbout) {
            btnOpenAbout.onclick = () => {
                document.getElementById('aboutModal')?.classList.remove('hidden');
            };
        }

        // Webcam Settings Sliders
        const rngWebcamSize = document.getElementById('rngWebcamSize');
        const lblWebcamSize = document.getElementById('lblWebcamSize');
        if (rngWebcamSize && lblWebcamSize) {
            rngWebcamSize.oninput = (e) => { lblWebcamSize.innerText = `${e.target.value}%`; };
        }

        const rngWebcamBorder = document.getElementById('rngWebcamBorder');
        const lblWebcamBorder = document.getElementById('lblWebcamBorder');
        if (rngWebcamBorder && lblWebcamBorder) {
            rngWebcamBorder.oninput = (e) => { lblWebcamBorder.innerText = `${e.target.value}px`; };
        }


        // 10. Cursor FX Controls & Visual Cards
        const cursorCards = document.querySelectorAll('.cursor-fx-card');
        cursorCards.forEach(card => {
            card.onclick = () => {
                const fx = card.dataset.fx;
                if (!fx) return;
                const isCurrentlyActive = card.classList.contains('active');
                const newState = !isCurrentlyActive;
                card.classList.toggle('active', newState);

                const badge = card.querySelector('.studio-card-apply-badge');
                if (badge) badge.innerText = newState ? 'Enabled' : 'Off';

                if (fx === 'halo') {
                    this.compositor.cursorOptions.halo = newState;
                    const chk = document.getElementById('chkCursorHalo');
                    if (chk) chk.checked = newState;
                } else if (fx === 'spotlight') {
                    this.compositor.cursorOptions.spotlight = newState;
                    const chk = document.getElementById('chkCursorSpotlight');
                    if (chk) chk.checked = newState;
                } else if (fx === 'ripple') {
                    this.compositor.cursorOptions.ripple = newState;
                    const chk = document.getElementById('chkClickRipple');
                    if (chk) chk.checked = newState;
                } else if (fx === 'clickSound') {
                    this.compositor.cursorOptions.clickSound = newState;
                    const chk = document.getElementById('chkClickSound');
                    if (chk) chk.checked = newState;
                } else if (fx === 'magnifier') {
                    this.compositor.cursorOptions.magnifier = newState;
                    const chk = document.getElementById('chkCursorMagnifier');
                    if (chk) chk.checked = newState;
                } else if (fx === 'crosshair') {
                    this.compositor.cursorOptions.crosshair = newState;
                    const chk = document.getElementById('chkCursorCrosshair');
                    if (chk) chk.checked = newState;
                }

                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        });

        const chkHalo = document.getElementById('chkCursorHalo');
        if (chkHalo) chkHalo.onchange = (e) => {
            this.compositor.cursorOptions.halo = e.target.checked;
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        const chkSpot = document.getElementById('chkCursorSpotlight');
        if (chkSpot) chkSpot.onchange = (e) => {
            this.compositor.cursorOptions.spotlight = e.target.checked;
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        const chkRip = document.getElementById('chkClickRipple');
        if (chkRip) chkRip.onchange = (e) => {
            this.compositor.cursorOptions.ripple = e.target.checked;
        };
        const chkSnd = document.getElementById('chkClickSound');
        if (chkSnd) chkSnd.onchange = (e) => {
            this.compositor.cursorOptions.clickSound = e.target.checked;
        };

        const rngCursorScale = document.getElementById('rngCursorScale');
        const lblCursorScale = document.getElementById('lblCursorScale');
        if (rngCursorScale) {
            rngCursorScale.oninput = (e) => {
                const val = parseFloat(e.target.value);
                this.compositor.cursorOptions.scale = val;
                if (lblCursorScale) lblCursorScale.innerText = `${val.toFixed(1)}x`;
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const chkCursorSmooth = document.getElementById('chkCursorSmooth');
        if (chkCursorSmooth) {
            chkCursorSmooth.onchange = (e) => {
                this.compositor.cursorOptions.smoothTelemetry = e.target.checked;
            };
        }

        // 11. Visual FX Controls (Chroma Key, Device Frame, Filters)
        document.getElementById('chkChromaKey').onchange = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.chromaKey = e.target.checked;
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('colChromaColor').oninput = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.chromaColor = e.target.value;
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('rngChromaTolerance').oninput = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.chromaTolerance = parseInt(e.target.value, 10) / 100.0;
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('selDeviceFrame').onchange = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.deviceFrame = e.target.value;
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('propBorderRadius').oninput = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.borderRadius = parseInt(e.target.value, 10);
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('chkDropShadow').onchange = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.dropShadow = e.target.checked;
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('propBrightness').oninput = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.brightness = parseInt(e.target.value, 10);
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('propContrast').oninput = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.contrast = parseInt(e.target.value, 10);
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('propSaturation').oninput = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            target.saturation = parseInt(e.target.value, 10);
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };
        document.getElementById('selClipSpeed').onchange = (e) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            if (clip) {
                const speed = parseFloat(e.target.value);
                clip.duration = Math.max(0.2, clip.duration / speed);
                this.timeline.updateTotalDuration();
                this.timeline.saveSnapshot();
                this.renderTimeline();
                this.updateTimelineRuler();
            }
        };

        // Massive Effects Sliders
        const bindFxInput = (id, prop, isCheck = false) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const target = clip ? clip.visualEffects : this.compositor.visualFx;
                if (!target) return;
                target[prop] = isCheck ? e.target.checked : parseInt(e.target.value, 10);
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
            if (isCheck) {
                el.onchange = (e) => {
                    const clip = this.timeline.getClip(this.timeline.selectedClipId);
                    const target = clip ? clip.visualEffects : this.compositor.visualFx;
                    if (!target) return;
                    target[prop] = e.target.checked;
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                };
            } else {
                el.onchange = () => this.timeline.saveSnapshot();
            }
        };

        bindFxInput('propVignette', 'vignette');
        bindFxInput('propFilmGrain', 'filmGrain');
        bindFxInput('propGlow', 'glow');
        bindFxInput('propPixelate', 'pixelate');
        bindFxInput('propSepia', 'sepia');
        bindFxInput('chkScanlines', 'scanlines', true);
        bindFxInput('chkInvert', 'invert', true);

        // Color Temperature and Tint Sliders
        const rngTemp = document.getElementById('rngColorTemp');
        const rngTint = document.getElementById('rngColorTint');
        const lblTemp = document.getElementById('lblColorTemp');
        const lblTint = document.getElementById('lblColorTint');

        if (rngTemp) {
            rngTemp.oninput = (e) => {
                const val = parseInt(e.target.value, 10);
                if (lblTemp) lblTemp.innerText = val > 0 ? `+${val}` : `${val}`;
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const target = clip ? clip.visualEffects : this.compositor.visualFx;
                if (!target.colorGrade) target.colorGrade = {};
                target.colorGrade.temperature = val;
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
            rngTemp.onchange = () => this.timeline.saveSnapshot();
        }

        if (rngTint) {
            rngTint.oninput = (e) => {
                const val = parseInt(e.target.value, 10);
                if (lblTint) lblTint.innerText = val > 0 ? `+${val}` : `${val}`;
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const target = clip ? clip.visualEffects : this.compositor.visualFx;
                if (!target.colorGrade) target.colorGrade = {};
                target.colorGrade.tint = val;
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
            rngTint.onchange = () => this.timeline.saveSnapshot();
        }

        // Color Wheel & Auto Adjust Init
        this.initColorWheel();
        const btnAutoAdj = document.getElementById('btnAutoAdjustColor');
        if (btnAutoAdj) {
            btnAutoAdj.onclick = () => this.autoAdjustColors();
        }

        // Keyframe Editor & Studio Animations Init
        this.initKeyframeEditor();
        this.initStudioAnimations();
        this.initSystemFontSync();
        this.initCalloutReset();

        // 12. Captions Controls
        document.getElementById('btnAddCaptionAtPlayhead').onclick = () => {
            const text = document.getElementById('txtCaptionInput').value.trim() || 'New Subtitle Line';
            const dur = parseFloat(document.getElementById('numCaptionDuration').value) || 3.0;
            const caption = this.timeline.addCaption(this.playheadTime, dur, text);
            document.getElementById('txtCaptionInput').value = '';
            this.renderCaptionList();
            this.renderTimeline();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        // 13. Voice Narration & VU Meter
        document.getElementById('btnStartVoiceover').onclick = () => this.toggleVoiceNarration();

        // 14. Setup Drag and Drop for ALL Studio Tools (no auto-apply on click!)
        this.setupDraggableStudioTools();

        // 15. Custom Zoom & Pan Sliders
        const rngZoom = document.getElementById('rngCustomZoomScale');
        const rngPanX = document.getElementById('rngCustomFocusX');
        const rngPanY = document.getElementById('rngCustomFocusY');
        if (rngZoom && rngPanX && rngPanY) {
            const onZoomChange = () => {
                this.applyZoom(
                    parseInt(rngZoom.value, 10) / 100.0,
                    parseInt(rngPanX.value, 10) / 100.0,
                    parseInt(rngPanY.value, 10) / 100.0
                );
            };
            rngZoom.oninput = onZoomChange;
            rngPanX.oninput = onZoomChange;
            rngPanY.oninput = onZoomChange;
        }

        // 16. Inspector Property Inputs & Video Aspect Ratio Dropdown
        const selAspect = document.getElementById('selAspectRatioPreset');
        if (selAspect) {
            selAspect.onchange = (e) => {
                this.setAspectRatioPreset(e.target.value);
            };
        }

        // Callout Subtype / Shape dropdown
        const propCalloutSubtype = document.getElementById('propCalloutSubtype');
        if (propCalloutSubtype) {
            propCalloutSubtype.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.subtype = e.target.value;
                    const subTitles = {
                        'title': 'Title Header',
                        'speech': 'Speech Bubble',
                        'thought': 'Thought Bubble',
                        'lower-third': 'Lower Third',
                        'arrow': 'Directional Arrow',
                        'double-arrow': 'Double Arrow',
                        'rectangle': 'Focus Rectangle',
                        'circle': 'Circle Ring',
                        'spotlight': 'Spotlight Cutout',
                        'highlight': 'Highlighter Marker',
                        'blur': 'Blur Sensitive',
                        'pixelate': 'Pixelate Censor',
                        'sketch-circle': 'Sketch Circle',
                        'sketch-arrow': 'Sketch Arrow',
                        'sketch-check': 'Sketch Check',
                        'keystroke': 'Keystroke'
                    };
                    clip.title = subTitles[e.target.value] || clip.title;
                    const groupSubText = document.getElementById('groupCalloutSubText');
                    if (groupSubText) groupSubText.style.display = e.target.value === 'lower-third' ? 'block' : 'none';
                    this.timeline.saveSnapshot();
                    this.renderTimeline();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        // Primary Callout Text
        const propText = document.getElementById('propText');
        if (propText) {
            propText.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.text = e.target.value;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propText.onchange = () => this.timeline.saveSnapshot();
        }

        // Subtitle Text (Lower Third)
        const propSubText = document.getElementById('propSubText');
        if (propSubText) {
            propSubText.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.subText = e.target.value;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propSubText.onchange = () => this.timeline.saveSnapshot();
        }

        // Word Selection Tracking for Selective Word/Character Styling
        const updateWordSelectionFrom = (inputEl) => {
            if (!inputEl) return;
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const badge = document.getElementById('selectionStatusBadge');
            const lblInfo = document.getElementById('lblSelectedWordInfo');
            const sStart = inputEl.selectionStart;
            const sEnd = inputEl.selectionEnd;

            if (clip && sStart !== undefined && sEnd !== undefined && sStart !== sEnd) {
                const selText = inputEl.value.substring(sStart, sEnd);
                this.activeWordSelection = {
                    clipId: clip.id,
                    start: sStart,
                    end: sEnd,
                    text: selText
                };
                if (badge) badge.classList.remove('hidden');
                if (lblInfo) lblInfo.innerText = `Selected: "${selText}" (Chars ${sStart}-${sEnd}) — Color & Font below apply to selection`;
            } else if (document.activeElement === inputEl && sStart === sEnd) {
                this.activeWordSelection = null;
                if (badge) badge.classList.add('hidden');
            }
        };

        if (propText) {
            propText.addEventListener('select', () => updateWordSelectionFrom(propText));
            propText.addEventListener('keyup', () => updateWordSelectionFrom(propText));
            propText.addEventListener('pointerup', () => updateWordSelectionFrom(propText));
        }

        const btnClearWordSelection = document.getElementById('btnClearWordSelection');
        if (btnClearWordSelection) {
            btnClearWordSelection.onclick = () => {
                this.activeWordSelection = null;
                const badge = document.getElementById('selectionStatusBadge');
                if (badge) badge.classList.add('hidden');
            };
        }

        // Callout Accent Color (Supports Selective Word Span)
        const propCalloutColor = document.getElementById('propCalloutColor');
        if (propCalloutColor) {
            propCalloutColor.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (this.activeWordSelection && this.activeWordSelection.clipId === clip.id) {
                        this.applySpanStyle(clip, this.activeWordSelection.start, this.activeWordSelection.end, { color: e.target.value });
                    } else {
                        clip.color = e.target.value;
                    }
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propCalloutColor.onchange = () => this.timeline.saveSnapshot();
        }

        // Font Size
        const propFontSize = document.getElementById('propFontSize');
        if (propFontSize) {
            propFontSize.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.fontSize = parseInt(e.target.value, 10);
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propFontSize.onchange = () => this.timeline.saveSnapshot();
        }

        // Studio Typography Tools (Supports Selective Word Span)
        const propFontFamily = document.getElementById('propFontFamily');
        if (propFontFamily) {
            propFontFamily.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (this.activeWordSelection && this.activeWordSelection.clipId === clip.id) {
                        this.applySpanStyle(clip, this.activeWordSelection.start, this.activeWordSelection.end, { fontFamily: e.target.value });
                    } else {
                        clip.fontFamily = e.target.value;
                    }
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const propFontWeight = document.getElementById('propFontWeight');
        if (propFontWeight) {
            propFontWeight.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (this.activeWordSelection && this.activeWordSelection.clipId === clip.id) {
                        this.applySpanStyle(clip, this.activeWordSelection.start, this.activeWordSelection.end, { fontWeight: e.target.value });
                    } else {
                        clip.fontWeight = e.target.value;
                    }
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        // Underline & Strike-through Toggle Buttons
        const btnTextUnderline = document.getElementById('btnTextUnderline');
        if (btnTextUnderline) {
            btnTextUnderline.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (this.activeWordSelection && this.activeWordSelection.clipId === clip.id) {
                        const cur = this.getSpanProperty(clip, this.activeWordSelection.start, this.activeWordSelection.end, 'underline');
                        this.applySpanStyle(clip, this.activeWordSelection.start, this.activeWordSelection.end, { underline: !cur });
                        btnTextUnderline.classList.toggle('active', !cur);
                    } else {
                        clip.underline = !clip.underline;
                        btnTextUnderline.classList.toggle('active', !!clip.underline);
                    }
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const btnTextStrikethrough = document.getElementById('btnTextStrikethrough');
        if (btnTextStrikethrough) {
            btnTextStrikethrough.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (this.activeWordSelection && this.activeWordSelection.clipId === clip.id) {
                        const cur = this.getSpanProperty(clip, this.activeWordSelection.start, this.activeWordSelection.end, 'strikeThrough');
                        this.applySpanStyle(clip, this.activeWordSelection.start, this.activeWordSelection.end, { strikeThrough: !cur });
                        btnTextStrikethrough.classList.toggle('active', !cur);
                    } else {
                        clip.strikeThrough = !clip.strikeThrough;
                        btnTextStrikethrough.classList.toggle('active', !!clip.strikeThrough);
                    }
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        
        // Text Alignment Handlers (Horizontal & Vertical Dropdowns)
        const selTextAlign = document.getElementById('selTextAlign');
        if (selTextAlign) {
            selTextAlign.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.textAlign = e.target.value;
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const selTextVAlign = document.getElementById('selTextVAlign');
        if (selTextVAlign) {
            selTextVAlign.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.verticalAlign = e.target.value;
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const propLetterCase = document.getElementById('propLetterCase');
        if (propLetterCase) {
            propLetterCase.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.letterCase = e.target.value;
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const propFillType = document.getElementById('propFillType');
        if (propFillType) {
            propFillType.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.fillType = e.target.value;
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const propTracking = document.getElementById('propTracking');
        const lblTracking = document.getElementById('lblTracking');
        if (propTracking) {
            propTracking.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblTracking) lblTracking.innerText = `${val}px`;
                if (clip) {
                    clip.tracking = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTracking.onchange = () => this.timeline.saveSnapshot();
        }

        const propLineSpacing = document.getElementById('propLineSpacing');
        const lblLineSpacing = document.getElementById('lblLineSpacing');
        if (propLineSpacing) {
            propLineSpacing.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10) / 10.0;
                if (lblLineSpacing) lblLineSpacing.innerText = `${val.toFixed(1)}x`;
                if (clip) {
                    clip.lineSpacing = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propLineSpacing.onchange = () => this.timeline.saveSnapshot();
        }

        const propOutlineColor = document.getElementById('propOutlineColor');
        if (propOutlineColor) {
            propOutlineColor.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.outlineColor = e.target.value;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propOutlineColor.onchange = () => this.timeline.saveSnapshot();
        }

        const propOutlineThickness = document.getElementById('propOutlineThickness');
        const lblOutlineThickness = document.getElementById('lblOutlineThickness');
        if (propOutlineThickness) {
            propOutlineThickness.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblOutlineThickness) lblOutlineThickness.innerText = `${val}px`;
                if (clip) {
                    clip.outlineThickness = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propOutlineThickness.onchange = () => this.timeline.saveSnapshot();
        }

        const propOutlineJoin = document.getElementById('propOutlineJoin');
        if (propOutlineJoin) {
            propOutlineJoin.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.outlineJoin = e.target.value;
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const propOutlineOpacity = document.getElementById('propOutlineOpacity');
        const lblOutlineOpacity = document.getElementById('lblOutlineOpacity');
        if (propOutlineOpacity) {
            propOutlineOpacity.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblOutlineOpacity) lblOutlineOpacity.innerText = `${val}%`;
                if (clip) {
                    clip.outlineOpacity = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propOutlineOpacity.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextGlowColor = document.getElementById('propTextGlowColor');
        if (propTextGlowColor) {
            propTextGlowColor.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.glowColor = e.target.value;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextGlowColor.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextGlowBlur = document.getElementById('propTextGlowBlur');
        const lblTextGlowBlur = document.getElementById('lblTextGlowBlur');
        if (propTextGlowBlur) {
            propTextGlowBlur.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblTextGlowBlur) lblTextGlowBlur.innerText = `${val}px`;
                if (clip) {
                    clip.glowBlur = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextGlowBlur.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextGlowIntensity = document.getElementById('propTextGlowIntensity');
        const lblTextGlowIntensity = document.getElementById('lblTextGlowIntensity');
        if (propTextGlowIntensity) {
            propTextGlowIntensity.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblTextGlowIntensity) lblTextGlowIntensity.innerText = `${val}x`;
                if (clip) {
                    clip.glowIntensity = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextGlowIntensity.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextGlowOpacity = document.getElementById('propTextGlowOpacity');
        const lblTextGlowOpacity = document.getElementById('lblTextGlowOpacity');
        if (propTextGlowOpacity) {
            propTextGlowOpacity.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblTextGlowOpacity) lblTextGlowOpacity.innerText = `${val}%`;
                if (clip) {
                    clip.glowOpacity = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextGlowOpacity.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextShadowColor = document.getElementById('propTextShadowColor');
        if (propTextShadowColor) {
            propTextShadowColor.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.shadowColor = e.target.value;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextShadowColor.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextShadowBlur = document.getElementById('propTextShadowBlur');
        const lblTextShadowBlur = document.getElementById('lblTextShadowBlur');
        if (propTextShadowBlur) {
            propTextShadowBlur.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblTextShadowBlur) lblTextShadowBlur.innerText = `${val}px`;
                if (clip) {
                    clip.shadowBlur = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextShadowBlur.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextShadowOffsetX = document.getElementById('propTextShadowOffsetX');
        const lblTextShadowOffsetX = document.getElementById('lblTextShadowOffsetX');
        if (propTextShadowOffsetX) {
            propTextShadowOffsetX.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblTextShadowOffsetX) lblTextShadowOffsetX.innerText = `${val}px`;
                if (clip) {
                    clip.shadowOffsetX = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextShadowOffsetX.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextShadowOffsetY = document.getElementById('propTextShadowOffsetY');
        const lblTextShadowOffsetY = document.getElementById('lblTextShadowOffsetY');
        if (propTextShadowOffsetY) {
            propTextShadowOffsetY.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblTextShadowOffsetY) lblTextShadowOffsetY.innerText = `${val}px`;
                if (clip) {
                    clip.shadowOffsetY = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextShadowOffsetY.onchange = () => this.timeline.saveSnapshot();
        }

        const propTextShadowOpacity = document.getElementById('propTextShadowOpacity');
        const lblTextShadowOpacity = document.getElementById('lblTextShadowOpacity');
        if (propTextShadowOpacity) {
            propTextShadowOpacity.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblTextShadowOpacity) lblTextShadowOpacity.innerText = `${val}%`;
                if (clip) {
                    clip.shadowOpacity = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propTextShadowOpacity.onchange = () => this.timeline.saveSnapshot();
        }

        // Studio 1-Click Style Presets
        document.querySelectorAll('.btn-style-preset').forEach(btn => {
            btn.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                const p = btn.dataset.preset;
                if (p === 'tiktok') {
                    clip.fontFamily = "'Montserrat', sans-serif";
                    clip.fontWeight = "900";
                    clip.letterCase = "uppercase";
                    clip.color = "#FFE600";
                    clip.fillType = "solid";
                    clip.outlineColor = "#000000";
                    clip.outlineThickness = 8;
                    clip.shadowColor = "rgba(0,0,0,0.9)";
                    clip.shadowBlur = 14;
                    clip.tracking = 2;
                } else if (p === 'cyberpunk') {
                    clip.fontFamily = "'Rubik Glitch', monospace";
                    clip.fontWeight = "bold";
                    clip.letterCase = "uppercase";
                    clip.fillType = "grad-cyberpunk";
                    clip.glowColor = "#00f2fe";
                    clip.glowBlur = 25;
                    clip.glowIntensity = 3;
                    clip.glowOpacity = 100;
                    clip.outlineColor = "#ff007f";
                    clip.outlineThickness = 3;
                    clip.tracking = 4;
                } else if (p === 'gold') {
                    clip.fontFamily = "'Cinzel', serif";
                    clip.fontWeight = "bold";
                    clip.letterCase = "uppercase";
                    clip.fillType = "grad-gold";
                    clip.shadowColor = "rgba(0,0,0,0.9)";
                    clip.shadowBlur = 16;
                    clip.outlineThickness = 0;
                    clip.tracking = 8;
                } else if (p === 'synthwave') {
                    clip.fontFamily = "'Oswald', sans-serif";
                    clip.fontWeight = "bold";
                    clip.letterCase = "uppercase";
                    clip.fillType = "grad-sunset";
                    clip.glowColor = "#f72585";
                    clip.glowBlur = 22;
                    clip.glowIntensity = 3;
                    clip.glowOpacity = 100;
                    clip.outlineColor = "#4361ee";
                    clip.outlineThickness = 4;
                    clip.tracking = 3;
                } else if (p === 'bloom') {
                    clip.fontFamily = "'Montserrat', sans-serif";
                    clip.fontWeight = "bold";
                    clip.letterCase = "uppercase";
                    clip.color = "#ffffff";
                    clip.fillType = "solid";
                    clip.glowColor = "#38bdf8";
                    clip.glowBlur = 32;
                    clip.glowIntensity = 4;
                    clip.glowOpacity = 100;
                    clip.outlineColor = "#0284c7";
                    clip.outlineThickness = 2;
                    clip.shadowColor = "rgba(0,0,0,0.8)";
                    clip.shadowBlur = 10;
                    clip.tracking = 3;
                } else if (p === 'neon') {
                    clip.fontFamily = "'Oswald', sans-serif";
                    clip.fontWeight = "bold";
                    clip.letterCase = "uppercase";
                    clip.color = "#ecfdf5";
                    clip.fillType = "solid";
                    clip.glowColor = "#10b981";
                    clip.glowBlur = 28;
                    clip.glowIntensity = 3;
                    clip.glowOpacity = 100;
                    clip.outlineColor = "#059669";
                    clip.outlineThickness = 3;
                    clip.shadowColor = "rgba(0,0,0,0.75)";
                    clip.shadowBlur = 12;
                    clip.tracking = 4;
                } else if (p === 'impact') {
                    clip.fontFamily = "'Bebas Neue', sans-serif";
                    clip.fontWeight = "bold";
                    clip.letterCase = "uppercase";
                    clip.color = "#ffffff";
                    clip.fillType = "solid";
                    clip.outlineColor = "#e11d48";
                    clip.outlineThickness = 8;
                    clip.shadowColor = "rgba(0,0,0,0.9)";
                    clip.shadowBlur = 12;
                    clip.tracking = 2;
                } else if (p === 'subtitle') {
                    clip.fontFamily = "'Inter', sans-serif";
                    clip.fontWeight = "600";
                    clip.letterCase = "default";
                    clip.color = "#ffffff";
                    clip.fillType = "solid";
                    clip.outlineColor = "#000000";
                    clip.outlineThickness = 3;
                    clip.shadowColor = "rgba(0,0,0,0.7)";
                    clip.shadowBlur = 6;
                    clip.tracking = 0;
                }
                this.renderProperties(clip);
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        });

        // Transitions In & Out
        const selTransitionIn = document.getElementById('selTransitionIn');
        if (selTransitionIn) {
            selTransitionIn.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.transitionIn = e.target.value;
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }
        const btnRemoveTransIn = document.getElementById('btnRemoveTransitionIn');
        if (btnRemoveTransIn) {
            btnRemoveTransIn.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.transitionIn = 'none';
                    delete clip.transitionIn;
                    clip.transitionInDuration = 0;
                    if (selTransitionIn) selTransitionIn.value = 'none';
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }
        const selTransitionOut = document.getElementById('selTransitionOut');
        if (selTransitionOut) {
            selTransitionOut.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.transitionOut = e.target.value;
                    if (clip.transitionOut === 'none') {
                        delete clip.transitionOut;
                        clip.transitionOutDuration = 0;
                    }
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }
        const btnRemoveTransOut = document.getElementById('btnRemoveTransitionOut');
        if (btnRemoveTransOut) {
            btnRemoveTransOut.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.transitionOut = 'none';
                    delete clip.transitionOut;
                    clip.transitionOutDuration = 0;
                    if (selTransitionOut) selTransitionOut.value = 'none';
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }
        const rngTransDur = document.getElementById('rngTransitionDuration');
        const lblTransDur = document.getElementById('lblTransitionDur');
        if (rngTransDur) {
            rngTransDur.oninput = (e) => {
                const val = parseInt(e.target.value, 10) / 10.0;
                if (lblTransDur) lblTransDur.innerText = `${val.toFixed(1)}s`;
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.transitionInDuration = val;
                    clip.transitionOutDuration = val;
                    this.renderTimeline();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            rngTransDur.onchange = () => this.timeline.saveSnapshot();
        }
        const btnClearTrans = document.getElementById('btnClearTransitions');
        if (btnClearTrans) {
            btnClearTrans.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.transitionIn = 'none';
                    delete clip.transitionIn;
                    clip.transitionOut = 'none';
                    delete clip.transitionOut;
                    clip.transitionInDuration = 0;
                    clip.transitionOutDuration = 0;
                    clip.transitions = [];
                    if (selTransitionIn) selTransitionIn.value = 'none';
                    if (selTransitionOut) selTransitionOut.value = 'none';
                    this.renderProperties(clip);
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }
        const btnApplyAll = document.getElementById('btnApplyTransitionAll');
        if (btnApplyAll) {
            btnApplyAll.onclick = () => this.applyCurrentTransitionToAllClips();
        }
        const btnApplyAllTab = document.getElementById('btnApplyAllTabTransitions');
        if (btnApplyAllTab) {
            btnApplyAllTab.onclick = () => this.applyCurrentTransitionToAllClips();
        }

        // ====================================================
        // Studio-EXACT BEHAVIOR CONTROLLER & INSPECTOR
        // (In, During, Out phase tabs, presets, steppers, sync)
        // ====================================================
        const selBehavior = document.getElementById('selBehavior');
        if (selBehavior) {
            selBehavior.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.behavior = e.target.value;
                    if (clip.behavior !== 'none') {
                        clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                    } else {
                        clip.behavior = 'none';
                        delete clip.behavior;
                        clip.behaviorProps = null;
                        delete clip.behaviorProps;
                    }
                    this.renderProperties(clip);
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        // Reset Behavior Preset to Defaults (↺ icon button next to preset dropdown)
        const btnResetBehPreset = document.getElementById('btnResetBehaviorPreset');
        if (btnResetBehPreset) {
            btnResetBehPreset.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip && clip.behavior && clip.behavior !== 'none') {
                    clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                    this.renderProperties(clip);
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        // Remove Behavior (✕ icon button)
        const btnClearBeh = document.getElementById('btnClearBehavior');
        if (btnClearBeh) {
            btnClearBeh.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.behavior = 'none';
                    delete clip.behavior;
                    clip.behaviorProps = null;
                    delete clip.behaviorProps;
                    if (selBehavior) selBehavior.value = 'none';
                    this.renderProperties(clip);
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        // Behavior Phase Navigation Tabs (In / During / Out)
        document.querySelectorAll('.studio-phase-tab').forEach(tab => {
            tab.onclick = () => {
                const phase = tab.dataset.phase;
                document.querySelectorAll('.studio-phase-tab').forEach(t => {
                    t.classList.toggle('active', t === tab);
                });
                const pIn = document.getElementById('phasePanelIn');
                const pDuring = document.getElementById('phasePanelDuring');
                const pOut = document.getElementById('phasePanelOut');
                if (pIn) pIn.style.display = (phase === 'in') ? 'block' : 'none';
                if (pDuring) pDuring.style.display = (phase === 'during') ? 'block' : 'none';
                if (pOut) pOut.style.display = (phase === 'out') ? 'block' : 'none';
            };
        });

        // Helper to bind a synchronized slider + numeric stepper pair
        const bindSyncSliderStepper = (sliderId, numId, getVal, setVal, format = (v) => v, scaleFactor = 1) => {
            const slider = document.getElementById(sliderId);
            const num = document.getElementById(numId);
            if (!slider || !num) return;

            slider.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                const rawVal = parseFloat(e.target.value);
                const actualVal = scaleFactor === 1 ? rawVal : parseFloat((rawVal / scaleFactor).toFixed(2));
                setVal(clip.behaviorProps, actualVal);
                num.value = format(actualVal);
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
            slider.onchange = () => {
                this.timeline.saveSnapshot();
                this.renderTimeline();
            };

            num.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                const actualVal = parseFloat(e.target.value) || 0;
                setVal(clip.behaviorProps, actualVal);
                slider.value = scaleFactor === 1 ? actualVal : Math.round(actualVal * scaleFactor);
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
            num.onchange = () => {
                this.timeline.saveSnapshot();
                this.renderTimeline();
            };
        };

        // --- PHASE 1: IN CONTROLS ---
        const selInStyle = document.getElementById('selBehaviorInStyle');
        if (selInStyle) {
            selInStyle.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.in) clip.behaviorProps.in = {};
                clip.behaviorProps.in.style = e.target.value;
                const lblParam = document.getElementById('lblBehaviorInParamName');
                if (lblParam) {
                    lblParam.innerText = (e.target.value === 'bounce') ? 'Bounce' : (e.target.value === 'pop' ? 'Spring' : 'Speed');
                }
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const selInType = document.getElementById('selBehaviorInType');
        if (selInType) {
            selInType.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.in) clip.behaviorProps.in = {};
                clip.behaviorProps.in.type = e.target.value;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const selInMovement = document.getElementById('selBehaviorInMovement');
        if (selInMovement) {
            selInMovement.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.in) clip.behaviorProps.in = {};
                clip.behaviorProps.in.movement = e.target.value;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const selInDirection = document.getElementById('selBehaviorInDirection');
        if (selInDirection) {
            selInDirection.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.in) clip.behaviorProps.in = {};
                clip.behaviorProps.in.direction = e.target.value;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const btnResetInDir = document.getElementById('btnResetInDirection');
        if (btnResetInDir) {
            btnResetInDir.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.in) clip.behaviorProps.in = {};
                clip.behaviorProps.in.direction = 'right';
                if (selInDirection) selInDirection.value = 'right';
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        bindSyncSliderStepper('rngBehaviorInBounce', 'numBehaviorInBounce',
            bp => bp.in?.bounce || 40,
            (bp, v) => { if (!bp.in) bp.in = {}; bp.in.bounce = v; }
        );

        bindSyncSliderStepper('rngBehaviorInOffset', 'numBehaviorInOffset',
            bp => bp.in?.offset || 0.00,
            (bp, v) => { if (!bp.in) bp.in = {}; bp.in.offset = v; },
            v => v.toFixed(2),
            100
        );

        const btnResetInOffset = document.getElementById('btnResetInOffset');
        if (btnResetInOffset) {
            btnResetInOffset.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.in) clip.behaviorProps.in = {};
                clip.behaviorProps.in.offset = 0.00;
                const r = document.getElementById('rngBehaviorInOffset');
                const n = document.getElementById('numBehaviorInOffset');
                if (r) r.value = 0;
                if (n) n.value = '0.00';
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        // --- PHASE 2: DURING CONTROLS ---
        const selDuringStyle = document.getElementById('selBehaviorDuringStyle');
        if (selDuringStyle) {
            selDuringStyle.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.during) clip.behaviorProps.during = {};
                clip.behaviorProps.during.style = e.target.value;
                const lblParam = document.getElementById('lblBehaviorDuringParamName');
                if (lblParam) {
                    lblParam.innerText = (e.target.value === 'jump') ? 'Jump' : (e.target.value === 'drift' ? 'Drift' : 'Amount');
                }
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const selDuringType = document.getElementById('selBehaviorDuringType');
        if (selDuringType) {
            selDuringType.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.during) clip.behaviorProps.during = {};
                clip.behaviorProps.during.type = e.target.value;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        bindSyncSliderStepper('rngBehaviorDuringJump', 'numBehaviorDuringJump',
            bp => bp.during?.jump || 60.00,
            (bp, v) => { if (!bp.during) bp.during = {}; bp.during.jump = v; },
            v => v.toFixed(2)
        );

        bindSyncSliderStepper('rngBehaviorDuringLoopTime', 'numBehaviorDuringLoopTime',
            bp => bp.during?.loopTime || 1.00,
            (bp, v) => { if (!bp.during) bp.during = {}; bp.during.loopTime = v; },
            v => v.toFixed(2),
            100
        );

        bindSyncSliderStepper('rngBehaviorDuringOffset', 'numBehaviorDuringOffset',
            bp => bp.during?.offset || 0.08,
            (bp, v) => { if (!bp.during) bp.during = {}; bp.during.offset = v; },
            v => v.toFixed(2),
            100
        );

        bindSyncSliderStepper('rngBehaviorDuringDelay', 'numBehaviorDuringDelay',
            bp => bp.during?.delay || 1.67,
            (bp, v) => { if (!bp.during) bp.during = {}; bp.during.delay = v; },
            v => v.toFixed(2),
            100
        );

        bindSyncSliderStepper('rngBehaviorDuringLoops', 'numBehaviorDuringLoops',
            bp => bp.during?.loops || 1,
            (bp, v) => { if (!bp.during) bp.during = {}; bp.during.loops = Math.max(1, Math.round(v)); },
            v => Math.round(v).toString()
        );

        const chkLoopForever = document.getElementById('chkBehaviorLoopForever');
        if (chkLoopForever) {
            chkLoopForever.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.during) clip.behaviorProps.during = {};
                const isForever = e.target.checked;
                clip.behaviorProps.during.loopForever = isForever;
                const rowLoops = document.getElementById('rowBehaviorDuringLoops');
                const rngLoops = document.getElementById('rngBehaviorDuringLoops');
                const numLoops = document.getElementById('numBehaviorDuringLoops');
                if (rowLoops) rowLoops.style.opacity = isForever ? '0.45' : '1.0';
                if (rngLoops) rngLoops.disabled = isForever;
                if (numLoops) numLoops.disabled = isForever;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        // --- PHASE 3: OUT CONTROLS ---
        const selOutStyle = document.getElementById('selBehaviorOutStyle');
        if (selOutStyle) {
            selOutStyle.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.out) clip.behaviorProps.out = {};
                clip.behaviorProps.out.style = e.target.value;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const selOutType = document.getElementById('selBehaviorOutType');
        if (selOutType) {
            selOutType.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.out) clip.behaviorProps.out = {};
                clip.behaviorProps.out.type = e.target.value;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const selOutMovement = document.getElementById('selBehaviorOutMovement');
        if (selOutMovement) {
            selOutMovement.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.out) clip.behaviorProps.out = {};
                clip.behaviorProps.out.movement = e.target.value;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        const selOutDirection = document.getElementById('selBehaviorOutDirection');
        if (selOutDirection) {
            selOutDirection.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.out) clip.behaviorProps.out = {};
                clip.behaviorProps.out.direction = e.target.value;
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        bindSyncSliderStepper('rngBehaviorOutSpeed', 'numBehaviorOutSpeed',
            bp => bp.out?.speed || 92,
            (bp, v) => { if (!bp.out) bp.out = {}; bp.out.speed = v; }
        );

        bindSyncSliderStepper('rngBehaviorOutOffset', 'numBehaviorOutOffset',
            bp => bp.out?.offset || 0.08,
            (bp, v) => { if (!bp.out) bp.out = {}; bp.out.offset = v; },
            v => v.toFixed(2),
            100
        );

        const btnResetOutOffset = document.getElementById('btnResetOutOffset');
        if (btnResetOutOffset) {
            btnResetOutOffset.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.behaviorProps) clip.behaviorProps = this.getDefaultBehaviorProps(clip.behavior);
                if (!clip.behaviorProps.out) clip.behaviorProps.out = {};
                clip.behaviorProps.out.offset = 0.08;
                const r = document.getElementById('rngBehaviorOutOffset');
                const n = document.getElementById('numBehaviorOutOffset');
                if (r) r.value = 8;
                if (n) n.value = '0.08';
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        // Visual Effects in Inspector
        const bindInspFx = (id, prop, lblId = null, unit = '%', isCheck = false) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                if (!clip.visualEffects) clip.visualEffects = {};
                const val = isCheck ? e.target.checked : parseInt(e.target.value, 10);
                clip.visualEffects[prop] = val;
                if (lblId) {
                    const lbl = document.getElementById(lblId);
                    if (lbl) lbl.innerText = `${val}${unit}`;
                }
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
            if (isCheck) {
                el.onchange = () => {
                    const clip = this.timeline.getClip(this.timeline.selectedClipId);
                    if (clip && clip.visualEffects) clip.visualEffects[prop] = el.checked;
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                };
            } else {
                el.onchange = () => {
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                };
            }
        };

        bindInspFx('propVignetteInspector', 'vignette', 'lblVignetteInspector', '%');
        bindInspFx('propFilmGrainInspector', 'filmGrain', 'lblFilmGrainInspector', '%');
        bindInspFx('propGlowInspector', 'glow', 'lblGlowInspector', '%');
        bindInspFx('propSepiaInspector', 'sepia', 'lblSepiaInspector', '%');
        bindInspFx('propPixelateInspector', 'pixelate', 'lblPixelateInspector', 'px');
        bindInspFx('propBorderRadiusInspector', 'borderRadius', 'lblBorderRadiusInspector', 'px');
        bindInspFx('chkScanlinesInspector', 'scanlines', null, '', true);
        bindInspFx('chkInvertInspector', 'invert', null, '', true);
        bindInspFx('chkDropShadowInspector', 'dropShadow', null, '', true);
        bindInspFx('propDropShadowPower', 'dropShadowPower', 'lblDropShadowPower', 'x');
        bindInspFx('propDropShadowBlur', 'dropShadowBlur', 'lblDropShadowBlur', 'px');

        const chkDropShadow = document.getElementById('chkDropShadowInspector');
        if (chkDropShadow) {
            chkDropShadow.addEventListener('change', (e) => {
                const grp = document.getElementById('grpDropShadowParams');
                if (grp) grp.style.display = e.target.checked ? 'grid' : 'none';
            });
        }
        bindInspFx('propChromaticAberration', 'chromaticAberration', 'lblChromaticAberration', 'px');
        bindInspFx('propWaveWarp', 'waveWarp', 'lblWaveWarp', 'px');
        bindInspFx('propLensDistortion', 'lensDistortion', 'lblLensDistortion', '%');
        bindInspFx('propVhsGlitch', 'vhsGlitch', 'lblVhsGlitch', '%');

        const selGradePreset = document.getElementById('selColorGradePreset');
        if (selGradePreset) {
            selGradePreset.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (!clip.visualEffects) clip.visualEffects = {};
                    clip.visualEffects.colorGradePreset = e.target.value;
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const selDevInsp = document.getElementById('selDeviceFrameInspector');
        if (selDevInsp) {
            selDevInsp.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (!clip.visualEffects) clip.visualEffects = {};
                    clip.visualEffects.deviceFrame = e.target.value;
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const chkChromaInsp = document.getElementById('chkChromaKeyInspector');
        if (chkChromaInsp) {
            chkChromaInsp.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (!clip.visualEffects) clip.visualEffects = {};
                    clip.visualEffects.chromaKey = e.target.checked;
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        const colChromaInsp = document.getElementById('colChromaColorInspector');
        if (colChromaInsp) {
            colChromaInsp.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (!clip.visualEffects) clip.visualEffects = {};
                    clip.visualEffects.chromaColor = e.target.value;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            colChromaInsp.onchange = () => this.timeline.saveSnapshot();
        }

        const rngChromaTolInsp = document.getElementById('rngChromaTolInspector');
        if (rngChromaTolInsp) {
            rngChromaTolInsp.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    if (!clip.visualEffects) clip.visualEffects = {};
                    clip.visualEffects.chromaTolerance = parseInt(e.target.value, 10) / 100.0;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            rngChromaTolInsp.onchange = () => this.timeline.saveSnapshot();
        }

        const btnClearEffects = document.getElementById('btnClearEffects');
        if (btnClearEffects) {
            btnClearEffects.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.visualEffects = {};
                    this.renderProperties(clip);
                    this.renderTimeline();
                    this.timeline.saveSnapshot();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
        }

        // Transforms: Scale, Offset, Rotation, Opacity
        const chkLockAspect = document.getElementById('chkLockAspect');
        const propScale = document.getElementById('propScale');
        const propScaleX = document.getElementById('propScaleX');
        const propScaleY = document.getElementById('propScaleY');
        const lblScaleUniform = document.getElementById('lblScaleUniform');
        const lblScaleX = document.getElementById('lblScaleX');
        const lblScaleY = document.getElementById('lblScaleY');

        if (chkLockAspect) {
            chkLockAspect.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.aspectRatioLocked = e.target.checked;
                    this.timeline.saveSnapshot();
                }
            };
        }

        if (propScale) {
            propScale.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const s = parseInt(e.target.value, 10) / 100.0;
                if (lblScaleUniform) lblScaleUniform.innerText = `${Math.round(s * 100)}%`;
                if (clip) {
                    clip.scale = s;
                    if (chkLockAspect && chkLockAspect.checked) {
                        clip.scaleX = s;
                        clip.scaleY = s;
                        if (propScaleX) propScaleX.value = Math.round(s * 100);
                        if (propScaleY) propScaleY.value = Math.round(s * 100);
                        if (lblScaleX) lblScaleX.innerText = `${Math.round(s * 100)}%`;
                        if (lblScaleY) lblScaleY.innerText = `${Math.round(s * 100)}%`;
                    }
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propScale.onchange = () => this.timeline.saveSnapshot();
        }

        if (propScaleX) {
            propScaleX.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const sx = parseInt(e.target.value, 10) / 100.0;
                if (lblScaleX) lblScaleX.innerText = `${Math.round(sx * 100)}%`;
                if (clip) {
                    clip.scaleX = sx;
                    if (chkLockAspect && chkLockAspect.checked) {
                        clip.scaleY = sx;
                        clip.scale = sx;
                        if (propScaleY) propScaleY.value = Math.round(sx * 100);
                        if (propScale) propScale.value = Math.round(sx * 100);
                        if (lblScaleY) lblScaleY.innerText = `${Math.round(sx * 100)}%`;
                        if (lblScaleUniform) lblScaleUniform.innerText = `${Math.round(sx * 100)}%`;
                    }
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propScaleX.onchange = () => this.timeline.saveSnapshot();
        }

        if (propScaleY) {
            propScaleY.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const sy = parseInt(e.target.value, 10) / 100.0;
                if (lblScaleY) lblScaleY.innerText = `${Math.round(sy * 100)}%`;
                if (clip) {
                    clip.scaleY = sy;
                    if (chkLockAspect && chkLockAspect.checked) {
                        clip.scaleX = sy;
                        clip.scale = sy;
                        if (propScaleX) propScaleX.value = Math.round(sy * 100);
                        if (propScale) propScale.value = Math.round(sy * 100);
                        if (lblScaleX) lblScaleX.innerText = `${Math.round(sy * 100)}%`;
                        if (lblScaleUniform) lblScaleUniform.innerText = `${Math.round(sy * 100)}%`;
                    }
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propScaleY.onchange = () => this.timeline.saveSnapshot();
        }

        const propXOffset = document.getElementById('propXOffset');
        if (propXOffset) {
            propXOffset.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.xOffset = parseInt(e.target.value, 10) || 0;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propXOffset.onchange = () => this.timeline.saveSnapshot();
        }

        const propYOffset = document.getElementById('propYOffset');
        if (propYOffset) {
            propYOffset.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.yOffset = parseInt(e.target.value, 10) || 0;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propYOffset.onchange = () => this.timeline.saveSnapshot();
        }

        // Position Z (Layer Depth / Track Ordering)
        const btnLayerFront = document.getElementById('btnLayerFront');
        const btnLayerUp = document.getElementById('btnLayerUp');
        const btnLayerDown = document.getElementById('btnLayerDown');
        const btnLayerBack = document.getElementById('btnLayerBack');
        const lblPositionZ = document.getElementById('lblPositionZ');

        const moveClipToTrack = (targetTrackId) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            if (!clip) return;
            clip.trackId = targetTrackId;
            if (lblPositionZ) lblPositionZ.innerText = `Track ${targetTrackId}`;
            this.renderTimeline();
            this.timeline.saveSnapshot();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        if (btnLayerFront) {
            btnLayerFront.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip || !this.timeline.tracks.length) return;
                const maxTrack = Math.max(...this.timeline.tracks.map(t => t.id));
                moveClipToTrack(maxTrack);
            };
        }
        if (btnLayerUp) {
            btnLayerUp.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                const sortedTracks = [...this.timeline.tracks].sort((a, b) => a.id - b.id);
                const nextTrack = sortedTracks.find(t => t.id > clip.trackId);
                if (nextTrack) {
                    moveClipToTrack(nextTrack.id);
                } else {
                    const newTrack = this.timeline.addTrack();
                    moveClipToTrack(newTrack.id);
                }
            };
        }
        if (btnLayerDown) {
            btnLayerDown.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) return;
                const sortedTracks = [...this.timeline.tracks].sort((a, b) => b.id - a.id);
                const prevTrack = sortedTracks.find(t => t.id < clip.trackId);
                if (prevTrack) {
                    moveClipToTrack(prevTrack.id);
                }
            };
        }
        if (btnLayerBack) {
            btnLayerBack.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip || !this.timeline.tracks.length) return;
                const minTrack = Math.min(...this.timeline.tracks.map(t => t.id));
                moveClipToTrack(minTrack);
            };
        }

        // Interactive Rotatable Knob Button & Rotation Controls
        const knobRotation = document.getElementById('knobRotation');
        const propRotation = document.getElementById('propRotation');
        const propRotationSlider = document.getElementById('propRotationSlider');
        const lblKnobRotation = document.getElementById('lblKnobRotation');

        const updateRotationValue = (deg, saveSnap = false) => {
            let normalizedDeg = Math.round(deg % 360);
            if (normalizedDeg < 0) normalizedDeg += 360;

            if (propRotation) propRotation.value = normalizedDeg;
            if (propRotationSlider) propRotationSlider.value = normalizedDeg;
            if (lblKnobRotation) lblKnobRotation.innerText = `${normalizedDeg}°`;

            if (knobRotation) {
                const indicator = knobRotation.querySelector('.knob-indicator');
                if (indicator) {
                    indicator.style.transform = `rotate(${normalizedDeg}deg)`;
                    indicator.style.transformOrigin = '50% 21px';
                }
            }

            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            if (clip) {
                clip.rotation = normalizedDeg;
                this.compositor.renderFrame(this.timeline, this.playheadTime);
                if (saveSnap) this.timeline.saveSnapshot();
            }
        };

        if (knobRotation) {
            let isDraggingKnob = false;

            const onKnobPointerDown = (e) => {
                e.preventDefault();
                isDraggingKnob = true;
                knobRotation.classList.add('dragging');

                const rect = knobRotation.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;

                const calcAngle = (moveEvt) => {
                    const dx = moveEvt.clientX - cx;
                    const dy = moveEvt.clientY - cy;
                    let rad = Math.atan2(dy, dx) + Math.PI / 2;
                    let deg = rad * (180 / Math.PI);
                    if (deg < 0) deg += 360;
                    return deg;
                };

                updateRotationValue(calcAngle(e));

                const onKnobPointerMove = (moveEvt) => {
                    if (!isDraggingKnob) return;
                    updateRotationValue(calcAngle(moveEvt));
                };

                const onKnobPointerUp = () => {
                    if (isDraggingKnob) {
                        isDraggingKnob = false;
                        knobRotation.classList.remove('dragging');
                        window.removeEventListener('pointermove', onKnobPointerMove);
                        window.removeEventListener('pointerup', onKnobPointerUp);
                        this.timeline.saveSnapshot();
                    }
                };

                window.addEventListener('pointermove', onKnobPointerMove);
                window.addEventListener('pointerup', onKnobPointerUp);
            };

            knobRotation.addEventListener('pointerdown', onKnobPointerDown);
            knobRotation.addEventListener('dblclick', () => updateRotationValue(0, true));
        }

        if (propRotation) {
            propRotation.oninput = (e) => updateRotationValue(parseInt(e.target.value, 10) || 0);
            propRotation.onchange = () => this.timeline.saveSnapshot();
        }

        if (propRotationSlider) {
            propRotationSlider.oninput = (e) => updateRotationValue(parseInt(e.target.value, 10) || 0);
            propRotationSlider.onchange = () => this.timeline.saveSnapshot();
        }

        const angleButtons = document.querySelectorAll('.btn-knob-angle');
        angleButtons.forEach(btn => {
            btn.onclick = () => {
                const angle = parseInt(btn.dataset.angle, 10) || 0;
                updateRotationValue(angle, true);
            };
        });

        // Opacity Control
        const propOpacity = document.getElementById('propOpacity');
        const lblOpacity = document.getElementById('lblOpacity');
        if (propOpacity) {
            propOpacity.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10);
                if (lblOpacity) lblOpacity.innerText = `${val}%`;
                if (clip) {
                    clip.opacity = val / 100.0;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propOpacity.onchange = () => this.timeline.saveSnapshot();
        }

        // Blur Filter Control
        const propBlur = document.getElementById('propBlur');
        const lblBlur = document.getElementById('lblBlur');
        if (propBlur) {
            propBlur.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                const val = parseInt(e.target.value, 10) || 0;
                if (lblBlur) lblBlur.innerText = `${val}px`;
                if (clip) {
                    clip.blur = val;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propBlur.onchange = () => this.timeline.saveSnapshot();
        }

        // Clip Speed & Time Ramping Controls
        const propClipSpeed = document.getElementById('propClipSpeed');
        const lblClipSpeed = document.getElementById('lblClipSpeed');
        const applySpeedValue = (newSpeed) => {
            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            if (!clip) return;
            const validSpeed = Math.max(0.25, Math.min(4.0, parseFloat(newSpeed) || 1.0));
            clip.speed = validSpeed;

            if (lblClipSpeed) lblClipSpeed.innerText = `${validSpeed.toFixed(2)}x`;
            if (propClipSpeed) propClipSpeed.value = validSpeed;

            if (!clip.originalDuration) clip.originalDuration = clip.duration;
            clip.duration = clip.originalDuration / validSpeed;

            this.renderTimeline();
            this.timeline.saveSnapshot();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        if (propClipSpeed) {
            propClipSpeed.oninput = (e) => {
                const val = parseFloat(e.target.value);
                if (lblClipSpeed) lblClipSpeed.innerText = `${val.toFixed(2)}x`;
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.speed = val;
                    if (!clip.originalDuration) clip.originalDuration = clip.duration;
                    clip.duration = clip.originalDuration / val;
                    this.renderTimeline();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            propClipSpeed.onchange = () => this.timeline.saveSnapshot();
        }

        const speedPresetBtns = document.querySelectorAll('.btn-speed-preset');
        speedPresetBtns.forEach(btn => {
            btn.onclick = () => applySpeedValue(btn.dataset.speed);
        });

        const propVolume = document.getElementById('propVolume');
        if (propVolume) {
            propVolume.oninput = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.volume = parseInt(e.target.value, 10) / 100.0;
                }
            };
            propVolume.onchange = () => this.timeline.saveSnapshot();
        }

        const propStart = document.getElementById('propStart');
        if (propStart) {
            propStart.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.startTime = Math.max(0, parseFloat(e.target.value));
                    this.timeline.updateTotalDuration();
                    this.timeline.saveSnapshot();
                    this.renderTimeline();
                    this.updateTimelineRuler();
                }
            };
        }

        const propDuration = document.getElementById('propDuration');
        if (propDuration) {
            propDuration.onchange = (e) => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (clip) {
                    clip.duration = Math.max(0.2, parseFloat(e.target.value));
                    this.timeline.updateTotalDuration();
                    this.timeline.saveSnapshot();
                    this.renderTimeline();
                    this.updateTimelineRuler();
                }
            };
        }

        // 17. Screen & Audio Record Modal
        document.getElementById('btnOpenRecordModal').onclick = async () => {
            if (this.recorder.isRecording) {
                this.stopRecording();
            } else {
                await this.populateRecordingDevices();
                document.getElementById('recordModal').classList.remove('hidden');
                this.renderRecordingSetupPreview();
            }
        };

        const recCamToggle = document.getElementById('recCameraToggle');
        if (recCamToggle) {
            recCamToggle.onchange = (e) => {
                const groupCam = document.getElementById('groupRecCameraSelect');
                if (groupCam) groupCam.style.display = e.target.checked ? 'block' : 'none';
                this.renderRecordingSetupPreview();
            };
        }

        document.getElementById('btnStartCapture').onclick = () => {
            this.stopRecSetupPreview();
            document.getElementById('recordModal').classList.add('hidden');
            this.startRecording();
        };

        // 18. Import & Save
        const fileInput = document.getElementById('fileInput');
        document.getElementById('btnImportMedia').onclick = () => fileInput.click();
        fileInput.onchange = (e) => this.handleFileImport(e);
        document.getElementById('btnSaveProject').onclick = () => this.saveProject();

        // 19. Projects Browser & New Project Modals
        const btnProjects = document.getElementById('btnOpenProjectsModal');
        if (btnProjects) btnProjects.onclick = () => this.openProjectsModal();

        const btnNew = document.getElementById('btnNewProject');
        if (btnNew) btnNew.onclick = () => this.newProject();

        const btnModalNew = document.getElementById('btnModalNewProject');
        if (btnModalNew) btnModalNew.onclick = () => this.newProject();

        const btnShortcuts = document.getElementById('btnOpenShortcutsModal');
        if (btnShortcuts) btnShortcuts.onclick = () => document.getElementById('shortcutsModal').classList.remove('hidden');

        const btnSnap = document.getElementById('btnToggleSnapping');
        if (btnSnap) {
            btnSnap.onclick = () => {
                this.timeline.snappingEnabled = !this.timeline.snappingEnabled;
                btnSnap.classList.toggle('active', this.timeline.snappingEnabled);
                btnSnap.title = `Magnetic Snapping: ${this.timeline.snappingEnabled ? 'ON' : 'OFF'}`;
            };
        }
    }

    /**
     * Pull-to-Extend Timeline Resizer
     * Allows dragging up or down to expand/collapse timeline and responsive player view
     */
    initTimelineResizer() {
        const resizer = document.getElementById('timelineResizer');
        const timelineSec = document.getElementById('timelineSection');
        if (!resizer || !timelineSec) return;

        // Restore persisted timeline height
        const savedHeight = localStorage.getItem('rpa_timeline_height');
        if (savedHeight) {
            const h = parseInt(savedHeight, 10);
            if (h >= 140 && h <= window.innerHeight - 150) {
                timelineSec.style.height = `${h}px`;
            }
        }

        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        const onPointerDown = (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = timelineSec.getBoundingClientRect().height;
            resizer.classList.add('resizing');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            if (!isResizing) return;
            const deltaY = startY - e.clientY; // Dragging upwards extends timeline height
            const minH = 140;
            const maxH = Math.max(minH, window.innerHeight - 180);
            const newHeight = Math.max(minH, Math.min(maxH, Math.round(startHeight + deltaY)));
            timelineSec.style.height = `${newHeight}px`;
            this.resizeCanvas();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        const onPointerUp = (e) => {
            if (!isResizing) return;
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
            const finalHeight = Math.round(timelineSec.getBoundingClientRect().height);
            localStorage.setItem('rpa_timeline_height', finalHeight);
            this.resizeCanvas();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        resizer.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    }

    /**
     * High-Precision Studio Playhead Scrubber & In/Out Range Dragging
     */
    setupPlayheadDragging() {
        const scrollArea = document.getElementById('timelineScrollArea');
        const ruler = document.getElementById('timelineRuler');
        const playheadCenter = document.getElementById('playheadCenter');
        const playheadContainer = document.getElementById('playheadHandleContainer');
        const playheadLine = document.querySelector('.playhead-line');
        const handleIn = document.getElementById('handleInPoint');
        const handleOut = document.getElementById('handleOutPoint');

        const getTimeFromPointer = (clientX) => {
            const rect = scrollArea.getBoundingClientRect();
            // 140px offset accounts for dynamic track header width
            const clickX = (clientX - rect.left) + scrollArea.scrollLeft - 140;
            return Math.max(0, Math.min(this.timeline.totalDuration, clickX / this.timeline.pixelsPerSecond));
        };

        const startScrub = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            this.isDraggingPlayhead = true;
            if (this.isPlaying) this.togglePlayback();

            if (e.target && e.target.setPointerCapture && e.pointerId !== undefined) {
                try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
            }

            const time = getTimeFromPointer(e.clientX);
            this.seek(time);

            let scrubRaf = null;
            const onPointerMove = (moveEvent) => {
                if (!this.isDraggingPlayhead) return;
                moveEvent.preventDefault();
                const newTime = getTimeFromPointer(moveEvent.clientX);
                if (!scrubRaf) {
                    scrubRaf = requestAnimationFrame(() => {
                        this.seek(newTime);
                        scrubRaf = null;
                    });
                }

                // Auto-scroll timeline when dragging near edges
                const rect = scrollArea.getBoundingClientRect();
                const edgeMargin = 40;
                if (moveEvent.clientX > rect.right - edgeMargin) {
                    scrollArea.scrollLeft += 15;
                } else if (moveEvent.clientX < rect.left + 140 + edgeMargin) {
                    scrollArea.scrollLeft -= 15;
                }
            };

            const onPointerUp = (upEvent) => {
                this.isDraggingPlayhead = false;
                if (scrubRaf) {
                    cancelAnimationFrame(scrubRaf);
                    scrubRaf = null;
                }
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('mousemove', onPointerMove);
                window.removeEventListener('mouseup', onPointerUp);
                if (upEvent.target && upEvent.target.releasePointerCapture && upEvent.pointerId !== undefined) {
                    try { upEvent.target.releasePointerCapture(upEvent.pointerId); } catch (_) {}
                }
            };

            window.addEventListener('pointermove', onPointerMove, { passive: false });
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('mousemove', onPointerMove);
            window.addEventListener('mouseup', onPointerUp);
        };

        // 1. Playhead Center Handle & Head Container
        playheadCenter.addEventListener('pointerdown', startScrub);
        playheadCenter.addEventListener('mousedown', startScrub);

        playheadContainer.addEventListener('pointerdown', (e) => {
            if (e.target !== handleIn && e.target !== handleOut) {
                startScrub(e);
            }
        });
        playheadContainer.addEventListener('mousedown', (e) => {
            if (e.target !== handleIn && e.target !== handleOut) {
                startScrub(e);
            }
        });

        // 2. Playhead Vertical Guide Line (Allows grabbing playhead anywhere down tracks!)
        if (playheadLine) {
            playheadLine.addEventListener('pointerdown', startScrub);
            playheadLine.addEventListener('mousedown', startScrub);
        }

        // 3. Ruler (Click or Drag anywhere on ruler)
        ruler.addEventListener('pointerdown', startScrub);
        ruler.addEventListener('mousedown', startScrub);

        // 4. Scroll Area & Empty Track Space
        scrollArea.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.timeline-clip') ||
                e.target.closest('.track-header') ||
                e.target.closest('.timeline-marker') ||
                e.target.closest('.playhead-head-container') ||
                e.target.closest('.playhead-line')) {
                return;
            }
            startScrub(e);
        });
        scrollArea.addEventListener('mousedown', (e) => {
            if (e.target.closest('.timeline-clip') ||
                e.target.closest('.track-header') ||
                e.target.closest('.timeline-marker') ||
                e.target.closest('.playhead-head-container') ||
                e.target.closest('.playhead-line')) {
                return;
            }
            startScrub(e);
        });

        // 5. Drag In-Point (Green Left Handle)
        const startDragIn = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            if (e.target.setPointerCapture && e.pointerId !== undefined) {
                try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
            }

            const onMove = (moveEvent) => {
                moveEvent.preventDefault();
                const newTime = getTimeFromPointer(moveEvent.clientX);
                this.timeline.selectionStart = Math.min(newTime, this.playheadTime);
                this.timeline.selectionEnd = Math.max(this.timeline.selectionEnd || this.playheadTime, this.playheadTime);
                this.updateSelectionRangeUI();
            };

            const onUp = (upEvent) => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                if (upEvent.target && upEvent.target.releasePointerCapture && upEvent.pointerId !== undefined) {
                    try { upEvent.target.releasePointerCapture(upEvent.pointerId); } catch (_) {}
                }
            };

            window.addEventListener('pointermove', onMove, { passive: false });
            window.addEventListener('pointerup', onUp);
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        };
        handleIn.addEventListener('pointerdown', startDragIn);
        handleIn.addEventListener('mousedown', startDragIn);

        // 6. Drag Out-Point (Red Right Handle)
        const startDragOut = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            if (e.target.setPointerCapture && e.pointerId !== undefined) {
                try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
            }

            const onMove = (moveEvent) => {
                moveEvent.preventDefault();
                const newTime = getTimeFromPointer(moveEvent.clientX);
                this.timeline.selectionStart = Math.min(this.timeline.selectionStart || this.playheadTime, this.playheadTime);
                this.timeline.selectionEnd = Math.max(newTime, this.playheadTime);
                this.updateSelectionRangeUI();
            };

            const onUp = (upEvent) => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                if (upEvent.target && upEvent.target.releasePointerCapture && upEvent.pointerId !== undefined) {
                    try { upEvent.target.releasePointerCapture(upEvent.pointerId); } catch (_) {}
                }
            };

            window.addEventListener('pointermove', onMove, { passive: false });
            window.addEventListener('pointerup', onUp);
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        };
        handleOut.addEventListener('pointerdown', startDragOut);
        handleOut.addEventListener('mousedown', startDragOut);

        // 7. Double-click reset
        playheadContainer.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.timeline.selectionStart = null;
            this.timeline.selectionEnd = null;
            this.updateSelectionRangeUI();
        });
        ruler.addEventListener('dblclick', () => {
            this.timeline.selectionStart = null;
            this.timeline.selectionEnd = null;
            this.updateSelectionRangeUI();
        });

        // 8. Dynamic sizing on window resize
        window.addEventListener('resize', () => {
            this.updateTimelineRuler();
        });
    }

    updateSelectionRangeUI() {
        const rangeEl = document.getElementById('selectionRange');
        if (this.timeline.selectionStart !== null && this.timeline.selectionEnd !== null && this.timeline.selectionStart < this.timeline.selectionEnd) {
            const leftPx = (this.timeline.selectionStart * this.timeline.pixelsPerSecond) + 140;
            const widthPx = (this.timeline.selectionEnd - this.timeline.selectionStart) * this.timeline.pixelsPerSecond;
            rangeEl.style.left = `${leftPx}px`;
            rangeEl.style.width = `${widthPx}px`;
            rangeEl.style.display = 'block';
        } else {
            rangeEl.style.display = 'none';
        }
    }

    cutRangeSelection() {
        if (this.timeline.selectionStart === null || this.timeline.selectionEnd === null) {
            alert('Please drag the Green In-point or Red Out-point on the playhead to select a range to cut.');
            return;
        }
        this.timeline.cutSelection(this.timeline.selectionStart, this.timeline.selectionEnd);
        this.updateSelectionRangeUI();
        this.renderTimeline();
        this.updateTimelineRuler();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    addMarkerAtPlayhead() {
        const label = prompt('Marker name / Chapter title:', `Chapter at ${this.playheadTime.toFixed(1)}s`);
        if (label) {
            this.timeline.addMarker(this.playheadTime, label);
            this.updateTimelineRuler();
        }
    }

    applyZoom(scale, focusX, focusY) {
        this.compositor.zoom.scale = scale;
        this.compositor.zoom.focusX = focusX;
        this.compositor.zoom.focusY = focusY;
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    getDefaultBehaviorProps(behaviorName) {
        const preset = (behaviorName || 'jump').toLowerCase();
        const base = {
            preset: preset,
            name: 'Jump And Fall',
            tension: 50,
            textUnit: 'character',
            waveDelay: 0.08,
            in: {
                style: 'bounce',
                type: 'ltr',
                movement: 'bounce',
                direction: 'bottom',
                bounce: 40,
                offset: 0.00,
                duration: 0.8
            },
            during: {
                style: 'jump',
                type: 'ltr',
                jump: 60.00,
                loopTime: 1.00,
                offset: 0.08,
                delay: 1.67,
                loops: 1,
                loopForever: true
            },
            out: {
                style: 'drop',
                type: 'ltr',
                movement: 'ease-in-quart',
                direction: 'bottom',
                speed: 92,
                offset: 0.08,
                duration: 0.8
            }
        };

        if (preset === 'jump') {
            base.name = 'Jump And Fall';
            base.in = { style: 'jump', type: 'ltr', movement: 'bounce', direction: 'bottom', bounce: 40, offset: 0.00, duration: 0.8 };
            base.during = { style: 'jump', type: 'ltr', jump: 60.00, loopTime: 1.00, offset: 0.08, delay: 1.67, loops: 1, loopForever: true };
            base.out = { style: 'drop', type: 'ltr', movement: 'ease-in-quart', direction: 'bottom', speed: 92, offset: 0.08, duration: 0.8 };
        } else if (preset === 'slide' || preset === 'slide-drift' || preset === 'slide-in') {
            base.name = 'Slide & Drift';
            base.in = { style: 'slide', type: 'ltr', movement: 'smooth', direction: 'left', bounce: 50, offset: 0.05, duration: 0.8 };
            base.during = { style: 'drift', type: 'ltr', jump: 25.00, loopTime: 2.00, offset: 0.08, delay: 0.50, loops: 1, loopForever: true };
            base.out = { style: 'slide', type: 'ltr', movement: 'smooth', direction: 'right', speed: 85, offset: 0.05, duration: 0.8 };
        } else if (preset === 'slide-bounce') {
            base.name = 'Slide & Bounce';
            base.in = { style: 'slide-bounce', type: 'ltr', movement: 'bounce', direction: 'left', bounce: 70, offset: 0.05, duration: 0.9 };
            base.during = { style: 'jump', type: 'ltr', jump: 35.00, loopTime: 1.20, offset: 0.06, delay: 0.50, loops: 1, loopForever: true };
            base.out = { style: 'slide', type: 'ltr', movement: 'smooth', direction: 'bottom', speed: 85, offset: 0.05, duration: 0.8 };
        } else if (preset === 'pop' || preset === 'popup') {
            base.name = 'Pop Up';
            base.in = { style: 'pop', type: 'ltr', movement: 'spring', direction: 'bottom', bounce: 60, offset: 0.04, duration: 0.7 };
            base.during = { style: 'pulsating', type: 'ltr', jump: 30.00, loopTime: 1.20, offset: 0.06, delay: 1.00, loops: 1, loopForever: true };
            base.out = { style: 'shrink', type: 'ltr', movement: 'ease-in-quart', direction: 'bottom', speed: 85, offset: 0.04, duration: 0.7 };
        } else if (preset === 'pulsing' || preset === 'pulsate') {
            base.name = 'Pulsing';
            base.in = { style: 'scale', type: 'all', movement: 'smooth', direction: 'bottom', bounce: 40, offset: 0.00, duration: 0.6 };
            base.during = { style: 'pulsating', type: 'all', jump: 40.00, loopTime: 0.80, offset: 0.00, delay: 0.20, loops: 1, loopForever: true };
            base.out = { style: 'fade', type: 'all', movement: 'linear', direction: 'bottom', speed: 90, offset: 0.00, duration: 0.6 };
        } else if (preset === 'fade-scale') {
            base.name = 'Fade & Scale Bloom';
            base.in = { style: 'fade', type: 'all', movement: 'smooth', direction: 'bottom', bounce: 30, offset: 0.00, duration: 0.8 };
            base.during = { style: 'drift', type: 'ltr', jump: 20.00, loopTime: 2.20, offset: 0.05, delay: 0.50, loops: 1, loopForever: true };
            base.out = { style: 'fade', type: 'all', movement: 'smooth', direction: 'bottom', speed: 85, offset: 0.00, duration: 0.8 };
        } else if (preset === 'wiggle') {
            base.name = 'Wiggle / Jitter';
            base.in = { style: 'pop', type: 'ltr', movement: 'spring', direction: 'bottom', bounce: 70, offset: 0.03, duration: 0.6 };
            base.during = { style: 'wiggle', type: 'ltr', jump: 35.00, loopTime: 0.60, offset: 0.04, delay: 0.10, loops: 1, loopForever: true };
            base.out = { style: 'shrink', type: 'ltr', movement: 'bounce', direction: 'bottom', speed: 80, offset: 0.04, duration: 0.6 };
        } else if (preset === 'swing') {
            base.name = 'Pendulum Swing';
            base.in = { style: 'bounce', type: 'ltr', movement: 'spring', direction: 'top', bounce: 55, offset: 0.06, duration: 0.8 };
            base.during = { style: 'swing', type: 'ltr', jump: 45.00, loopTime: 1.50, offset: 0.08, delay: 0.30, loops: 1, loopForever: true };
            base.out = { style: 'drop', type: 'ltr', movement: 'smooth', direction: 'bottom', speed: 88, offset: 0.06, duration: 0.8 };
        } else if (preset === 'float-bob') {
            base.name = 'Float & Bob';
            base.in = { style: 'slide', type: 'ltr', movement: 'smooth', direction: 'bottom', bounce: 30, offset: 0.05, duration: 0.9 };
            base.during = { style: 'float-bob', type: 'ltr', jump: 28.00, loopTime: 1.80, offset: 0.06, delay: 0.20, loops: 1, loopForever: true };
            base.out = { style: 'fade', type: 'ltr', movement: 'smooth', direction: 'top', speed: 80, offset: 0.05, duration: 0.8 };
        } else if (preset === 'shifting') {
            base.name = 'Shifting Drift';
            base.in = { style: 'slide', type: 'ltr', movement: 'smooth', direction: 'top', bounce: 35, offset: 0.05, duration: 0.8 };
            base.during = { style: 'drift', type: 'ltr', jump: 35.00, loopTime: 1.60, offset: 0.08, delay: 0.30, loops: 1, loopForever: true };
            base.out = { style: 'slide', type: 'ltr', movement: 'smooth', direction: 'bottom', speed: 80, offset: 0.05, duration: 0.8 };
        } else if (preset === 'hinge') {
            base.name = 'Hinge Corner Drop';
            base.in = { style: 'drop', type: 'ltr', movement: 'spring', direction: 'top', bounce: 50, offset: 0.05, duration: 0.8 };
            base.during = { style: 'swing', type: 'ltr', jump: 40.00, loopTime: 1.50, offset: 0.08, delay: 0.20, loops: 1, loopForever: true };
            base.out = { style: 'drop', type: 'ltr', movement: 'smooth', direction: 'bottom', speed: 90, offset: 0.05, duration: 0.8 };
        } else if (preset === 'roller') {
            base.name = 'Roller 360';
            base.in = { style: 'roller', type: 'ltr', movement: 'smooth', direction: 'left', bounce: 45, offset: 0.05, duration: 0.9 };
            base.during = { style: 'drift', type: 'ltr', jump: 20.00, loopTime: 1.80, offset: 0.06, delay: 0.40, loops: 1, loopForever: true };
            base.out = { style: 'roller', type: 'ltr', movement: 'smooth', direction: 'right', speed: 85, offset: 0.05, duration: 0.9 };
        } else if (preset === 'spin-grow') {
            base.name = '720° Spin Grow';
            base.in = { style: 'spin-grow', type: 'ltr', movement: 'smooth', direction: 'center', bounce: 50, offset: 0.04, duration: 0.8 };
            base.during = { style: 'breathe', type: 'ltr', jump: 20.00, loopTime: 2.00, offset: 0.06, delay: 0.30, loops: 1, loopForever: true };
            base.out = { style: 'spin-grow', type: 'ltr', movement: 'smooth', direction: 'center', speed: 80, offset: 0.04, duration: 0.8 };
        } else if (preset === 'squash-stretch') {
            base.name = 'Squash & Stretch';
            base.in = { style: 'bounce', type: 'ltr', movement: 'bounce', direction: 'top', bounce: 65, offset: 0.05, duration: 0.8 };
            base.during = { style: 'jump', type: 'ltr', jump: 45.00, loopTime: 0.90, offset: 0.08, delay: 0.20, loops: 1, loopForever: true };
            base.out = { style: 'drop', type: 'ltr', movement: 'smooth', direction: 'bottom', speed: 85, offset: 0.05, duration: 0.7 };
        } else if (preset === 'glow-pulse') {
            base.name = 'Glow Breathe';
            base.in = { style: 'fade', type: 'all', movement: 'smooth', direction: 'bottom', bounce: 30, offset: 0.00, duration: 0.7 };
            base.during = { style: 'breathe', type: 'all', jump: 30.00, loopTime: 1.40, offset: 0.00, delay: 0.10, loops: 1, loopForever: true };
            base.out = { style: 'fade', type: 'all', movement: 'smooth', direction: 'bottom', speed: 80, offset: 0.00, duration: 0.7 };
        } else if (preset === 'glitch-jitter') {
            base.name = 'Glitch Jitter';
            base.in = { style: 'pop', type: 'ltr', movement: 'spring', direction: 'bottom', bounce: 60, offset: 0.03, duration: 0.6 };
            base.during = { style: 'glitch', type: 'ltr', jump: 35.00, loopTime: 0.50, offset: 0.04, delay: 0.10, loops: 1, loopForever: true };
            base.out = { style: 'shrink', type: 'ltr', movement: 'smooth', direction: 'bottom', speed: 85, offset: 0.03, duration: 0.6 };
        } else {
            base.name = behaviorName.charAt(0).toUpperCase() + behaviorName.slice(1);
        }
        return base;
    }

    applyTransition(type) {
        const clip = this.timeline.getClip(this.timeline.selectedClipId);
        if (!clip) {
            alert('Please select a clip on the timeline first.');
            return;
        }
        if (!clip.transitionIn || clip.transitionIn === 'none') {
            clip.transitionIn = type;
        } else if (!clip.transitionOut || clip.transitionOut === 'none') {
            clip.transitionOut = type;
        } else {
            // Multiple transitions support: Add as timeline content intermediate transition!
            if (!Array.isArray(clip.transitions)) clip.transitions = [];
            const relPlayhead = Math.max(0.1, Math.min(clip.duration - 0.9, (this.playheadTime || 0) - clip.startTime));
            clip.transitions.push({
                id: 'trans_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: type,
                type: type,
                timeOffset: parseFloat(relPlayhead.toFixed(2)),
                duration: 0.8
            });
        }
        this.renderProperties(clip);
        this.renderTimeline();
        this.timeline.saveSnapshot();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    applyBehavior(type) {
        const clip = this.timeline.getClip(this.timeline.selectedClipId);
        if (!clip) {
            alert('Please select a clip on the timeline first.');
            return;
        }
        clip.behavior = type;
        if (type !== 'none') {
            clip.behaviorProps = this.getDefaultBehaviorProps(type);
        } else {
            clip.behaviorProps = null;
        }
        this.renderProperties(clip);
        this.renderTimeline();
        this.timeline.saveSnapshot();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    applyAudioFade(direction) {
        const clip = this.timeline.getClip(this.timeline.selectedClipId);
        if (!clip) {
            alert('Select an audio or video clip on the timeline first.');
            return;
        }
        if (direction === 'in') clip.audioEffects.fadeIn = 1.0;
        if (direction === 'out') clip.audioEffects.fadeOut = 1.0;
        alert(`Applied audio fade ${direction} (1s) to clip: ${clip.title}`);
    }

    renderCaptionList() {
        const container = document.getElementById('captionListContainer');
        if (!container) return;
        container.innerHTML = '';
        for (const cap of this.timeline.captions) {
            const card = document.createElement('div');
            card.className = 'asset-card';
            card.innerHTML = `
                <div class="asset-title">💬 ${cap.text}</div>
                <div class="asset-sub">Start: ${cap.startTime.toFixed(1)}s | Duration: ${cap.duration.toFixed(1)}s</div>
            `;
            container.appendChild(card);
        }
    }

    async toggleVoiceNarration() {
        const btn = document.getElementById('btnStartVoiceover');
        const vuBar = document.getElementById('vuMeterBar');

        if (!this.isVoiceNarrating) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.voiceChunks = [];
                this.voiceRecorder = new MediaRecorder(stream);
                this.voiceRecorder.ondataavailable = e => { if (e.data.size > 0) this.voiceChunks.push(e.data); };

                // Audio level meter
                this.vuAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = this.vuAudioContext.createMediaStreamSource(stream);
                this.vuAnalyser = this.vuAudioContext.createAnalyser();
                this.vuAnalyser.fftSize = 64;
                source.connect(this.vuAnalyser);
                this.vuDataArray = new Uint8Array(this.vuAnalyser.frequencyBinCount);

                const updateMeter = () => {
                    if (!this.isVoiceNarrating) {
                        if (vuBar) vuBar.style.width = '0%';
                        return;
                    }
                    this.vuAnalyser.getByteFrequencyData(this.vuDataArray);
                    let sum = 0;
                    for (let i = 0; i < this.vuDataArray.length; i++) sum += this.vuDataArray[i];
                    const avg = sum / this.vuDataArray.length;
                    const pct = Math.min(100, Math.round((avg / 128) * 100));
                    if (vuBar) vuBar.style.width = `${pct}%`;
                    requestAnimationFrame(updateMeter);
                };
                requestAnimationFrame(updateMeter);

                const startRecordTime = this.playheadTime;
                this.voiceRecorder.onstop = () => {
                    stream.getTracks().forEach(t => t.stop());
                    if (this.vuAudioContext) this.vuAudioContext.close();
                    const blob = new Blob(this.voiceChunks, { type: 'audio/webm' });
                    const url = URL.createObjectURL(blob);
                    const dur = Math.max(1.0, this.playheadTime - startRecordTime);

                    // Add onto audio track
                    let audioTrack = this.timeline.tracks.find(t => t.type === 'audio');
                    if (!audioTrack) audioTrack = this.timeline.tracks[this.timeline.tracks.length - 1];

                    this.timeline.addClip({
                        title: `Voiceover_${Date.now()}`,
                        type: 'audio',
                        trackId: audioTrack ? audioTrack.id : 1,
                        startTime: startRecordTime,
                        duration: dur,
                        sourceUrl: url
                    });
                    this.renderTimeline();
                    this.updateTimelineRuler();
                };

                this.voiceRecorder.start();
                this.isVoiceNarrating = true;
                btn.style.backgroundColor = '#ef4444';
                btn.style.color = '#fff';
                btn.innerHTML = '<span>⏹️</span> Stop Voice Recording';
                if (!this.isPlaying) this.togglePlayback();
            } catch (err) {
                alert(`Microphone access failed: ${err.message}`);
            }
        } else {
            this.voiceRecorder.stop();
            this.isVoiceNarrating = false;
            btn.style.backgroundColor = '';
            btn.style.color = '';
            btn.innerHTML = '🎙️ Start Voice Recording';
            if (this.isPlaying) this.togglePlayback();
        }
    }

    setupDemoContent() {
        this.timeline.addClip({
            title: 'Welcome Screen Recording.mp4',
            type: 'video',
            trackId: 2,
            startTime: 0.0,
            duration: 10.0,
            telemetry: [
                { time: 1.0, x: 0.25, y: 0.35, type: 'mousemove' },
                { time: 2.2, x: 0.50, y: 0.50, type: 'mousedown' },
                { time: 4.5, x: 0.75, y: 0.40, type: 'mousemove' },
                { time: 6.0, x: 0.30, y: 0.60, type: 'mousedown' }
            ]
        });

        this.timeline.addClip({
            title: 'Title Header',
            type: 'callout',
            trackId: 4,
            startTime: 0.5,
            duration: 4.5,
            text: 'RPA VIDEO EDITOR STUDIO PRO'
        });

        this.timeline.addMarker(0.0, 'Intro');
        this.timeline.addMarker(5.0, 'Step 1: Capture');

        this.mediaBin = [
            {
                id: 'cardDemoClip',
                name: 'Welcome Demo.mp4',
                type: 'video',
                duration: 10.0,
                sub: 'RPA Automation Workflow Showcase'
            }
        ];
        this.renderMediaBin();
        this.updateTimelineRuler();
        this.renderTimeline();
        this.renderCaptionList();
    }

    addCallout(title) {
        const defaults = this.getCalloutDefaults(title);
        const newClip = {
            title,
            type: 'callout',
            subtype: defaults.subtype,
            trackId: 4,
            startTime: this.playheadTime,
            duration: 4.0,
            scale: 1.0,
            scaleX: defaults.scaleX,
            scaleY: defaults.scaleY,
            xOffset: defaults.xOffset,
            yOffset: defaults.yOffset,
            color: defaults.color,
            fontSize: defaults.fontSize,
            text: defaults.text,
            subText: defaults.subText,
            aspectRatioLocked: false
        };
        this.timeline.addClip(newClip);
        const added = this.timeline.clips[this.timeline.clips.length - 1];
        this.timeline.selectedClipId = added.id;
        this.renderProperties(added);
        this.renderTimeline();
        this.updateTimelineRuler();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    setupRecordingPreview() {
        const btnToggleRecPreview = document.getElementById('btnToggleRecSetupPreview');
        const hiddenVid = document.getElementById('recSetupVideoHidden');
        const previewCanvas = document.getElementById('recSetupPreviewCanvas');
        this.recSetupStream = null;
        this.recPreviewAnimId = null;
        this.recWebcamCustomPos = null;
        this.recCurrentOverlayBounds = null;

        const stopRecSetupPreview = () => {
            if (this.recPreviewAnimId) {
                cancelAnimationFrame(this.recPreviewAnimId);
                this.recPreviewAnimId = null;
            }
            if (this.recSetupStream) {
                this.recSetupStream.getTracks().forEach(t => t.stop());
                this.recSetupStream = null;
            }
            if (hiddenVid) {
                try { hiddenVid.pause(); } catch (_) {}
                hiddenVid.srcObject = null;
            }
            if (btnToggleRecPreview) {
                btnToggleRecPreview.innerHTML = '<span>📹</span> Test Camera Feed';
            }
            this.renderRecordingSetupPreview();
        };
        this.stopRecSetupPreview = stopRecSetupPreview;

        if (btnToggleRecPreview) {
            btnToggleRecPreview.onclick = async () => {
                if (this.recSetupStream) {
                    stopRecSetupPreview();
                    return;
                }
                try {
                    const camSelect = document.getElementById('recCameraDevice');
                    const constraints = {
                        video: camSelect && camSelect.value && camSelect.value !== 'default'
                            ? { deviceId: { exact: camSelect.value }, width: { ideal: 1280 }, height: { ideal: 720 } }
                            : { width: { ideal: 1280 }, height: { ideal: 720 } },
                        audio: false
                    };
                    const stream = await navigator.mediaDevices.getUserMedia(constraints);
                    this.recSetupStream = stream;
                    if (hiddenVid) {
                        hiddenVid.srcObject = stream;
                        await hiddenVid.play();
                    }
                    const camToggle = document.getElementById('recCameraToggle');
                    if (camToggle) {
                        camToggle.checked = true;
                        const grp = document.getElementById('groupRecCameraSelect');
                        if (grp) grp.style.display = 'block';
                    }
                    btnToggleRecPreview.innerHTML = '<span>⏹</span> Stop Camera Feed';

                    const animLoop = () => {
                        if (this.recSetupStream) {
                            this.renderRecordingSetupPreview();
                            this.recPreviewAnimId = requestAnimationFrame(animLoop);
                        }
                    };
                    if (this.recPreviewAnimId) cancelAnimationFrame(this.recPreviewAnimId);
                    this.recPreviewAnimId = requestAnimationFrame(animLoop);
                } catch (err) {
                    console.error('[Pre-recording Preview Error]', err);
                    alert(`Camera preview unavailable: ${err.message}`);
                }
            };
        }

        // Live change listeners on all webcam & recording settings
        const controlsToWatch = [
            'selWebcamShape', 'selWebcamPosition', 'rngWebcamSize', 'rngWebcamBorder',
            'colWebcamBorder', 'chkWebcamShadow', 'chkWebcamMirror', 'recCameraToggle', 'recResolution'
        ];
        controlsToWatch.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    if (id === 'rngWebcamSize') {
                        const lbl = document.getElementById('lblWebcamSize');
                        if (lbl) lbl.innerText = el.value + '%';
                    } else if (id === 'rngWebcamBorder') {
                        const lbl = document.getElementById('lblWebcamBorder');
                        if (lbl) lbl.innerText = el.value + 'px';
                    } else if (id === 'selWebcamPosition') {
                        this.recWebcamCustomPos = null;
                    }
                    this.renderRecordingSetupPreview();
                });
                el.addEventListener('change', () => {
                    if (id === 'selWebcamPosition') {
                        this.recWebcamCustomPos = null;
                    }
                    this.renderRecordingSetupPreview();
                });
            }
        });

        const camDeviceSelect = document.getElementById('recCameraDevice');
        if (camDeviceSelect) {
            camDeviceSelect.onchange = async () => {
                if (this.recSetupStream) {
                    stopRecSetupPreview();
                    if (btnToggleRecPreview) btnToggleRecPreview.click();
                } else {
                    this.renderRecordingSetupPreview();
                }
            };
        }

        // 1-Click Size & Border Presets
        document.querySelectorAll('.btn-rec-size-preset').forEach(btn => {
            btn.onclick = () => {
                const s = btn.dataset.size;
                const rng = document.getElementById('rngWebcamSize');
                const lbl = document.getElementById('lblWebcamSize');
                if (rng) rng.value = s;
                if (lbl) lbl.innerText = s + '%';
                this.renderRecordingSetupPreview();
            };
        });

        document.querySelectorAll('.btn-rec-border-preset').forEach(btn => {
            btn.onclick = () => {
                const b = btn.dataset.border;
                const rng = document.getElementById('rngWebcamBorder');
                const lbl = document.getElementById('lblWebcamBorder');
                if (rng) rng.value = b;
                if (lbl) lbl.innerText = b + 'px';
                this.renderRecordingSetupPreview();
            };
        });

        // Interactive Drag-and-Drop & Mousewheel Resizing on the Preview Canvas
        if (previewCanvas) {
            let isDragging = false;
            let dragStartX = 0;
            let dragStartY = 0;

            const getCanvasCoords = (e) => {
                const rect = previewCanvas.getBoundingClientRect();
                const scaleX = previewCanvas.width / rect.width;
                const scaleY = previewCanvas.height / rect.height;
                return {
                    x: (e.clientX - rect.left) * scaleX,
                    y: (e.clientY - rect.top) * scaleY
                };
            };

            previewCanvas.onpointerdown = (e) => {
                const pt = getCanvasCoords(e);
                const b = this.recCurrentOverlayBounds;
                if (b && pt.x >= b.ox && pt.x <= (b.ox + b.ow) && pt.y >= b.oy && pt.y <= (b.oy + b.oh)) {
                    isDragging = true;
                    dragStartX = pt.x - b.ox;
                    dragStartY = pt.y - b.oy;
                    previewCanvas.setPointerCapture(e.pointerId);
                    previewCanvas.style.cursor = 'grabbing';
                }
            };

            previewCanvas.onpointermove = (e) => {
                const pt = getCanvasCoords(e);
                const b = this.recCurrentOverlayBounds;
                if (isDragging && b) {
                    const newOx = Math.max(0, Math.min(previewCanvas.width - b.ow, pt.x - dragStartX));
                    const newOy = Math.max(0, Math.min(previewCanvas.height - b.oh, pt.y - dragStartY));
                    this.recWebcamCustomPos = {
                        x: newOx / previewCanvas.width,
                        y: newOy / previewCanvas.height
                    };
                    this.renderRecordingSetupPreview();
                } else if (b && pt.x >= b.ox && pt.x <= (b.ox + b.ow) && pt.y >= b.oy && pt.y <= (b.oy + b.oh)) {
                    previewCanvas.style.cursor = 'grab';
                } else {
                    previewCanvas.style.cursor = 'default';
                }
            };

            const endDrag = (e) => {
                if (isDragging) {
                    isDragging = false;
                    try { previewCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
                    previewCanvas.style.cursor = 'default';
                }
            };
            previewCanvas.onpointerup = endDrag;
            previewCanvas.onpointercancel = endDrag;

            // Mouse wheel directly resizes webcam scale
            previewCanvas.onwheel = (e) => {
                const pt = getCanvasCoords(e);
                const b = this.recCurrentOverlayBounds;
                if (b && pt.x >= b.ox && pt.x <= (b.ox + b.ow) && pt.y >= b.oy && pt.y <= (b.oy + b.oh)) {
                    e.preventDefault();
                    const rng = document.getElementById('rngWebcamSize');
                    if (rng) {
                        const step = e.deltaY < 0 ? 2 : -2;
                        const nextVal = Math.max(8, Math.min(75, parseInt(rng.value, 10) + step));
                        rng.value = nextVal;
                        const lbl = document.getElementById('lblWebcamSize');
                        if (lbl) lbl.innerText = nextVal + '%';
                        this.renderRecordingSetupPreview();
                    }
                }
            };
        }

        // Close handlers to stop camera preview
        const recordModal = document.getElementById('recordModal');
        if (recordModal) {
            const btnClose = recordModal.querySelector('.modal-close');
            if (btnClose) btnClose.addEventListener('click', () => stopRecSetupPreview());
        }
    }

    renderRecordingSetupPreview() {
        const canvas = document.getElementById('recSetupPreviewCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const cw = canvas.width;
        const ch = canvas.height;

        // 1. Draw Full Scene Background (What will actually be captured)
        if (this.compositor && this.compositor.canvas && this.timeline && this.timeline.clips && this.timeline.clips.length > 0) {
            ctx.drawImage(this.compositor.canvas, 0, 0, cw, ch);
        } else {
            // High-fidelity studio desktop workspace pattern
            const bgGrad = ctx.createLinearGradient(0, 0, cw, ch);
            bgGrad.addColorStop(0, '#0f172a');
            bgGrad.addColorStop(1, '#020617');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, cw, ch);

            // Subtle desktop grid
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.lineWidth = 1;
            for (let x = 0; x < cw; x += 32) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, ch);
                ctx.stroke();
            }
            for (let y = 0; y < ch; y += 32) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(cw, y);
                ctx.stroke();
            }

            // Window Header Bar Mockup
            ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
            ctx.fillRect(0, 0, cw, 22);
            ctx.fillStyle = '#ef4444';
            ctx.beginPath(); ctx.arc(12, 11, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#eab308';
            ctx.beginPath(); ctx.arc(24, 11, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#22c55e';
            ctx.beginPath(); ctx.arc(36, 11, 4, 0, Math.PI * 2); ctx.fill();

            const resVal = document.getElementById('recResolution')?.value || '1920x1080';
            ctx.fillStyle = '#64748b';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Desktop Screen Display (${resVal})`, cw / 2, 15);

            // Studio Center Reticle
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
            ctx.beginPath();
            ctx.arc(cw / 2, ch / 2, 40, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText('Recording Display Area', cw / 2, ch / 2 + 55);
            ctx.restore();
        }

        // 2. Check PiP Webcam Overlay
        const isCamEnabled = document.getElementById('recCameraToggle')?.checked || !!this.recSetupStream;
        if (!isCamEnabled) {
            this.recCurrentOverlayBounds = null;
            return;
        }

        // Read UI Settings
        const shape = document.getElementById('selWebcamShape')?.value || 'circle';
        const pos = document.getElementById('selWebcamPosition')?.value || 'bottom-right';
        const sizeRatio = Math.max(0.08, Math.min(0.75, (parseFloat(document.getElementById('rngWebcamSize')?.value || 22)) / 100));
        const borderWidth = parseInt(document.getElementById('rngWebcamBorder')?.value || 3, 10);
        const borderColor = document.getElementById('colWebcamBorder')?.value || '#38bdf8';
        const hasShadow = document.getElementById('chkWebcamShadow')?.checked ?? true;
        const isMirror = document.getElementById('chkWebcamMirror')?.checked ?? true;

        // Calculate Overlay Coordinates
        const overlayW = Math.round(cw * sizeRatio);
        const overlayH = (shape === 'rect' || shape === 'oval') ? Math.round(overlayW * (9 / 16)) : overlayW;
        const margin = Math.round(Math.min(cw, ch) * 0.04);

        let ox = cw - overlayW - margin;
        let oy = ch - overlayH - margin;

        if (this.recWebcamCustomPos) {
            ox = Math.max(0, Math.min(cw - overlayW, Math.round(this.recWebcamCustomPos.x * cw)));
            oy = Math.max(0, Math.min(ch - overlayH, Math.round(this.recWebcamCustomPos.y * ch)));
        } else if (pos === 'bottom-left') {
            ox = margin;
            oy = ch - overlayH - margin;
        } else if (pos === 'top-right') {
            ox = cw - overlayW - margin;
            oy = margin;
        } else if (pos === 'top-left') {
            ox = margin;
            oy = margin;
        }

        this.recCurrentOverlayBounds = { ox, oy, ow: overlayW, oh: overlayH };

        const cx = ox + overlayW / 2;
        const cy = oy + overlayH / 2;
        const radius = overlayW / 2;

        const buildShapePath = () => {
            ctx.beginPath();
            if (shape === 'circle') {
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            } else if (shape === 'square') {
                const r = Math.round(overlayW * 0.18);
                ctx.moveTo(ox + r, oy);
                ctx.lineTo(ox + overlayW - r, oy);
                ctx.quadraticCurveTo(ox + overlayW, oy, ox + overlayW, oy + r);
                ctx.lineTo(ox + overlayW, oy + overlayH - r);
                ctx.quadraticCurveTo(ox + overlayW, oy + overlayH, ox + overlayW - r, oy + overlayH);
                ctx.lineTo(ox + r, oy + overlayH);
                ctx.quadraticCurveTo(ox, oy + overlayH, ox, oy + overlayH - r);
                ctx.lineTo(ox, oy + r);
                ctx.quadraticCurveTo(ox, oy, ox + r, oy);
            } else if (shape === 'polygon') {
                const sides = 6;
                for (let i = 0; i < sides; i++) {
                    const angle = (i * 2 * Math.PI / sides) - (Math.PI / 2);
                    const px = cx + radius * Math.cos(angle);
                    const py = cy + radius * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
            } else if (shape === 'diamond') {
                ctx.moveTo(cx, oy);
                ctx.lineTo(ox + overlayW, cy);
                ctx.lineTo(cx, oy + overlayH);
                ctx.lineTo(ox, cy);
                ctx.closePath();
            } else if (shape === 'oval') {
                ctx.ellipse(cx, cy, overlayW / 2, overlayH / 2, 0, 0, Math.PI * 2);
            } else {
                ctx.rect(ox, oy, overlayW, overlayH);
            }
        };

        // 3. Drop Shadow
        if (hasShadow) {
            ctx.save();
            buildShapePath();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            ctx.shadowBlur = Math.round(18 * (cw / 640));
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 5;
            ctx.fillStyle = '#000000';
            ctx.fill();
            ctx.restore();
        }

        // 4. Clip & Draw Camera Video Feed or Preview Avatar
        ctx.save();
        buildShapePath();
        ctx.clip();

        if (isMirror) {
            ctx.translate(cx, cy);
            ctx.scale(-1, 1);
            ctx.translate(-cx, -cy);
        }

        const hiddenVid = document.getElementById('recSetupVideoHidden');
        if (this.recSetupStream && hiddenVid && hiddenVid.readyState >= 2) {
            const vw = hiddenVid.videoWidth || 1280;
            const vh = hiddenVid.videoHeight || 720;
            const vAspect = vw / vh;
            const oAspect = overlayW / overlayH;
            let sw = vw, sh = vh, sx = 0, sy = 0;
            if (vAspect > oAspect) {
                sw = vh * oAspect;
                sx = (vw - sw) / 2;
            } else {
                sh = vw / oAspect;
                sy = (vh - sh) / 2;
            }
            ctx.drawImage(hiddenVid, sx, sy, sw, sh, ox, oy, overlayW, overlayH);
        } else {
            // Live Preview Avatar with Camera Silhouette
            const camGrad = ctx.createLinearGradient(ox, oy, ox + overlayW, oy + overlayH);
            camGrad.addColorStop(0, '#1e293b');
            camGrad.addColorStop(1, '#090d16');
            ctx.fillStyle = camGrad;
            ctx.fillRect(ox, oy, overlayW, overlayH);

            ctx.fillStyle = '#38bdf8';
            ctx.font = `${Math.round(overlayW * 0.28)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📷', cx, cy - Math.round(overlayW * 0.07));

            ctx.fillStyle = '#f1f5f9';
            ctx.font = `bold ${Math.max(9, Math.round(overlayW * 0.09))}px Inter, sans-serif`;
            ctx.fillText('Webcam PiP', cx, cy + Math.round(overlayW * 0.18));
            ctx.fillStyle = '#94a3b8';
            ctx.font = `${Math.max(8, Math.round(overlayW * 0.07))}px Inter, sans-serif`;
            ctx.fillText(shape.toUpperCase(), cx, cy + Math.round(overlayW * 0.30));
        }
        ctx.restore();

        // 5. Border
        if (borderWidth > 0) {
            ctx.save();
            buildShapePath();
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = Math.max(1, Math.round(borderWidth * (cw / 1920)));
            ctx.stroke();
            ctx.restore();
        }

        // 6. Size indicator badge on overlay
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.beginPath();
        ctx.roundRect(ox + 4, oy + 4, 34, 15, 3);
        ctx.fill();
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(sizeRatio * 100)}%`, ox + 21, oy + 12);
        ctx.restore();
    }

    async populateRecordingDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioSelect = document.getElementById('recAudioDevice');
            const camSelect = document.getElementById('recCameraDevice');

            if (audioSelect) {
                audioSelect.innerHTML = '<option value="default">Default System Microphone</option>';
                const mics = devices.filter(d => d.kind === 'audioinput');
                mics.forEach((m, idx) => {
                    const opt = document.createElement('option');
                    opt.value = m.deviceId;
                    opt.innerText = m.label || `Microphone ${idx + 1}`;
                    audioSelect.appendChild(opt);
                });
            }

            if (camSelect) {
                camSelect.innerHTML = '<option value="default">Default System Webcam</option>';
                const cams = devices.filter(d => d.kind === 'videoinput');
                cams.forEach((c, idx) => {
                    const opt = document.createElement('option');
                    opt.value = c.deviceId;
                    opt.innerText = c.label || `Camera ${idx + 1}`;
                    camSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.warn('Could not enumerate media devices:', err);
        }
    }

    async startRecording() {
        const resolution = document.getElementById('recResolution')?.value || '1920x1080';
        const includeMic = document.getElementById('recMicToggle')?.checked ?? true;
        const audioDeviceId = document.getElementById('recAudioDevice')?.value || 'default';
        const includeSystemAudio = document.getElementById('recSystemAudioToggle')?.checked ?? true;
        const trackCursor = document.getElementById('recCursorToggle')?.checked ?? true;
        const includeCamera = document.getElementById('recCameraToggle')?.checked ?? false;
        const cameraDeviceId = document.getElementById('recCameraDevice')?.value || 'default';

        const recordBtn = document.getElementById('btnOpenRecordModal');
        recordBtn.innerText = '⏹ Stop';
        recordBtn.style.animation = 'pulse 1s infinite';

        try {
            const webcamShape = document.getElementById('selWebcamShape')?.value || 'circle';
            const webcamPosition = document.getElementById('selWebcamPosition')?.value || 'bottom-right';
            const webcamSize = (parseFloat(document.getElementById('rngWebcamSize')?.value || 22)) / 100;
            const webcamBorderWidth = parseInt(document.getElementById('rngWebcamBorder')?.value || 3, 10);
            const webcamBorderColor = document.getElementById('colWebcamBorder')?.value || '#38bdf8';
            const webcamShadow = document.getElementById('chkWebcamShadow')?.checked ?? true;
            const webcamMirror = document.getElementById('chkWebcamMirror')?.checked ?? true;
            const webcamCustomPos = this.recWebcamCustomPos;

            await this.recorder.start({
                resolution,
                includeMic,
                audioDeviceId,
                includeSystemAudio,
                trackCursor,
                includeCamera,
                cameraDeviceId,
                webcamShape,
                webcamPosition: webcamCustomPos ? 'custom' : webcamPosition,
                webcamCustomPos,
                webcamSize,
                webcamBorderWidth,
                webcamBorderColor,
                webcamShadow,
                webcamMirror
            });

            // Start Live Studio Recording Monitor on preview canvas
            if (this.recorder.isRecording && this.recorder.stream) {
                const liveVideo = document.createElement('video');
                liveVideo.muted = true;
                liveVideo.autoplay = true;
                liveVideo.playsInline = true;
                liveVideo.srcObject = this.recorder.stream;
                try {
                    await liveVideo.play();
                } catch (_) {}

                const startRecTime = performance.now();
                const recLoop = () => {
                    if (!this.recorder.isRecording) {
                        try {
                            liveVideo.pause();
                            liveVideo.srcObject = null;
                        } catch (_) {}
                        this.compositor.renderFrame(this.timeline, this.playheadTime);
                        return;
                    }

                    const canvas = this.compositor.canvas;
                    const ctx = this.compositor.ctx;
                    const { width, height } = canvas;

                    // 1. Draw Live Screen/Webcam Feed
                    ctx.fillStyle = '#0b0d11';
                    ctx.fillRect(0, 0, width, height);

                    if (liveVideo.videoWidth > 0 && liveVideo.videoHeight > 0) {
                        const aspect = liveVideo.videoWidth / liveVideo.videoHeight;
                        const cAspect = width / height;
                        let dw, dh, dx, dy;
                        if (aspect > cAspect) {
                            dw = width;
                            dh = width / aspect;
                            dx = 0;
                            dy = (height - dh) / 2;
                        } else {
                            dh = height;
                            dw = height * aspect;
                            dx = (width - dw) / 2;
                            dy = 0;
                        }
                        ctx.drawImage(liveVideo, dx, dy, dw, dh);
                    } else if (this.recorder.compositeCanvas) {
                        ctx.drawImage(this.recorder.compositeCanvas, 0, 0, width, height);
                    }

                    // 2. Render Studio Live Recording HUD Badge
                    const elapsedSec = Math.floor((performance.now() - startRecTime) / 1000);
                    const recMin = Math.floor(elapsedSec / 60);
                    const recSec = elapsedSec % 60;
                    const timeStr = `${String(recMin).padStart(2, '0')}:${String(recSec).padStart(2, '0')}`;

                    ctx.save();
                    ctx.shadowColor = 'rgba(0,0,0,0.6)';
                    ctx.shadowBlur = 10;
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(24, 24, 150, 36, 18);
                    else ctx.rect(24, 24, 150, 36);
                    ctx.fill();

                    const blink = Math.sin(performance.now() / 250) > 0;
                    ctx.fillStyle = blink ? '#ffffff' : '#fca5a5';
                    ctx.beginPath();
                    ctx.arc(44, 42, 6, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(`REC ${timeStr}`, 58, 42);
                    ctx.restore();

                    requestAnimationFrame(recLoop);
                };
                requestAnimationFrame(recLoop);
            }
        } catch (err) {
            recordBtn.innerText = '⏺ Record';
            recordBtn.style.animation = 'none';
        }
    }

    async stopRecording() {
        const recordBtn = document.getElementById('btnOpenRecordModal');
        recordBtn.innerText = '⏺ Record';
        recordBtn.style.animation = 'none';

        const result = await this.recorder.stop();
        if (!result) return;

        const dur = Math.max(1.0, result.duration);
        const clipTitle = `Capture_${new Date().toLocaleTimeString().replace(/:/g, '-')}.webm`;
        this.timeline.addClip({
            title: clipTitle,
            type: 'video',
            trackId: 2,
            startTime: this.playheadTime,
            duration: dur,
            sourceUrl: result.videoUrl,
            telemetry: result.telemetry
        });

        // Add to Media Bin & Captures
        this.addMediaToBin({
            id: `rec_${Date.now()}`,
            name: clipTitle,
            type: 'video',
            duration: dur,
            url: result.videoUrl,
            telemetry: result.telemetry,
            sub: 'Recorded Screen / Webcam Capture'
        });

        this.renderTimeline();
        this.updateTimelineRuler();
        this.markDirty(true);
    }

    handleFileImport(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        for (const file of files) {
            const url = URL.createObjectURL(file);
            const isAudio = file.type.startsWith('audio');
            const mediaType = isAudio ? 'audio' : 'video';

            // Probe duration
            const probe = document.createElement(isAudio ? 'audio' : 'video');
            probe.preload = 'metadata';
            probe.src = url;
            probe.onloadedmetadata = () => {
                const dur = (probe.duration && isFinite(probe.duration)) ? Math.max(1.0, parseFloat(probe.duration.toFixed(2))) : 10.0;
                this.addMediaToBin({
                    id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    name: file.name,
                    type: mediaType,
                    duration: dur,
                    url: url,
                    sub: `${(file.size / (1024 * 1024)).toFixed(1)} MB • ${mediaType.toUpperCase()}`
                });

                this.timeline.addClip({
                    title: file.name,
                    type: mediaType,
                    trackId: isAudio ? 1 : 2,
                    startTime: this.playheadTime,
                    duration: dur,
                    sourceUrl: url
                });

                this.renderTimeline();
                this.updateTimelineRuler();
                this.markDirty(true);
            };
            probe.onerror = () => {
                this.addMediaToBin({
                    id: `file_${Date.now()}`,
                    name: file.name,
                    type: mediaType,
                    duration: 10.0,
                    url: url,
                    sub: `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                });

                this.timeline.addClip({
                    title: file.name,
                    type: mediaType,
                    trackId: isAudio ? 1 : 2,
                    startTime: this.playheadTime,
                    duration: 10.0,
                    sourceUrl: url
                });

                this.renderTimeline();
                this.updateTimelineRuler();
                this.markDirty(true);
            };
        }
        e.target.value = '';
    }

    addMediaToBin(item) {
        if (!this.mediaBin) this.mediaBin = [];
        if (!item.id) item.id = `media_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        this.mediaBin.unshift(item);
        this.renderMediaBin();
    }

    renderMediaBin() {
        const mediaList = document.getElementById('mediaList');
        if (!mediaList) return;
        mediaList.innerHTML = '';

        if (!this.mediaBin || this.mediaBin.length === 0) {
            mediaList.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 24px 12px; border: 1px dashed var(--border-color); border-radius: 6px;">
                    <span style="font-size: 28px; display: block; margin-bottom: 6px;">📁</span>
                    <span>Media Bin is empty.<br>Click <strong>+ Import Media</strong> or record screen to add clips.</span>
                </div>
            `;
            return;
        }

        for (const item of this.mediaBin) {
            const card = document.createElement('div');
            card.className = 'studio-card asset-card';
            card.draggable = true;
            card.dataset.toolType = 'media';
            card.dataset.toolName = item.name;
            card.dataset.mediaId = item.id;

            const isVideo = item.type !== 'audio';
            const icon = isVideo ? '🎬' : '🎵';
            const durStr = item.duration ? `${item.duration.toFixed(1)}s` : '10.0s';
            const badgeText = isVideo ? `${durStr} • 1080p` : `${durStr} • Audio`;

            card.innerHTML = `
                <div class="studio-card-preview" style="background: linear-gradient(135deg, ${isVideo ? '#1e293b, #0f172a' : '#064e3b, #022c22'});">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <span style="font-size: 24px;">${icon}</span>
                        <span style="font-size: 9.5px; font-weight: 700; color: #38bdf8; background: rgba(0,0,0,0.6); padding: 1px 6px; border-radius: 3px;">${badgeText}</span>
                    </div>
                </div>
                <div class="studio-card-info">
                    <div class="studio-card-title" title="${item.name}">${item.name}</div>
                    <div class="studio-card-desc">${item.sub || (isVideo ? 'Video Media Asset' : 'Audio Track Asset')}</div>
                    <span class="studio-card-badge">${isVideo ? 'VIDEO CLIP' : 'AUDIO TRACK'}</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
                    <div class="studio-card-apply-badge" data-action="add-to-timeline" title="Add to timeline at playhead">+ Add</div>
                    <button type="button" class="btn-bin-del" data-action="del-bin-item" style="background: transparent; border: none; color: #ef4444; font-size: 11px; cursor: pointer; padding: 2px 4px;" title="Remove from Bin">🗑️</button>
                </div>
            `;

            card.ondragstart = (e) => {
                const data = {
                    toolType: 'media',
                    toolName: item.name,
                    mediaId: item.id,
                    url: item.url,
                    duration: item.duration || 10.0,
                    mediaType: item.type || 'video'
                };
                e.dataTransfer.setData('text/plain', JSON.stringify(data));
                e.dataTransfer.effectAllowed = 'copy';
                card.classList.add('dragging-card');
            };
            card.ondragend = () => card.classList.remove('dragging-card');

            card.onclick = (e) => {
                if (e.target.closest('[data-action="del-bin-item"]')) {
                    e.stopPropagation();
                    this.mediaBin = this.mediaBin.filter(m => m.id !== item.id);
                    this.renderMediaBin();
                    return;
                }
                this.addMediaClipToTimeline(item);
            };

            mediaList.appendChild(card);
        }
    }

    addMediaClipToTimeline(item) {
        const isAudio = item.type === 'audio';
        const newClip = {
            title: item.name,
            type: isAudio ? 'audio' : 'video',
            trackId: isAudio ? 1 : 2,
            startTime: this.playheadTime,
            duration: item.duration || 10.0,
            sourceUrl: item.url || '',
            telemetry: item.telemetry || null,
            scale: 1.0,
            scaleX: 1.0,
            scaleY: 1.0,
            xOffset: 0,
            yOffset: 0,
            aspectRatioLocked: true
        };
        this.timeline.addClip(newClip);
        const added = this.timeline.clips[this.timeline.clips.length - 1];
        this.timeline.selectedClipId = added.id;
        this.timeline.saveSnapshot();
        this.renderTimeline();
        this.updateTimelineRuler();
        this.renderProperties(added);
        this.compositor.renderFrame(this.timeline, this.playheadTime);
        this.markDirty(true);
    }

    copySelectedClip() {
        if (!this.timeline.selectedClipId) {
            alert('Please select a clip on the timeline first to copy.');
            return;
        }
        const clip = this.timeline.getClip(this.timeline.selectedClipId);
        if (!clip) return;
        const { element, _previewEl, cachedImage, audioBuffer, video, sourceElement, mediaStream, ...clipData } = clip;
        this.clipboardClip = JSON.parse(JSON.stringify(clipData));
        const btn = document.getElementById('btnCopyClip');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<span>✅</span> Copied!';
            setTimeout(() => { btn.innerHTML = orig; }, 1000);
        }
    }

    pasteClip() {
        if (!this.clipboardClip) {
            alert('No clip copied yet. Select a clip on the timeline and press Copy (Ctrl+C).');
            return;
        }
        const newClip = JSON.parse(JSON.stringify(this.clipboardClip));
        newClip.id = `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        newClip.startTime = this.playheadTime;
        if (newClip.title && !newClip.title.includes('(Copy)')) {
            newClip.title = `${newClip.title} (Copy)`;
        }
        this.timeline.addClip(newClip);
        this.timeline.selectedClipId = newClip.id;
        this.timeline.saveSnapshot();
        this.renderTimeline();
        this.updateTimelineRuler();
        this.renderProperties(newClip);
        this.compositor.renderFrame(this.timeline, this.playheadTime);
        this.markDirty(true);
        const btn = document.getElementById('btnPasteClip');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<span>✅</span> Pasted!';
            setTimeout(() => { btn.innerHTML = orig; }, 1000);
        }
    }

    markDirty(dirty = true) {
        this.isDirty = Boolean(dirty);
        if (window.rpaNative && window.rpaNative.setDirtyState) {
            window.rpaNative.setDirtyState(this.isDirty);
        }
    }

    splitSelectedClip() {
        if (!this.timeline.selectedClipId) {
            alert('Please select a clip on the timeline first.');
            return;
        }
        const secondClip = this.timeline.splitClip(this.timeline.selectedClipId, this.playheadTime);
        if (secondClip) {
            this.timeline.selectedClipId = secondClip.id;
            this.renderProperties(secondClip);
        }
        this.renderTimeline();
        this.updateTimelineRuler();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    deleteSelectedClip() {
        if (this.timeline.selectedClipId) {
            this.timeline.removeClip(this.timeline.selectedClipId);
            this.timeline.selectedClipId = null;
            this.renderProperties(null);
            this.renderTimeline();
            this.updateTimelineRuler();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        }
    }

    togglePlayback() {
        this.isPlaying = !this.isPlaying;
        document.getElementById('btnPlayPause').innerText = this.isPlaying ? '⏸' : '▶';
        if (this.isPlaying) {
            this.lastFrameTimestamp = performance.now();
        } else {
            this.compositor.stopAllMedia();
        }
        this.compositor.syncMediaPlayback(this.timeline, this.playheadTime, this.isPlaying);
        this.compositor.renderFrame(this.timeline, this.playheadTime, this.isPlaying);
    }

    seek(time) {
        this.playheadTime = Math.max(0, Math.min(this.timeline.totalDuration, time));
        this.updatePlayheadPosition();
        this.compositor.renderFrame(this.timeline, this.playheadTime, this.isPlaying);
        this.compositor.syncMediaPlayback(this.timeline, this.playheadTime, this.isPlaying);
    }

    updatePlayheadPosition() {
        const leftPx = this.playheadTime * this.timeline.pixelsPerSecond;
        const playheadEl = document.getElementById('playhead');
        if (playheadEl) {
            playheadEl.style.left = '0px';
            playheadEl.style.transform = `translate3d(${leftPx + 140}px, 0, 0)`;
        }

        const mins = Math.floor(this.playheadTime / 60);
        const secs = Math.floor(this.playheadTime % 60);
        const centis = Math.floor((this.playheadTime % 1) * 100);
        const lblTime = document.getElementById('lblTimecode');
        if (lblTime) {
            lblTime.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
        }

        // Auto-follow playhead during playback
        if (this.isPlaying) {
            const scrollArea = document.getElementById('timelineScrollArea');
            if (scrollArea) {
                const playheadScreenX = leftPx + 140;
                const viewLeft = scrollArea.scrollLeft;
                const viewRight = scrollArea.scrollLeft + scrollArea.clientWidth;
                if (playheadScreenX > viewRight - 40) {
                    scrollArea.scrollLeft = playheadScreenX - 140;
                } else if (playheadScreenX < viewLeft + 140) {
                    scrollArea.scrollLeft = Math.max(0, playheadScreenX - 140);
                }
            }
        }
    }

    updateTimelineRuler() {
        const scrollArea = document.getElementById('timelineScrollArea');
        const ruler = document.getElementById('timelineRuler');
        const tracksContainer = document.getElementById('tracksContainer');
        if (!ruler) return;
        ruler.innerHTML = '';

        const minWidth = Math.max(
            scrollArea ? scrollArea.clientWidth : 1200,
            Math.ceil(this.timeline.totalDuration * this.timeline.pixelsPerSecond) + 380
        );
        ruler.style.width = `${minWidth}px`;
        if (tracksContainer) tracksContainer.style.width = `${minWidth}px`;

        const stepSec = this.timeline.pixelsPerSecond >= 60 ? 1 : (this.timeline.pixelsPerSecond >= 30 ? 2 : 5);
        const fragment = document.createDocumentFragment();

        for (let t = 0; t <= this.timeline.totalDuration; t += stepSec) {
            const left = t * this.timeline.pixelsPerSecond + 140;
            const tick = document.createElement('div');
            tick.className = 'ruler-tick';
            tick.style.left = `${left}px`;

            const label = document.createElement('div');
            label.className = 'ruler-label';
            label.style.left = `${left}px`;
            label.innerText = `${t}s`;

            fragment.appendChild(tick);
            fragment.appendChild(label);
        }

        // Render Markers
        for (const m of (this.timeline.markers || [])) {
            const left = m.time * this.timeline.pixelsPerSecond + 140;
            const markerEl = document.createElement('div');
            markerEl.className = 'timeline-marker';
            markerEl.style.left = `${left - 5}px`;
            markerEl.title = `${m.label} (${m.time.toFixed(1)}s)`;
            markerEl.onclick = (e) => {
                e.stopPropagation();
                this.seek(m.time);
            };
            fragment.appendChild(markerEl);
        }

        ruler.appendChild(fragment);
    }

    renderTimeline() {
        this.updateTimelineRuler();
        this.timeline.render(document.getElementById('tracksContainer'), (selectedClip) => {
            this.renderProperties(selectedClip);
        });
        const currentSelected = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
        this.renderProperties(currentSelected);
        this.updatePlayheadPosition();
        this.updateUndoRedoUI();
    }

    getCalloutSubtype(toolName) {
        if (!toolName) return 'title';
        const name = toolName.toLowerCase();
        if (name.includes('plain text') || name === 'text' || name.includes('plain-text')) return 'text';
        if (name.includes('title')) return 'title';
        if (name.includes('speech')) return 'speech';
        if (name.includes('thought')) return 'thought';
        if (name.includes('lower third') || name.includes('lower-third')) return 'lower-third';
        if (name.includes('double arrow')) return 'double-arrow';
        if (name.includes('arrow')) return 'arrow';
        if (name.includes('highlight')) return 'highlight';
        if (name.includes('rectangle')) return 'rectangle';
        if (name.includes('circle shape') || name === 'circle') return 'circle';
        if (name.includes('spotlight')) return 'spotlight';
        if (name.includes('blur')) return 'blur';
        if (name.includes('pixelate') || name.includes('censor')) return 'pixelate';
        if (name.includes('sketch circle')) return 'sketch-circle';
        if (name.includes('sketch arrow')) return 'sketch-arrow';
        if (name.includes('sketch check')) return 'sketch-check';
        if (name.includes('keystroke')) return 'keystroke';
        return 'title';
    }

    getCalloutDefaults(toolName) {
        const subtype = this.getCalloutSubtype(toolName);
        const map = {
            'text': {
                scaleX: 0.50, scaleY: 0.12, xOffset: 0, yOffset: 0,
                color: '#ffffff', fontSize: 38,
                text: 'Enter Text Here', subText: ''
            },
            'title': {
                scaleX: 0.70, scaleY: 0.14, xOffset: 0, yOffset: -380,
                color: '#3b82f6', fontSize: 32,
                text: 'RPA AUTOMATION WORKFLOW', subText: ''
            },
            'speech': {
                scaleX: 0.38, scaleY: 0.20, xOffset: -160, yOffset: -120,
                color: '#2563eb', fontSize: 24,
                text: 'Important Step Here!', subText: ''
            },
            'thought': {
                scaleX: 0.40, scaleY: 0.22, xOffset: -160, yOffset: -130,
                color: '#6366f1', fontSize: 24,
                text: 'Analyzing workflow...', subText: ''
            },
            'lower-third': {
                scaleX: 0.55, scaleY: 0.16, xOffset: -300, yOffset: 340,
                color: '#10b981', fontSize: 26,
                text: 'RPA Video Editor Studio', subText: 'Automated Screen Recording & Editing'
            },
            'arrow': {
                scaleX: 0.35, scaleY: 0.16, xOffset: 120, yOffset: 60,
                color: '#ef4444', fontSize: 24,
                text: '', subText: ''
            },
            'double-arrow': {
                scaleX: 0.45, scaleY: 0.15, xOffset: 0, yOffset: 100,
                color: '#f59e0b', fontSize: 24,
                text: '', subText: ''
            },
            'rectangle': {
                scaleX: 0.36, scaleY: 0.22, xOffset: 100, yOffset: 50,
                color: '#eab308', fontSize: 24,
                text: '', subText: ''
            },
            'highlight': {
                scaleX: 0.38, scaleY: 0.08, xOffset: 0, yOffset: 0,
                color: '#eab308', fontSize: 24,
                text: '', subText: ''
            },
            'circle': {
                scaleX: 0.26, scaleY: 0.26, xOffset: 80, yOffset: -40,
                color: '#ef4444', fontSize: 24,
                text: '', subText: ''
            },
            'spotlight': {
                scaleX: 0.34, scaleY: 0.34, xOffset: 0, yOffset: 0,
                color: '#ffffff', fontSize: 24,
                text: '', subText: ''
            },
            'blur': {
                scaleX: 0.32, scaleY: 0.12, xOffset: 0, yOffset: 0,
                color: '#38bdf8', fontSize: 22,
                text: '••••••••••••••', subText: ''
            },
            'pixelate': {
                scaleX: 0.32, scaleY: 0.14, xOffset: 0, yOffset: 0,
                color: '#6366f1', fontSize: 24,
                text: '', subText: ''
            },
            'sketch-circle': {
                scaleX: 0.26, scaleY: 0.26, xOffset: 50, yOffset: -50,
                color: '#ef4444', fontSize: 24,
                text: '', subText: ''
            },
            'sketch-arrow': {
                scaleX: 0.34, scaleY: 0.20, xOffset: 80, yOffset: 40,
                color: '#f59e0b', fontSize: 24,
                text: '', subText: ''
            },
            'sketch-check': {
                scaleX: 0.24, scaleY: 0.24, xOffset: -100, yOffset: 50,
                color: '#22c55e', fontSize: 24,
                text: '', subText: ''
            },
            'keystroke': {
                scaleX: 0.28, scaleY: 0.12, xOffset: 0, yOffset: 350,
                color: '#3b82f6', fontSize: 26,
                text: 'Ctrl + C', subText: ''
            }
        };
        const def = map[subtype] || map['title'];
        return { subtype, ...def };
    }

    applySpanStyle(clip, start, end, style) {
        if (!clip || start === undefined || end === undefined || start >= end) return;
        if (!Array.isArray(clip.textSpans)) clip.textSpans = [];

        // Find existing style in the range to preserve properties
        const existing = clip.textSpans.find(s => (s.start <= start && s.end >= end) || (start <= s.start && end >= s.end));
        const mergedStyle = existing ? { ...existing, ...style, start, end } : { start, end, ...style };

        const updatedSpans = [];
        for (const sp of clip.textSpans) {
            if (sp.end <= start || sp.start >= end) {
                updatedSpans.push(sp);
            } else if (sp.start < start && sp.end > end) {
                updatedSpans.push({ ...sp, end: start });
                updatedSpans.push({ ...sp, start: end });
            } else if (sp.start < start && sp.end <= end) {
                updatedSpans.push({ ...sp, end: start });
            } else if (sp.start >= start && sp.end > end) {
                updatedSpans.push({ ...sp, start: end });
            }
        }

        updatedSpans.push(mergedStyle);
        updatedSpans.sort((a, b) => a.start - b.start);
        clip.textSpans = updatedSpans;
    }

    getSpanProperty(clip, start, end, prop) {
        if (!clip || !Array.isArray(clip.textSpans)) return clip[prop];
        for (const sp of clip.textSpans) {
            if (sp.start <= start && sp.end >= end && sp[prop] !== undefined) {
                return sp[prop];
            }
        }
        return clip[prop];
    }

    openCanvasInlineEditor(clip) {
        const editor = document.getElementById('canvasInlineTextEditor');
        const container = document.getElementById('canvasContainer');
        const canvas = this.compositor ? this.compositor.canvas : null;
        if (!editor || !container || !canvas || !clip || clip.type !== 'callout') return;

        const bounds = this.compositor.getClipCanvasBounds(clip);
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const scaleX = canvasRect.width / canvas.width;
        const scaleY = canvasRect.height / canvas.height;

        const left = (canvasRect.left - containerRect.left) + (bounds.cx - bounds.width / 2) * scaleX;
        const top = (canvasRect.top - containerRect.top) + (bounds.cy - bounds.height / 2) * scaleY;
        const width = Math.max(140, bounds.width * scaleX);
        const height = Math.max(50, bounds.height * scaleY);

        editor.style.left = `${Math.round(left)}px`;
        editor.style.top = `${Math.round(top)}px`;
        editor.style.width = `${Math.round(width)}px`;
        editor.style.height = `${Math.round(height)}px`;
        editor.style.fontSize = `${Math.max(14, Math.round((clip.fontSize || 28) * scaleY))}px`;
        editor.style.fontFamily = clip.fontFamily || "'Inter', sans-serif";
        editor.style.fontWeight = clip.fontWeight || 'bold';
        editor.style.color = clip.color || '#ffffff';
        editor.style.textAlign = 'center';
        editor.style.transform = `rotate(${bounds.rotation || 0}deg)`;
        editor.style.transformOrigin = 'center center';

        editor.value = clip.text !== undefined ? clip.text : '';
        editor.classList.remove('hidden');
        editor.focus();
        editor.select();

        const updateWordSelectionFrom = (inputEl) => {
            if (!inputEl) return;
            const badge = document.getElementById('selectionStatusBadge');
            const lblInfo = document.getElementById('lblSelectedWordInfo');
            const sStart = inputEl.selectionStart;
            const sEnd = inputEl.selectionEnd;

            if (sStart !== undefined && sEnd !== undefined && sStart !== sEnd) {
                const selText = inputEl.value.substring(sStart, sEnd);
                this.activeWordSelection = {
                    clipId: clip.id,
                    start: sStart,
                    end: sEnd,
                    text: selText
                };
                if (badge) badge.classList.remove('hidden');
                if (lblInfo) lblInfo.innerText = `Selected: "${selText}" (Chars ${sStart}-${sEnd}) — Color & Font apply to selection`;
            } else if (document.activeElement === inputEl && sStart === sEnd) {
                this.activeWordSelection = null;
                if (badge) badge.classList.add('hidden');
            }
        };

        editor.oninput = () => {
            clip.text = editor.value;
            const propText = document.getElementById('propText');
            if (propText) propText.value = editor.value;
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        editor.onselect = () => updateWordSelectionFrom(editor);
        editor.onkeyup = () => updateWordSelectionFrom(editor);
        editor.onpointerup = () => updateWordSelectionFrom(editor);

        const closeEditor = () => {
            if (!editor.classList.contains('hidden')) {
                editor.classList.add('hidden');
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            }
        };

        editor.onblur = () => closeEditor();
        editor.onkeydown = (e) => {
            if (e.key === 'Escape') {
                closeEditor();
            }
        };
    }

    renderProperties(selectedClip) {
        const emptyState = document.getElementById('inspectorEmptyState');
        const clipControls = document.getElementById('inspectorClipControls');
        if (!selectedClip) {
            if (emptyState) emptyState.style.display = 'block';
            if (clipControls) clipControls.style.display = 'none';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';
        if (clipControls) clipControls.style.display = 'block';

        // Context-Aware Inspector Section Filtering
        const cType = selectedClip.type; // 'callout' | 'video' | 'audio' | 'sfx' | 'image'
        const isCallout = (cType === 'callout');
        const isVideo = (cType === 'video');
        const isAudio = (cType === 'audio' || cType === 'sfx');
        const isImage = (cType === 'image');
        const isVisual = (isCallout || isVideo || isImage);

        // Update Active Clip Type Badge
        const typeBadge = document.getElementById('lblActiveClipTypeBadge');
        if (typeBadge) typeBadge.innerText = (selectedClip.title || cType).toUpperCase();

        const selSubMenu = document.getElementById('selPropertiesSubMenu');
        let subMenuVal = selSubMenu ? selSubMenu.value : 'all';

        // Filter / adjust sub-menu options based on clip capabilities
        const optionValidity = {
            'all': true,
            'callout': isCallout,
            'transform': isVisual,
            'timing': true,
            'behaviors': isCallout || (selectedClip.behavior && selectedClip.behavior !== 'none'),
            'animations': isVideo || isCallout || isImage,
            'visual': isVideo || isImage,
            'audio': isVideo || isAudio,
            'transitions': isVideo || isCallout || isImage
        };

        if (selSubMenu) {
            Array.from(selSubMenu.options).forEach(opt => {
                const isValid = optionValidity[opt.value] !== false;
                opt.style.display = isValid ? '' : 'none';
                opt.disabled = !isValid;
            });

            // If current sub-menu value is invalid for this clip type, auto reset
            if (subMenuVal !== 'all' && !optionValidity[subMenuVal]) {
                subMenuVal = isCallout ? 'callout' : (isAudio ? 'audio' : 'all');
                selSubMenu.value = subMenuVal;
            }
        }

        const isSub = (name) => (subMenuVal === 'all' || subMenuVal === name);

        const setSectionVisible = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? 'block' : 'none';
        };

        setSectionVisible('sectionClipTiming', isSub('timing') && true);
        setSectionVisible('sectionClipSpeed', isSub('timing') && (isVideo || isAudio));
        setSectionVisible('sectionCalloutProps', isSub('callout') && isCallout);
        setSectionVisible('sectionTransformProps', isSub('transform') && isVisual);
        setSectionVisible('sectionBehaviors', isSub('behaviors') && (isCallout || (selectedClip.behavior && selectedClip.behavior !== 'none')));
        setSectionVisible('sectionAnimationProps', isSub('animations') && (isVideo || isCallout || isImage));
        setSectionVisible('sectionVisualEffects', isSub('visual') && (isVideo || isImage));
        setSectionVisible('sectionAudioProps', isSub('audio') && (isVideo || isAudio));
        setSectionVisible('sectionTransitions', isSub('transitions') && (isVideo || isCallout || isImage));

        const setFxRange = (id, lblId, val, unit) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
            const lbl = document.getElementById(lblId);
            if (lbl) lbl.innerText = `${val}${unit}`;
        };

        // 1. Timing & Title
        const propTitle = document.getElementById('propTitle');
        if (propTitle) propTitle.value = selectedClip.title || '';
        const propStart = document.getElementById('propStart');
        if (propStart) propStart.value = (selectedClip.startTime || 0).toFixed(1);
        const propDuration = document.getElementById('propDuration');
        if (propDuration) propDuration.value = (selectedClip.duration || 0).toFixed(1);

        // 2. Callout & Annotation Properties
        const secCallout = document.getElementById('sectionCalloutProps');
        if (secCallout) secCallout.style.display = selectedClip.type === 'callout' ? 'block' : 'none';
        
        const subtype = selectedClip.subtype || this.getCalloutSubtype(selectedClip.title) || 'title';
        const propCalloutSubtype = document.getElementById('propCalloutSubtype');
        if (propCalloutSubtype) propCalloutSubtype.value = subtype;

        const propText = document.getElementById('propText');
        if (propText) propText.value = selectedClip.text !== undefined ? selectedClip.text : '';

        const propSubText = document.getElementById('propSubText');
        if (propSubText) propSubText.value = selectedClip.subText !== undefined ? selectedClip.subText : '';

        const groupSubText = document.getElementById('groupCalloutSubText');
        if (groupSubText) groupSubText.style.display = (subtype === 'lower-third') ? 'block' : 'none';

        const propCalloutColor = document.getElementById('propCalloutColor');
        if (propCalloutColor) propCalloutColor.value = selectedClip.color || '#3b82f6';

        const propFontSize = document.getElementById('propFontSize');
        if (propFontSize) propFontSize.value = selectedClip.fontSize || 28;

        // Typography & Callout controls
        const propFontFamily = document.getElementById('propFontFamily');
        if (propFontFamily) propFontFamily.value = selectedClip.fontFamily || "'Inter', sans-serif";
        const propFontWeight = document.getElementById('propFontWeight');
        if (propFontWeight) propFontWeight.value = selectedClip.fontWeight || 'bold';
        const propLetterCase = document.getElementById('propLetterCase');
        if (propLetterCase) propLetterCase.value = selectedClip.letterCase || 'default';
        const propFillType = document.getElementById('propFillType');
        if (propFillType) propFillType.value = selectedClip.fillType || 'solid';

        const btnTextUnderline = document.getElementById('btnTextUnderline');
        
        // Sync Horizontal & Vertical Text Alignment Dropdowns
        const selTextAlign = document.getElementById('selTextAlign');
        if (selTextAlign) selTextAlign.value = selectedClip.textAlign || 'center';

        const selTextVAlign = document.getElementById('selTextVAlign');
        if (selTextVAlign) selTextVAlign.value = selectedClip.verticalAlign || 'middle';

        if (btnTextUnderline) btnTextUnderline.classList.toggle('active', !!selectedClip.underline);
        const btnTextStrikethrough = document.getElementById('btnTextStrikethrough');
        if (btnTextStrikethrough) btnTextStrikethrough.classList.toggle('active', !!selectedClip.strikeThrough);

        if (this.activeWordSelection && this.activeWordSelection.clipId !== selectedClip.id) {
            this.activeWordSelection = null;
            const badge = document.getElementById('selectionStatusBadge');
            if (badge) badge.classList.add('hidden');
        }

        setFxRange('propTracking', 'lblTracking', selectedClip.tracking || 0, 'px');
        setFxRange('propLineSpacing', 'lblLineSpacing', Math.round((selectedClip.lineSpacing !== undefined ? selectedClip.lineSpacing : 1.2) * 10) / 10, 'x');

        const propOutlineColor = document.getElementById('propOutlineColor');
        if (propOutlineColor) propOutlineColor.value = selectedClip.outlineColor || '#000000';
        setFxRange('propOutlineThickness', 'lblOutlineThickness', selectedClip.outlineThickness || 0, 'px');
        const propOutlineJoin = document.getElementById('propOutlineJoin');
        if (propOutlineJoin) propOutlineJoin.value = selectedClip.outlineJoin || 'round';
        setFxRange('propOutlineOpacity', 'lblOutlineOpacity', selectedClip.outlineOpacity !== undefined ? selectedClip.outlineOpacity : 100, '%');

        const propTextGlowColor = document.getElementById('propTextGlowColor');
        if (propTextGlowColor) propTextGlowColor.value = selectedClip.glowColor || '#00f2fe';
        setFxRange('propTextGlowBlur', 'lblTextGlowBlur', selectedClip.glowBlur || 0, 'px');
        setFxRange('propTextGlowIntensity', 'lblTextGlowIntensity', selectedClip.glowIntensity !== undefined ? selectedClip.glowIntensity : 2, 'x');
        setFxRange('propTextGlowOpacity', 'lblTextGlowOpacity', selectedClip.glowOpacity !== undefined ? selectedClip.glowOpacity : 100, '%');

        const propTextShadowColor = document.getElementById('propTextShadowColor');
        if (propTextShadowColor) propTextShadowColor.value = selectedClip.shadowColor || '#000000';
        setFxRange('propTextShadowBlur', 'lblTextShadowBlur', selectedClip.shadowBlur || 0, 'px');
        setFxRange('propTextShadowOffsetX', 'lblTextShadowOffsetX', selectedClip.shadowOffsetX !== undefined ? selectedClip.shadowOffsetX : 0, 'px');
        setFxRange('propTextShadowOffsetY', 'lblTextShadowOffsetY', selectedClip.shadowOffsetY !== undefined ? selectedClip.shadowOffsetY : 6, 'px');
        setFxRange('propTextShadowOpacity', 'lblTextShadowOpacity', selectedClip.shadowOpacity !== undefined ? selectedClip.shadowOpacity : 85, '%');

        // 3. Transitions
        const selTransitionIn = document.getElementById('selTransitionIn');
        if (selTransitionIn) selTransitionIn.value = selectedClip.transitionIn || 'none';
        const selTransitionOut = document.getElementById('selTransitionOut');
        if (selTransitionOut) selTransitionOut.value = selectedClip.transitionOut || 'none';
        const transDur = selectedClip.transitionInDuration !== undefined ? selectedClip.transitionInDuration : 0.8;
        const rngTransDur = document.getElementById('rngTransitionDuration');
        if (rngTransDur) rngTransDur.value = Math.round(transDur * 10);
        const lblTransDur = document.getElementById('lblTransitionDur');
        if (lblTransDur) lblTransDur.innerText = `${transDur.toFixed(1)}s`;

        // Intermediate Transitions in Inspector
        const intermediateTransList = document.getElementById('inspectorIntermediateTransitions');
        const intermediateTransCount = document.getElementById('lblIntermediateTransCount');
        const intermediateTransitions = Array.isArray(selectedClip.transitions) ? selectedClip.transitions : [];
        if (intermediateTransCount) {
            intermediateTransCount.innerText = `${intermediateTransitions.length} active`;
        }
        if (intermediateTransList) {
            intermediateTransList.innerHTML = '';
            if (intermediateTransitions.length === 0) {
                intermediateTransList.innerHTML = '<div style="font-size: 9.5px; color: var(--text-muted); font-style: italic; padding: 3px 0;">No intermediate transitions. Drag any transition onto clip content.</div>';
            } else {
                intermediateTransitions.forEach((t, idx) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.35); border-radius: 4px; padding: 4px 6px; font-size: 10px; margin-bottom: 2px;';
                    row.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                            <span style="font-size: 11px;">⚡</span>
                            <span style="font-weight: 600; color: #e9d5ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;">${t.name || t.type}</span>
                            <span style="font-family: monospace; font-size: 9px; color: #c4b5fd;">@${(t.timeOffset || 0).toFixed(1)}s (${(t.duration || 0.8).toFixed(1)}s)</span>
                        </div>
                        <button class="btn-del-intermediate" data-index="${idx}" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 12px; font-weight: bold; line-height: 1; padding: 2px 4px;">✕</button>
                    `;
                    const delBtn = row.querySelector('.btn-del-intermediate');
                    if (delBtn) {
                        delBtn.onclick = (e) => {
                            e.stopPropagation();
                            selectedClip.transitions.splice(idx, 1);
                            this.renderProperties(selectedClip);
                            this.renderTimeline();
                            this.timeline.saveSnapshot();
                            this.compositor.renderFrame(this.timeline, this.playheadTime);
                        };
                    }
                    intermediateTransList.appendChild(row);
                });
            }
        }

        // Callout Font-Targeted Transition Indicator Notice
        const noticeScope = document.getElementById('inspectorTransitionScopeNotice');
        if (noticeScope) {
            noticeScope.style.display = (selectedClip.type === 'callout') ? 'block' : 'none';
        }

        // 4. Studio-Precision Behavior Inspector Controls
        const selBehavior = document.getElementById('selBehavior');
        if (selBehavior) selBehavior.value = selectedClip.behavior || 'none';
        const behPanel = document.getElementById('behaviorPropertiesPanel');
        if (behPanel) {
            if (selectedClip.behavior && selectedClip.behavior !== 'none') {
                behPanel.style.display = 'block';
                if (!selectedClip.behaviorProps) {
                    selectedClip.behaviorProps = this.getDefaultBehaviorProps(selectedClip.behavior);
                }
                const bp = selectedClip.behaviorProps;

                // IN phase
                const selInSt = document.getElementById('selBehaviorInStyle');
                if (selInSt) selInSt.value = bp.in?.style || 'bounce';
                const selInTy = document.getElementById('selBehaviorInType');
                if (selInTy) selInTy.value = bp.in?.type || 'ltr';
                const selInMv = document.getElementById('selBehaviorInMovement');
                if (selInMv) selInMv.value = bp.in?.movement || 'bounce';
                const selInDir = document.getElementById('selBehaviorInDirection');
                if (selInDir) selInDir.value = bp.in?.direction || 'right';

                const inBounce = bp.in?.bounce !== undefined ? bp.in.bounce : 40;
                const rngInB = document.getElementById('rngBehaviorInBounce');
                const numInB = document.getElementById('numBehaviorInBounce');
                if (rngInB) rngInB.value = inBounce;
                if (numInB) numInB.value = inBounce;

                const inOff = bp.in?.offset !== undefined ? bp.in.offset : 0.00;
                const rngInOff = document.getElementById('rngBehaviorInOffset');
                const numInOff = document.getElementById('numBehaviorInOffset');
                if (rngInOff) rngInOff.value = Math.round(inOff * 100);
                if (numInOff) numInOff.value = inOff.toFixed(2);

                const lblInParam = document.getElementById('lblBehaviorInParamName');
                if (lblInParam) {
                    const st = bp.in?.style || 'bounce';
                    lblInParam.innerText = (st === 'bounce') ? 'Bounce' : (st === 'pop' ? 'Spring' : 'Speed');
                }

                // DURING phase
                const selDuSt = document.getElementById('selBehaviorDuringStyle');
                if (selDuSt) selDuSt.value = bp.during?.style || 'jump';
                const selDuTy = document.getElementById('selBehaviorDuringType');
                if (selDuTy) selDuTy.value = bp.during?.type || 'ltr';

                const duJump = bp.during?.jump !== undefined ? bp.during.jump : 60.00;
                const rngDuJ = document.getElementById('rngBehaviorDuringJump');
                const numDuJ = document.getElementById('numBehaviorDuringJump');
                if (rngDuJ) rngDuJ.value = Math.round(duJump);
                if (numDuJ) numDuJ.value = duJump.toFixed(2);

                const duLoopTime = bp.during?.loopTime !== undefined ? bp.during.loopTime : 1.00;
                const rngDuLT = document.getElementById('rngBehaviorDuringLoopTime');
                const numDuLT = document.getElementById('numBehaviorDuringLoopTime');
                if (rngDuLT) rngDuLT.value = Math.round(duLoopTime * 100);
                if (numDuLT) numDuLT.value = duLoopTime.toFixed(2);

                const duOff = bp.during?.offset !== undefined ? bp.during.offset : 0.08;
                const rngDuOff = document.getElementById('rngBehaviorDuringOffset');
                const numDuOff = document.getElementById('numBehaviorDuringOffset');
                if (rngDuOff) rngDuOff.value = Math.round(duOff * 100);
                if (numDuOff) numDuOff.value = duOff.toFixed(2);

                const duDelay = bp.during?.delay !== undefined ? bp.during.delay : 1.67;
                const rngDuDel = document.getElementById('rngBehaviorDuringDelay');
                const numDuDel = document.getElementById('numBehaviorDuringDelay');
                if (rngDuDel) rngDuDel.value = Math.round(duDelay * 100);
                if (numDuDel) numDuDel.value = duDelay.toFixed(2);

                const duLoops = bp.during?.loops !== undefined ? bp.during.loops : 1;
                const rngDuLoops = document.getElementById('rngBehaviorDuringLoops');
                const numDuLoops = document.getElementById('numBehaviorDuringLoops');
                if (rngDuLoops) rngDuLoops.value = duLoops;
                if (numDuLoops) numDuLoops.value = duLoops;

                const duLoopForever = bp.during?.loopForever !== undefined ? !!bp.during.loopForever : true;
                const chkDuLF = document.getElementById('chkBehaviorLoopForever');
                if (chkDuLF) chkDuLF.checked = duLoopForever;
                const rowLoops = document.getElementById('rowBehaviorDuringLoops');
                if (rowLoops) {
                    rowLoops.style.opacity = duLoopForever ? '0.45' : '1.0';
                    if (rngDuLoops) rngDuLoops.disabled = duLoopForever;
                    if (numDuLoops) numDuLoops.disabled = duLoopForever;
                }

                const lblDuParam = document.getElementById('lblBehaviorDuringParamName');
                if (lblDuParam) {
                    const st = bp.during?.style || 'jump';
                    lblDuParam.innerText = (st === 'jump') ? 'Jump' : (st === 'drift' ? 'Drift' : 'Amount');
                }

                // OUT phase
                const selOuSt = document.getElementById('selBehaviorOutStyle');
                if (selOuSt) selOuSt.value = bp.out?.style || 'drop';
                const selOuTy = document.getElementById('selBehaviorOutType');
                if (selOuTy) selOuTy.value = bp.out?.type || 'ltr';
                const selOuMv = document.getElementById('selBehaviorOutMovement');
                if (selOuMv) selOuMv.value = bp.out?.movement || 'ease-in-quart';
                const selOuDir = document.getElementById('selBehaviorOutDirection');
                if (selOuDir) selOuDir.value = bp.out?.direction || 'bottom';

                const ouSpeed = bp.out?.speed !== undefined ? bp.out.speed : 92;
                const rngOuSp = document.getElementById('rngBehaviorOutSpeed');
                const numOuSp = document.getElementById('numBehaviorOutSpeed');
                if (rngOuSp) rngOuSp.value = ouSpeed;
                if (numOuSp) numOuSp.value = ouSpeed;

                const ouOff = bp.out?.offset !== undefined ? bp.out.offset : 0.08;
                const rngOuOff = document.getElementById('rngBehaviorOutOffset');
                const numOuOff = document.getElementById('numBehaviorOutOffset');
                if (rngOuOff) rngOuOff.value = Math.round(ouOff * 100);
                if (numOuOff) numOuOff.value = ouOff.toFixed(2);
            } else {
                behPanel.style.display = 'none';
            }
        }

        // 5. Visual Effects & Frames
        const fx = selectedClip.visualEffects || {};
        const selDev = document.getElementById('selDeviceFrameInspector');
        if (selDev) selDev.value = fx.deviceFrame || 'none';

        setFxRange('propVignetteInspector', 'lblVignetteInspector', fx.vignette || 0, '%');
        setFxRange('propFilmGrainInspector', 'lblFilmGrainInspector', fx.filmGrain || 0, '%');
        setFxRange('propGlowInspector', 'lblGlowInspector', fx.glow || 0, '%');
        setFxRange('propSepiaInspector', 'lblSepiaInspector', fx.sepia || 0, '%');
        setFxRange('propPixelateInspector', 'lblPixelateInspector', fx.pixelate || 0, 'px');
        setFxRange('propBorderRadiusInspector', 'lblBorderRadiusInspector', fx.borderRadius || 0, 'px');
        setFxRange('propChromaticAberration', 'lblChromaticAberration', fx.chromaticAberration || 0, 'px');
        setFxRange('propWaveWarp', 'lblWaveWarp', fx.waveWarp || 0, 'px');
        setFxRange('propLensDistortion', 'lblLensDistortion', fx.lensDistortion || 0, '%');
        setFxRange('propVhsGlitch', 'lblVhsGlitch', fx.vhsGlitch || 0, '%');

        const selGradePreset = document.getElementById('selColorGradePreset');
        if (selGradePreset) selGradePreset.value = fx.colorGradePreset || 'none';

        const chkScan = document.getElementById('chkScanlinesInspector');
        if (chkScan) chkScan.checked = !!fx.scanlines;
        const chkInv = document.getElementById('chkInvertInspector');
        if (chkInv) chkInv.checked = !!fx.invert;
        const chkDrop = document.getElementById('chkDropShadowInspector');
        const hasDrop = fx.dropShadow !== undefined ? fx.dropShadow : true;
        if (chkDrop) chkDrop.checked = hasDrop;
        const grpDrop = document.getElementById('grpDropShadowParams');
        if (grpDrop) grpDrop.style.display = hasDrop ? 'grid' : 'none';
        const dPower = fx.dropShadowPower !== undefined ? fx.dropShadowPower : (selectedClip.dropShadowPower !== undefined ? selectedClip.dropShadowPower : 2);
        const dBlur = fx.dropShadowBlur !== undefined ? fx.dropShadowBlur : (selectedClip.dropShadowBlur !== undefined ? selectedClip.dropShadowBlur : 35);
        setFxRange('propDropShadowPower', 'lblDropShadowPower', dPower, 'x');
        setFxRange('propDropShadowBlur', 'lblDropShadowBlur', dBlur, 'px');

        const chkChroma = document.getElementById('chkChromaKeyInspector');
        if (chkChroma) chkChroma.checked = !!fx.chromaKey;
        const colChroma = document.getElementById('colChromaColorInspector');
        if (colChroma) colChroma.value = fx.chromaColor || '#00ff00';
        const rngChromaTol = document.getElementById('rngChromaTolInspector');
        if (rngChromaTol) rngChromaTol.value = Math.round((fx.chromaTolerance !== undefined ? fx.chromaTolerance : 0.28) * 100);

        // 6. Transform & Position (Active for all visual clips: video, image, callout)

        const scalePct = Math.round((selectedClip.scale || 1.0) * 100);
        const scaleXPct = Math.round((selectedClip.scaleX !== undefined ? selectedClip.scaleX : (selectedClip.scale || 1.0)) * 100);
        const scaleYPct = Math.round((selectedClip.scaleY !== undefined ? selectedClip.scaleY : (selectedClip.scale || 1.0)) * 100);

        const propScale = document.getElementById('propScale');
        if (propScale) propScale.value = scalePct;
        const propScaleX = document.getElementById('propScaleX');
        if (propScaleX) propScaleX.value = scaleXPct;
        const propScaleY = document.getElementById('propScaleY');
        if (propScaleY) propScaleY.value = scaleYPct;

        const lblScaleUniform = document.getElementById('lblScaleUniform');
        if (lblScaleUniform) lblScaleUniform.innerText = `${scalePct}%`;
        const lblScaleX = document.getElementById('lblScaleX');
        if (lblScaleX) lblScaleX.innerText = `${scaleXPct}%`;
        const lblScaleY = document.getElementById('lblScaleY');
        if (lblScaleY) lblScaleY.innerText = `${scaleYPct}%`;

        const chkLockAspect = document.getElementById('chkLockAspect');
        if (chkLockAspect) chkLockAspect.checked = selectedClip.aspectRatioLocked !== undefined ? selectedClip.aspectRatioLocked : true;

        const propXOffset = document.getElementById('propXOffset');
        if (propXOffset) propXOffset.value = selectedClip.xOffset || 0;
        const propYOffset = document.getElementById('propYOffset');
        if (propYOffset) propYOffset.value = selectedClip.yOffset || 0;

        // Position Z Layer Display
        const lblPositionZ = document.getElementById('lblPositionZ');
        if (lblPositionZ) lblPositionZ.innerText = `Track ${selectedClip.trackId || 1} (Layer ${selectedClip.trackId || 1})`;

        // Rotatable Knob & Angle controls
        const rot = Math.round(((selectedClip.rotation || 0) % 360 + 360) % 360);
        const propRotation = document.getElementById('propRotation');
        if (propRotation) propRotation.value = rot;
        const propRotationSlider = document.getElementById('propRotationSlider');
        if (propRotationSlider) propRotationSlider.value = rot;
        const lblKnobRotation = document.getElementById('lblKnobRotation');
        if (lblKnobRotation) lblKnobRotation.innerText = `${rot}°`;
        const knobRotation = document.getElementById('knobRotation');
        if (knobRotation) {
            const ind = knobRotation.querySelector('.knob-indicator');
            if (ind) {
                ind.style.transform = `rotate(${rot}deg)`;
                ind.style.transformOrigin = '50% 21px';
            }
        }

        // Opacity
        const opacityPct = Math.round((selectedClip.opacity !== undefined ? selectedClip.opacity : 1.0) * 100);
        const propOpacity = document.getElementById('propOpacity');
        if (propOpacity) propOpacity.value = opacityPct;
        const lblOpacity = document.getElementById('lblOpacity');
        if (lblOpacity) lblOpacity.innerText = `${opacityPct}%`;

        // Blur Filter
        const blurVal = selectedClip.blur || 0;
        const propBlur = document.getElementById('propBlur');
        if (propBlur) propBlur.value = blurVal;
        const lblBlur = document.getElementById('lblBlur');
        if (lblBlur) lblBlur.innerText = `${blurVal}px`;

        // 7. Clip Speed & Time Ramping
        const cSpeed = selectedClip.speed || 1.0;
        const propClipSpeed = document.getElementById('propClipSpeed');
        if (propClipSpeed) propClipSpeed.value = cSpeed;
        const lblClipSpeed = document.getElementById('lblClipSpeed');
        if (lblClipSpeed) lblClipSpeed.innerText = `${cSpeed.toFixed(2)}x`;
        const selClipSpeed = document.getElementById('selClipSpeed');
        if (selClipSpeed) selClipSpeed.value = cSpeed.toString();

        // 8. Audio Settings
        const secAudio = document.getElementById('sectionAudioProps');
        if (secAudio) secAudio.style.display = (selectedClip.type === 'video' || selectedClip.type === 'audio') ? 'block' : 'none';
        const propVolume = document.getElementById('propVolume');
        if (propVolume) propVolume.value = Math.round((selectedClip.volume !== undefined ? selectedClip.volume : 1.0) * 100);

        // Also sync Sidebar effects if open
        const chkChromaSide = document.getElementById('chkChromaKey');
        if (chkChromaSide) chkChromaSide.checked = !!fx.chromaKey;
        const colChromaSide = document.getElementById('colChromaColor');
        if (colChromaSide) colChromaSide.value = fx.chromaColor || '#00ff00';
        const selDevSide = document.getElementById('selDeviceFrame');
        if (selDevSide) selDevSide.value = fx.deviceFrame || 'none';
        const propRadSide = document.getElementById('propBorderRadius');
        if (propRadSide) propRadSide.value = fx.borderRadius || 0;

        // 8. Studio Animations & Motion Inspector
        const secAnim = document.getElementById('sectionAnimationProps');
        if (secAnim) {
            secAnim.style.display = 'block';
            this.renderInspectorKeyframeBadges(selectedClip);
        }
        this.updateZoomMonitorUI(selectedClip);
    }

    focusInspectorSection(sectionId) {
        if (sectionId === 'tabAnimations' || sectionId === 'sectionAnimations') {
            const animTabBtn = document.querySelector('.sidebar-tab[data-tab="animations"]');
            if (animTabBtn) animTabBtn.click();
            const sidebar = document.getElementById('sidebarPanel');
            const btnExpandSidebar = document.getElementById('btnExpandSidebar');
            if (sidebar && sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
                if (btnExpandSidebar) btnExpandSidebar.classList.add('hidden');
            }
            return;
        }

        const inspector = document.getElementById('inspectorPanel');
        const btnExpandInspector = document.getElementById('btnExpandInspector');
        if (inspector && inspector.classList.contains('collapsed')) {
            inspector.classList.remove('collapsed');
            if (btnExpandInspector) btnExpandInspector.classList.add('hidden');
        }

        const sec = document.getElementById(sectionId);
        if (sec) {
            sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            sec.classList.remove('inspector-section-highlight');
            void sec.offsetWidth; // Force reflow to re-trigger animation
            sec.classList.add('inspector-section-highlight');
            setTimeout(() => {
                sec.classList.remove('inspector-section-highlight');
            }, 1800);
        }
    }

    startRenderLoop() {
        const loop = (timestamp) => {
            if (!this.lastFrameTimestamp) this.lastFrameTimestamp = timestamp;
            if (this.isPlaying && !this.isDraggingPlayhead) {
                const rawDelta = (timestamp - this.lastFrameTimestamp) / 1000.0;
                // Clamp delta between 0 and 0.1s max to prevent large frame jumps on lag or background tabs
                const deltaSeconds = Math.min(0.1, Math.max(0, rawDelta));
                this.seek(this.playheadTime + deltaSeconds);
                this.lastFrameTimestamp = timestamp;

                if (this.playheadTime >= this.timeline.totalDuration) {
                    this.togglePlayback();
                    this.seek(0);
                }
            } else {
                this.lastFrameTimestamp = timestamp;
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Undo / Redo Shortcuts
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                e.preventDefault();
                this.timeline.undo();
                this.updateUndoRedoUI();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
                e.preventDefault();
                this.timeline.redo();
                this.updateUndoRedoUI();
                return;
            }

            // Copy / Paste Shortcuts
            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                this.copySelectedClip();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
                e.preventDefault();
                this.pasteClip();
                return;
            }

            // Project Shortcuts
            if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
                e.preventDefault();
                this.openProjectsModal();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
                e.preventDefault();
                this.newProject();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                this.saveProject();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
                e.preventDefault();
                document.getElementById('exportModal').classList.remove('hidden');
                return;
            }
            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                document.getElementById('shortcutsModal').classList.remove('hidden');
                return;
            }

            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlayback();
            } else if (e.key === 'v' || e.key === 'V') {
                this.compositor.activeCanvasTool = 'pointer';
                document.getElementById('toolPointer').click();
            } else if (e.key === 'h' || e.key === 'H') {
                this.compositor.activeCanvasTool = 'hand';
                document.getElementById('toolHand').click();
            } else if (e.key === 'c' || e.key === 'C') {
                this.compositor.activeCanvasTool = 'crop';
                document.getElementById('toolCrop').click();
            } else if (e.key === 's' || e.key === 'S') {
                this.splitSelectedClip();
            } else if (e.key === 'm' || e.key === 'M') {
                this.addMarkerAtPlayhead();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
                e.preventDefault();
                this.cutRangeSelection();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.timeline.selectedAnimationId) {
                    this.deleteSelectedAnimation();
                } else {
                    this.deleteSelectedClip();
                }
            }
        });
    }

    applyCurrentTransitionToAllClips(transType = null) {
        let transIn = transType || 'fade';
        let transOut = transType || 'fade';
        let dur = 0.8;
        const selClip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
        if (!transType && selClip) {
            if (selClip.transitionIn && selClip.transitionIn !== 'none') transIn = selClip.transitionIn;
            if (selClip.transitionOut && selClip.transitionOut !== 'none') transOut = selClip.transitionOut;
            dur = selClip.transitionInDuration || selClip.transitionOutDuration || 0.8;
        } else if (!transType) {
            const selIn = document.getElementById('selTransitionIn');
            if (selIn && selIn.value !== 'none') transIn = selIn.value;
            const selOut = document.getElementById('selTransitionOut');
            if (selOut && selOut.value !== 'none') transOut = selOut.value;
            const rng = document.getElementById('rngTransitionDuration');
            if (rng) dur = parseInt(rng.value, 10) / 10.0;
        }

        let count = 0;
        for (const clip of this.timeline.clips) {
            if (clip.type === 'video' || clip.type === 'image' || clip.type === 'callout') {
                const safeDur = Math.max(0.1, Math.min(dur, (clip.duration || 1.0) * 0.45));
                clip.transitionIn = transIn;
                clip.transitionInDuration = safeDur;
                clip.transitionOut = transOut;
                clip.transitionOutDuration = safeDur;
                count++;
            }
        }

        this.timeline.saveSnapshot();
        this.renderTimeline();
        if (selClip) this.renderProperties(selClip);
        this.compositor.renderFrame(this.timeline, this.playheadTime);
        alert(`Successfully applied transition (${transIn} / ${transOut}, ${dur.toFixed(1)}s) to all ${count} clips on the timeline!`);
    }

    async saveProject(isAutoPrompt = false) {
        if (!isAutoPrompt) {
            const modal = document.getElementById('saveProjectModal');
            if (modal) {
                const titleInput = document.getElementById('txtSaveProjectTitle');
                if (titleInput) titleInput.value = this.compositor.projectSettings?.name || 'RPA_Workflow_Video';
                const folderInput = document.getElementById('txtProjectOutputFolder');
                if (folderInput) folderInput.value = this.projectOutputDir || localStorage.getItem('rpa_project_output_dir') || '';
                modal.classList.remove('hidden');
                return;
            }
        }

        const defaultName = this.compositor.projectSettings?.name || 'RPA_Workflow_Video';
        await this.executeSaveProject(defaultName, this.projectOutputDir, 'rpavideo', isAutoPrompt);
    }

    async writeProjectToPath(filePath, cleanTitle) {
        const sanitizedClips = (this.timeline.clips || []).map(clip => {
            const { element, _previewEl, cachedImage, audioBuffer, video, sourceElement, mediaStream, ...safeClip } = clip;
            return safeClip;
        });

        const projectData = {
            title: cleanTitle || 'Untitled',
            duration: this.timeline.totalDuration,
            tracks: this.timeline.tracks,
            clips: sanitizedClips,
            markers: this.timeline.markers || [],
            captions: this.timeline.captions || [],
            projectSettings: this.compositor.projectSettings || {},
            filePath
        };

        const safeJson = JSON.stringify(projectData, (key, value) => {
            if (key === 'element' || key === '_previewEl' || key === 'cachedImage' || key === 'audioBuffer' || key === 'video' || key === 'sourceElement' || key === 'mediaStream') {
                return undefined;
            }
            return value;
        }, 2);

        if (window.rpaNative && window.rpaNative.saveProjectToDisk) {
            const res = await window.rpaNative.saveProjectToDisk({ filePath, content: safeJson });
            if (res && res.success) {
                this.markDirty(false);
                alert(`Project successfully saved!\nLocation: ${res.path}`);
                return;
            }
        }

        try {
            const res = await fetch('/api/projects/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: safeJson
            });
            const data = await res.json();
            if (res.ok && data.success) {
                this.markDirty(false);
                alert(`Project successfully saved!\nLocation: ${data.path || data.id}`);
            } else {
                throw new Error(data.error || 'Server error saving project');
            }
        } catch (err) {
            console.error('[Save Project Path Error]', err);
            alert(`Project saved: ${filePath}`);
            this.markDirty(false);
        }
    }

    async executeSaveProject(cleanTitle, targetDir, format = 'rpavideo', isSilent = false) {
        const sanitizedClips = (this.timeline.clips || []).map(clip => {
            const { element, _previewEl, cachedImage, audioBuffer, video, sourceElement, mediaStream, ...safeClip } = clip;
            return safeClip;
        });

        const projectData = {
            title: cleanTitle || 'Untitled',
            duration: this.timeline.totalDuration,
            tracks: this.timeline.tracks,
            clips: sanitizedClips,
            markers: this.timeline.markers || [],
            captions: this.timeline.captions || [],
            projectSettings: this.compositor.projectSettings || {},
            targetDirectory: targetDir || this.projectOutputDir || null,
            extension: format
        };

        const safeJson = JSON.stringify(projectData, (key, value) => {
            if (key === 'element' || key === '_previewEl' || key === 'cachedImage' || key === 'audioBuffer' || key === 'video' || key === 'sourceElement' || key === 'mediaStream') {
                return undefined;
            }
            return value;
        }, 2);

        // A. Desktop Native File Save (Zero-overhead direct disk write)
        if (window.rpaNative && window.rpaNative.saveProjectToDisk) {
            const safeFileName = (cleanTitle || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
            const res = await window.rpaNative.saveProjectToDisk({
                targetDirectory: targetDir || this.projectOutputDir || null,
                fileName: `${safeFileName}.${format}`,
                content: safeJson
            });
            if (res && res.success) {
                this.markDirty(false);
                if (!isSilent) alert(`Project successfully saved!\nLocation: ${res.path}`);
                return;
            }
        }

        // B. Server API Save
        try {
            const res = await fetch('/api/projects/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: safeJson
            });
            const data = await res.json();
            if (res.ok && data.success) {
                this.markDirty(false);
                if (!isSilent) alert(`Project successfully saved!\nLocation: ${data.path || data.id}`);
            } else {
                throw new Error(data.error || 'Server error saving project');
            }
        } catch (err) {
            console.error('[Save Project Error]', err);
            // Safe offline fallback: direct JSON download
            const blob = new Blob([safeJson], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            const safeFileName = cleanTitle.replace(/[^a-zA-Z0-9_-]/g, '_') || 'project';
            a.download = `${safeFileName}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            this.markDirty(false);
            if (!isSilent) alert(`Project saved directly to your Downloads folder as "${safeFileName}.${format}".\nNotice: ${err.message}`);
        }
    }

    async executeCustomExport() {
        const resVal = document.getElementById('selExportResolution').value;
        let width = 1920;
        let height = 1080;

        if (resVal === 'custom') {
            const wInput = parseInt(document.getElementById('txtExportCustomWidth').value, 10) || 1920;
            const hInput = parseInt(document.getElementById('txtExportCustomHeight').value, 10) || 1080;
            width = Math.max(128, Math.min(8192, Math.round(wInput / 2) * 2));
            height = Math.max(128, Math.min(8192, Math.round(hInput / 2) * 2));
        } else {
            const parts = resVal.split('x');
            width = parseInt(parts[0], 10);
            height = parseInt(parts[1], 10);
        }

        const fps = parseInt(document.getElementById('selExportFps').value, 10);
        const bitrate = parseInt(document.getElementById('selExportBitrate').value, 10);
        const format = document.getElementById('selExportFormat').value;

        const progressContainer = document.getElementById('exportProgressBarContainer');
        const progressBar = document.getElementById('exportProgressBar');
        const statusLabel = document.getElementById('lblExportStatus');
        const btnExec = document.getElementById('btnExecuteExport');

        progressContainer.style.display = 'block';
        btnExec.disabled = true;
        btnExec.innerText = '⏳ Rendering...';

        try {
            const exportResult = await window.RpaExporter.exportTimeline(
                this.timeline,
                this.compositor,
                { width, height, fps, bitrate, format },
                (pct) => {
                    progressBar.style.width = `${Math.floor(pct)}%`;
                    statusLabel.innerText = `Rendering ${width}x${height} (${fps}fps): ${Math.floor(pct)}%`;
                }
            );

            const chosenFolder = document.getElementById('txtExportOutputFolder')?.value?.trim();
            if (window.rpaNative && window.rpaNative.saveExportedFile && exportResult && exportResult.blob) {
                const arrayBuffer = await exportResult.blob.arrayBuffer();
                const ext = format === 'mp4' ? 'mp4' : 'webm';
                const filename = `RPA_Video_${width}x${height}_${Date.now()}.${ext}`;
                const saveResult = await window.rpaNative.saveExportedFile({
                    buffer: arrayBuffer,
                    filename,
                    targetDirectory: chosenFolder || null
                });
                if (saveResult && saveResult.success) {
                    alert(`Full ${width}x${height} video successfully rendered and saved to:\n${saveResult.path}`);
                } else {
                    alert(`Full ${width}x${height} video rendered!`);
                }
            } else {
                alert(`Full ${width}x${height} video successfully rendered and downloaded!`);
            }
            document.getElementById('exportModal').classList.add('hidden');
        } catch (err) {
            alert(`Export failed: ${err.message}`);
        } finally {
            progressContainer.style.display = 'none';
            btnExec.disabled = false;
            btnExec.innerText = 'Render & Download';
        }
    }

    // ==========================================
    // STUDIO PRO FEATURES: COLOR, KEYFRAMES, DND
    // ==========================================

    updateUndoRedoUI() {
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        if (btnUndo) btnUndo.disabled = !this.timeline.canUndo();
        if (btnRedo) btnRedo.disabled = !this.timeline.canRedo();
    }

    initCategoryFilterBars() {
        document.querySelectorAll('.tool-filter-bar').forEach(bar => {
            const containerId = bar.dataset.target;
            const container = containerId ? document.getElementById(containerId) : bar.closest('.sidebar-content > div');
            if (!container) return;

            bar.querySelectorAll('.tool-filter-pill').forEach(pill => {
                pill.onclick = () => {
                    bar.querySelectorAll('.tool-filter-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    const category = pill.dataset.category;

                    container.querySelectorAll('.studio-card').forEach(card => {
                        if (category === 'all' || card.dataset.category === category) {
                            card.style.display = 'flex';
                        } else {
                            card.style.display = 'none';
                        }
                    });
                };
            });
        });
    }

    setupDraggableStudioTools() {
        this.initCategoryFilterBars();

        document.querySelectorAll('.studio-card, .asset-card[draggable="true"]').forEach(card => {
            const toolType = card.dataset.toolType;
            const toolName = card.dataset.toolName;
            if (!toolType) return;

            // 1. Drag & Drop Support
            card.ondragstart = (e) => {
                const data = { toolType, toolName };
                e.dataTransfer.setData('text/plain', JSON.stringify(data));
                e.dataTransfer.effectAllowed = 'copy';
                card.classList.add('dragging-card');
            };
            card.ondragend = () => {
                card.classList.remove('dragging-card');
            };

            // 2. 1-Click / Double-Click to Apply (Studio Parity)
            card.onclick = () => {
                this.handleStudioToolApply(toolType, toolName, card);
            };
        });
    }

    handleStudioToolApply(toolType, toolName, card = null) {
        if (card) {
            card.classList.remove('card-applied-flash');
            void card.offsetWidth; // Trigger DOM reflow for CSS keyframe restart
            card.classList.add('card-applied-flash');
        }

        const selectedClip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
        const clipAtPlayhead = this.timeline.clips.find(c => this.playheadTime >= c.startTime && this.playheadTime <= (c.startTime + c.duration));
        const targetClip = selectedClip || clipAtPlayhead;

        if (toolType === 'callout') {
            const defaults = this.getCalloutDefaults(toolName);
            const newClip = {
                title: toolName,
                type: 'callout',
                subtype: defaults.subtype,
                trackId: 4,
                startTime: this.playheadTime,
                duration: 4.0,
                scale: 1.0,
                scaleX: defaults.scaleX,
                scaleY: defaults.scaleY,
                xOffset: defaults.xOffset,
                yOffset: defaults.yOffset,
                color: defaults.color,
                fontSize: defaults.fontSize,
                text: defaults.text,
                subText: defaults.subText,
                aspectRatioLocked: false
            };
            this.timeline.addClip(newClip);
            const added = this.timeline.clips[this.timeline.clips.length - 1];
            this.timeline.selectedClipId = added.id;
            this.renderProperties(added);
        } else if (toolType === 'sfx') {
            this.sfxGenerator.addToTimeline(this.timeline, toolName, this.playheadTime, 2).then(newClip => {
                if (newClip) {
                    this.timeline.selectedClipId = newClip.id;
                    this.renderProperties(newClip);
                }
                this.renderTimeline();
                this.updateTimelineRuler();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            });
            return;
        } else if (toolType === 'media') {
            const mediaItem = (this.mediaBin || []).find(m => m.name === toolName || m.id === toolName);
            const isAudio = mediaItem ? mediaItem.type === 'audio' : false;
            this.timeline.addClip({
                title: mediaItem ? mediaItem.name : (toolName || 'Demo Clip.mp4'),
                type: isAudio ? 'audio' : 'video',
                trackId: isAudio ? 1 : 2,
                startTime: this.playheadTime,
                duration: mediaItem?.duration || 10.0,
                sourceUrl: mediaItem?.url || '',
                telemetry: mediaItem?.telemetry || [
                    { time: 1.0, x: 0.25, y: 0.35, type: 'mousemove' },
                    { time: 2.2, x: 0.50, y: 0.50, type: 'mousedown' },
                    { time: 4.5, x: 0.75, y: 0.40, type: 'mousemove' },
                    { time: 6.0, x: 0.30, y: 0.60, type: 'mousedown' }
                ],
                scale: 1.0,
                scaleX: 1.0,
                scaleY: 1.0,
                xOffset: 0,
                yOffset: 0,
                aspectRatioLocked: true
            });
            const added = this.timeline.clips[this.timeline.clips.length - 1];
            this.timeline.selectedClipId = added.id;
            this.renderProperties(added);
            this.markDirty(true);
        } else if (targetClip) {
            this.handleToolDropOnClip(null, targetClip.id, { toolType, toolName });
            return;
        } else if (this.timeline.clips.length > 0) {
            this.handleToolDropOnClip(null, this.timeline.clips[0].id, { toolType, toolName });
            return;
        }

        this.timeline.saveSnapshot();
        this.renderTimeline();
        this.updateTimelineRuler();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    handleToolDropOnTrack(e, trackId) {
        let raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        const trackContent = document.getElementById(`trackContent${trackId}`);
        if (!trackContent) return;
        const rect = trackContent.getBoundingClientRect();
        const dropX = e.clientX - rect.left;
        const dropTime = Math.max(0, dropX / this.timeline.pixelsPerSecond);

        if (data.toolType === 'callout') {
            const defaults = this.getCalloutDefaults(data.toolName);
            const newClip = {
                title: data.toolName,
                type: 'callout',
                subtype: defaults.subtype,
                trackId,
                startTime: dropTime,
                duration: 4.0,
                scale: 1.0,
                scaleX: defaults.scaleX,
                scaleY: defaults.scaleY,
                xOffset: defaults.xOffset,
                yOffset: defaults.yOffset,
                color: defaults.color,
                fontSize: defaults.fontSize,
                text: defaults.text,
                subText: defaults.subText,
                aspectRatioLocked: false
            };
            this.timeline.addClip(newClip);
            const added = this.timeline.clips[this.timeline.clips.length - 1];
            this.timeline.selectedClipId = added.id;
            this.renderProperties(added);
        } else if (data.toolType === 'sfx') {
            this.sfxGenerator.addToTimeline(this.timeline, data.toolName, dropTime, trackId).then(newClip => {
                if (newClip) {
                    this.timeline.selectedClipId = newClip.id;
                    this.renderProperties(newClip);
                }
                this.renderTimeline();
                this.updateTimelineRuler();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            });
            return;
        } else if (data.toolType === 'media') {
            const mediaItem = (this.mediaBin || []).find(m => m.id === data.mediaId || m.name === data.toolName);
            const isAudio = (data.mediaType === 'audio') || (mediaItem && mediaItem.type === 'audio');
            this.timeline.addClip({
                title: data.toolName || (mediaItem ? mediaItem.name : 'Media Clip'),
                type: isAudio ? 'audio' : 'video',
                trackId,
                startTime: dropTime,
                duration: data.duration || mediaItem?.duration || 10.0,
                sourceUrl: data.url || mediaItem?.url || '',
                telemetry: mediaItem?.telemetry || [
                    { time: 1.0, x: 0.25, y: 0.35, type: 'mousemove' },
                    { time: 2.2, x: 0.50, y: 0.50, type: 'mousedown' },
                    { time: 4.5, x: 0.75, y: 0.40, type: 'mousemove' },
                    { time: 6.0, x: 0.30, y: 0.60, type: 'mousedown' }
                ],
                scale: 1.0,
                scaleX: 1.0,
                scaleY: 1.0,
                xOffset: 0,
                yOffset: 0,
                aspectRatioLocked: true
            });
            const added = this.timeline.clips[this.timeline.clips.length - 1];
            this.timeline.selectedClipId = added.id;
            this.renderProperties(added);
            this.markDirty(true);
            this.renderProperties(added);
        } else {
            // Transitions, behaviors, effects, or audio-fx dropped on track
            const targetClip = this.timeline.clips.find(c => c.trackId === trackId && dropTime >= c.startTime && dropTime <= (c.startTime + c.duration));
            if (targetClip) {
                this.handleToolDropOnClip(e, targetClip.id, data);
                return;
            } else if (this.timeline.selectedClipId) {
                this.handleToolDropOnClip(e, this.timeline.selectedClipId, data);
                return;
            }
        }
        this.timeline.saveSnapshot();
        this.renderTimeline();
        this.updateTimelineRuler();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    handleToolDropOnClip(e, clipId, data = null) {
        if (!data) {
            let raw = e.dataTransfer.getData('text/plain');
            if (!raw) return;
            try { data = JSON.parse(raw); } catch { return; }
        }
        const clip = this.timeline.getClip(clipId);
        if (!clip) return;

        if (data.toolType === 'transition') {
            if (clip.transitionInDuration === undefined) clip.transitionInDuration = 0.8;
            if (clip.transitionOutDuration === undefined) clip.transitionOutDuration = 0.8;
            if (!Array.isArray(clip.transitions)) clip.transitions = [];

            let relProgress = null;
            if (e && e.clientX) {
                const clipEl = (e.currentTarget && e.currentTarget.classList && e.currentTarget.classList.contains('timeline-clip'))
                    ? e.currentTarget
                    : document.querySelector(`.timeline-clip[data-clip-id="${clip.id}"]`);
                if (clipEl) {
                    const rect = clipEl.getBoundingClientRect();
                    if (rect.width > 0) {
                        relProgress = Math.max(0, Math.min(1.0, (e.clientX - rect.left) / rect.width));
                    }
                }
            }

            if (relProgress !== null) {
                if (relProgress <= 0.28) {
                    // Zone 1: Entrance Transition
                    clip.transitionIn = data.toolName;
                } else if (relProgress >= 0.72) {
                    // Zone 3: Exit Transition
                    clip.transitionOut = data.toolName;
                } else {
                    // Zone 2: Multiple Timeline Content Intermediate Transitions
                    const transDur = Math.min(clip.transitionInDuration || 0.8, Math.max(0.3, clip.duration * 0.4));
                    const targetCenter = relProgress * clip.duration;
                    const timeOffset = Math.max(0.1, Math.min(clip.duration - transDur - 0.1, targetCenter - transDur / 2));
                    clip.transitions.push({
                        id: 'trans_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                        name: data.toolName,
                        type: data.toolName,
                        timeOffset: parseFloat(timeOffset.toFixed(2)),
                        duration: parseFloat(transDur.toFixed(2))
                    });
                }
            } else {
                // Non-drag / default click placement:
                if (!clip.transitionIn || clip.transitionIn === 'none') {
                    clip.transitionIn = data.toolName;
                } else if (!clip.transitionOut || clip.transitionOut === 'none') {
                    clip.transitionOut = data.toolName;
                } else {
                    clip.transitions.push({
                        id: 'trans_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                        name: data.toolName,
                        type: data.toolName,
                        timeOffset: parseFloat(Math.max(0.1, clip.duration * 0.5 - 0.4).toFixed(2)),
                        duration: 0.8
                    });
                }
            }
        } else if (data.toolType === 'behavior') {
            clip.behavior = data.toolName;
            if (data.toolName !== 'none') {
                clip.behaviorProps = this.getDefaultBehaviorProps(data.toolName);
            } else {
                clip.behaviorProps = null;
            }
        } else if (data.toolType === 'effect') {
            if (!clip.visualEffects) clip.visualEffects = {};
            if (data.toolName === 'clipSpeed') {
                const newSpeed = (clip.speed && clip.speed === 2.0) ? 1.0 : 2.0;
                clip.speed = newSpeed;
                if (!clip.originalDuration) clip.originalDuration = clip.duration;
                clip.duration = clip.originalDuration / newSpeed;
                this.focusInspectorSection('sectionClipSpeed');
            } else if (data.toolName === 'vignette') clip.visualEffects.vignette = 65;
            else if (data.toolName === 'filmGrain') clip.visualEffects.filmGrain = 45;
            else if (data.toolName === 'scanlines') clip.visualEffects.scanlines = true;
            else if (data.toolName === 'glow') clip.visualEffects.glow = 50;
            else if (data.toolName === 'pixelate') clip.visualEffects.pixelate = 12;
            else if (data.toolName === 'sepia') clip.visualEffects.sepia = 80;
            else if (data.toolName === 'invert') clip.visualEffects.invert = true;
            else if (data.toolName === 'chromaKey') clip.visualEffects.chromaKey = true;
            else if (data.toolName === 'macFrame') clip.visualEffects.deviceFrame = 'mac';
            else if (data.toolName === 'windowsFrame') clip.visualEffects.deviceFrame = 'windows';
            else if (data.toolName === 'chromaticAberration') clip.visualEffects.chromaticAberration = 16;
            else if (data.toolName === 'waveWarp') clip.visualEffects.waveWarp = 14;
            else if (data.toolName === 'lensDistortion') clip.visualEffects.lensDistortion = 25;
            else if (data.toolName === 'vhsGlitch') clip.visualEffects.vhsGlitch = 65;
            else if (data.toolName.startsWith('filter-')) clip.visualEffects.colorGradePreset = data.toolName.replace('filter-', '');
        } else if (data.toolType === 'audio-fx') {
            if (!clip.audioEffects) clip.audioEffects = {};
            if (data.toolName === 'clipSpeed' || data.toolName === 'speedRamp') {
                const newSpeed = (clip.speed && clip.speed === 2.0) ? 1.0 : 2.0;
                clip.speed = newSpeed;
                if (!clip.originalDuration) clip.originalDuration = clip.duration;
                clip.duration = clip.originalDuration / newSpeed;
                this.focusInspectorSection('sectionClipSpeed');
            } else if (data.toolName === 'fadeIn') clip.audioEffects.fadeIn = 1.0;
            else if (data.toolName === 'fadeOut') clip.audioEffects.fadeOut = 1.0;
            else if (data.toolName === 'noiseGate') clip.audioEffects.noiseGate = true;
            else if (data.toolName === 'leveling') clip.audioEffects.volumeLeveling = true;
        } else if (data.toolType === 'animation') {
            let dropOffset = null;
            if (e && e.clientX) {
                const clipEl = document.querySelector(`.timeline-clip[data-clip-id="${clip.id}"]`);
                if (clipEl) {
                    const rect = clipEl.getBoundingClientRect();
                    const relX = Math.max(0, e.clientX - rect.left);
                    dropOffset = relX / this.timeline.pixelsPerSecond;
                }
            }
            this.applyAnimationPresetToClip(clip, data.toolName, dropOffset);
            return;
        }

        this.timeline.selectedClipId = clip.id;
        this.renderProperties(clip);
        this.timeline.saveSnapshot();
        this.renderTimeline();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    initColorWheel() {
        const canvas = document.getElementById('colorWheelCanvas');
        const container = document.getElementById('colorWheelContainer');
        const reticle = document.getElementById('colorWheelReticle');
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const radius = width / 2;

        // Render vibrant radial color wheel
        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dx = x - radius;
                const dy = y - radius;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const index = (y * width + x) * 4;

                if (dist <= radius) {
                    let angle = Math.atan2(dy, dx); // -PI to PI
                    let hue = (angle + Math.PI) / (2 * Math.PI) * 360;
                    let sat = dist / radius;

                    // Convert HSL to RGB
                    const rgb = this.hslToRgb(hue / 360, sat, 0.5);
                    data[index] = rgb[0];
                    data[index + 1] = rgb[1];
                    data[index + 2] = rgb[2];
                    data[index + 3] = 255;
                } else {
                    data[index + 3] = 0;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // Reticle Dragging Event Listeners
        const onWheelPointer = (e) => {
            const rect = container.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;
            const dx = x - 70;
            const dy = y - 70;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxR = 64;

            if (dist > maxR) {
                x = 70 + (dx / dist) * maxR;
                y = 70 + (dy / dist) * maxR;
            }

            reticle.style.left = `${x}px`;
            reticle.style.top = `${y}px`;

            // Calculate Temperature and Tint offsets from reticle position
            // X axis: Cool (left) to Warm (right)
            // Y axis: Green (top) to Magenta (bottom)
            const tempVal = Math.round(((x - 70) / maxR) * 50);
            const tintVal = Math.round(((y - 70) / maxR) * 50);

            const clip = this.timeline.getClip(this.timeline.selectedClipId);
            const target = clip ? clip.visualEffects : this.compositor.visualFx;
            if (!target.colorGrade) target.colorGrade = {};
            target.colorGrade.temperature = tempVal;
            target.colorGrade.tint = tintVal;

            const rngTemp = document.getElementById('rngColorTemp');
            const rngTint = document.getElementById('rngColorTint');
            const lblTemp = document.getElementById('lblColorTemp');
            const lblTint = document.getElementById('lblColorTint');

            if (rngTemp) rngTemp.value = tempVal;
            if (lblTemp) lblTemp.innerText = tempVal > 0 ? `+${tempVal}` : `${tempVal}`;
            if (rngTint) rngTint.value = tintVal;
            if (lblTint) lblTint.innerText = tintVal > 0 ? `+${tintVal}` : `${tintVal}`;

            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        let isWheelDragging = false;
        container.onpointerdown = (e) => {
            isWheelDragging = true;
            onWheelPointer(e);
            const onPointerMove = (ev) => {
                if (isWheelDragging) onWheelPointer(ev);
            };
            const onPointerUp = () => {
                isWheelDragging = false;
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                this.timeline.saveSnapshot();
            };
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        };
    }

    hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    autoAdjustColors() {
        const clip = this.timeline.getClip(this.timeline.selectedClipId);
        this.compositor.autoAdjustColor(clip);

        const target = clip ? clip.visualEffects : this.compositor.visualFx;
        if (target) {
            const propB = document.getElementById('propBrightness');
            const propC = document.getElementById('propContrast');
            const propS = document.getElementById('propSaturation');
            const rngTemp = document.getElementById('rngColorTemp');
            const lblTemp = document.getElementById('lblColorTemp');

            if (propB) propB.value = target.brightness;
            if (propC) propC.value = target.contrast;
            if (propS) propS.value = target.saturation;
            if (rngTemp && target.colorGrade) {
                rngTemp.value = target.colorGrade.temperature || 0;
                if (lblTemp) lblTemp.innerText = `+${target.colorGrade.temperature}`;
            }

            // Adjust Color Wheel Reticle to warm position
            const reticle = document.getElementById('colorWheelReticle');
            if (reticle) {
                reticle.style.left = '84px';
                reticle.style.top = '72px';
            }
        }
        this.timeline.saveSnapshot();
        this.renderTimeline();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    initKeyframeEditor() {
        const selEasing = document.getElementById('selKeyframeEasing');
        const btnAddKf = document.getElementById('btnAddKeyframe');
        const btnDelKf = document.getElementById('btnDeleteKeyframe');

        if (selEasing) {
            selEasing.onchange = (e) => this.drawKeyframeCurveGraph(e.target.value);
            this.drawKeyframeCurveGraph(selEasing.value);
        }

        if (btnAddKf) {
            btnAddKf.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip) {
                    alert('Please select a clip on the timeline first to add a keyframe.');
                    return;
                }
                const relTime = Math.max(0, this.playheadTime - clip.startTime);
                if (relTime > clip.duration) {
                    alert('Playhead is outside the selected clip duration.');
                    return;
                }

                const prop = document.getElementById('selKeyframeProp').value;
                const easing = document.getElementById('selKeyframeEasing').value;
                const val = parseFloat(document.getElementById('numKeyframeValue').value) || 1.0;

                if (!clip.keyframes) clip.keyframes = [];
                // Remove existing keyframe at same timeOffset for same property
                clip.keyframes = clip.keyframes.filter(k => !(Math.abs(k.timeOffset - relTime) < 0.1 && k.property === prop));

                clip.keyframes.push({
                    id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                    timeOffset: relTime,
                    property: prop,
                    value: val,
                    easing
                });
                clip.keyframes.sort((a, b) => a.timeOffset - b.timeOffset);

                this.timeline.saveSnapshot();
                this.renderTimeline();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
                this.drawKeyframeCurveGraph(easing);
            };
        }

        if (btnDelKf) {
            btnDelKf.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip || !clip.keyframes || clip.keyframes.length === 0) {
                    alert('No keyframes found on selected clip.');
                    return;
                }
                const relTime = this.playheadTime - clip.startTime;
                // Find closest keyframe within 1.0s
                let closestIdx = -1;
                let minDist = Infinity;
                clip.keyframes.forEach((kf, idx) => {
                    const dist = Math.abs(kf.timeOffset - relTime);
                    if (dist < minDist) {
                        minDist = dist;
                        closestIdx = idx;
                    }
                });

                if (closestIdx !== -1 && minDist < 1.0) {
                    clip.keyframes.splice(closestIdx, 1);
                    this.timeline.saveSnapshot();
                    this.renderTimeline();
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                } else {
                    alert('No keyframe near current playhead.');
                }
            };
        }
    }

    drawKeyframeCurveGraph(easing = 'easeInOut') {
        const canvas = document.getElementById('keyframeGraphCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // Background & Grid lines
        ctx.fillStyle = '#12141a';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#222631';
        ctx.lineWidth = 1;
        // Horizontal grid
        for (let y = 15; y < h; y += 20) {
            ctx.beginPath();
            ctx.moveTo(10, y);
            ctx.lineTo(w - 10, y);
            ctx.stroke();
        }
        // Vertical grid
        for (let x = 20; x < w; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 10);
            ctx.lineTo(x, h - 10);
            ctx.stroke();
        }

        // Plot Easing Curve
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();

        const paddingX = 16;
        const paddingY = 16;
        const plotW = w - paddingX * 2;
        const plotH = h - paddingY * 2;

        const steps = 60;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const easedT = this.compositor.evaluateEasing(t, easing);
            const px = paddingX + t * plotW;
            const py = (h - paddingY) - (easedT * plotH);

            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Start and end control diamonds
        ctx.fillStyle = '#10b981';
        ctx.fillRect(paddingX - 3, h - paddingY - 3, 6, 6);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(w - paddingX - 3, paddingY - 3, 6, 6);
    }

    initStudioAnimations() {
        // 1. Studio Sub-Tab Switching (Zoom-n-Pan / Presets / Motion Graph)
        const subTabBar = document.getElementById('animSubTabBar');
        if (subTabBar) {
            subTabBar.querySelectorAll('.tool-filter-pill').forEach(pill => {
                pill.onclick = () => {
                    subTabBar.querySelectorAll('.tool-filter-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    const tabKey = pill.dataset.animSubtab;
                    const tabZoom = document.getElementById('animSubTabZoom');
                    const tabPresets = document.getElementById('animSubTabPresets');
                    const tabKeyframes = document.getElementById('animSubTabKeyframes');
                    if (tabZoom) tabZoom.style.display = (tabKey === 'zoom') ? 'block' : 'none';
                    if (tabPresets) tabPresets.style.display = (tabKey === 'presets') ? 'block' : 'none';
                    if (tabKeyframes) tabKeyframes.style.display = (tabKey === 'keyframes') ? 'block' : 'none';

                    if (tabKey === 'zoom') {
                        const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                        this.updateZoomMonitorUI(clip);
                    } else if (tabKey === 'keyframes') {
                        const selEasing = document.getElementById('selKeyframeEasing');
                        this.drawKeyframeCurveGraph(selEasing ? selEasing.value : 'easeInOut');
                    }
                };
            });
        }

        // 2. Interactive Viewport Monitor Stage Dragging & Resizing
        const stage = document.getElementById('zoomMonitorStage');
        const framingBox = document.getElementById('zoomFramingBox');
        if (stage && framingBox) {
            let isDraggingBox = false;
            let startMouseX = 0;
            let startMouseY = 0;
            let initialBoxLeft = 0;
            let initialBoxTop = 0;

            framingBox.onmousedown = (e) => {
                if (e.target.classList.contains('zoom-handle')) return; // handled by handle resize
                isDraggingBox = true;
                startMouseX = e.clientX;
                startMouseY = e.clientY;
                initialBoxLeft = framingBox.offsetLeft;
                initialBoxTop = framingBox.offsetTop;
                e.preventDefault();

                const onMouseMove = (moveEvt) => {
                    if (!isDraggingBox) return;
                    const dx = moveEvt.clientX - startMouseX;
                    const dy = moveEvt.clientY - startMouseY;
                    const maxLeft = Math.max(0, stage.clientWidth - framingBox.offsetWidth);
                    const maxTop = Math.max(0, stage.clientHeight - framingBox.offsetHeight);
                    const newLeft = Math.max(0, Math.min(maxLeft, initialBoxLeft + dx));
                    const newTop = Math.max(0, Math.min(maxTop, initialBoxTop + dy));

                    framingBox.style.left = `${newLeft}px`;
                    framingBox.style.top = `${newTop}px`;

                    const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                    if (clip) {
                        const scale = clip.scale || 1.0;
                        const centerX = newLeft + framingBox.offsetWidth / 2;
                        const centerY = newTop + framingBox.offsetHeight / 2;
                        const normOffsetX = (stage.clientWidth / 2 - centerX) / (stage.clientWidth / 2);
                        const normOffsetY = (stage.clientHeight / 2 - centerY) / (stage.clientHeight / 2);
                        clip.xOffset = Math.round(normOffsetX * (this.compositor.canvas.width / 2) * (1 - 1 / scale));
                        clip.yOffset = Math.round(normOffsetY * (this.compositor.canvas.height / 2) * (1 - 1 / scale));
                        const propX = document.getElementById('propXOffset');
                        const propY = document.getElementById('propYOffset');
                        if (propX) propX.value = clip.xOffset;
                        if (propY) propY.value = clip.yOffset;
                        this.compositor.renderFrame(this.timeline, this.playheadTime);
                    }
                };

                const onMouseUp = () => {
                    if (isDraggingBox) {
                        isDraggingBox = false;
                        this.timeline.saveSnapshot();
                        window.removeEventListener('mousemove', onMouseMove);
                        window.removeEventListener('mouseup', onMouseUp);
                    }
                };
                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            };

            // Corner Handle Drag Resizing (Zoom In / Out)
            framingBox.querySelectorAll('.zoom-handle').forEach(handle => {
                handle.onmousedown = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    let isResizing = true;
                    const startX = e.clientX;
                    const initialW = framingBox.offsetWidth;

                    const onHandleMove = (moveEvt) => {
                        if (!isResizing) return;
                        const deltaX = (handle.classList.contains('zh-tl') || handle.classList.contains('zh-bl'))
                            ? (startX - moveEvt.clientX)
                            : (moveEvt.clientX - startX);
                        let newW = Math.max(60, Math.min(stage.clientWidth, initialW + deltaX));
                        const newH = newW * (stage.clientHeight / stage.clientWidth);
                        const scale = parseFloat((stage.clientWidth / newW).toFixed(2));

                        framingBox.style.width = `${newW}px`;
                        framingBox.style.height = `${newH}px`;
                        const maxL = Math.max(0, stage.clientWidth - newW);
                        const maxT = Math.max(0, stage.clientHeight - newH);
                        framingBox.style.left = `${Math.min(framingBox.offsetLeft, maxL)}px`;
                        framingBox.style.top = `${Math.min(framingBox.offsetTop, maxT)}px`;

                        const rng = document.getElementById('rngCameraZoom');
                        if (rng) rng.value = Math.round(scale * 100);
                        const lbl = document.getElementById('lblCameraZoomVal');
                        if (lbl) lbl.innerText = `${Math.round(scale * 100)}%`;
                        const pill = document.getElementById('lblZoomLevelPill');
                        if (pill) pill.innerText = `${Math.round(scale * 100)}%`;

                        const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                        if (clip) {
                            clip.scale = scale;
                            const propScale = document.getElementById('propScale');
                            if (propScale) propScale.value = Math.round(scale * 100);
                            const lblScale = document.getElementById('lblScaleUniform');
                            if (lblScale) lblScale.innerText = `${Math.round(scale * 100)}%`;
                            this.compositor.renderFrame(this.timeline, this.playheadTime);
                        }
                    };

                    const onHandleUp = () => {
                        if (isResizing) {
                            isResizing = false;
                            this.timeline.saveSnapshot();
                            window.removeEventListener('mousemove', onHandleMove);
                            window.removeEventListener('mouseup', onHandleUp);
                        }
                    };
                    window.addEventListener('mousemove', onHandleMove);
                    window.addEventListener('mouseup', onHandleUp);
                };
            });
        }

        // 3. Zoom Magnification Slider
        const rngCameraZoom = document.getElementById('rngCameraZoom');
        if (rngCameraZoom) {
            rngCameraZoom.oninput = (e) => {
                const scale = parseInt(e.target.value, 10) / 100.0;
                const lbl = document.getElementById('lblCameraZoomVal');
                if (lbl) lbl.innerText = `${Math.round(scale * 100)}%`;
                const pill = document.getElementById('lblZoomLevelPill');
                if (pill) pill.innerText = (scale === 1.0) ? '100% (Full)' : `${Math.round(scale * 100)}%`;

                const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                if (clip) {
                    clip.scale = scale;
                    this.updateZoomMonitorUI(clip);
                    const propScale = document.getElementById('propScale');
                    if (propScale) propScale.value = Math.round(scale * 100);
                    const lblScale = document.getElementById('lblScaleUniform');
                    if (lblScale) lblScale.innerText = `${Math.round(scale * 100)}%`;
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            };
            rngCameraZoom.onchange = () => this.timeline.saveSnapshot();
        }

        // 4. Studio Smart Framing Presets
        const applyZoomPreset = (scale, xOff, yOff) => {
            const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
            if (!clip) return;
            clip.scale = scale;
            clip.xOffset = xOff;
            clip.yOffset = yOff;
            this.updateZoomMonitorUI(clip);
            this.renderProperties(clip);
            this.timeline.saveSnapshot();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        };

        const w = 1920;
        const h = 1080;
        const btnFit = document.getElementById('btnZoomFit');
        if (btnFit) btnFit.onclick = () => applyZoomPreset(1.0, 0, 0);
        const btn150 = document.getElementById('btnZoom150');
        if (btn150) btn150.onclick = () => applyZoomPreset(1.5, 0, 0);
        const btn200 = document.getElementById('btnZoom200');
        if (btn200) btn200.onclick = () => applyZoomPreset(2.0, 0, 0);
        const btnTL = document.getElementById('btnZoomTL');
        if (btnTL) btnTL.onclick = () => applyZoomPreset(1.8, -Math.round(w * 0.22), -Math.round(h * 0.22));
        const btnTR = document.getElementById('btnZoomTR');
        if (btnTR) btnTR.onclick = () => applyZoomPreset(1.8, Math.round(w * 0.22), -Math.round(h * 0.22));
        const btnBL = document.getElementById('btnZoomBL');
        if (btnBL) btnBL.onclick = () => applyZoomPreset(1.8, -Math.round(w * 0.22), Math.round(h * 0.22));
        const btnBR = document.getElementById('btnZoomBR');
        if (btnBR) btnBR.onclick = () => applyZoomPreset(1.8, Math.round(w * 0.22), Math.round(h * 0.22));
        const btnCenter = document.getElementById('btnZoomCenter');
        if (btnCenter) btnCenter.onclick = () => applyZoomPreset(1.8, 0, 0);
        const btnSmartFocus = document.getElementById('btnZoomSmartFocus');
        if (btnSmartFocus) {
            btnSmartFocus.onclick = () => {
                const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                if (!clip) return;
                // Detect cursor activity at current playhead if telemetry is present
                let targetX = 0;
                let targetY = 0;
                if (clip.telemetry && clip.telemetry.length > 0) {
                    const rel = this.playheadTime - clip.startTime;
                    const pt = clip.telemetry.find(t => Math.abs(t.time - rel) < 1.0) || clip.telemetry[0];
                    if (pt) {
                        targetX = Math.round((pt.x - 0.5) * w * 0.5);
                        targetY = Math.round((pt.y - 0.5) * h * 0.5);
                    }
                }
                applyZoomPreset(1.65, targetX, targetY);
            };
        }

        // 5. Add Animation Arrow vs Instant Zoom Cut
        const btnCreateArrow = document.getElementById('btnCreateZoomArrow');
        if (btnCreateArrow) {
            btnCreateArrow.onclick = () => {
                const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                if (!clip) {
                    alert('Please select a clip on the timeline first to create an animation arrow.');
                    return;
                }
                const dur = (parseInt(document.getElementById('rngAnimDurationInspector')?.value || 10, 10) / 10.0) || 1.0;
                const easing = document.getElementById('selAnimEasingInspector')?.value || 'easeInOut';
                this.createAnimationArrow(clip, dur, {
                    scale: clip.scale || 1.0,
                    x: clip.xOffset || 0,
                    y: clip.yOffset || 0
                }, easing);
            };
        }

        const btnInstantZoom = document.getElementById('btnApplyInstantZoom');
        if (btnInstantZoom) {
            btnInstantZoom.onclick = () => {
                const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                if (!clip) return;
                this.renderProperties(clip);
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        // 6. Animation Inspector Controls
        const rngAnimDur = document.getElementById('rngAnimDurationInspector');
        const lblAnimDur = document.getElementById('lblAnimDurationInspector');
        if (rngAnimDur) {
            rngAnimDur.oninput = (e) => {
                const val = (parseInt(e.target.value, 10) / 10.0).toFixed(1);
                if (lblAnimDur) lblAnimDur.innerText = `${val}s`;
            };
        }

        const btnAddArrowInsp = document.getElementById('btnAddAnimArrowInspector');
        if (btnAddArrowInsp) {
            btnAddArrowInsp.onclick = () => {
                const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                if (!clip) {
                    alert('Select a clip on the timeline first to add an animation arrow.');
                    return;
                }
                const dur = (parseInt(rngAnimDur?.value || 10, 10) / 10.0) || 1.0;
                const easing = document.getElementById('selAnimEasingInspector')?.value || 'easeInOut';
                this.createAnimationArrow(clip, dur, {
                    scale: clip.scale || 1.0,
                    x: clip.xOffset || 0,
                    y: clip.yOffset || 0
                }, easing);
            };
        }

        const btnRestoreInsp = document.getElementById('btnRestoreFullCanvasInspector');
        if (btnRestoreInsp) {
            btnRestoreInsp.onclick = () => {
                const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                if (!clip) return;
                this.applyAnimationPresetToClip(clip, 'restore');
            };
        }

        const btnClearAnimInsp = document.getElementById('btnClearAnimationsInspector');
        if (btnClearAnimInsp) {
            btnClearAnimInsp.onclick = () => {
                const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
                if (!clip) return;
                clip.keyframes = [];
                this.renderInspectorKeyframeBadges(clip);
                this.renderTimeline();
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }
    }

    applyAnimationPresetToClip(clip, presetName, customTimeOffset = null) {
        if (!clip) return;
        const dur = (parseInt(document.getElementById('rngAnimDurationInspector')?.value || 10, 10) / 10.0) || 1.0;
        const easing = document.getElementById('selAnimEasingInspector')?.value || 'easeInOut';
        let targetProps = {};
        let animName = 'Custom';

        if (presetName === 'custom') {
            targetProps = { scale: (clip.scale || 1.0) * 1.3 };
            animName = 'Custom';
        } else if (presetName === 'restore') {
            targetProps = { scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
            animName = 'Restore Full (100%)';
        } else if (presetName === 'smart-focus') {
            targetProps = { scale: 1.6, x: 0, y: 0 };
            animName = 'Smart Focus';
        } else if (presetName === 'scale-up') {
            targetProps = { scale: (clip.scale || 1.0) * 1.5 };
            animName = 'Scale Up';
        } else if (presetName === 'scale-down') {
            targetProps = { scale: Math.max(0.2, (clip.scale || 1.0) * 0.75) };
            animName = 'Scale Down';
        } else if (presetName === 'tilt-left') {
            targetProps = { rotation: -15 };
            animName = 'Tilt Left (-15°)';
        } else if (presetName === 'tilt-right') {
            targetProps = { rotation: 15 };
            animName = 'Tilt Right (+15°)';
        } else if (presetName === 'slide-left') {
            targetProps = { x: (clip.xOffset || 0) - 380 };
            animName = 'Slide Left';
        } else if (presetName === 'slide-right') {
            targetProps = { x: (clip.xOffset || 0) + 380 };
            animName = 'Slide Right';
        } else if (presetName === 'slide-top') {
            targetProps = { y: (clip.yOffset || 0) - 240 };
            animName = 'Slide Top';
        } else if (presetName === 'slide-bottom') {
            targetProps = { y: (clip.yOffset || 0) + 240 };
            animName = 'Slide Bottom';
        } else if (presetName === 'fade-in') {
            targetProps = { opacity: 1.0 };
            animName = 'Fade In';
        } else if (presetName === 'fade-out') {
            targetProps = { opacity: 0.0 };
            animName = 'Fade Out';
        } else if (presetName === 'bounce-pop') {
            targetProps = { scale: 1.0 };
            animName = 'Bounce Pop';
            return this.createAnimationArrow(clip, dur, targetProps, 'bounce', 0.45, animName, presetName, customTimeOffset);
        } else if (presetName === 'cinematic-drift') {
            targetProps = { scale: (clip.scale || 1.0) * 1.15, x: (clip.xOffset || 0) + 90 };
            animName = 'Cinematic Drift';
            return this.createAnimationArrow(clip, 3.0, targetProps, 'easeInOut', null, animName, presetName, customTimeOffset);
        }

        this.createAnimationArrow(clip, dur, targetProps, easing, null, animName, presetName, customTimeOffset);
    }

    createAnimationArrow(clip, duration = 1.0, targetProps = {}, easing = 'easeInOut', initialPropVal = null, animName = 'Animation', presetName = 'custom', customTimeOffset = null) {
        if (!clip) return;
        if (!clip.keyframes) clip.keyframes = [];
        if (!clip.animations) clip.animations = [];

        let relTime;
        if (customTimeOffset !== null && !isNaN(customTimeOffset)) {
            relTime = Math.max(0, Math.min(clip.duration - 0.2, customTimeOffset));
        } else {
            relTime = Math.max(0, Math.min(clip.duration - 0.2, this.playheadTime - clip.startTime));
        }
        const effectiveDur = Math.max(0.15, Math.min(duration, clip.duration - relTime));
        const arrowId = `anim_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

        const startPropsMap = {};
        for (const [prop, targetVal] of Object.entries(targetProps)) {
            let startVal;
            if (initialPropVal !== null) {
                startVal = initialPropVal;
            } else if (prop === 'scale') {
                startVal = clip.scale !== undefined ? clip.scale : 1.0;
            } else if (prop === 'x') {
                startVal = clip.xOffset || 0;
            } else if (prop === 'y') {
                startVal = clip.yOffset || 0;
            } else if (prop === 'rotation') {
                startVal = clip.rotation || 0;
            } else if (prop === 'opacity') {
                startVal = clip.opacity !== undefined ? clip.opacity : 1.0;
            } else {
                startVal = 1.0;
            }
            startPropsMap[prop] = startVal;

            // Remove colliding keyframes right at relTime or relTime + effectiveDur
            clip.keyframes = clip.keyframes.filter(k => 
                !(k.property === prop && (Math.abs(k.timeOffset - relTime) < 0.05 || Math.abs(k.timeOffset - (relTime + effectiveDur)) < 0.05))
            );

            // Start keyframe
            clip.keyframes.push({
                id: `kf_${Date.now()}_${prop}_start`,
                arrowId,
                timeOffset: parseFloat(relTime.toFixed(2)),
                property: prop,
                value: startVal,
                easing
            });

            // End keyframe
            clip.keyframes.push({
                id: `kf_${Date.now()}_${prop}_end`,
                arrowId,
                timeOffset: parseFloat((relTime + effectiveDur).toFixed(2)),
                property: prop,
                value: targetVal,
                easing
            });
        }

        // Add Studio Animation Arrow object
        const animItem = {
            id: arrowId,
            name: animName,
            type: presetName,
            timeOffset: parseFloat(relTime.toFixed(2)),
            duration: parseFloat(effectiveDur.toFixed(2)),
            easing: easing,
            targetProps: { ...targetProps },
            startProps: { ...startPropsMap }
        };
        clip.animations.push(animItem);
        clip.animations.sort((a, b) => a.timeOffset - b.timeOffset);

        clip.keyframes.sort((a, b) => a.timeOffset - b.timeOffset);
        this.timeline.selectedClipId = clip.id;
        this.timeline.selectedAnimationId = arrowId;
        this.inspectAnimation(clip, animItem);
        this.renderProperties(clip);
        this.timeline.saveSnapshot();
        this.renderTimeline();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    inspectAnimation(clip, anim) {
        if (!anim) return;
        this.timeline.selectedAnimationId = anim.id;
        const rngDur = document.getElementById('rngAnimDurationInspector');
        const lblDur = document.getElementById('lblAnimDurationInspector');
        const selEasing = document.getElementById('selAnimEasingInspector');
        if (rngDur) rngDur.value = Math.round(anim.duration * 10);
        if (lblDur) lblDur.innerText = `${anim.duration.toFixed(1)}s`;
        if (selEasing) selEasing.value = anim.easing || 'easeInOut';

        if (rngDur) {
            rngDur.oninput = (e) => {
                const newDur = Math.max(0.15, Math.min(clip.duration - anim.timeOffset, parseInt(e.target.value, 10) / 10.0));
                anim.duration = parseFloat(newDur.toFixed(2));
                if (lblDur) lblDur.innerText = `${anim.duration.toFixed(1)}s`;
                if (clip.keyframes) {
                    for (const kf of clip.keyframes) {
                        if (kf.arrowId === anim.id && kf.id.endsWith('_end')) {
                            kf.timeOffset = parseFloat((anim.timeOffset + anim.duration).toFixed(2));
                        }
                    }
                }
                this.timeline.saveSnapshot();
                this.renderTimeline();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }
        if (selEasing) {
            selEasing.onchange = (e) => {
                anim.easing = e.target.value;
                if (clip.keyframes) {
                    for (const kf of clip.keyframes) {
                        if (kf.arrowId === anim.id) kf.easing = anim.easing;
                    }
                }
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }

        this.focusInspectorSection('sectionAnimationProps');
    }

    deleteSelectedAnimation() {
        if (!this.timeline.selectedAnimationId) return;
        const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
        if (clip) {
            if (clip.animations) {
                clip.animations = clip.animations.filter(a => a.id !== this.timeline.selectedAnimationId);
            }
            if (clip.keyframes) {
                clip.keyframes = clip.keyframes.filter(k => k.arrowId !== this.timeline.selectedAnimationId);
            }
            this.timeline.selectedAnimationId = null;
            this.timeline.saveSnapshot();
            this.renderInspectorKeyframeBadges(clip);
            this.renderTimeline();
            this.compositor.renderFrame(this.timeline, this.playheadTime);
        }
    }

    renderInspectorKeyframeBadges(clip) {
        const badgeContainer = document.getElementById('inspectorKeyframeBadges');
        if (!badgeContainer) return;
        badgeContainer.innerHTML = '';

        if (!clip || !clip.keyframes || clip.keyframes.length === 0) {
            badgeContainer.innerHTML = '<span style="font-size: 10px; color: var(--text-secondary); font-style: italic;">No keyframes or animation arrows on this clip.</span>';
            return;
        }

        clip.keyframes.forEach((kf, idx) => {
            const chip = document.createElement('div');
            chip.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; background: rgba(59,130,246,0.18); border: 1px solid rgba(59,130,246,0.35); border-radius: 4px; padding: 2px 6px; font-size: 10px; color: #93c5fd; cursor: pointer;';
            chip.title = `Keyframe ${kf.property}: ${kf.value} at ${kf.timeOffset.toFixed(2)}s (${kf.easing})`;
            chip.innerHTML = `<span><strong>${kf.property}</strong>: ${typeof kf.value === 'number' ? kf.value.toFixed(1) : kf.value} @ ${kf.timeOffset.toFixed(1)}s</span><span style="color: #ef4444; font-weight: bold; margin-left: 2px;" title="Delete keyframe">✕</span>`;
            
            // Clicking delete '✕'
            const delBtn = chip.querySelector('span:last-child');
            delBtn.onclick = (e) => {
                e.stopPropagation();
                clip.keyframes.splice(idx, 1);
                this.timeline.saveSnapshot();
                this.renderInspectorKeyframeBadges(clip);
                this.renderTimeline();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };

            // Clicking chip jumps playhead to keyframe
            chip.onclick = () => {
                this.playheadTime = clip.startTime + kf.timeOffset;
                this.updateTimelinePlayhead();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };

            badgeContainer.appendChild(chip);
        });
    }

    updateZoomMonitorUI(clip) {
        const stage = document.getElementById('zoomMonitorStage');
        const canvas = document.getElementById('zoomMonitorCanvas');
        const framingBox = document.getElementById('zoomFramingBox');
        if (!stage || !canvas || !framingBox) return;

        // Render current compositor frame onto mini monitor canvas
        if (this.compositor && this.compositor.canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(this.compositor.canvas, 0, 0, canvas.width, canvas.height);
        }

        const scale = clip ? (clip.scale || 1.0) : 1.0;
        const xOff = clip ? (clip.xOffset || 0) : 0;
        const yOff = clip ? (clip.yOffset || 0) : 0;

        const stageW = stage.clientWidth || 280;
        const stageH = stage.clientHeight || 158;
        const boxW = Math.max(50, stageW / scale);
        const boxH = Math.max(30, stageH / scale);

        const canvasW = this.compositor.canvas.width || 1920;
        const canvasH = this.compositor.canvas.height || 1080;
        const normOffsetX = (scale > 1.0) ? (xOff / ((canvasW / 2) * (1 - 1 / scale))) : 0;
        const normOffsetY = (scale > 1.0) ? (yOff / ((canvasH / 2) * (1 - 1 / scale))) : 0;

        const centerX = (stageW / 2) - normOffsetX * (stageW / 2);
        const centerY = (stageH / 2) - normOffsetY * (stageH / 2);
        const boxL = Math.max(0, Math.min(stageW - boxW, centerX - boxW / 2));
        const boxT = Math.max(0, Math.min(stageH - boxH, centerY - boxH / 2));

        framingBox.style.width = `${boxW}px`;
        framingBox.style.height = `${boxH}px`;
        framingBox.style.left = `${boxL}px`;
        framingBox.style.top = `${boxT}px`;

        const rng = document.getElementById('rngCameraZoom');
        if (rng) rng.value = Math.round(scale * 100);
        const lbl = document.getElementById('lblCameraZoomVal');
        if (lbl) lbl.innerText = `${Math.round(scale * 100)}%`;
        const pill = document.getElementById('lblZoomLevelPill');
        if (pill) pill.innerText = (scale === 1.0) ? '100% (Full)' : `${Math.round(scale * 100)}%`;
    }

    async syncSystemFonts(showNotification = false) {
        const btnSyncFonts = document.getElementById('btnSyncSystemFonts');
        const optgroup = document.getElementById('optgroupSystemFonts');
        if (!optgroup) return;

        if (btnSyncFonts && showNotification) {
            btnSyncFonts.innerText = '🔄 Scanning All System & User Fonts...';
            btnSyncFonts.disabled = true;
        }

        const foundFonts = new Set();

        // 1. Fetch all installed Windows system & user fonts from studio backend server
        try {
            const res = await fetch('/api/system/fonts');
            if (res.ok) {
                const data = await res.json();
                if (data && data.fonts && Array.isArray(data.fonts)) {
                    for (const fontName of data.fonts) {
                        if (fontName && fontName.trim()) {
                            foundFonts.add(fontName.trim());
                        }
                    }
                }
            }
        } catch (apiErr) {
            console.log('Server font API unavailable, fallback to browser font detection:', apiErr);
        }

        // 2. Query Local Font Access API if supported (Chrome/Edge on Windows)
        if ('queryLocalFonts' in window) {
            try {
                const localFonts = await window.queryLocalFonts();
                for (const f of localFonts) {
                    if (f.family) foundFonts.add(f.family);
                }
            } catch (err) {
                console.log('Local Font Access permission not granted:', err);
            }
        }

        // 3. Canvas Probing Fallback if no fonts discovered yet
        if (foundFonts.size === 0) {
            const candidateFonts = [
                'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 
                'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 
                'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 
                'Impact', 'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Lucida Console', 
                'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Himalaya', 
                'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa', 
                'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft Yi Baiti', 
                'MingLiU-ExtB', 'Mongolian Baiti', 'MS Gothic', 'MS PGothic', 'MS UI Gothic', 
                'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe Print', 
                'Segoe Script', 'Segoe UI', 'Segoe UI Historic', 'Segoe UI Emoji', 
                'Segoe UI Symbol', 'SimSun', 'Sitka Text', 'Sylfaen', 'Symbol', 'Tahoma', 
                'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic'
            ];
            const probeCanvas = document.createElement('canvas');
            const probeCtx = probeCanvas.getContext('2d');
            const testString = 'mmmmmmmmmmlliWWWWWW12345!@#$%^';

            probeCtx.font = '72px monospace';
            const baseMono = probeCtx.measureText(testString).width;
            probeCtx.font = '72px sans-serif';
            const baseSans = probeCtx.measureText(testString).width;
            probeCtx.font = '72px serif';
            const baseSerif = probeCtx.measureText(testString).width;

            for (const fontName of candidateFonts) {
                if (document.fonts && document.fonts.check(`16px "${fontName}"`)) {
                    foundFonts.add(fontName);
                    continue;
                }
                probeCtx.font = `72px "${fontName}", monospace`;
                const w1 = probeCtx.measureText(testString).width;
                probeCtx.font = `72px "${fontName}", sans-serif`;
                const w2 = probeCtx.measureText(testString).width;
                probeCtx.font = `72px "${fontName}", serif`;
                const w3 = probeCtx.measureText(testString).width;

                if (w1 !== baseMono || w2 !== baseSans || w3 !== baseSerif) {
                    foundFonts.add(fontName);
                }
            }
        }

        const sorted = Array.from(foundFonts).sort((a, b) => a.localeCompare(b));
        if (sorted.length > 0) {
            optgroup.innerHTML = '';
            sorted.forEach(fName => {
                const opt = document.createElement('option');
                opt.value = fName;
                opt.textContent = fName;
                optgroup.appendChild(opt);
            });

            // Resync current clip's font value if selected
            const clip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
            if (clip && clip.fontFamily) {
                const propFontFamily = document.getElementById('propFontFamily');
                if (propFontFamily) propFontFamily.value = clip.fontFamily;
            }

            if (btnSyncFonts) {
                btnSyncFonts.innerText = `✓ Synced ${sorted.length} Windows Fonts`;
                btnSyncFonts.style.color = '#10b981';
            }
        }

        if (btnSyncFonts) {
            setTimeout(() => {
                btnSyncFonts.disabled = false;
                if (!showNotification) {
                    btnSyncFonts.innerText = `🔄 Sync Windows Fonts (${sorted.length})`;
                }
            }, 1800);
        }
    }

    initSystemFontSync() {
        const btnSyncFonts = document.getElementById('btnSyncSystemFonts');
        if (btnSyncFonts) {
            btnSyncFonts.onclick = () => this.syncSystemFonts(true);
        }
        // Automatically populate all system and user installed fonts on load!
        this.syncSystemFonts(false);
    }

    initCalloutReset() {
        const btnClearCallout = document.getElementById('btnClearCalloutProps');
        if (btnClearCallout) {
            btnClearCallout.onclick = () => {
                const clip = this.timeline.getClip(this.timeline.selectedClipId);
                if (!clip || clip.type !== 'callout') return;
                clip.fontFamily = "'Inter', sans-serif";
                clip.fontWeight = "bold";
                clip.letterCase = "default";
                clip.fillType = "solid";
                clip.color = "#3b82f6";
                clip.fontSize = 28;
                clip.tracking = 0;
                clip.lineSpacing = 1.2;
                clip.outlineColor = "#000000";
                clip.outlineThickness = 0;
                clip.glowColor = "#00f2fe";
                clip.glowBlur = 0;
                clip.shadowColor = "#000000";
                clip.shadowBlur = 0;
                this.renderProperties(clip);
                this.timeline.saveSnapshot();
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            };
        }
    }

    setAspectRatioPreset(aspect) {
        const selAspect = document.getElementById('selAspectRatioPreset');
        if (selAspect && selAspect.value !== aspect) {
            selAspect.value = aspect;
        }
        const lblAspectTag = document.getElementById('lblCanvasAspectTag');
        if (lblAspectTag) {
            lblAspectTag.innerText = aspect.toUpperCase();
        }

        if (aspect === '16:9') {
            this.compositor.setProjectSettings(1920, 1080, 30, '#0f1115', '1080p FHD (16:9)');
            document.getElementById('lblCanvasDimensions').innerText = '1920x1080 (16:9)';
        } else if (aspect === '9:16') {
            this.compositor.setProjectSettings(1080, 1920, 30, '#0f1115', 'Vertical Shorts (9:16)');
            document.getElementById('lblCanvasDimensions').innerText = '1080x1920 (9:16)';
        } else if (aspect === '1:1') {
            this.compositor.setProjectSettings(1080, 1080, 30, '#0f1115', 'Instagram Square (1:1)');
            document.getElementById('lblCanvasDimensions').innerText = '1080x1080 (1:1)';
        } else if (aspect === '4:5') {
            this.compositor.setProjectSettings(1080, 1350, 30, '#0f1115', 'Social Feed (4:5)');
            document.getElementById('lblCanvasDimensions').innerText = '1080x1350 (4:5)';
        } else if (aspect === '21:9') {
            this.compositor.setProjectSettings(2560, 1080, 30, '#0f1115', 'Ultrawide Cinema (21:9)');
            document.getElementById('lblCanvasDimensions').innerText = '2560x1080 (21:9)';
        } else if (aspect === '4:3') {
            this.compositor.setProjectSettings(1440, 1080, 30, '#0f1115', 'Classic Standard (4:3)');
            document.getElementById('lblCanvasDimensions').innerText = '1440x1080 (4:3)';
        } else if (aspect === 'custom') {
            document.getElementById('projectSettingsModal').classList.remove('hidden');
            return;
        }

        this.timeline.saveSnapshot();
        this.compositor.renderFrame(this.timeline, this.playheadTime);
    }

    // ==========================================
    // CANVAS DIRECT MANIPULATION & GIZMO
    // ==========================================

    setupCanvasInteraction() {
        const canvas = this.canvas;
        let isInteracting = false;
        let hasMoved = false;
        let interactionMode = null; // 'translate' | 'rotate' | 'resize' | 'pan' | 'crop'
        let resizeHandle = null;
        let startClientPos = { x: 0, y: 0 };
        let startCanvasPos = { x: 0, y: 0 };
        let startClipBounds = null;
        let startClipState = null;
        let startPanOffset = { x: 0, y: 0 };

        const getCanvasPoint = (e) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const panX = this.compositor.panOffset?.x || 0;
            const panY = this.compositor.panOffset?.y || 0;
            return {
                x: (e.clientX - rect.left) * scaleX - panX,
                y: (e.clientY - rect.top) * scaleY - panY
            };
        };

        const distance = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const pt = getCanvasPoint(e);
            startClientPos = { x: e.clientX, y: e.clientY };
            startCanvasPos = pt;
            hasMoved = false;

            // 1. Hand Pan Tool
            if (this.compositor.activeCanvasTool === 'hand') {
                isInteracting = true;
                interactionMode = 'pan';
                startPanOffset = { ...this.compositor.panOffset };
                canvas.style.cursor = 'grabbing';
                return;
            }

            // 2. Pointer / Select Tool
            if (this.compositor.activeCanvasTool === 'pointer') {
                let selClip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;

                // Check if clicked on gizmo of selected clip
                if (selClip) {
                    const b = this.compositor.getClipCanvasBounds(selClip);
                    const hw = b.width / 2;
                    const hh = b.height / 2;

                    // Test rotation handle (top handle)
                    const rotRad = (b.rotation || 0) * Math.PI / 180;
                    const cosR = Math.cos(rotRad);
                    const sinR = Math.sin(rotRad);

                    const rotHandleRelY = -hh - 34;
                    const rotHandleX = b.cx + (0 * cosR - rotHandleRelY * sinR);
                    const rotHandleY = b.cy + (0 * sinR + rotHandleRelY * cosR);

                    if (distance(pt.x, pt.y, rotHandleX, rotHandleY) <= 16) {
                        isInteracting = true;
                        interactionMode = 'rotate';
                        startClipState = { rotation: selClip.rotation || 0 };
                        startClipBounds = b;
                        return;
                    }

                    // Test 8 resize handles
                    const handles = [
                        { type: 'nw', rx: -hw, ry: -hh },
                        { type: 'n',  rx: 0,   ry: -hh },
                        { type: 'ne', rx: hw,  ry: -hh },
                        { type: 'e',  rx: hw,  ry: 0   },
                        { type: 'se', rx: hw,  ry: hh  },
                        { type: 's',  rx: 0,   ry: hh  },
                        { type: 'sw', rx: -hw, ry: hh  },
                        { type: 'w',  rx: -hw, ry: 0   }
                    ];

                    for (const h of handles) {
                        const hx = b.cx + (h.rx * cosR - h.ry * sinR);
                        const hy = b.cy + (h.rx * sinR + h.ry * cosR);
                        if (distance(pt.x, pt.y, hx, hy) <= 14) {
                            isInteracting = true;
                            interactionMode = 'resize';
                            resizeHandle = h.type;
                            startClipState = {
                                scale: selClip.scale || 1.0,
                                scaleX: selClip.scaleX !== undefined ? selClip.scaleX : (selClip.scale || 1.0),
                                scaleY: selClip.scaleY !== undefined ? selClip.scaleY : (selClip.scale || 1.0),
                                xOffset: selClip.xOffset || 0,
                                yOffset: selClip.yOffset || 0
                            };
                            startClipBounds = b;
                            return;
                        }
                    }

                    // Test inside bounding box
                    const dx = pt.x - b.cx;
                    const dy = pt.y - b.cy;
                    const unrotX = dx * Math.cos(-rotRad) - dy * Math.sin(-rotRad);
                    const unrotY = dx * Math.sin(-rotRad) + dy * Math.cos(-rotRad);

                    if (Math.abs(unrotX) <= hw && Math.abs(unrotY) <= hh) {
                        isInteracting = true;
                        interactionMode = 'translate';
                        startClipState = {
                            xOffset: selClip.xOffset || 0,
                            yOffset: selClip.yOffset || 0
                        };
                        return;
                    }
                }

                // If not clicking on gizmo, hit-test active clips from top layer down
                const activeClips = this.timeline.clips
                    .filter(c => this.playheadTime >= c.startTime && this.playheadTime <= (c.startTime + c.duration))
                    .sort((a, b) => b.trackId - a.trackId);

                let hitClip = null;
                for (const clip of activeClips) {
                    const b = this.compositor.getClipCanvasBounds(clip);
                    const rotRad = (b.rotation || 0) * Math.PI / 180;
                    const dx = pt.x - b.cx;
                    const dy = pt.y - b.cy;
                    const unrotX = dx * Math.cos(-rotRad) - dy * Math.sin(-rotRad);
                    const unrotY = dx * Math.sin(-rotRad) + dy * Math.cos(-rotRad);
                    if (Math.abs(unrotX) <= b.width / 2 && Math.abs(unrotY) <= b.height / 2) {
                        hitClip = clip;
                        break;
                    }
                }

                if (hitClip) {
                    this.timeline.selectedClipId = hitClip.id;
                    this.renderTimeline();
                    isInteracting = true;
                    interactionMode = 'translate';
                    startClipState = {
                        xOffset: hitClip.xOffset || 0,
                        yOffset: hitClip.yOffset || 0
                    };
                    this.renderProperties(hitClip);
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                } else {
                    // Clicked on empty canvas background
                    this.timeline.selectedClipId = null;
                    this.renderTimeline();
                    this.renderProperties(null);
                    this.compositor.renderFrame(this.timeline, this.playheadTime);
                }
            }

            // 3. Crop Tool
            if (this.compositor.activeCanvasTool === 'crop' && this.timeline.selectedClipId) {
                const selClip = this.timeline.getClip(this.timeline.selectedClipId);
                if (selClip) {
                    const handle = this.compositor.getCropHandleAtPoint(selClip, pt, canvas.width, canvas.height);
                    if (handle) {
                        isInteracting = true;
                        interactionMode = 'crop';
                        resizeHandle = handle;
                        if (!selClip.crop) selClip.crop = { top: 0, right: 0, bottom: 0, left: 0 };
                        startClipState = { ...selClip.crop };
                        return;
                    }
                }
            }
        });

        const onPointerMove = (e) => {
            if (!isInteracting) return;
            if (Math.hypot(e.clientX - startClientPos.x, e.clientY - startClientPos.y) > 4) {
                hasMoved = true;
            }
            const pt = getCanvasPoint(e);
            const deltaX = pt.x - startCanvasPos.x;
            const deltaY = pt.y - startCanvasPos.y;

            if (interactionMode === 'pan') {
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const deltaClientX = (e.clientX - startClientPos.x) * scaleX;
                const deltaClientY = (e.clientY - startClientPos.y) * scaleY;
                if (!this.compositor.panOffset) this.compositor.panOffset = { x: 0, y: 0 };
                this.compositor.panOffset.x = Math.round(startPanOffset.x + deltaClientX);
                this.compositor.panOffset.y = Math.round(startPanOffset.y + deltaClientY);
                this.compositor.renderFrame(this.timeline, this.playheadTime);
                return;
            }

            const selClip = this.timeline.selectedClipId ? this.timeline.getClip(this.timeline.selectedClipId) : null;
            if (!selClip) return;

            if (interactionMode === 'crop') {
                if (!selClip.crop) selClip.crop = { top: 0, right: 0, bottom: 0, left: 0 };
                const scaleX = selClip.scaleX !== undefined ? selClip.scaleX : (selClip.scale || 1.0);
                const scaleY = selClip.scaleY !== undefined ? selClip.scaleY : (selClip.scale || 1.0);
                const ratioX = 1 / Math.max(0.01, scaleX);
                const ratioY = 1 / Math.max(0.01, scaleY);

                if (resizeHandle === 'left' || resizeHandle === 'nw' || resizeHandle === 'sw') {
                    selClip.crop.left = Math.max(0, Math.round(startClipState.left + deltaX * ratioX));
                }
                if (resizeHandle === 'right' || resizeHandle === 'ne' || resizeHandle === 'se') {
                    selClip.crop.right = Math.max(0, Math.round(startClipState.right - deltaX * ratioX));
                }
                if (resizeHandle === 'top' || resizeHandle === 'nw' || resizeHandle === 'ne') {
                    selClip.crop.top = Math.max(0, Math.round(startClipState.top + deltaY * ratioY));
                }
                if (resizeHandle === 'bottom' || resizeHandle === 'sw' || resizeHandle === 'se') {
                    selClip.crop.bottom = Math.max(0, Math.round(startClipState.bottom - deltaY * ratioY));
                }
                this.compositor.renderFrame(this.timeline, this.playheadTime);
                this.markDirty(true);
                return;
            }

            if (interactionMode === 'translate') {
                selClip.xOffset = Math.round(startClipState.xOffset + deltaX);
                selClip.yOffset = Math.round(startClipState.yOffset + deltaY);
                const pX = document.getElementById('propXOffset');
                const pY = document.getElementById('propYOffset');
                if (pX) pX.value = selClip.xOffset;
                if (pY) pY.value = selClip.yOffset;
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            } else if (interactionMode === 'rotate') {
                const b = startClipBounds;
                const angle = Math.atan2(pt.y - b.cy, pt.x - b.cx) * (180 / Math.PI) + 90;
                selClip.rotation = Math.round(((angle % 360) + 360) % 360);
                const pRot = document.getElementById('propRotation');
                if (pRot) pRot.value = selClip.rotation;
                const pRotSlider = document.getElementById('propRotationSlider');
                if (pRotSlider) pRotSlider.value = selClip.rotation;
                const lblKnob = document.getElementById('lblKnobRotation');
                if (lblKnob) lblKnob.innerText = `${selClip.rotation}°`;
                const knob = document.getElementById('knobRotation');
                if (knob) {
                    const ind = knob.querySelector('.knob-indicator');
                    if (ind) {
                        ind.style.transform = `rotate(${selClip.rotation}deg)`;
                        ind.style.transformOrigin = '50% 21px';
                    }
                }
                this.compositor.renderFrame(this.timeline, this.playheadTime);
            } else if (interactionMode === 'resize') {
                const b = startClipBounds;
                const hw = b.width / 2;
                const hh = b.height / 2;
                const rotRad = (b.rotation || 0) * Math.PI / 180;
                const cosR = Math.cos(rotRad);
                const sinR = Math.sin(rotRad);
                const localDeltaX = deltaX * cosR + deltaY * sinR;
                const localDeltaY = -deltaX * sinR + deltaY * cosR;

                const signX = resizeHandle.includes('e') ? 1 : (resizeHandle.includes('w') ? -1 : 0);
                const signY = resizeHandle.includes('s') ? 1 : (resizeHandle.includes('n') ? -1 : 0);
                const isCorner = (signX !== 0 && signY !== 0);

                const newW = Math.max(20, b.width + localDeltaX * signX);
                const newH = Math.max(20, b.height + localDeltaY * signY);
                const factorX = signX !== 0 ? (newW / b.width) : 1.0;
                const factorY = signY !== 0 ? (newH / b.height) : 1.0;

                const lockAspect = document.getElementById('chkLockAspect')?.checked ?? (selClip.type !== 'callout');
                let shiftLocalX = 0;
                let shiftLocalY = 0;

                if (isCorner && lockAspect) {
                    const factor = Math.max(0.05, (factorX + factorY) / 2);
                    selClip.scaleX = Math.max(0.05, Math.min(5.0, startClipState.scaleX * factor));
                    selClip.scaleY = Math.max(0.05, Math.min(5.0, startClipState.scaleY * factor));
                    selClip.scale = Math.max(0.05, Math.min(5.0, startClipState.scale * factor));
                    shiftLocalX = signX * (b.width * factor - b.width) / 2;
                    shiftLocalY = signY * (b.height * factor - b.height) / 2;
                } else {
                    if (signX !== 0) {
                        selClip.scaleX = Math.max(0.05, Math.min(5.0, startClipState.scaleX * factorX));
                        shiftLocalX = signX * (newW - b.width) / 2;
                    }
                    if (signY !== 0) {
                        selClip.scaleY = Math.max(0.05, Math.min(5.0, startClipState.scaleY * factorY));
                        shiftLocalY = signY * (newH - b.height) / 2;
                    }
                    selClip.scale = (selClip.scaleX + selClip.scaleY) / 2;
                }

                // Anchor opposite edge / corner during handle dragging
                const deltaCanvasX = shiftLocalX * cosR - shiftLocalY * sinR;
                const deltaCanvasY = shiftLocalX * sinR + shiftLocalY * cosR;
                selClip.xOffset = Math.round(startClipState.xOffset + deltaCanvasX);
                selClip.yOffset = Math.round(startClipState.yOffset + deltaCanvasY);

                // Sync Inspector property sliders
                const sPct = Math.round((selClip.scale || 1.0) * 100);
                const sxPct = Math.round((selClip.scaleX || 1.0) * 100);
                const syPct = Math.round((selClip.scaleY || 1.0) * 100);
                const pScale = document.getElementById('propScale');
                const pScaleX = document.getElementById('propScaleX');
                const pScaleY = document.getElementById('propScaleY');
                const lScale = document.getElementById('lblScaleUniform');
                const lScaleX = document.getElementById('lblScaleX');
                const lScaleY = document.getElementById('lblScaleY');
                const pX = document.getElementById('propXOffset');
                const pY = document.getElementById('propYOffset');
                if (pScale) pScale.value = sPct;
                if (pScaleX) pScaleX.value = sxPct;
                if (pScaleY) pScaleY.value = syPct;
                if (lScale) lScale.innerText = `${sPct}%`;
                if (lScaleX) lScaleX.innerText = `${sxPct}%`;
                if (lScaleY) lScaleY.innerText = `${syPct}%`;
                if (pX) pX.value = selClip.xOffset;
                if (pY) pY.value = selClip.yOffset;

                this.compositor.renderFrame(this.timeline, this.playheadTime);
            }
        };

        const onPointerUp = () => {
            if (isInteracting) {
                isInteracting = false;
                interactionMode = null;
                canvas.style.cursor = this.compositor.activeCanvasTool === 'hand' ? 'grab' : (this.compositor.activeCanvasTool === 'crop' ? 'crosshair' : 'default');
                this.timeline.saveSnapshot();
                this.markDirty(true);
            }
        };

        canvas.addEventListener('dblclick', (e) => {
            if (this.compositor.activeCanvasTool === 'hand') {
                this.compositor.panOffset = { x: 0, y: 0 };
                this.compositor.renderFrame(this.timeline, this.playheadTime);
                return;
            }
            const pt = getCanvasPoint(e);
            const activeClips = this.timeline.clips
                .filter(c => this.playheadTime >= c.startTime && this.playheadTime <= (c.startTime + c.duration))
                .sort((a, b) => b.trackId - a.trackId);

            for (const clip of activeClips) {
                if (clip.type === 'callout') {
                    const b = this.compositor.getClipCanvasBounds(clip);
                    const rotRad = (b.rotation || 0) * Math.PI / 180;
                    const dx = pt.x - b.cx;
                    const dy = pt.y - b.cy;
                    const unrotX = dx * Math.cos(-rotRad) - dy * Math.sin(-rotRad);
                    const unrotY = dx * Math.sin(-rotRad) + dy * Math.cos(-rotRad);
                    if (Math.abs(unrotX) <= b.width / 2 && Math.abs(unrotY) <= b.height / 2) {
                        this.timeline.selectedClipId = clip.id;
                        this.renderTimeline();
                        this.renderProperties(clip);
                        this.openCanvasInlineEditor(clip);
                        break;
                    }
                }
            }
        });

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    }

    // ==========================================
    // PROJECT MANAGER & PERSISTENCE
    // ==========================================

    async openProjectsModal() {
        const modal = document.getElementById('projectsModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        await this.loadProjectsList();
    }

    async loadProjectsList() {
        const container = document.getElementById('projectsListContainer');
        if (!container) return;
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; grid-column: span 2; text-align: center; padding: 20px;">Loading projects...</div>';

        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            const projects = data.projects || [];
            container.innerHTML = '';

            if (projects.length === 0) {
                container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; grid-column: span 2; text-align: center; padding: 20px;">No saved projects found. Save your current studio or start a new one!</div>';
                return;
            }

            for (const proj of projects) {
                const card = document.createElement('div');
                card.className = 'asset-card';
                card.style.display = 'flex';
                card.style.flexDirection = 'column';
                card.style.justifyContent = 'space-between';
                card.style.padding = '12px';
                card.style.height = '110px';

                const dateStr = proj.updatedAt ? new Date(proj.updatedAt).toLocaleDateString() : '';

                card.innerHTML = `
                    <div>
                        <div class="asset-title" style="font-size: 13px;">🎬 ${proj.title}</div>
                        <div class="asset-sub" style="font-size: 11px;">Duration: ${proj.duration ? proj.duration.toFixed(0) : '0'}s | Modified: ${dateStr}</div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                        <button class="btn btn-primary btn-open-proj" style="flex: 1; padding: 5px 8px; font-size: 11px;" data-id="${proj.id}">
                            ▶ Open
                        </button>
                        <button class="btn btn-secondary btn-del-proj" style="padding: 5px 8px; font-size: 11px; color: #ef4444;" data-id="${proj.id}" title="Delete Project">
                            🗑
                        </button>
                    </div>
                `;

                card.querySelector('.btn-open-proj').onclick = () => this.openProject(proj.id);
                card.querySelector('.btn-del-proj').onclick = () => this.deleteProject(proj.id);
                container.appendChild(card);
            }
        } catch (err) {
            container.innerHTML = `<div style="color: #ef4444; font-size: 12px; grid-column: span 2; text-align: center; padding: 20px;">Failed to load projects: ${err.message}</div>`;
        }
    }

    async openProject(id) {
        try {
            const res = await fetch(`/api/projects/${id}`);
            if (!res.ok) throw new Error('Project file not found');
            const project = await res.json();
            if (this.compositor) this.compositor.cleanupMediaResources();
            this.timeline.loadProjectData(project);

            if (project.projectSettings) {
                const s = project.projectSettings;
                this.compositor.setProjectSettings(s.width || 1920, s.height || 1080, s.fps || 30, s.backgroundColor, s.name);
                document.getElementById('lblCanvasDimensions').innerText = `${s.width}x${s.height} (${s.fps}fps)`;
            }

            this.seek(0);
            this.renderTimeline();
            this.updateTimelineRuler();
            this.renderCaptionList();
            document.getElementById('projectsModal').classList.add('hidden');
            alert(`Project "${project.title || id}" successfully loaded!`);
        } catch (err) {
            alert(`Failed to open project: ${err.message}`);
        }
    }

    async deleteProject(id) {
        if (!confirm(`Are you sure you want to permanently delete this project?`)) return;
        try {
            const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
            if (res.ok) {
                await this.loadProjectsList();
            } else {
                alert('Could not delete project.');
            }
        } catch (err) {
            alert(`Delete failed: ${err.message}`);
        }
    }

    newProject() {
        if (!confirm('Start a new blank project? Any unsaved edits on the current timeline will be lost.')) return;
        if (this.compositor) this.compositor.cleanupMediaResources();
        this.timeline.clips = [];
        this.timeline.markers = [];
        this.timeline.captions = [];
        this.timeline.totalDuration = 30.0;
        this.timeline.selectedClipId = null;
        this.timeline.selectionStart = null;
        this.timeline.selectionEnd = null;
        this.timeline.saveSnapshot();
        this.seek(0);
        this.renderTimeline();
        this.updateTimelineRuler();
        this.renderCaptionList();
        const modal = document.getElementById('projectsModal');
        if (modal) modal.classList.add('hidden');
    }
}

function initApp() {
    if (!window.rpaStudio) {
        window.rpaStudio = new RpaStudioApp();
    }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initApp();
} else {
    window.addEventListener('DOMContentLoaded', initApp);
    window.addEventListener('load', initApp);
}
