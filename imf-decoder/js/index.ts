// js/index.ts
import { init, verifyWasmBuild, runDecoderTests } from './utils/wasm-test';

class TestUI {
    private verifyButton: HTMLButtonElement;
    private testButton: HTMLButtonElement;
    private clearButton: HTMLButtonElement;
    private statusDiv: HTMLDivElement;
    private logDiv: HTMLDivElement;
    private decoder: any = null;

    constructor() {
        this.verifyButton = document.getElementById('verifyWasm') as HTMLButtonElement;
        this.testButton = document.getElementById('runTests') as HTMLButtonElement;
        this.clearButton = document.getElementById('clearLog') as HTMLButtonElement;
        this.statusDiv = document.getElementById('status') as HTMLDivElement;
        this.logDiv = document.getElementById('log') as HTMLDivElement;

        this.setupEventListeners();
        this.interceptConsole();
    }

    private setupEventListeners() {
        this.verifyButton.addEventListener('click', () => this.verifyWasm());
        this.testButton.addEventListener('click', () => this.runTests());
        this.clearButton.addEventListener('click', () => this.clearLog());
    }

    private interceptConsole() {
        const originalLog = console.log;
        const originalError = console.error;

        console.log = (...args) => {
            this.log('log', ...args);
            originalLog.apply(console, args);
        };

        console.error = (...args) => {
            this.log('error', ...args);
            originalError.apply(console, args);
        };
    }

    private log(type: 'log' | 'error', ...args: any[]) {
        const line = document.createElement('div');
        line.className = type === 'error' ? 'error' : '';
        line.textContent = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        this.logDiv.appendChild(line);
        this.logDiv.scrollTop = this.logDiv.scrollHeight;
    }

    private async verifyWasm() {
        try {
            this.verifyButton.disabled = true;
            this.setStatus('Verifying WASM...', 'info');
            
            const result = await verifyWasmBuild();
            if (result.success && result.decoder) {
                this.decoder = result.decoder;
                this.testButton.disabled = false;
                this.setStatus('WASM verification successful!', 'success');
            } else {
                this.setStatus('WASM verification failed!', 'error');
            }
        } catch (error) {
            this.setStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.verifyButton.disabled = false;
        }
    }

    private async runTests() {
        if (!this.decoder) {
            this.setStatus('Please verify WASM first', 'error');
            return;
        }

        try {
            this.testButton.disabled = true;
            this.setStatus('Running tests...', 'info');
            
            const result = await runDecoderTests(this.decoder);
            if (result.success) {
                this.setStatus(result.message || 'Tests completed successfully', 'success');
            } else {
                this.setStatus(`Tests failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.setStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.testButton.disabled = false;
        }
    }

    private setStatus(message: string, type: 'success' | 'error' | 'info') {
        this.statusDiv.textContent = message;
        this.statusDiv.className = `status ${type}`;
    }

    private clearLog() {
        this.logDiv.innerHTML = '';
    }
}

// Initialize when the document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new TestUI());
} else {
    new TestUI();
}
