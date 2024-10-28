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
import { IMFDecoder, ReferenceData as WasmReferenceData, FrameToken as WasmFrameToken } from '@pkg/imf_decoder';



class TestUI {
    private decoder: IMFDecoder | null = null;
    private playerStatus: PlayerStatus = PlayerStatus.Idle;
    private decoderStatus: DecoderStatus = DecoderStatus.Idle;
    private animationFrameId: number | null = null;
    private frameCount: number = 0;
    private canvas: HTMLCanvasElement | null = null;

    private buttons!: {
        verify: HTMLButtonElement;
        init: HTMLButtonElement;
        start: HTMLButtonElement;
        process: HTMLButtonElement;
        pause: HTMLButtonElement;
        clear: HTMLButtonElement;
    };

    private statusElements!: {
        player: HTMLElement;
        decoder: HTMLElement;
    };

    constructor() {
        this.setupLayout();
        this.initializeElements();
        this.setupEventListeners();
        this.interceptConsole();
    }

    private setupLayout() {
        document.body.innerHTML = `
        <div class="container">
            <div class="left-panel">
                <h1>IMF Decoder Test</h1>
                <div class="status-panel">
                    <div class="status-item">
                        <span class="status-label">Player Status:</span>
                        <span id="player-status" class="status-value status-idle">Idle</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Decoder Status:</span>
                        <span id="decoder-status" class="status-value status-idle">Idle</span>
                    </div>
                </div>
                <canvas id="decoder-canvas"></canvas>
                <div class="button-group">
                    <button id="verifyWasm">Verify WASM</button>
                    <button id="initDecoder" disabled>Initialize Decoder</button>
                    <button id="startDecoder" disabled>Start Decoder</button>
                    <button id="processFrame" disabled>Process Frame</button>
                    <button id="pauseDecoder" disabled>Pause Decoder</button>
                    <button id="clearLog">Clear Log</button>
                </div>
            </div>
            <div class="right-panel">
                <div class="log-header">
                    <h2>Decoder Log</h2>
                </div>
                <div id="log" class="log-content"></div>
            </div>
        </div>
    `;

        const style = document.createElement('style');
        style.textContent = `
         #decoder-canvas {
            display: block;
            margin: 20px auto;
            max-width: 100%;
            height: auto;
            border: 1px solid #ccc;
        }
            .container {
                display: flex;
                gap: 20px;
                padding: 20px;
                max-width: 1400px;
                margin: 0 auto;
                height: calc(100vh - 40px);
            }

            .left-panel {
                flex: 1;
                min-width: 400px;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }

            .right-panel {
                flex: 1;
                min-width: 400px;
                display: flex;
                flex-direction: column;
                border-left: 1px solid #ccc;
                padding-left: 20px;
            }

            .status-panel {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }

            .status-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }

            .status-label {
                font-weight: bold;
            }

            .status-value {
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 14px;
            }

            .status-idle { background: #ffd700; }
            .status-ready { background: #90ee90; }
            .status-playing { background: #87ceeb; }
            .status-paused { background: #ffb6c1; }

            #decoder-canvas {
                width: 100%;
                max-width: 640px;
                height: auto;
                border: 1px solid #ccc;
                border-radius: 4px;
                margin: 0 auto;
            }

            .button-group {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 10px;
            }

            button {
                padding: 10px;
                border: none;
                border-radius: 4px;
                background: #4285f4;
                color: white;
                cursor: pointer;
                transition: background 0.2s;
            }

            button:hover:not(:disabled) {
                background: #3367d6;
            }

            button:disabled {
                background: #ccc;
                cursor: not-allowed;
            }

            .log-header {
                padding: 10px 0;
                border-bottom: 1px solid #eee;
                margin-bottom: 10px;
            }

            .log-content {
                flex: 1;
                overflow-y: auto;
                background: #f8f9fa;
                padding: 10px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 13px;
                line-height: 1.5;
            }

            .info { color: #4285f4; }
            .error { color: #dc3545; }
            .success { color: #28a745; }

            h1, h2 {
                margin: 0 0 20px 0;
                color: #333;
            }
        `;
        document.head.appendChild(style);

        // Setup canvas after layout
        this.canvas = document.getElementById('decoder-canvas') as HTMLCanvasElement;
        if (this.canvas) {
            this.canvas.width = 640;
            this.canvas.height = 480;
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
    
    


    private initializeElements() {
        // Verify all elements exist before assignment
        const verifyBtn = document.getElementById('verifyWasm');
        const initBtn = document.getElementById('initDecoder');
        const startBtn = document.getElementById('startDecoder');
        const processBtn = document.getElementById('processFrame');
        const pauseBtn = document.getElementById('pauseDecoder');
        const clearBtn = document.getElementById('clearLog');
        const playerStatus = document.getElementById('player-status');
        const decoderStatus = document.getElementById('decoder-status');

        if (!verifyBtn || !initBtn || !startBtn || !processBtn || 
            !pauseBtn || !clearBtn || !playerStatus || !decoderStatus) {
            throw new Error('Required DOM elements not found');
        }

        this.buttons = {
            verify: verifyBtn as HTMLButtonElement,
            init: initBtn as HTMLButtonElement,
            start: startBtn as HTMLButtonElement,
            process: processBtn as HTMLButtonElement,
            pause: pauseBtn as HTMLButtonElement,
            clear: clearBtn as HTMLButtonElement
        };

        this.statusElements = {
            player: playerStatus,
            decoder: decoderStatus
        };
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



    private setupEventListeners() {
        this.buttons.verify.onclick = () => this.verifyWasm();
        this.buttons.init.onclick = () => this.initializeDecoder();
        this.buttons.start.onclick = () => this.startDecoder();
        this.buttons.process.onclick = () => this.processFrame();
        this.buttons.pause.onclick = () => this.pauseDecoder();
        this.buttons.clear.onclick = () => this.clearLog();
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

    // private async startDecoderLoop() {
    //     if (!this.decoder || !this.canvas) return;

    //     const frameWidth = 640;
    //     const frameHeight = 480;
    //     const channelCount = 4; // RGBA
        
    //     const animate = async () => {
    //         try {
    //             // Create test frame data with changing pattern
    //             const frame = new Float32Array(frameWidth * frameHeight * channelCount);
                
    //             // Create a simple animation pattern
    //             const time = this.frameCount * 0.05;
    //             for (let y = 0; y < frameHeight; y++) {
    //                 for (let x = 0; x < frameWidth; x++) {
    //                     const i = (y * frameWidth + x) * channelCount;
    //                     // Create animated gradient pattern
    //                     frame[i] = (Math.sin(x * 0.01 + time) + 1) * 0.5; // R
    //                     frame[i + 1] = (Math.cos(y * 0.01 + time) + 1) * 0.5; // G
    //                     frame[i + 2] = (Math.sin((x + y) * 0.01 + time) + 1) * 0.5; // B
    //                     frame[i + 3] = 1.0; // A
    //                 }
    //             }

    //             const token: FrameToken = {
    //                 token: frame,
    //                 frame_index: this.frameCount++
    //             };

    //             // Process frame through decoder
    //             await this.decoder.process_tokens([token]);
    //             await this.decoder.process_batch();

    //             // Request next frame if still playing
    //             if (this.decoderStatus === DecoderStatus.Open) {
    //                 this.animationFrameId = requestAnimationFrame(animate);
    //             }

    //             // Log frame stats every 60 frames
    //             if (this.frameCount % 60 === 0) {
    //                 const stats = await this.decoder.get_status();
    //                 this.log('info', `Frame ${this.frameCount}: ${JSON.stringify(stats)}`);
    //             }

    //         } catch (error) {
    //             this.log('error', `Animation error: ${error}`);
    //             this.pauseDecoder();
    //         }
    //     };

    //     // Start animation loop
    //     this.animationFrameId = requestAnimationFrame(animate);
    // }

    // private async startDecoder() {
    //     try {
    //         this.buttons.start.disabled = true;
    //         this.updateStatus('decoder', DecoderStatus.Open);
            
    //         if (!this.decoder) {
    //             throw new Error('Decoder not initialized');
    //         }

    //         // Enable frame processing and pause buttons
    //         this.buttons.process.disabled = false;
    //         this.buttons.pause.disabled = false;
            
    //         // Start the decoder's internal render loop
    //         await this.decoder.start_player_loop();
            
    //         // Start our animation loop
    //         this.startDecoderLoop();
            
    //         this.log('success', 'Decoder started');
    //     } catch (error:any) {
    //         this.log('error', `Start error: ${error.message}`);
    //         this.updateStatus('decoder', DecoderStatus.Ready);
    //     }
    // }

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

export { TestUI };