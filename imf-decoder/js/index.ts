import { init, verifyWasmBuild, runDecoderTests } from './utils/wasm-test';

import { 
    WasmModule, 
    IMFDecoder, 
    ReferenceData, 
    FrameToken, 
    VerifyResult,
    TestResult,
    PlayerStatus,
    DecoderStatus 
} from './types';

class TestUI {
    private decoder: IMFDecoder | null = null;
    private playerStatus: PlayerStatus = PlayerStatus.Idle;
    private decoderStatus: DecoderStatus = DecoderStatus.Idle;

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
        this.initializeElements();
        this.setupEventListeners();
        this.interceptConsole();
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
            
            if (!this.decoder) {
                throw new Error('Decoder not initialized');
            }

            // Create and set reference data
            const reference_data = this.createReferenceData();
            await this.decoder.set_reference_data(reference_data);
            
            this.buttons.start.disabled = false;
            this.updateStatus('decoder', DecoderStatus.Ready);
            this.log('success', 'Decoder initialized successfully');
        } catch (error) {
            this.log('error', `Initialization error: ${error.message}`);
            this.updateStatus('decoder', DecoderStatus.Idle);
        }
    }

    private async startDecoder() {
        try {
            this.buttons.start.disabled = true;
            this.updateStatus('decoder', DecoderStatus.Open);
            
            // Enable frame processing and pause
            this.buttons.process.disabled = false;
            this.buttons.pause.disabled = false;
            
            this.log('success', 'Decoder started');
        } catch (error:any) {
            this.log('error', `Start error: ${error.message}`);
            this.updateStatus('decoder', DecoderStatus.Ready);
        }
    }

    private async processFrame() {
        if (!this.decoder) return;

        try {
            // Create test frame data - full frame size (640x480 RGBA)
            const frameWidth = 640;
            const frameHeight = 480;
            const channelCount = 4; // RGBA
            const frame = new Float32Array(frameWidth * frameHeight * channelCount).fill(0.5);
            
            const token: FrameToken = {
                token: frame,
                frame_index: 0
            };

            this.log('info', `Processing frame with size: ${frameWidth}x${frameHeight}`);
            await this.decoder.process_tokens([token]);
            const batchResult = await this.decoder.process_batch();
            
            this.log('success', `Frame processed: ${batchResult}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('error', `Process error: ${errorMessage}`);
        }
    }

    private async pauseDecoder() {
        try {
            this.updateStatus('decoder', DecoderStatus.Pause);
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