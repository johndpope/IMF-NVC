import { DecoderConfig } from './types';

console.log('Initializing decoder...');

const config: DecoderConfig = {
    width: 640,
    height: 480,
    maxQueueSize: 60,
    batchSize: 4
};

export { config };