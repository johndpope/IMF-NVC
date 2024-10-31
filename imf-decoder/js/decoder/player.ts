import * as tf from '@tensorflow/tfjs';
import { 
    PlayerStatus, 
    MessageType, 
    DecoderConfig,
    WorkerMessage, 
    ReferenceData,
    FrameStats,
    ModelInputConfig,
    FrameData
} from '../types';

export class IMFPlayer {
    private worker: Worker;
    private status: PlayerStatus = PlayerStatus.Idle;
    private model: tf.GraphModel | null = null;
    private callbacks: Map<MessageType, Function>;
    private config: DecoderConfig;
    private frameBuffer: FrameData[] = [];
    private frameIndex: number = 0;
    private readonly bufferSize: number = 30;
    private modelConfig: ModelInputConfig;
    private lastProcessedFrame: tf.Tensor | null = null;
    private frameCallback: ((stats: FrameStats) => void) | null = null;
    private errorCallback: ((error: Error) => void) | null = null;
    private lastFrameTime: number = 0;

    constructor(config: DecoderConfig) {
        this.config = config;
        this.callbacks = new Map();
        this.worker = new Worker(new URL('./decoder.worker.ts', import.meta.url));
        this.modelConfig = {
            inputShape: [1, config.height, config.width, 3],
            inputNormalization: {
                mean: [0.485, 0.456, 0.406],
                std: [0.229, 0.224, 0.225]
            },
            maxBatchSize: 1
        };
        this.setupWorkerListeners();
        this.initialize();
    }

    private setupWorkerListeners() {
        this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
            const { type, data, error } = event.data;
            
            const callback = this.callbacks.get(type);
            if (callback) {
                callback(data);
                this.callbacks.delete(type);
            }

            if (error) {
                this.handleDecoderError(error);
                return;
            }

            switch (type) {
                case MessageType.DecoderCreated:
                    this.status = PlayerStatus.Ready;
                    break;
                case MessageType.FrameProcessed:
                    this.handleFrameProcessed(data);
                    break;
                case MessageType.DecoderRecovered:
                    this.handleDecoderRecovery(data);
                    break;
            }
        };

        this.worker.onerror = (error) => {
            this.handleDecoderError(error);
        };
    }

    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.callbacks.set(MessageType.DecoderInited, resolve);
            this.worker.postMessage({ 
                type: MessageType.DecoderInit,
                data: this.config
            });
        });
    }

    async loadModel(modelUrl: string): Promise<boolean> {
        try {
            this.model = await tf.loadGraphModel(modelUrl);
            const referenceData = this.createReferenceData();
            
            return new Promise((resolve) => {
                this.callbacks.set(MessageType.ReferenceDataSet, (status: boolean) => {
                    resolve(status);
                });

                this.worker.postMessage({
                    type: MessageType.DecoderInit,
                    data: referenceData
                });
            });
        } catch (error) {
            console.error('Failed to load model:', error);
            return false;
        }
    }

    private createReferenceData(): ReferenceData {
        const features = [
            tf.zeros([1, 128, 64, 64]),
            tf.zeros([1, 256, 32, 32]),
            tf.zeros([1, 512, 16, 16]),
            tf.zeros([1, 512, 8, 8])
        ];

        const token = tf.zeros([1, 32]);

        return {
            features: features.map(tensor => ({
                tensor: tensor.dataSync() as Float32Array,
                shape: tensor.shape
            })),
            token: token.dataSync() as Float32Array
        };
    }

    private async getNextFrameData(): Promise<FrameData> {
        try {
            if (this.lastProcessedFrame) {
                this.lastProcessedFrame.dispose();
                this.lastProcessedFrame = null;
            }

            const inputTensor = await this.prepareInputTensor();
            const startTime = performance.now();
            const outputTensor = await this.model!.executeAsync(inputTensor) as tf.Tensor;
            const inferenceTime = performance.now() - startTime;
            const processedData = await this.processModelOutput(outputTensor);
            
            inputTensor.dispose();
            outputTensor.dispose();

            this.frameIndex = (this.frameIndex + 1) % this.bufferSize;

            return {
                frameIndex: this.frameIndex,
                timestamp: Date.now(),
                data: processedData,
                metadata: {
                    inferenceTime,
                    inputShape: this.modelConfig.inputShape,
                    outputShape: processedData.shape
                }
            };
        } catch (error) {
            console.error('Error getting next frame:', error);
            throw new Error(`Frame processing failed: ${error}`);
        }
    }

    private async processFrame(): Promise<void> {
        if (!this.model || this.status !== PlayerStatus.Playing) return;

        try {
            const frameData = await this.getNextFrameData();
            this.worker.postMessage({
                type: MessageType.ProcessFrame,
                data: [{
                    token: Array.from(frameData.data.values),
                    frame_index: frameData.frameIndex
                }]
            });
        } catch (error) {
            this.handleDecoderError(error);
        }
    }

    private handleFrameProcessed(data: any) {
        if (this.frameCallback) {
            this.frameCallback(data.frameStats);
        }

        if (this.status === PlayerStatus.Playing) {
            this.requestNextFrame();
        }
    }

    private handleDecoderError(error: any) {
        console.error('Decoder error:', error);
        if (this.errorCallback) {
            this.errorCallback(new Error(String(error)));
        }
    }

    private handleDecoderRecovery(data: any) {
        console.log('Decoder recovered:', data);
        if (data.success && this.status === PlayerStatus.Playing) {
            this.requestNextFrame();
        }
    }

    private requestNextFrame() {
        const now = performance.now();
        const timeSinceLastFrame = now - this.lastFrameTime;

        if (timeSinceLastFrame >= 16.67) { // Target 60fps
            this.processFrame();
            this.lastFrameTime = now;
        } else {
            setTimeout(() => this.requestNextFrame(), 16.67 - timeSinceLastFrame);
        }
    }

    public setModelConfig(config: Partial<ModelInputConfig>) {
        this.modelConfig = {
            ...this.modelConfig,
            ...config
        };
    }

    public getBufferStatus(): {current: number, total: number} {
        return {
            current: this.frameBuffer.length,
            total: this.bufferSize
        };
    }

    public onFrameProcessed(callback: (stats: FrameStats) => void) {
        this.frameCallback = callback;
    }

    public onError(callback: (error: Error) => void) {
        this.errorCallback = callback;
    }

    public async start() {
        if (this.status !== PlayerStatus.Ready) {
            throw new Error('Decoder not ready');
        }
        await this.preloadFrames();
        this.status = PlayerStatus.Playing;
        this.requestNextFrame();
    }

    public stop() {
        this.status = PlayerStatus.Ready;
    }

    public async destroy() {
        this.stop();
        await this.cleanupResources();
        if (this.model) {
            this.model.dispose();
        }
        this.worker.terminate();
        this.status = PlayerStatus.Destroyed;
    }

    // Additional helper methods
    private async prepareInputTensor(): Promise<tf.Tensor> {
        return tf.tidy(() => {
            let inputTensor = tf.randomNormal(this.modelConfig.inputShape);
            if (this.modelConfig.inputNormalization) {
                const { mean, std } = this.modelConfig.inputNormalization;
                inputTensor = tf.sub(inputTensor, mean);
                inputTensor = tf.div(inputTensor, std);
            }
            if (inputTensor.shape[0] !== 1) {
                inputTensor = tf.expandDims(inputTensor, 0);
            }
            this.lastProcessedFrame = inputTensor;
            return inputTensor;
        });
    }

    private async processModelOutput(outputTensor: tf.Tensor): Promise<tf.TensorBuffer<tf.Rank>> {
        const outputData = await outputTensor.buffer();
        await this.applyPostProcessing(outputData);
        return outputData;
    }

    private async applyPostProcessing(data: tf.TensorBuffer<tf.Rank>): Promise<void> {
        tf.tidy(() => {
            if (this.modelConfig.outputDenormalization) {
                const { scale, offset } = this.modelConfig.outputDenormalization;
                for (let i = 0; i < data.size; i++) {
                    const value = data.values[i];
                    data.values[i] = value * scale + offset;
                }
            }
            for (let i = 0; i < data.size; i++) {
                data.values[i] = Math.max(0, Math.min(1, data.values[i]));
            }
        });
    }

    private async cleanupResources(): Promise<void> {
        await this.clearBuffer();
        if (this.lastProcessedFrame) {
            this.lastProcessedFrame.dispose();
            this.lastProcessedFrame = null;
        }
        tf.engine().startScope();
        tf.engine().endScope();
    }

    public async preloadFrames(count: number = this.bufferSize): Promise<void> {
        for (let i = 0; i < count; i++) {
            try {
                const frameData = await this.getNextFrameData();
                this.frameBuffer.push(frameData);
            } catch (error) {
                console.error(`Failed to preload frame ${i}:`, error);
                break;
            }
        }
    }

    public async clearBuffer(): Promise<void> {
        this.frameBuffer.forEach(frame => {
            if (frame.data instanceof tf.Tensor) {
                frame.data.dispose();
            }
        });
        this.frameBuffer = [];
        this.frameIndex = 0;
    }
}