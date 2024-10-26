import init, { DecoderWorker } from '../../pkg/imf_decoder';
import { MessageType, DecoderStatus } from '../types';

class DecoderWorkerInstance {
    private decoder: DecoderWorker | null = null;
    private status: DecoderStatus = DecoderStatus.Idle;

    async initialize() {
        try {
            await init();
            this.decoder = new DecoderWorker();
            this.status = DecoderStatus.Ready;
            self.postMessage({ type: MessageType.DecoderCreated });
        } catch (error) {
            self.postMessage({ 
                type: MessageType.Error, 
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    handleMessage(event: MessageEvent) {
        const { type, data } = event.data;

        try {
            switch (type as MessageType) {
                case MessageType.DecoderInit:
                    this.initialize();
                    break;
                case MessageType.TokensProcessed:
                    this.processTokens(data);
                    break;
            }
        } catch (error) {
            self.postMessage({ 
                type: MessageType.Error, 
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    async processTokens(tokens: any) {
        if (!this.decoder || this.status !== DecoderStatus.Ready) {
            throw new Error('Decoder not ready');
        }

        const result = await this.decoder.process_tokens(tokens);
        self.postMessage({ type: MessageType.TokensProcessed, result });

        const batchResult = await this.decoder.process_batch();
        self.postMessage({ type: MessageType.BatchProcessed, result: batchResult });
    }
}

const worker = new DecoderWorkerInstance();
self.onmessage = (event) => worker.handleMessage(event);