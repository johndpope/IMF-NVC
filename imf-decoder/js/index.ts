import { init, verifyWasmBuild, runDecoderTests } from './utils/wasm-test';
import { 
    WasmModule,  
    ReferenceData, 
    FrameToken, 
    VerifyResult,
    TestResult,
    PlayerStatus,
    DecoderStatus 
} from './types';
import { logInterceptor, LogInterceptor } from './log-interceptor';
import '../styles/styles.css';

class TestUI {
    private decoder: IMFDecoder | null = null;
    private playerStatus: PlayerStatus = PlayerStatus.Idle;
    private decoderStatus: DecoderStatus = DecoderStatus.Idle;
    private animationFrameId: number | null = null;
    private frameCount: number = 0;
    private canvas: HTMLCanvasElement | null = null;
    private logInterceptor: LogInterceptor;
    private debugMetricsInterval: number | null = null;

    private buttons!: {
        verify: HTMLButtonElement;
        init: HTMLButtonElement;
        start: HTMLButtonElement;
        process: HTMLButtonElement;
        pause: HTMLButtonElement;
        clear: HTMLButtonElement;
        enableDebug: HTMLButtonElement;
        disableDebug: HTMLButtonElement;
    };

    private statusElements!: {
        player: HTMLElement;
        decoder: HTMLElement;
        debugMode: HTMLElement;
        frameCount: HTMLElement;
        frameTime: HTMLElement;
        queueSize: HTMLElement;
    };

    constructor() {
        this.logInterceptor = logInterceptor;
        this.initializeElements();
        this.setupEventListeners();
        this.interceptConsole();
        this.setupDebugPanel();
        
        // Initialize canvas
        this.canvas = document.getElementById('decoder-canvas') as HTMLCanvasElement;
        if (this.canvas) {
            this.canvas.width = 640;
            this.canvas.height = 480;
        }
    }

    private setupDebugPanel() {
        // Create debug panel container
        const debugPanel = document.createElement('div');
        debugPanel.className = 'debug-panel';
        debugPanel.innerHTML = `
            <div class="debug-header">Debug Controls</div>
            <div class="debug-content">
                <div class="debug-section">
                    <div class="debug-row">
                        <span>Debug Mode:</span>
                        <span id="debug-mode-status">Disabled</span>
                    </div>
                    <div class="debug-controls">
                        <button id="enableDebug">Enable Debug</button>
                        <button id="disableDebug">Disable Debug</button>
                    </div>
                </div>
                <div class="debug-section">
                    <div class="debug-row">
                        <span>Frame Count:</span>
                        <span id="frame-count">0</span>
                    </div>
                    <div class="debug-row">
                        <span>Frame Time:</span>
                        <span id="frame-time">0 ms</span>
                    </div>
                    <div class="debug-row">
                        <span>Queue Size:</span>
                        <span id="queue-size">0</span>
                    </div>
                </div>
            </div>
        `;

        // Add debug panel to document
        document.body.appendChild(debugPanel);

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .debug-panel {
                position: fixed;
                right: 0;
                top: 0;
                width: 300px;
                height: 100%;
                background: #1a1a1a;
                color: #fff;
                padding: 20px;
                box-shadow: -2px 0 5px rgba(0,0,0,0.2);
                overflow-y: auto;
            }
            .debug-header {
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 20px;
                border-bottom: 1px solid #333;
                padding-bottom: 10px;
            }
            .debug-section {
                margin-bottom: 20px;
                background: #2a2a2a;
                padding: 15px;
                border-radius: 4px;
            }
            .debug-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
            }
            .debug-controls {
                display: flex;
                gap: 10px;
                margin-top: 10px;
            }
            .debug-controls button {
                flex: 1;
                padding: 8px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                background: #444;
                color: white;
                transition: background 0.2s;
            }
            .debug-controls button:hover {
                background: #555;
            }
            #main-content {
                margin-right: 300px;
            }
        `;
        document.head.appendChild(style);
    }

    private initializeElements() {
        // Get all required DOM elements
        const elements = {
            verify: 'verifyWasm',
            init: 'initDecoder',
            start: 'startDecoder',
            process: 'processFrame',
            pause: 'pauseDecoder',
            clear: 'clearLog',
            enableDebug: 'enableDebug',
            disableDebug: 'disableDebug',
            playerStatus: 'player-status',
            decoderStatus: 'decoder-status',
            debugMode: 'debug-mode-status',
            frameCount: 'frame-count',
            frameTime: 'frame-time',
            queueSize: 'queue-size'
        };

        // Initialize buttons
        this.buttons = Object.entries(elements).slice(0, 8).reduce((acc, [key, id]) => {
            const element = document.getElementById(id);
            if (!element) throw new Error(`Button ${id} not found`);
            return { ...acc, [key]: element as HTMLButtonElement };
        }, {}) as typeof this.buttons;

        // Initialize status elements
        this.statusElements = {
            player: document.getElementById(elements.playerStatus) || throwError(elements.playerStatus),
            decoder: document.getElementById(elements.decoderStatus) || throwError(elements.decoderStatus),
            debugMode: document.getElementById(elements.debugMode) || throwError(elements.debugMode),
            frameCount: document.getElementById(elements.frameCount) || throwError(elements.frameCount),
            frameTime: document.getElementById(elements.frameTime) || throwError(elements.frameTime),
            queueSize: document.getElementById(elements.queueSize) || throwError(elements.queueSize)
        };
    }

    private setupEventListeners() {
        this.buttons.verify.onclick = () => this.verifyWasm();
        this.buttons.init.onclick = () => this.initializeDecoder();
        this.buttons.start.onclick = () => this.startDecoder();
        this.buttons.process.onclick = () => this.processFrame();
        this.buttons.pause.onclick = () => this.pauseDecoder();
        this.buttons.clear.onclick = () => this.clearLog();
        this.buttons.enableDebug.onclick = () => this.enableDebug();
        this.buttons.disableDebug.onclick = () => this.disableDebug();
    }

    private enableDebug() {
        if (this.decoder) {
            this.decoder.enable_debug_mode();
            this.statusElements.debugMode.textContent = 'Enabled';
            this.startDebugMetrics();
            this.log('info', 'Debug mode enabled');
        }
    }

    private disableDebug() {
        if (this.decoder) {
            this.decoder.disable_debug_mode();
            this.statusElements.debugMode.textContent = 'Disabled';
            this.stopDebugMetrics();
            this.log('info', 'Debug mode disabled');
        }
    }

    private startDebugMetrics() {
        if (this.debugMetricsInterval) return;
        
        this.debugMetricsInterval = window.setInterval(() => {
            if (this.decoder) {
                const status = this.decoder.get_status();
                if (typeof status === 'object') {
                    this.statusElements.frameCount.textContent = status.metrics?.frameCount?.toString() || '0';
                    this.statusElements.frameTime.textContent = `${(status.metrics?.lastFrameTime || 0).toFixed(2)} ms`;
                    this.statusElements.queueSize.textContent = status.queue?.inputQueueSize?.toString() || '0';
                }
            }
        }, 16.67); // ~60fps update rate
    }

    private stopDebugMetrics() {
        if (this.debugMetricsInterval) {
            window.clearInterval(this.debugMetricsInterval);
            this.debugMetricsInterval = null;
        }
    }

    private async checkWebGPUSupport(): Promise<boolean> {
        if (!navigator.gpu) {
            this.log('error', 'WebGPU is not supported in this browser');
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance'
            });

            if (!adapter) {
                this.log('error', 'No WebGPU adapter found');
                return false;
            }

            const device = await adapter.requestDevice();
            if (!device) {
                this.log('error', 'Failed to get WebGPU device');
                return false;
            }

            this.log('success', 'WebGPU is supported and initialized');
            return true;
        } catch (error) {
            this.log('error', `WebGPU initialization failed: ${error}`);
            return false;
        }
    }
    
    


    private interceptConsole() {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        console.log = (...args: any[]) => {
            this.log('info', ...args);
            originalLog.apply(console, args);
        };

        console.error = (...args: any[]) => {
            this.log('error', ...args);
            originalError.apply(console, args);
        };

        console.warn = (...args: any[]) => {
            this.log('info', ...args);
            originalWarn.apply(console, args);
        };
    }




    private updateStatus(type: 'player' | 'decoder', status: PlayerStatus | DecoderStatus) {
        const element = this.statusElements[type];
        const statusMap = type === 'player' ? PlayerStatus : DecoderStatus;
        const statusName = statusMap[status];
        
        // Remove all existing status classes
        element.className = 'status-value';
        
        // Add appropriate status class
        switch(status) {
            case 0: element.classList.add('status-idle'); break;
            case 1: element.classList.add('status-ready'); break;
            case 2: element.classList.add('status-playing'); break;
            case 3: element.classList.add('status-paused'); break;
            default: element.classList.add('status-error');
        }
        
        element.textContent = statusName;
    }

    private async verifyWasm() {
        try {
            this.buttons.verify.disabled = true;
            this.log('info', 'Verifying WASM...');
            
            const result = await verifyWasmBuild();
            if (result.success && result.decoder) {
                this.decoder = result.decoder;
                this.buttons.init.disabled = false;
                this.updateStatus('player', PlayerStatus.Ready);
                this.log('success', 'WASM verification successful!');
            } else {
                this.updateStatus('player', PlayerStatus.Idle);
                this.log('error', 'WASM verification failed!');
            }
        } catch (error) {
            this.log('error', `Error: ${error.message}`);
            this.updateStatus('player', PlayerStatus.Idle);
        } finally {
            this.buttons.verify.disabled = false;
        }
    }
    
    
    private async initializeDecoder() {
        try {
            this.buttons.init.disabled = true;
            this.updateStatus('decoder', DecoderStatus.Initializing);
            
            if (!this.decoder || !this.canvas) {
                throw new Error('Decoder or canvas not initialized');
            }
    
            // Check WebGPU support first
            const hasWebGPU = await this.checkWebGPUSupport();
            if (!hasWebGPU) {
                throw new Error('WebGPU not supported or failed to initialize');
            }
    
            // Configure canvas for WebGPU
            this.canvas.width = 640;
            this.canvas.height = 480;
            
            // Enable debug mode using the proper method
            this.decoder.enable_debug_mode();
            
            // Verify debug mode is set
            if (!this.decoder.is_debug_mode()) {
                throw new Error('Failed to enable debug mode');
            }
            
            // Create and set reference data
            const referenceData = this.createReferenceData();
            const refResult = await this.decoder.set_reference_data(referenceData);
            this.log('info', `Reference data set: ${refResult}`);
    
            // Initialize WebGPU context
            const initResult = await this.decoder.initialize_render_context(this.canvas);
            this.log('info', `Render context initialized: ${initResult}`);
    
            this.buttons.start.disabled = false;
            this.updateStatus('decoder', DecoderStatus.Ready);
            this.log('success', 'Decoder initialized successfully in debug mode');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('error', `Initialization error: ${errorMessage}`);
            this.updateStatus('decoder', DecoderStatus.Idle);
        } finally {
            this.buttons.init.disabled = false;
        }
    }

    private async processFrame() {
        if (!this.decoder) return;

        try {
            const frameWidth = 640;
            const frameHeight = 480;
            const channelCount = 4; // RGBA
            const frameData = new Float32Array(frameWidth * frameHeight * channelCount).fill(0.5);
            
            const token: FrameToken = {
                token: frameData,
                frame_index: this.frameCount++
            };

            this.log('info', `Processing frame ${token.frame_index}`);
            const processResult = await this.decoder.process_tokens([token]);
            this.log('info', processResult);
            
            const batchResult = await this.decoder.process_batch();
            this.log('success', `Batch processed: ${batchResult}`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('error', `Process error: ${errorMessage}`);
        }
    }

    private async startDecoderLoop() {
        if (!this.decoder || !this.canvas) return;

        try {
            // Verify render context is initialized
            const status = await this.decoder.get_status();
            if (!status.initialized) {
                throw new Error('Render context not initialized');
            }

            await this.decoder.start_player_loop();
            this.updateStatus('decoder', DecoderStatus.Playing);
            this.log('success', 'Decoder loop started');

            // Start frame processing
            this.processFrame();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('error', `Start error: ${errorMessage}`);
            this.updateStatus('decoder', DecoderStatus.Ready);
        }
    }
    
    private async startDecoder() {
        try {
            this.buttons.start.disabled = true;
            this.updateStatus('decoder', DecoderStatus.Open);
            
            if (!this.decoder) {
                throw new Error('Decoder not initialized');
            }
    
            // Make sure render context is ready before starting the loop
            const status = await this.decoder.get_status();
            if (!status.initialized) {
                throw new Error('Render context not initialized');
            }
    
            // Start the decoder's internal render loop
            await this.decoder.start_player_loop();
            
            // Enable frame processing and pause buttons
            this.buttons.process.disabled = false;
            this.buttons.pause.disabled = false;
            
            // Start our animation loop
            this.startDecoderLoop();
            
            this.log('success', 'Decoder started');
        } catch (error:any) {
            this.log('error', `Start error: ${error.message}`);
            this.updateStatus('decoder', DecoderStatus.Ready);
        }
    }


    private async pauseDecoder() {
        try {
            this.updateStatus('decoder', DecoderStatus.Pause);
            
            // Stop animation loop
            if (this.animationFrameId !== null) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }

            // Stop decoder's internal render loop
            if (this.decoder) {
                this.decoder.stop_player_loop();
            }

            this.buttons.process.disabled = true;
            this.buttons.pause.disabled = true;
            this.buttons.start.disabled = false;
            
            this.log('info', 'Decoder paused');
        } catch (error) {
            this.log('error', `Pause error: ${error.message}`);
        }
    }

    private createReferenceData(): ReferenceData {
        return {
            features: [
                {
                    tensor: new Float32Array(1 * 128 * 64 * 64).fill(0.5),
                    shape: [1, 128, 64, 64]
                },
                {
                    tensor: new Float32Array(1 * 256 * 32 * 32).fill(0.5),
                    shape: [1, 256, 32, 32]
                },
                {
                    tensor: new Float32Array(1 * 512 * 16 * 16).fill(0.5),
                    shape: [1, 512, 16, 16]
                },
                {
                    tensor: new Float32Array(1 * 512 * 8 * 8).fill(0.5),
                    shape: [1, 512, 8, 8]
                }
            ],
            token: new Float32Array(32).fill(0.1)
        };
    }

    private log(type: 'info' | 'error' | 'success', ...args: any[]) {
        const logDiv = document.getElementById('log')!;
        const line = document.createElement('div');
        line.className = type;
        line.textContent = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        logDiv.appendChild(line);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    private clearLog() {
        this.logInterceptor.clear();

        const logDiv = document.getElementById('log')!;
        logDiv.innerHTML = '';
    }
}

// Initialize when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new TestUI());
} else {
    new TestUI();
}

function throwError(id: string): never {
    throw new Error(`Element ${id} not found`);
}


export { TestUI };