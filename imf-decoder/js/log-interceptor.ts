class LogInterceptor {
    private logElement: HTMLElement;
    private maxLogEntries: number = 1000;

    constructor() {
        this.logElement = document.getElementById('log') || document.createElement('div');
        this.setupConsoleInterceptor();
    }

    private setupConsoleInterceptor() {
        const originalConsole = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug
        };

        // Intercept console methods
        console.log = (...args: any[]) => {
            this.addLogEntry('log', ...args);
            originalConsole.log.apply(console, args);
        };

        console.info = (...args: any[]) => {
            this.addLogEntry('info', ...args);
            originalConsole.info.apply(console, args);
        };

        console.warn = (...args: any[]) => {
            this.addLogEntry('warn', ...args);
            originalConsole.warn.apply(console, args);
        };

        console.error = (...args: any[]) => {
            this.addLogEntry('error', ...args);
            originalConsole.error.apply(console, args);
        };

        console.debug = (...args: any[]) => {
            this.addLogEntry('debug', ...args);
            originalConsole.debug.apply(console, args);
        };
    }

    private formatMessage(args: any[]): string {
        return args.map(arg => {
            if (typeof arg === 'string') {
                return this.formatString(arg);
            }
            if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}\n${arg.stack}`;
            }
            return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
        }).join(' ');
    }

    private formatString(str: string): string {
        // Handle special formatting
        return str
            .replace(/\%c/g, '') // Remove CSS formatting placeholders
            .replace(/src\/wasm\/bindings\.rs:(\d+)/g, '<span class="log-file">src/wasm/bindings.rs:$1</span>')
            .replace(/(DEBUG|INFO|WARN|ERROR)/g, '<span class="log-level log-$1">$1</span>')
            .replace(/Token data length: (\d+)/g, '<span class="log-token">Token data length: $1</span>')
            .replace(/Frame data length: (\d+)/g, '<span class="log-frame">Frame data length: $1</span>')
            .replace(/WASM (Exports|verification)/g, '<span class="log-wasm">WASM $1</span>');
    }

    private addLogEntry(level: string, ...args: any[]) {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${level}`;

        // Add timestamp
        const timestamp = document.createElement('span');
        timestamp.className = 'log-timestamp';
        timestamp.textContent = new Date().toISOString().split('T')[1].split('.')[0];
        entry.appendChild(timestamp);

        // Add level indicator
        const levelIndicator = document.createElement('span');
        levelIndicator.className = `log-level log-${level}`;
        levelIndicator.textContent = level.toUpperCase();
        entry.appendChild(levelIndicator);

        // Add message
        const message = document.createElement('span');
        message.className = 'log-message';
        message.innerHTML = this.formatMessage(args);
        entry.appendChild(message);

        // Add to log and scroll
        this.logElement.appendChild(entry);
        this.trimOldEntries();
        this.logElement.scrollTop = this.logElement.scrollHeight;
    }

    private trimOldEntries() {
        while (this.logElement.children.length > this.maxLogEntries) {
            this.logElement.removeChild(this.logElement.firstChild!);
        }
    }

    clear() {
        this.logElement.innerHTML = '';
    }
}

// Initialize the log interceptor
const logInterceptor = new LogInterceptor();

// Export for use in other modules
export { logInterceptor,LogInterceptor };