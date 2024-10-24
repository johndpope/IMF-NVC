

// interface QualityLevel {
//   tokenSize: number;
//   audioSampleRate: number;
//   audioBitrate: number;
//   bufferTarget: number;
// }

// interface NetworkStats {
//   bandwidth: number;
//   latency: number;
//   jitter: number;
//   packetLoss: number;


// }

// interface BandwidthEstimate {
//     available: number;      // Available bandwidth in bits/sec
//     confidence: number;     // 0-1 confidence score
//     trend: 'up' | 'down' | 'stable';
//     history: number[];      // Recent measurements
//     predictedNext: number;  // ML-predicted next value
//   }
  
//   interface SeekTarget {
//     timestamp: number;
//     keyframeIndex: number;
//     quality: number;
//   }
  
//   class AdvancedMediaCodec {
//     // Bandwidth estimation using Kalman filter
//     private bandwidthEstimator = {
//       estimate: 0,
//       variance: 1,
//       processNoise: 0.01,
//       measurementNoise: 0.1,
//       history: new Array<number>(),
      
//       update(measurement: number) {
//         // Kalman filter update
//         const predictedEstimate = this.estimate;
//         const predictedVariance = this.variance + this.processNoise;
        
//         // Kalman gain
//         const gain = predictedVariance / (predictedVariance + this.measurementNoise);
        
//         // Update estimate
//         this.estimate = predictedEstimate + gain * (measurement - predictedEstimate);
//         this.variance = (1 - gain) * predictedVariance;
        
//         // Update history
//         this.history.push(measurement);
//         if (this.history.length > 30) this.history.shift();
        
//         return {
//           available: this.estimate,
//           confidence: 1 - this.variance,
//           trend: this.getTrend(),
//           history: [...this.history],
//           predictedNext: this.predict()
//         };
//       },
      
//       getTrend(): 'up' | 'down' | 'stable' {
//         const recent = this.history.slice(-5);
//         const slope = recent.reduce((acc, val, i) => 
//           acc + (val - recent[0]) / (i + 1), 0) / recent.length;
        
//         return slope > 0.1 ? 'up' : slope < -0.1 ? 'down' : 'stable';
//       },
      
//       predict(): number {
//         // Simple linear regression for prediction
//         const x = Array.from({length: this.history.length}, (_, i) => i);
//         const y = this.history;
        
//         const n = x.length;
//         const sx = x.reduce((a, b) => a + b);
//         const sy = y.reduce((a, b) => a + b);
//         const sxy = x.reduce((a, i) => a + i * y[i], 0);
//         const sx2 = x.reduce((a, b) => a + b * b);
        
//         const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
//         const intercept = (sy - slope * sx) / n;
        
//         return slope * (n + 1) + intercept;
//       }
//     };
  
//     // Advanced error recovery
//     private errorRecovery = {
//       strategies: ['interpolation', 'quality_fallback', 'buffer_rebuild', 'iframe_fallback'] as const,
//       currentStrategy: 0,
//       consecutiveErrors: 0,
//       recoveryAttempts: new Map<number, number>(),
      
//       async handleError(error: Error, chunk: MediaChunk) {
//         this.consecutiveErrors++;
//         const attempts = this.recoveryAttempts.get(chunk.timestamp) || 0;
        
//         if (attempts >= 3) {
//           // Try next strategy
//           this.currentStrategy = (this.currentStrategy + 1) % this.strategies.length;
//           this.recoveryAttempts.delete(chunk.timestamp);
//         }
        
//         const strategy = this.strategies[this.currentStrategy];
//         try {
//           await this[`recover_${strategy}`](chunk);
//           this.consecutiveErrors = 0;
//         } catch (e) {
//           this.recoveryAttempts.set(chunk.timestamp, attempts + 1);
//           throw e;
//         }
//       },
      
//       async recover_interpolation(chunk: MediaChunk) {
//         // Find nearest good chunks
//         const prev = this.findNearestGoodChunk(chunk.timestamp, 'backward');
//         const next = this.findNearestGoodChunk(chunk.timestamp, 'forward');
        
//         if (!prev || !next) throw new Error('Cannot interpolate');
        
//         // Interpolate audio
//         const audioData = this.interpolateAudio(prev.audio, next.audio, 
//           (chunk.timestamp - prev.timestamp) / (next.timestamp - prev.timestamp));
        
//         // Interpolate token
//         const token = this.interpolateToken(prev.token, next.token,
//           (chunk.timestamp - prev.timestamp) / (next.timestamp - prev.timestamp));
          
//         return { ...chunk, audio: audioData, token };
//       },
      
//       async recover_quality_fallback(chunk: MediaChunk) {
//         // Try fetching chunk at lower quality
//         const currentQuality = this.getCurrentQuality();
//         if (currentQuality === this.qualityLevels.length - 1) {
//           throw new Error('Already at lowest quality');
//         }
        
//         return await this.fetchChunkAtQuality(chunk.timestamp, currentQuality + 1);
//       },
      
//       async recover_buffer_rebuild(chunk: MediaChunk) {
//         // Clear and rebuild buffer around problem area
//         const start = chunk.timestamp - 2000; // 2 seconds before
//         const end = chunk.timestamp + 2000;   // 2 seconds after
        
//         await this.clearBufferRange(start, end);
//         return await this.rebuildBufferRange(start, end);
//       },
      
//       async recover_iframe_fallback(chunk: MediaChunk) {
//         // Fall back to nearest keyframe
//         const keyframe = await this.findNearestKeyframe(chunk.timestamp);
//         return await this.reconstructFromKeyframe(keyframe, chunk.timestamp);
//       }
//     };
  
//     // Seeking and random access
//     private seekManager = {
//       keyframeMap: new Map<number, number>(),  // timestamp -> keyframe index
//       segmentInfo: new Map<number, {start: number, end: number}>(),
      
//       async seek(timestamp: number): Promise<SeekTarget> {
//         // Find nearest keyframe
//         const keyframeIndex = await this.findNearestKeyframe(timestamp);
        
//         // Determine optimal quality based on network conditions
//         const bandwidth = this.bandwidthEstimator.estimate;
//         const quality = this.selectQualityForBandwidth(bandwidth);
        
//         // Prepare seek target
//         return {
//           timestamp,
//           keyframeIndex,
//           quality
//         };
//       },
      
//       async prepareSeek(target: SeekTarget) {
//         // Clear existing buffer
//         await this.clearBuffer();
        
//         // Pre-buffer around seek point
//         const preloadStart = Math.max(0, target.timestamp - 1000);  // 1 sec before
//         const preloadEnd = target.timestamp + 2000;                 // 2 secs after
        
//         await this.preloadRange(preloadStart, preloadEnd, target.quality);
//       }
//     };
  
//     // Advanced quality adaptation
//     private qualityAdapter = {
//       currentQuality: 0,
//       switchPending: false,
//       lastSwitch: 0,
      
//       async evaluateQuality(bandwidth: BandwidthEstimate) {
//         if (this.switchPending || Date.now() - this.lastSwitch < 5000) return;
        
//         const currentQuality = this.qualityLevels[this.currentQuality];
//         const requiredBandwidth = this.calculateRequiredBandwidth(currentQuality);
        
//         // Consider switching if:
//         // 1. Bandwidth trend is stable
//         // 2. We have high confidence in the estimate
//         // 3. Predicted bandwidth supports the switch
//         if (bandwidth.confidence > 0.8 && bandwidth.trend === 'stable') {
//           if (bandwidth.predictedNext < requiredBandwidth * 0.8) {
//             await this.switchToLowerQuality();
//           } else if (bandwidth.predictedNext > requiredBandwidth * 1.5) {
//             await this.switchToHigherQuality();
//           }
//         }
//       },
      
//       async switchToLowerQuality() {
//         const nextQuality = Math.min(
//           this.currentQuality + 1,
//           this.qualityLevels.length - 1
//         );
//         await this.switchQuality(nextQuality);
//       },
      
//       async switchToHigherQuality() {
//         if (this.currentQuality === 0) return;
        
//         // Test higher quality with a single segment first
//         const testResult = await this.testQualitySwitch(this.currentQuality - 1);
//         if (testResult.success) {
//           await this.switchQuality(this.currentQuality - 1);
//         }
//       }
//     };
  
//     // ML-based chunk size prediction
//     private chunkPredictor = {
//       model: null as any,  // TensorFlow.js model
      
//       async predict(chunk: MediaChunk): Promise<number> {
//         if (!this.model) {
//           this.model = await this.loadPredictionModel();
//         }
        
//         const features = this.extractFeatures(chunk);
//         const prediction = await this.model.predict(features);
//         return prediction.dataSync()[0];
//       },
      
//       extractFeatures(chunk: MediaChunk) {
//         // Extract relevant features for size prediction
//         const tf = require('@tensorflow/tfjs');
//         return tf.tensor2d([
//           chunk.token.length,
//           chunk.audio.length,
//           this.calculateComplexity(chunk.token),
//           this.calculateAudioComplexity(chunk.audio)
//         ]);
//       }
//     };
  
//     // WebAssembly-accelerated processing
//     private wasmProcessor = {
//       instance: null as any,
      
//       async init() {
//         const response = await fetch('processor.wasm');
//         const wasmModule = await WebAssembly.compile(await response.arrayBuffer());
//         this.instance = await WebAssembly.instantiate(wasmModule, {
//           env: {
//             memory: new WebAssembly.Memory({ initial: 256 }),
//             abort: () => console.error('WASM abort')
//           }
//         });
//       },
      
//       processAudio(audio: Float32Array): Float32Array {
//         const ptr = this.instance.exports.allocate(audio.length * 4);
//         new Float32Array(this.instance.exports.memory.buffer, ptr, audio.length)
//           .set(audio);
        
//         this.instance.exports.processAudio(ptr, audio.length);
        
//         const result = new Float32Array(
//           this.instance.exports.memory.buffer,
//           ptr,
//           audio.length
//         );
        
//         this.instance.exports.deallocate(ptr);
//         return result;
//       },
      
//       interpolateFrames(frame1: Float32Array, frame2: Float32Array, ratio: number): Float32Array {
//         const ptr1 = this.instance.exports.allocate(frame1.length * 4);
//         const ptr2 = this.instance.exports.allocate(frame2.length * 4);
        
//         new Float32Array(this.instance.exports.memory.buffer, ptr1, frame1.length)
//           .set(frame1);
//         new Float32Array(this.instance.exports.memory.buffer, ptr2, frame2.length)
//           .set(frame2);
        
//         const resultPtr = this.instance.exports.interpolateFrames(
//           ptr1, ptr2, frame1.length, ratio
//         );
        
//         const result = new Float32Array(
//           this.instance.exports.memory.buffer,
//           resultPtr,
//           frame1.length
//         );
        
//         this.instance.exports.deallocate(ptr1);
//         this.instance.exports.deallocate(ptr2);
//         return result;
//       }
//     };
//   }

// class EnhancedMediaCodec {
//   private audioContext: AudioContext;
//   private mediaSource: MediaSource;
//   private frameBuffer: Map<number, MediaChunk>;
//   private audioBuffer: AudioBuffer;
//   private audioWorklet: AudioWorkletNode;
//   private qualityLevels: QualityLevel[];
//   private currentQuality: number;
//   private networkStats: NetworkStats;
//   private retryQueue: Set<number>;
//   private preloadAmount: number;
//   private isRecovering: boolean = false;

//   private readonly MAX_RETRIES = 3;
//   private readonly PRELOAD_THRESHOLD = 0.7; // 70% buffer before starting
//   private readonly QUALITY_CHECK_INTERVAL = 1000; // 1 second

//   constructor(config: MediaConfig) {
//     this.qualityLevels = [
//       { tokenSize: 32, audioSampleRate: 48000, audioBitrate: 192000, bufferTarget: 4 },
//       { tokenSize: 32, audioSampleRate: 44100, audioBitrate: 128000, bufferTarget: 3 },
//       { tokenSize: 32, audioSampleRate: 22050, audioBitrate: 64000, bufferTarget: 2 }
//     ];
//     this.currentQuality = 0;
//     this.frameBuffer = new Map();
//     this.retryQueue = new Set();
//     this.preloadAmount = config.preloadSeconds || 3;
    
//     this.initializeBuffers();
//     this.startQualityMonitoring();
//   }

//   async init() {
//     await this.initializeAudio();
//     await this.initializeErrorRecovery();
//     return this;
//   }

//   private async initializeAudio() {
//     const quality = this.qualityLevels[this.currentQuality];
//     this.audioContext = new AudioContext({
//       sampleRate: quality.audioSampleRate,
//       latencyHint: 'interactive'
//     });

//     // Load and initialize audio worklet
//     const workletUrl = this.createWorkletBlob();
//     await this.audioContext.audioWorklet.addModule(workletUrl);
//     URL.revokeObjectURL(workletUrl);

//     this.audioWorklet = new AudioWorkletNode(this.audioContext, 'frame-sync-processor', {
//       numberOfInputs: 1,
//       numberOfOutputs: 1,
//       outputChannelCount: [2],
//       processorOptions: {
//         sampleRate: quality.audioSampleRate,
//         bufferSize: 2048,
//         errorRecovery: true
//       }
//     });

//     this.setupAudioErrorRecovery();
//     this.connectAudioChain();
//   }

//   private createWorkletBlob(): string {
//     const workletCode = `
//       class FrameSyncProcessor extends AudioWorkletProcessor {
//         constructor(options) {
//           super();
//           this.buffer = new RingBuffer(options.processorOptions.bufferSize);
//           this.recovering = false;
//           this.lastGoodFrame = null;
//         }

//         process(inputs, outputs, parameters) {
//           const output = outputs[0];
//           const currentFrame = this.buffer.read();

//           if (currentFrame) {
//             this.lastGoodFrame = currentFrame;
//             this.recovering = false;
//             this.processFrame(currentFrame, output);
//           } else if (this.lastGoodFrame && this.recovering) {
//             // Error recovery: repeat last good frame with slight modification
//             this.processFrame(this.recoverFrame(this.lastGoodFrame), output);
//           }

//           return true;
//         }

//         recoverFrame(frame) {
//           // Implement frame interpolation/recovery logic here
//           return frame.map(sample => sample * 0.98); // Slight fade out
//         }

//         processFrame(frame, output) {
//           for (let channel = 0; channel < output.length; channel++) {
//             output[channel].set(frame[channel]);
//           }
//         }
//       }
//       registerProcessor('frame-sync-processor', FrameSyncProcessor);
//     `;

//     const blob = new Blob([workletCode], { type: 'application/javascript' });
//     return URL.createObjectURL(blob);
//   }

//   private async loadMediaFromMP4(videoId: number): Promise<void> {
//     try {
//       // Start preloading both audio and tokens
//       const preloadPromise = this.preloadMedia(videoId);
      
//       // Extract audio from MP4
//       const audioBuffer = await this.extractAudioFromMP4(videoId);
      
//       // Wait for preload to complete
//       await preloadPromise;
      
//       // Initialize playback
//       await this.initializePlayback(audioBuffer);
      
//     } catch (error:any) {
//       console.error('Failed to load media:', error);
//       await this.handleLoadError(error);
//     }
//   }

//   private async extractAudioFromMP4(videoId: number): Promise<AudioBuffer> {
//     const response = await fetch(`https://your-server/videos/${videoId}/media`);
//     const arrayBuffer = await response.arrayBuffer();

//     // Use Web Audio API to decode MP4 audio
//     return new Promise(async (resolve, reject) => {
//       try {
//         // Create temporary media source
//         const tempVideo = document.createElement('video');
//         tempVideo.src = URL.createObjectURL(new Blob([arrayBuffer]));
        
//         // Extract audio using MediaRecorder
//         const stream = tempVideo.captureStream();
//         const audioTrack = stream.getAudioTracks()[0];
        
//         const mediaRecorder = new MediaRecorder(new MediaStream([audioTrack]));
//         const audioChunks: BlobPart[] = [];
        
//         mediaRecorder.ondataavailable = (event) => {
//           audioChunks.push(event.data);
//         };
        
//         mediaRecorder.onstop = async () => {
//           const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
//           const arrayBuffer = await audioBlob.arrayBuffer();
//           const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
//           resolve(audioBuffer);
//         };
        
//         // Start recording and playback
//         mediaRecorder.start();
//         tempVideo.play();
        
//         tempVideo.onended = () => {
//           mediaRecorder.stop();
//           URL.revokeObjectURL(tempVideo.src);
//         };
        
//       } catch (error:any) {
//         reject(error);
//       }
//     });
//   }

//   private async preloadMedia(videoId: number) {
//     const quality = this.qualityLevels[this.currentQuality];
//     const preloadFrames = this.preloadAmount * quality.bufferTarget;
    
//     try {
//       // Fetch initial batch of frames and audio
//       const initialChunks = await Promise.all(
//         Array.from({ length: preloadFrames }, (_, i) => 
//           this.fetchMediaChunk(videoId, i)
//         )
//       );
      
//       // Store in buffer
//       initialChunks.forEach(chunk => {
//         if (chunk) this.frameBuffer.set(chunk.timestamp, chunk);
//       });
      
//       // Monitor buffer level
//       return new Promise(resolve => {
//         const checkBuffer = () => {
//           if (this.frameBuffer.size >= preloadFrames * this.PRELOAD_THRESHOLD) {
//             resolve(true);
//           } else {
//             setTimeout(checkBuffer, 100);
//           }
//         };
//         checkBuffer();
//       });
      
//     } catch (error:any) {
//       console.error('Preload failed:', error);
//       throw error;
//     }
//   }

//   private async adaptQuality() {
//     const stats = await this.measureNetworkConditions();
//     const currentQuality = this.qualityLevels[this.currentQuality];
    
//     // Calculate required bandwidth for current quality
//     const requiredBandwidth = this.calculateRequiredBandwidth(currentQuality);
    
//     // Check if we need to adapt
//     if (stats.bandwidth < requiredBandwidth * 0.8) {
//       // Switch to lower quality
//       this.switchQuality(Math.min(this.currentQuality + 1, this.qualityLevels.length - 1));
//     } else if (stats.bandwidth > requiredBandwidth * 1.5 && this.currentQuality > 0) {
//       // Switch to higher quality
//       this.switchQuality(this.currentQuality - 1);
//     }
//   }

//   private async switchQuality(newQualityIndex: number) {
//     if (newQualityIndex === this.currentQuality) return;
    
//     const oldQuality = this.qualityLevels[this.currentQuality];
//     const newQuality = this.qualityLevels[newQualityIndex];
    
//     try {
//       // Prepare new quality buffers
//       await this.prepareQualitySwitch(newQuality);
      
//       // Perform switch at next chunk boundary
//       this.audioWorklet.port.postMessage({
//         type: 'qualityChange',
//         oldSampleRate: oldQuality.audioSampleRate,
//         newSampleRate: newQuality.audioSampleRate
//       });
      
//       this.currentQuality = newQualityIndex;
      
//     } catch (error:any) {
//       console.error('Quality switch failed:', error);
//       // Fallback to error recovery
//       this.handlePlaybackError(error);
//     }
//   }

//   private handlePlaybackError(error: Error) {
//     if (!this.isRecovering) {
//       this.isRecovering = true;
      
//       // Start error recovery process
//       this.audioWorklet.port.postMessage({ type: 'startRecovery' });
      
//       // Attempt to rebuild buffer
//       this.rebuildBuffer().then(() => {
//         this.isRecovering = false;
//         this.audioWorklet.port.postMessage({ type: 'endRecovery' });
//       }).catch(error => {
//         console.error('Recovery failed:', error);
//         this.emit('fatal-error', error);
//       });
//     }
//   }

//   private async rebuildBuffer() {
//     // Clear existing buffer
//     this.frameBuffer.clear();
    
//     // Reload essential frames
//     const quality = this.qualityLevels[this.currentQuality];
//     const minFrames = quality.bufferTarget;
    
//     try {
//       // Fetch new frames
//       const frames = await Promise.all(
//         Array.from({ length: minFrames }, (_, i) => 
//           this.fetchMediaChunk(this.currentVideoId, this.currentFrame + i)
//         )
//       );
      
//       // Restore buffer
//       frames.forEach(frame => {
//         if (frame) this.frameBuffer.set(frame.timestamp, frame);
//       });
      
//     } catch (error:any) {
//       throw new Error('Buffer rebuild failed: ' + error.message);
//     }
//   }
// }

// // RingBuffer implementation for audio worklet
// class RingBuffer {
//   private buffer: Float32Array[];
//   private writePtr: number = 0;
//   private readPtr: number = 0;
//   private available: number = 0;

//   constructor(size: number) {
//     this.buffer = [
//       new Float32Array(size),
//       new Float32Array(size)
//     ];
//   }

//   write(data: Float32Array[]) {
//     if (this.available >= this.buffer[0].length) return false;
    
//     for (let channel = 0; channel < data.length; channel++) {
//       this.buffer[channel].set(data[channel], this.writePtr);
//     }
    
//     this.writePtr = (this.writePtr + data[0].length) % this.buffer[0].length;
//     this.available += data[0].length;
//     return true;
//   }

//   read(): Float32Array[] | null {
//     if (this.available < 128) return null; // Minimum read size
    
//     const result = this.buffer.map(channel => 
//       channel.slice(this.readPtr, this.readPtr + 128)
//     );
    
//     this.readPtr = (this.readPtr + 128) % this.buffer[0].length;
//     this.available -= 128;
//     return result;
//   }
// }

// interface StreamingConfig {
//   fps: number;
//   initialQuality: {
//     tokenSize: number;
//     audioSampleRate: number;
//     channels: number;
//   };
//   minBufferSize: number;  // Minimum frames needed to start
// }

// class LowLatencyCodec {
//   private audioContext: AudioContext;
//   private audioWorklet: AudioWorkletNode;
//   private frameBuffer: RingBuffer;
//   private isPlaying = false;
//   private currentFrame = 0;
//   private referenceFeatures: tfjs.Tensor[] | null = null;
  
//   constructor(private config: StreamingConfig) {
//     this.frameBuffer = new RingBuffer(config.minBufferSize);
//     this.initAudio();
//   }

//   async startPlayback(videoId: number) {
//     try {
//       // 1. Start audio context (must be from user interaction)
//       await this.audioContext.resume();

//       // 2. Quick connection setup - no handshake
//       const ws = new WebSocket(`wss://server/stream/${videoId}`);

//       // 3. Immediately request reference data
//       ws.onopen = () => {
//         ws.send(JSON.stringify({
//           type: 'reference_request',
//           videoId
//         }));
//       };

//       // 4. Handle incoming data
//       ws.onmessage = async (event) => {
//         const data = JSON.parse(event.data);
        
//         if (data.type === 'reference') {
//           // Store reference features and start playing immediately
//           this.setReferenceFeatures(data.features);
//           this.startPlaying();
//         }
//         else if (data.type === 'frame') {
//           // Add frame to buffer and start playing if we have enough
//           this.addFrame(data);
//         }
//       };

//     } catch (error) {
//       console.error('Playback start failed:', error);
//       throw error;
//     }
//   }

//   private async initAudio() {
//     // Create minimal audio pipeline
//     this.audioContext = new AudioContext({
//       sampleRate: this.config.initialQuality.audioSampleRate,
//       latencyHint: 'interactive'
//     });

//     // Simplified worklet for low latency
//     const worklet = `
//       class StreamProcessor extends AudioWorkletProcessor {
//         process(inputs, outputs) {
//           // Direct sample processing - no buffering
//           if (inputs[0] && inputs[0][0]) {
//             outputs[0][0].set(inputs[0][0]);
//           }
//           return true;
//         }
//       }
//       registerProcessor('stream', StreamProcessor);
//     `;

//     const blob = new Blob([worklet], { type: 'application/javascript' });
//     const url = URL.createObjectURL(blob);
    
//     await this.audioContext.audioWorklet.addModule(url);
//     URL.revokeObjectURL(url);

//     this.audioWorklet = new AudioWorkletNode(this.audioContext, 'stream');
//     this.audioWorklet.connect(this.audioContext.destination);
//   }

//   private async setReferenceFeatures(features: number[][][]) {
//     // Convert reference features to tensors once
//     const tf = await import('@tensorflow/tfjs');
    
//     this.referenceFeatures = features.map((feature, idx) => {
//       const shapes = [[1, 128, 64, 64], [1, 256, 32, 32], [1, 512, 16, 16], [1, 512, 8, 8]];
//       return tf.tensor4d(feature, shapes[idx]);
//     });
//   }

//   private addFrame(frameData: any) {
//     this.frameBuffer.write({
//       timestamp: frameData.timestamp,
//       token: new Float32Array(frameData.token),
//       audio: new Float32Array(frameData.audio)
//     });

//     // Start playing as soon as we have minimum buffer
//     if (!this.isPlaying && this.frameBuffer.available >= this.config.minBufferSize) {
//       this.startPlaying();
//     }
//   }

//   private startPlaying() {
//     if (this.isPlaying) return;
    
//     this.isPlaying = true;
//     this.playbackLoop();

//     // Start background quality improvements
//     requestIdleCallback(() => {
//       this.startQualityImprovements();
//     });
//   }

//   private async playbackLoop() {
//     if (!this.isPlaying) return;

//     try {
//       const frame = this.frameBuffer.read();
//       if (!frame) return;

//       // Process frame with minimal overhead
//       await this.processFrame(frame);
//       this.currentFrame++;

//       // Schedule next frame precisely
//       const nextFrameTime = this.audioContext.currentTime + (1 / this.config.fps);
//       this.audioContext.resume(nextFrameTime);
      
//       requestAnimationFrame(() => this.playbackLoop());

//     } catch (error) {
//       console.error('Playback error:', error);
//       // Simple error recovery - skip frame
//       this.currentFrame++;
//       requestAnimationFrame(() => this.playbackLoop());
//     }
//   }

//   private async processFrame(frame: { token: Float32Array, audio: Float32Array }) {
//     if (!this.referenceFeatures) return;

//     const tf = await import('@tensorflow/tfjs');
    
//     // Quick token processing
//     const tokenTensor = tf.tensor2d([frame.token]);
    
//     // Minimal model execution
//     const outputTensor = tf.tidy(() => {
//       return this.model!.execute({
//         'args_0:0': tokenTensor,
//         'args_0_1:0': tokenTensor,
//         'args_0_2': this.referenceFeatures![0],
//         'args_0_3': this.referenceFeatures![1],
//         'args_0_4': this.referenceFeatures![2],
//         'args_0_5': this.referenceFeatures![3]
//       });
//     });

//     // Quick render
//     const canvas = document.createElement('canvas');
//     canvas.width = 256;
//     canvas.height = 256;
//     await tf.browser.toPixels(outputTensor as tf.Tensor3D, canvas);

//     // Schedule audio precisely
//     const audioBuffer = this.audioContext.createBuffer(1, frame.audio.length, this.config.initialQuality.audioSampleRate);
//     audioBuffer.copyToChannel(frame.audio, 0);
    
//     const source = this.audioContext.createBufferSource();
//     source.buffer = audioBuffer;
//     source.connect(this.audioWorklet);
//     source.start(this.audioContext.currentTime);

//     // Cleanup
//     tokenTensor.dispose();
//     outputTensor.dispose();
//   }

//   // Quality improvements run in background
//   private async startQualityImprovements() {
//     // Only run when browser is idle
//     const task = () => {
//       if (this.isPlaying) {
//         this.measureAndAdapt();
//         requestIdleCallback(task);
//       }
//     };
//     requestIdleCallback(task);
//   }

//   private async measureAndAdapt() {
//     // Simplified bandwidth estimation
//     const stats = await this.quickNetworkCheck();
    
//     // Simple quality adaptation
//     if (stats.bandwidth < this.currentBandwidth * 0.5) {
//       this.lowerQuality();
//     } else if (stats.bandwidth > this.currentBandwidth * 2) {
//       this.improveQuality();
//     }
//   }
// }