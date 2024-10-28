declare module '@pkg/imf_decoder' {
    export interface ReferenceFeature {
        tensor: Float32Array;
        shape: number[];
    }

    export interface ReferenceData {
        features: ReferenceFeature[];
        token: Float32Array;
    }

    export interface FrameToken {
        token: Float32Array | number[];
        frame_index: number;
    }

    export interface DecoderStatus {
        initialized: boolean;
        running: boolean;
        metrics: {
            frameCount: number;
            lastFrameTime: number;
        };
        queue: {
            inputQueueSize: number;
            processingQueueSize: number;
            outputQueueSize: number;
        };
    }

    export interface DecoderCapabilities {
        version: string;
        dimensions: string;
        features: string[];
        methods: string[];
    }

    export class IMFDecoder {
        constructor(width: number, height: number);
        free(): void;
        initialize_render_context(canvas: HTMLCanvasElement): Promise<string>;
        get_capabilities(): DecoderCapabilities;
        test(): string;
        get_status(): DecoderStatus;
        start_player_loop(): Promise<void>;
        stop_player_loop(): void;
        
        // Debug mode methods
        debug_mode: boolean;
        enable_debug_mode(): void;
        disable_debug_mode(): void;
        is_debug_mode(): boolean;
        
        // Frame loading method
        load_frames(path: string): Promise<string>;
        
        // Diagnostic mode property
        diagnostic_mode: boolean;
        
        // Other methods
        set_reference_data(data: ReferenceData): Promise<string>;
        process_tokens(tokens: FrameToken[]): Promise<string>;
        process_batch(): Promise<string>;
        get_reference_status(): string;
    }

    export function initSync(): void;
    export function start(): void;
    export default function init(): Promise<void>;
}