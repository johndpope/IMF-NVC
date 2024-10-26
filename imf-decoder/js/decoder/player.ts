import * as tf from '@tensorflow/tfjs';
import { 
    PlayerStatus, 
    MessageType, 
    DecoderConfig,
    WorkerMessage, 
    ReferenceData 
} from '../types';

export class IMFPlayer {
    private worker: Worker;
    private status: PlayerStatus = PlayerStatus.Idle;
    private model: tf.GraphModel | null = null;
    private callbacks: Map<MessageType, Function>;
    private config: DecoderConfig;

    constructor(config: DecoderConfig) {
        this.config = config;
        this.callbacks = new Map();
        this.worker = new Worker(new URL('./decoder.worker.ts', import.meta.url));
        this.setupWorkerListeners();
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
                console.error('Decoder error:', error);
                return;
            }

            switch (type) {
                case MessageType.DecoderCreated:
                    this.status = PlayerStatus.Ready;
                    break;
                // Add other message handlers
            }
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
        // Create reference tensors
        const features = [
            tf.zeros([1, 128, 64, 64]),
            tf.zeros([1, 256, 32, 32]),
            tf.zeros([1, 512, 16, 16]),
            tf.zeros([1, 512, 8, 8])
        ];

        const token = tf.zeros([1, 32]);

        // Convert to the format expected by the decoder
        return {
            features: features.map(tensor => ({
                tensor: tensor.dataSync() as Float32Array,
                shape: tensor.shape
            })),
            token: token.dataSync() as Float32Array
        };
    }

    async processFrame(inputData: Float32Array, inputShape: number[]): Promise<void> {
        if (!this.model || this.status !== PlayerStatus.Playing) {
            return;
        }

        try {
            const inputTensor = tf.tensor(inputData, inputShape);
            const outputTensor = await this.model.executeAsync(inputTensor);
            const outputData = await (outputTensor as tf.Tensor).data();

            return new Promise((resolve) => {
                this.callbacks.set(MessageType.TokensProcessed, resolve);
                
                this.worker.postMessage({
                    type: MessageType.TokensProcessed,
                    data: [{
                        token: Array.from(outputData),
                        frame_index: 0
                    }]
                });
            });
        } catch (error) {
            console.error('Error processing frame:', error);
            throw error;
        }
    }

    destroy() {
        if (this.model) {
            this.model.dispose();
        }
        this.worker.terminate();
        this.status = PlayerStatus.Destroyed;
    }
}