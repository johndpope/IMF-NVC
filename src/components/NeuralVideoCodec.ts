import type * as tfjs from '@tensorflow/tfjs';


// Types for messaging and state management
interface VideoState {
    videoId: number;
    currentFrame: number;
    referenceFrame: number;
    isPlaying: boolean;
    bufferSize: number;
    fps: number;
  }
  
  interface FrameBuffer {
    frames: Map<number, {
      timestamp: number;
      data: string;  // base64 encoded image
      processed: boolean;
    }>;
    capacity: number;
  }
  
  interface ServerMessage {
    type: 'frame' | 'features' | 'error' | 'buffer_status';
    payload: any;
  }
  

// Additional types for event handling and metrics
type EventCallback = (data: any) => void;
type EventType = 'frameReady' | 'error' | 'bufferStatus' | 'metricsUpdate';

interface CodecMetrics {
  fps: number;
  bufferHealth: number;
  processingTime: number;
  networkLatency: number;
  droppedFrames: number;
  lastUpdate: number;
}

interface CodecConfig {
  bufferSize?: number;
  fps?: number;
  targetLatency?: number;
  enableAdaptiveBitrate?: boolean;
  modelPath?: string;
}

interface NeuralVideoCodec {
  startPlayback(videoId: number): Promise<void>;
  processFrames(): Promise<void>;
  on(event: string, callback: (data: any) => void): void;
  off(event: string, callback: (data: any) => void): void;
}


class NeuralVideoCodec {
  private ws: WebSocket | null = null;
  private frameBuffer: FrameBuffer;
  private state: VideoState;
  private processingQueue: number[] = [];
  private lastProcessedTime: number = 0;
  private readonly FRAME_INTERVAL: number;
  private eventListeners: Map<EventType, Set<EventCallback>>;
  private metrics: CodecMetrics;
  private model: tfjs.GraphModel | null = null;
  private retryCount: Map<number, number>;
  private readonly MAX_RETRIES = 3;

  constructor(config: CodecConfig = {}) {
    this.frameBuffer = {
      frames: new Map(),
      capacity: config.bufferSize || 30
    };
    
    this.state = {
      videoId: -1,
      currentFrame: 0,
      referenceFrame: 0,
      isPlaying: false,
      bufferSize: config.bufferSize || 30,
      fps: config.fps || 30
    };

    this.FRAME_INTERVAL = 1000 / this.state.fps;
    this.eventListeners = new Map();
    this.retryCount = new Map();
    
    this.metrics = {
      fps: 0,
      bufferHealth: 100,
      processingTime: 0,
      networkLatency: 0,
      droppedFrames: 0,
      lastUpdate: Date.now()
    };

    // Initialize event listeners
    ['frameReady', 'error', 'bufferStatus', 'metricsUpdate'].forEach(event => {
      this.eventListeners.set(event as EventType, new Set());
    });
  }

    /**
   * Start playback of a video from the current position
   */
    public async startPlayback(videoId: number): Promise<void> {
      try {
        this.state.videoId = videoId;
        this.state.isPlaying = true;
        
        // Clear existing buffer
        this.frameBuffer.frames.clear();
        this.processingQueue = [];
        
        // Initialize buffer with initial frames
        await this.prefetchFrames();
        
        // Start playback loop
        this.playbackLoop();
        
        // Emit status update
        this.emit('bufferStatus', {
          videoId,
          isPlaying: true,
          currentFrame: this.state.currentFrame
        });
  
      } catch (error:any)  {
        this.emit('error', {
          message: 'Failed to start playback',
          error: error.toString()
        });
        throw error;
      }
    }

    public async processFrames(): Promise<void> {
    if (!this.state.videoId) {
      throw new Error('No video selected');
    }

    try {
      // Fetch frames if not in buffer
      const currentFrame = await this.ensureFrameLoaded(this.state.currentFrame);
      const referenceFrame = await this.ensureFrameLoaded(this.state.referenceFrame);

      if (!currentFrame || !referenceFrame) {
        throw new Error('Failed to load frames');
      }

      // Send frame processing request to server
      this.sendMessage({
        type: 'process_frames',
        payload: {
          videoId: this.state.videoId,
          currentFrame: this.state.currentFrame,
          referenceFrame: this.state.referenceFrame
        }
      });

    } catch (error:any)  {
      this.emit('error', {
        message: 'Frame processing failed',
        error: error.toString()
      });
      throw error;
    }
  }


  /**
   * Ensure a frame is loaded in the buffer
   */
  private async ensureFrameLoaded(frameIndex: number): Promise<string | null> {
    // Check if frame is in buffer
    const bufferedFrame = this.frameBuffer.frames.get(frameIndex);
    if (bufferedFrame) {
      return bufferedFrame.data;
    }

    // Fetch frame if not in buffer
    try {
      const frameData = await this.fetchFrame(frameIndex);
      if (frameData) {
        this.frameBuffer.frames.set(frameIndex, {
          timestamp: Date.now(),
          data: frameData,
          processed: false
        });
        return frameData;
      }
    } catch (error:any)  {
      console.error(`Failed to fetch frame ${frameIndex}:`, error);
    }

    return null;
  }



  async connect(serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(serverUrl);
      
      this.ws.onopen = () => {
        this.initializeConnection();
        resolve();
      };

      this.ws.onmessage = this.handleServerMessage.bind(this);
      this.ws.onerror = (error:any)  => reject(error) ;
      this.ws.onclose = this.handleDisconnect.bind(this);
    });
  }

  private initializeConnection(): void {
    // Send initial configuration
    this.sendMessage({
      type: 'init',
      payload: {
        bufferSize: this.state.bufferSize,
        fps: this.state.fps
      }
    });
  }

  
  private handleServerMessage(event: MessageEvent): void {
    const message: ServerMessage = JSON.parse(event.data);

    switch (message.type) {
      case 'frame':
        // Handle incoming frame data
        this.handleFrameData(message.payload);
        break;
      
      case 'features':
        // Handle incoming feature data
        this.handleFeatureData(message.payload);
        break;
      
      case 'buffer_status':
        // Update buffer status
        this.handleBufferStatus(message.payload);
        break;
      
      case 'error':
        this.handleError(message.payload);
        break;
    }
  }

  // Event handling methods
  public on(event: EventType, callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.add(callback);
    }
  }

  public off(event: EventType, callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  private emit(event: EventType, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  // Neural processing methods
  private async initializeModel(modelPath: string): Promise<void> {
    try {
      const tf = await import('@tensorflow/tfjs');
      await import('@tensorflow/tfjs-backend-webgpu');

      try {
        await tf.setBackend('webgpu');
        await tf.ready();
        console.log('Using WebGPU backend');
      } catch (error:any)  {
        console.warn('WebGPU not available, falling back to WebGL');
        await tf.setBackend('webgl');
        await tf.ready();
      }

      this.model = await tf.loadGraphModel(modelPath);
      console.log('Model loaded successfully');
    } catch (error:any)  {
      console.error('Error loading model:', error);
      throw error;
    }
  }

  private async runNeuralCodec(frameData: string): Promise<string> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }

    const processStart = performance.now();
    try {
      const tf = await import('@tensorflow/tfjs');
      
      // Convert base64 to image tensor
      const img = await this.base64ToTensor(frameData);
      
      // Process through model
      const outputTensor = await this.processWithModel(img);
      
      // Convert back to image
      const processedImageData = await this.tensorToImage(outputTensor);
      
      // Update metrics
      this.metrics.processingTime = performance.now() - processStart;
      this.updateMetrics();
      
      return processedImageData;

    } catch (error:any)  {
      console.error('Error in neural processing:', error);
      throw error;
    }
  }

  private async base64ToTensor(base64Data: string): Promise<tfjs.Tensor4D> {
    const tf = await import('@tensorflow/tfjs');
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const tensor = tf.browser.fromPixels(img)
            .toFloat()
            .expandDims(0)
            .transpose([0, 3, 1, 2]); // Convert to NCHW format
          resolve(tensor as tfjs.Tensor4D);
        } catch (error:any)  {
          reject(error) ;
        }
      };
      img.onerror = reject;
      img.src = base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`;
    });
  }

  private async processWithModel(inputTensor: tfjs.Tensor4D): Promise<tfjs.Tensor4D> {
    if (!this.model) throw new Error('Model not initialized');
    
    const result = this.model.execute(inputTensor) as tfjs.Tensor4D;
    inputTensor.dispose();
    return result;
  }

  private async tensorToImage(tensor: tfjs.Tensor4D): Promise<string> {
    const tf = await import('@tensorflow/tfjs');
    
    // Process tensor to correct format
    const processedTensor = tf.tidy(() => {
      let t = tensor;
      if (t.shape[1] === 3) {
        t = t.transpose([0, 2, 3, 1]); // NCHW to NHWC
      }
      t = t.squeeze([0]); // Remove batch dimension
      return t.clipByValue(0, 1);
    });

    // Convert to canvas
    const canvas = document.createElement('canvas');
    canvas.width = processedTensor.shape[1];
    canvas.height = processedTensor.shape[0];
    await tf.browser.toPixels(processedTensor as tfjs.Tensor3D, canvas);
    
    // Cleanup
    processedTensor.dispose();
    tensor.dispose();
    
    return canvas.toDataURL();
  }

  // Buffer management methods
  private async handleFrameData(payload: any): Promise<void> {
    const { frameIndex, data } = payload;
    
    if (!this.frameBuffer.frames.has(frameIndex)) {
      this.frameBuffer.frames.set(frameIndex, {
        timestamp: Date.now(),
        data,
        processed: false
      });
      
      // Update buffer status
      this.updateBufferStatus();
    }
  }

  private handleFeatureData(payload: any): void {
    // Process incoming feature data
    // This would be used for frame interpolation or enhancement
    console.log('Received feature data:', payload);
  }

  private updateBufferStatus(): void {
    const bufferHealth = (this.frameBuffer.frames.size / this.frameBuffer.capacity) * 100;
    this.metrics.bufferHealth = bufferHealth;
    
    this.emit('bufferStatus', {
      health: bufferHealth,
      frameCount: this.frameBuffer.frames.size,
      capacity: this.frameBuffer.capacity
    });
  }

  // Metrics and monitoring
  private updateMetrics(): void {
    const now = Date.now();
    const timeDiff = now - this.metrics.lastUpdate;
    
    if (timeDiff >= 1000) { // Update every second
      this.metrics.fps = 1000 / this.FRAME_INTERVAL;
      this.metrics.lastUpdate = now;
      
      this.emit('metricsUpdate', this.metrics);
    }
  }

  private handleError(payload: any): void {
    console.error('Codec error:', payload);
    this.emit('error', payload);
  }

  private handleBufferStatus(payload: any): void {
    // Update buffer status based on server feedback
    this.updateBufferStatus();
  }

  private handleDisconnect(): void {
    console.log('WebSocket disconnected');
    this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.CLOSED) {
      try {
        await this.connect(this.ws.url);
      } catch (error:any)  {
        console.error('Reconnection failed:', error);
        setTimeout(() => this.reconnect(), 5000);
      }
    }
  }

  // Public control methods
  public async init(modelPath: string): Promise<void> {
    await this.initializeModel(modelPath);
  }

  public pause(): void {
    this.state.isPlaying = false;
  }

  public resume(): void {
    if (!this.state.isPlaying) {
      this.state.isPlaying = true;
      this.playbackLoop();
    }
  }

  public stop(): void {
    this.state.isPlaying = false;
    this.frameBuffer.frames.clear();
    this.processingQueue = [];
  }

  public getMetrics(): CodecMetrics {
    return { ...this.metrics };
  }

  private sendMessage(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

   /**
   * Fetch a frame from the server
   */
   private async fetchFrame(frameIndex: number): Promise<string | null> {
    try {
      const startTime = performance.now();
      const response = await fetch(
        `https://192.168.1.108:8000/videos/${this.state.videoId}/frames/${frameIndex}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Update network latency metrics
      this.metrics.networkLatency = performance.now() - startTime;
      
      return data.frame; // base64 encoded image data
    } catch (error:any)  {
      this.handleError({
        message: `Failed to fetch frame ${frameIndex}`,
        error: error.toString()
      });
      return null;
    }
  }

  /**
   * Prefetch frames to fill buffer
   */
  private async prefetchFrames(): Promise<void> {
    const prefetchCount = Math.min(
      this.frameBuffer.capacity,
      5 // Start with 5 frames initially
    );

    const fetchPromises = [];
    for (let i = 0; i < prefetchCount; i++) {
      fetchPromises.push(this.ensureFrameLoaded(this.state.currentFrame + i));
    }

    await Promise.all(fetchPromises);
    this.updateBufferStatus();
  }

  /**
   * Main playback loop
   */
  private async playbackLoop(): Promise<void> {
    if (!this.state.isPlaying) return;

    const now = performance.now();
    const timeSinceLastFrame = now - this.lastProcessedTime;

    if (timeSinceLastFrame >= this.FRAME_INTERVAL) {
      try {
        await this.processNextFrame();
        this.lastProcessedTime = now;

        // Maintain buffer
        await this.maintainBuffer();
        
        // Update metrics
        this.updateMetrics();
      } catch (error:any)  {
        console.error('Playback error:', error);
        this.metrics.droppedFrames++;
      }
    }

    requestAnimationFrame(() => this.playbackLoop());
  }

  /**
   * Process the next frame in the queue
   */
  private async processNextFrame(): Promise<void> {
    if (this.processingQueue.length === 0) {
      // Add next frame to queue if empty
      this.processingQueue.push(this.state.currentFrame);
    }

    const frameIndex = this.processingQueue[0];
    const frame = this.frameBuffer.frames.get(frameIndex);

    if (frame && !frame.processed) {
      try {
        // Process frame through neural codec
        const processedImage = await this.runNeuralCodec(frame.data);
        
        // Mark as processed
        frame.processed = true;
        
        // Emit processed frame
        this.emit('frameReady', {
          frameIndex,
          imageUrl: processedImage
        });

        // Move to next frame
        this.processingQueue.shift();
        this.state.currentFrame++;

      } catch (error:any)  {
        console.error('Frame processing error:', error);
        this.metrics.droppedFrames++;
        this.processingQueue.shift(); // Skip problematic frame
      }
    }
  }

  /**
   * Maintain the frame buffer
   */
  private async maintainBuffer(): Promise<void> {
    // Remove old frames
    const minFrame = this.state.currentFrame - 5;
    for (const [frameIndex] of this.frameBuffer.frames) {
      if (frameIndex < minFrame) {
        this.frameBuffer.frames.delete(frameIndex);
      }
    }

    // Prefetch upcoming frames
    const maxBufferedFrame = Math.max(...Array.from(this.frameBuffer.frames.keys()));
    if (maxBufferedFrame < this.state.currentFrame + this.frameBuffer.capacity) {
      const nextFrame = maxBufferedFrame + 1;
      await this.ensureFrameLoaded(nextFrame);
    }
  }
}


export default NeuralVideoCodec;