import type * as tfjs from "@tensorflow/tfjs";

interface FeatureData {
  reference_features: number[][][];
  reference_token: number[];
  current_token: number[];
}
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
  frames: Map<
    number,
    {
      timestamp: number;
      data: string; // base64 encoded image
      processed: boolean;
    }
  >;
  capacity: number;
}

interface ServerMessage {
  type: "frame" | "features" | "error" | "buffer_status";
  payload: any;
}

// Additional types for event handling and metrics
type EventCallback = (data: any) => void;
type EventType = "frameReady" | "error" | "bufferStatus" | "metricsUpdate";

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
  private cachedFrames: Map<
    number,
    {
      features: number[][][];
      tokens: number[];
      processed: boolean;
    }
  > = new Map();
  private cachedRanges: [number, number][] = [];
  private processingProgress: number = 0;

  private referenceFeatures: Map<number, number[][][]> = new Map(); // videoId -> reference features

  constructor(config: CodecConfig = {}) {
    this.frameBuffer = {
      frames: new Map(),
      capacity: config.bufferSize || 30,
    };

    this.state = {
      videoId: -1,
      currentFrame: 0,
      referenceFrame: 0,
      isPlaying: false,
      bufferSize: config.bufferSize || 30,
      fps: config.fps || 30,
    };

    this.FRAME_INTERVAL = 1000 / this.state.fps;
    this.eventListeners = new Map();

    this.metrics = {
      fps: 0,
      bufferHealth: 100,
      processingTime: 0,
      networkLatency: 0,
      droppedFrames: 0,
      lastUpdate: Date.now(),
    };

    // Initialize event listeners
    ["frameReady", "error", "bufferStatus", "metricsUpdate"].forEach(
      (event) => {
        this.eventListeners.set(event as EventType, new Set());
      }
    );
  }
  private currentVideoFrameCount: number = 0;
  /**
   * Start playback of a video from the current position
   */
  public async startPlayback(videoId: number): Promise<void> {
    try {
      const metadata = await this.fetchVideoMetadata(videoId);
      this.currentVideoFrameCount = metadata.frame_count;

      this.state.videoId = videoId;
      this.state.isPlaying = true;

      // Clear existing caches
      this.frameBuffer.frames.clear();
      this.cachedFrames.clear();
      this.cachedRanges = [];
      this.processingQueue = [];

      // Load reference features for this video
      await this.loadReferenceFeatures(videoId);

      // Initialize buffer
      await this.initializeBuffer();

      // Start playback loop
      this.playbackLoop();

      this.emit("bufferStatus", {
        videoId,
        isPlaying: true,
        currentFrame: this.state.currentFrame,
        totalFrames: this.currentVideoFrameCount,
        cachedRanges: this.cachedRanges,
      });
    } catch (error: any) {
      this.emit("error", {
        message: "Failed to start playback",
        error: error.toString(),
      });
      throw error;
    }
  }

  private async loadReferenceFeatures(videoId: number): Promise<void> {
    try {
      console.log("Loading reference features for video", videoId);

      // Request frame 0 to get reference features
      const response = await this.requestFrameProcessing(0);

      if (response.type === "error") {
        throw new Error(response.message);
      }

      if (!response.features?.reference_features) {
        throw new Error("No reference features in response");
      }

      // Store reference features
      this.referenceFeatures.set(videoId, response.features.reference_features);
      console.log("Successfully loaded reference features");
    } catch (error) {
      console.error("Error loading reference features:", error);
      throw error;
    }
  }

  private async processWithFeatures(frameIndex: number, tokens: number[]): Promise<string> {
    if (!this.model || !this.state.videoId) {
      throw new Error("Model or video not initialized");
    }
  
    const refFeatures = this.referenceFeatures.get(this.state.videoId);
    if (!refFeatures) {
      throw new Error("Reference features not loaded");
    }
  
    try {
      const tf = await import("@tensorflow/tfjs");
  
      // Ensure tokens is a 2D array
      const tokenArray = Array.isArray(tokens[0]) ? tokens : [tokens];
      const tokenTensor = tf.tensor2d(tokenArray).asType("float32");
  
      // Convert reference features to tensors with proper shapes
      const referenceFeatures = refFeatures.map((feature, idx) => {
        const shapes = [
          [1, 128, 64, 64],
          [1, 256, 32, 32],
          [1, 512, 16, 16],
          [1, 512, 8, 8]
        ];
        
        if (!this.verifyShape(feature, shapes[idx])) {
          throw new Error(`Reference feature ${idx} has incorrect shape. Expected ${shapes[idx]}, got ${this.getShape(feature)}`);
        }
        
        return tf.tensor4d(feature, shapes[idx]).asType("float32");
      });
  
      // Execute model
      const outputTensor: any = this.model.execute({
        "args_0:0": tokenTensor,
        "args_0_1:0": tokenTensor,
        args_0_2: referenceFeatures[0],
        args_0_3: referenceFeatures[1],
        args_0_4: referenceFeatures[2],
        args_0_5: referenceFeatures[3]
      });
  
      // Process output tensor
      const processedTensor = tf.tidy(() => {
        let tensor = outputTensor;
        if (tensor.shape[1] === 3) {
          tensor = tf.transpose(tensor, [0, 2, 3, 1]);
        }
        tensor = tensor.squeeze([0]);
        return tf.clipByValue(tensor, 0, 1);
      });
  
      // Convert to image
      const canvas = document.createElement("canvas");
      canvas.width = processedTensor.shape[1];
      canvas.height = processedTensor.shape[0];
      await tf.browser.toPixels(processedTensor as tfjs.Tensor3D, canvas);
  
      // Cleanup
      [tokenTensor, ...referenceFeatures, outputTensor, processedTensor].forEach(t => t.dispose());
  
      return canvas.toDataURL();
    } catch (error) {
      console.error("Error processing frame:", error);
      throw error;
    }
  }
  /**
   * Initialize buffer with cached frames if available
   */
  private async initializeBuffer(): Promise<void> {
    try {
      // Request initial frame processing to get cache information
      const response = await this.requestFrameProcessing(
        this.state.currentFrame
      );

      if (response.cached_frames) {
        // Update cache information
        Object.entries(response.cached_frames).forEach(([frameId, data]) => {
          this.cachedFrames.set(parseInt(frameId), {
            features: data.features,
            tokens: data.tokens,
            processed: true,
          });
        });
      }

      if (response.metadata?.cached_ranges) {
        this.cachedRanges = response.metadata.cached_ranges;
        this.processingProgress = response.metadata.processing_progress || 0;
      }

      // Initialize buffer with either cached frames or fetch new ones
      const initialFrames = Math.min(this.frameBuffer.capacity, 5);
      await this.prefetchFrames(initialFrames);
    } catch (error: any) {
      console.error("Buffer initialization error:", error);
      throw error;
    }
  }

  private async fetchVideoMetadata(videoId: number): Promise<any> {
    const response = await fetch(
      `https://192.168.1.108:8000/videos/${videoId}/metadata`,
      {
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch video metadata: ${response.statusText}`);
    }

    return await response.json();
  }

  public async processFrames(): Promise<void> {
    if (!this.state.videoId) {
      throw new Error("No video selected");
    }

    try {
      // Fetch frames if not in buffer
      const currentFrame = await this.ensureFrameLoaded(
        this.state.currentFrame
      );
      const referenceFrame = await this.ensureFrameLoaded(
        this.state.referenceFrame
      );

      if (!currentFrame || !referenceFrame) {
        throw new Error("Failed to load frames");
      }

      // Send frame processing request to server
      this.sendMessage({
        type: "process_frames",
        payload: {
          videoId: this.state.videoId,
          currentFrame: this.state.currentFrame,
          referenceFrame: this.state.referenceFrame,
        },
      });
    } catch (error: any) {
      this.emit("error", {
        message: "Frame processing failed",
        error: error.toString(),
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
          processed: false,
        });
        return frameData;
      }
    } catch (error: any) {
      console.error(`Failed to fetch frame ${frameIndex}:`, error);
    }

    return null;
  }

  // Also update WebSocket connection if you're using credentials
  public async connect(serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(serverUrl);

      this.ws.onopen = async () => {
        try {
          await this.initializeConnection();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      this.ws.onmessage = this.handleServerMessage.bind(this);
      this.ws.onerror = (error) => reject(error);
      this.ws.onclose = this.handleDisconnect.bind(this);
    });
  }

  private async initializeConnection(): Promise<void> {
    if (!this.ws) return;

    try {
      // Send initial configuration
      const initMessage = {
        type: "init",
        payload: {
          bufferSize: this.state.bufferSize,
          fps: this.state.fps,
        },
      };

      this.sendMessage(initMessage);

      // Wait for server acknowledgment
      const response = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Initialization timeout"));
        }, 5000); // 5 second timeout

        const handleInit = (event: MessageEvent) => {
          const message = JSON.parse(event.data);
          if (message.type === "init_response") {
            this.ws?.removeEventListener("message", handleInit);
            clearTimeout(timeout);
            resolve(message);
          }
        };

        this.ws?.addEventListener("message", handleInit);
      });

      // Update configuration with server limits
      if (response.config) {
        this.state.bufferSize = Math.min(
          this.state.bufferSize,
          response.config.bufferSize
        );
        this.frameBuffer.capacity = this.state.bufferSize;

        // Update other configurations
        if (response.config.maxFrames) {
          this.maxFrames = response.config.maxFrames;
        }
      }

      console.log("Connection initialized with config:", response.config);
    } catch (error) {
      console.error("Failed to initialize connection:", error);
      throw error;
    }
  }

  /**
   * Handle server messages
   */
  private handleServerMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      console.log("Received server message:", message);

      switch (message.type) {
        case "init_response":
          // Handled by initializeConnection
          break;

        case "frame_features":
          this.processFeatures(message.features)
            .then((timing) => {
              this.metrics.processingTime = timing.total;
              if (message.metadata?.frame_count) {
                this.currentVideoFrameCount = message.metadata.frame_count;
              }
              this.updateMetrics();
            })
            .catch((error) =>
              this.handleError({
                message: "Failed to process features",
                error: error.toString(),
              })
            );
          break;

        case "error":
          this.handleError(message);
          break;

        default:
          console.warn("Unknown message type:", message.type);
      }
    } catch (error: any) {
      console.error("Error parsing server message:", error);
      this.handleError({
        message: "Failed to parse server message",
        error: error.toString(),
      });
    }
  }

  /**
   * Process features received from server
   */
  private async processFeatures(features: FeatureData): Promise<{ total: number }> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
  
    const timing = {
      start: performance.now(),
      total: 0
    };
  
    const tensors: tfjs.Tensor[] = [];
    try {
      const tf = await import('@tensorflow/tfjs');
      
      // Ensure token shape is correct and create tensor
      const tokenShape = [1, features.current_token.length];
      const currentToken = tf.tensor2d(
        Array.isArray(features.current_token[0]) ? features.current_token : [features.current_token],
        tokenShape
      ).asType('float32');
      tensors.push(currentToken);
  
      // Process reference features with memory-efficient reshaping
      const referenceFeatures = features.reference_features.map((featureGroup, idx) => {
        const shapes = [[1, 128, 64, 64], [1, 256, 32, 32], [1, 512, 16, 16], [1, 512, 8, 8]];
        const expectedShape = shapes[idx];
        
        // Reshape data if needed
        const reshapedData = this.reshapeFeatureData(featureGroup, expectedShape);
        const tensor = tf.tensor4d(reshapedData, expectedShape).asType('float32');
        tensors.push(tensor);
        return tensor;
      });
  
      // Execute model with proper garbage collection
      const outputTensor = tf.tidy(() => {
        const result = this.model!.execute({
          'args_0:0': currentToken,
          'args_0_1:0': currentToken,
          'args_0_2': referenceFeatures[0],
          'args_0_3': referenceFeatures[1],
          'args_0_4': referenceFeatures[2],
          'args_0_5': referenceFeatures[3]
        });
        tensors.push(result as tfjs.Tensor);
        return result;
      });
  
      // Process output using tf.browser.draw for better performance
      const processedTensor = tf.tidy(() => {
        let tensor = outputTensor as tfjs.Tensor;
        if (tensor.shape[1] === 3) {
          tensor = tf.transpose(tensor, [0, 2, 3, 1]);
        }
        tensor = tensor.squeeze([0]);
        return tf.clipByValue(tensor, 0, 1);
      });
      tensors.push(processedTensor);
  
      // Create and setup canvas
      const canvas = document.createElement('canvas');
      canvas.width = processedTensor.shape[1];
      canvas.height = processedTensor.shape[0];
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }
  
      // Use tf.browser.draw instead of toPixels for better performance
      await tf.browser.draw(processedTensor as tfjs.Tensor3D, canvas, {
        multiplier: 1,
        magnitude: 1
      });
  
      // Emit processed frame
      this.emit('frameReady', {
        frameIndex: this.state.currentFrame,
        imageUrl: canvas.toDataURL()
      });
  
      timing.total = performance.now() - timing.start;
      return timing;
  
    } catch (error) {
      console.error('Error processing features:', error);
      throw error;
    } finally {
      // Ensure all tensors are properly disposed
      tensors.forEach(tensor => {
        if (tensor && !tensor.isDisposed) {
          tensor.dispose();
        }
      });
    }
  }
  
  private reshapeFeatureData(data: number[] | number[][][] | number[][][][], targetShape: number[]): number[][][][] {
    // Handle already correctly shaped data
    if (this.verifyShape(data as any[], targetShape)) {
      return data as number[][][][];
    }
  
    const [batch, channels, height, width] = targetShape;
    const flatData = Array.isArray(data[0]) ? (data as any).flat(3) : data;
    
    const result: number[][][][] = [];
    let index = 0;
    
    // Create the 4D structure efficiently
    for (let b = 0; b < batch; b++) {
      const batchArray: number[][][] = [];
      for (let c = 0; c < channels; c++) {
        const channelArray: number[][] = [];
        for (let h = 0; h < height; h++) {
          const row: number[] = [];
          for (let w = 0; w < width; w++) {
            row.push(flatData[index++]);
          }
          channelArray.push(row);
        }
        batchArray.push(channelArray);
      }
      result.push(batchArray);
    }
    
    return result;
  }

  private memoryCleanup(): void {
    if (typeof window !== 'undefined' && (window as any).gc) {
      (window as any).gc();
    }
    const tf = require('@tensorflow/tfjs');
    tf.tidy(() => {}); // Force garbage collection of unused tensors
    console.log('Memory cleaned up, tensor count:', tf.memory().numTensors);
  }
  
  private verifyShape(data: any[], shape: number[]): boolean {
    const actualShape = this.getShape(data);
    if (actualShape.length !== shape.length) return false;
    return actualShape.every((dim, i) => dim === shape[i]);
  }
  
  private getShape(arr: any[]): number[] {
    const shape = [];
    let current = arr;
    while (Array.isArray(current)) {
      shape.push(current.length);
      current = current[0];
    }
    return shape;
  }

  
  // Update the token cache handling
  private async processWithCache(frameIndex: number): Promise<string> {
    const cachedData = this.cachedFrames.get(frameIndex);
    if (!cachedData) {
      throw new Error('Cached data not found');
    }
  
    try {
      const tf = await import('@tensorflow/tfjs');
      
      // Create token tensor
      const tokenArray = Array.isArray(cachedData.tokens[0]) 
        ? cachedData.tokens 
        : [cachedData.tokens];
        
      const currentToken = tf.tensor2d(tokenArray, [1, 32]).asType('float32');
  
      // Get reference features for this video
      const refFeatures = this.referenceFeatures.get(this.state.videoId);
      if (!refFeatures) {
        throw new Error('Reference features not found');
      }
  
      // Convert reference features to tensors
      const referenceFeatures = refFeatures.map((featureGroup, idx) => {
        const shapes = [[1, 128, 64, 64], [1, 256, 32, 32], [1, 512, 16, 16], [1, 512, 8, 8]];
        const shape = shapes[idx];
        
        // Handle nested array structure
        let featureData:any = featureGroup[0];
        if (!Array.isArray(featureData[0])) {
          featureData = [featureData];
        }
        
        return tf.tensor(featureData, shape).asType('float32');
      });
  
      // Execute model
      const outputTensor = this.model.execute({
        'args_0:0': currentToken,
        'args_0_1:0': currentToken,
        'args_0_2': referenceFeatures[0],
        'args_0_3': referenceFeatures[1],
        'args_0_4': referenceFeatures[2],
        'args_0_5': referenceFeatures[3]
      });
  
      // Process tensor and convert to image
      const processedTensor = tf.tidy(() => {
        let tensor = outputTensor;
        if (tensor.shape[1] === 3) {
          tensor = tf.transpose(tensor, [0, 2, 3, 1]);
        }
        tensor = tensor.squeeze([0]);
        return tf.clipByValue(tensor, 0, 1);
      });
  
      const canvas = document.createElement('canvas');
      canvas.width = processedTensor.shape[1];
      canvas.height = processedTensor.shape[0];
      await tf.browser.toPixels(processedTensor as tfjs.Tensor3D, canvas);
  
      // Cleanup
      [currentToken, ...referenceFeatures, outputTensor, processedTensor].forEach(t => t.dispose());
  
      return canvas.toDataURL();
  
    } catch (error) {
      console.error('Error processing cached frame:', error);
      console.error('Cached data:', cachedData);
      throw error;
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
      listeners.forEach((callback) => callback(data));
    }
  }

  // Neural processing methods
  private async initializeModel(modelPath: string): Promise<void> {
    try {
      const tf = await import("@tensorflow/tfjs");
      await import("@tensorflow/tfjs-backend-webgpu");
  
      // Configure WebGPU with appropriate buffer size limits
      const webGPUConfig = {
        devicePixelRatio: 1,
        maxBufferSize: 4000000000, // ~4GB limit
        preferredGPUDevice: 'discrete'
      };
  
      try {
        await tf.setBackend("webgpu");
        await tf.ready();
        // Set WebGPU specific configurations
        const backend = tf.backend() as any;
        if (backend.setWebGPUDeviceConfig) {
          backend.setWebGPUDeviceConfig(webGPUConfig);
        }
        console.log("Using WebGPU backend");
      } catch (error: any) {
        console.warn("WebGPU not available, falling back to WebGL:", error);
        await tf.setBackend("webgl");
        await tf.ready();
      }
  
      this.model = await tf.loadGraphModel(modelPath);
      console.log("Model loaded successfully");
    } catch (error: any) {
      console.error("Error loading model:", error);
      throw error;
    }
  }
  

  private async runNeuralCodec(frameData: string): Promise<string> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    const processStart = performance.now();
    try {
      const tf = await import("@tensorflow/tfjs");

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
    } catch (error: any) {
      console.error("Error in neural processing:", error);
      throw error;
    }
  }

  private async base64ToTensor(base64Data: string): Promise<tfjs.Tensor4D> {
    const tf = await import("@tensorflow/tfjs");
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const tensor = tf.browser
            .fromPixels(img)
            .toFloat()
            .expandDims(0)
            .transpose([0, 3, 1, 2]); // Convert to NCHW format
          resolve(tensor as tfjs.Tensor4D);
        } catch (error: any) {
          reject(error);
        }
      };
      img.onerror = reject;
      img.src = base64Data.startsWith("data:")
        ? base64Data
        : `data:image/png;base64,${base64Data}`;
    });
  }

  private async processWithModel(
    inputTensor: tfjs.Tensor4D
  ): Promise<tfjs.Tensor4D> {
    if (!this.model) throw new Error("Model not initialized");

    const result = this.model.execute(inputTensor) as tfjs.Tensor4D;
    inputTensor.dispose();
    return result;
  }

  private async tensorToImage(tensor: tfjs.Tensor4D): Promise<string> {
    const tf = await import("@tensorflow/tfjs");

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
    const canvas = document.createElement("canvas");
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
        processed: false,
      });

      // Update buffer status
      this.updateBufferStatus();
    }
  }

  private handleFeatureData(payload: any): void {
    // Process incoming feature data
    // This would be used for frame interpolation or enhancement
    console.log("Received feature data:", payload);
  }

  private updateBufferStatus(): void {
    const bufferHealth =
      (this.frameBuffer.frames.size / this.frameBuffer.capacity) * 100;
    this.metrics.bufferHealth = bufferHealth;

    this.emit("bufferStatus", {
      health: bufferHealth,
      frameCount: this.frameBuffer.frames.size,
      capacity: this.frameBuffer.capacity,
    });
  }

  // Metrics and monitoring
  private updateMetrics(): void {
    const now = Date.now();
    const timeDiff = now - this.metrics.lastUpdate;

    if (timeDiff >= 1000) {
      // Update every second
      this.metrics.fps = 1000 / this.FRAME_INTERVAL;
      this.metrics.lastUpdate = now;

      this.emit("metricsUpdate", this.metrics);
    }
  }

  private handleError(payload: any): void {
    console.error("Codec error:", payload);
    this.emit("error", payload);
  }

  private handleBufferStatus(payload: any): void {
    // Update buffer status based on server feedback
    this.updateBufferStatus();
  }

  private handleDisconnect(): void {
    console.log("WebSocket disconnected");
    this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.CLOSED) {
      try {
        await this.connect(this.ws.url);
      } catch (error: any) {
        console.error("Reconnection failed:", error);
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

      // Check if frame index is valid
      if (frameIndex < 0 || !this.state.videoId) {
        throw new Error("Invalid frame request");
      }

      const response = await fetch(
        `https://192.168.1.108:8000/videos/${this.state.videoId}/frames/${frameIndex}`,
        {
          credentials: "same-origin", // Change from 'include' to 'same-origin'
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (response.status === 404) {
        console.warn(`Frame ${frameIndex} not found`);
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Update network latency metrics
      this.metrics.networkLatency = performance.now() - startTime;

      return data.frame; // base64 encoded image data
    } catch (error: any) {
      if (error.message.includes("404")) {
        // Handle missing frames gracefully
        return null;
      }

      this.handleError({
        message: `Failed to fetch frame ${frameIndex}`,
        error: error.toString(),
      });
      return null;
    }
  }

  /**
   * Prefetch frames with cache awareness
   */
  private async prefetchFrames(count: number): Promise<void> {
    const fetchPromises = [];
    for (let i = 0; i < count; i++) {
      const frameIndex = this.state.currentFrame + i;

      // Skip if frame is already in buffer
      if (this.frameBuffer.frames.has(frameIndex)) continue;

      // Check if frame is in cached ranges
      const isInCachedRange = this.cachedRanges.some(
        ([start, end]) => frameIndex >= start && frameIndex <= end
      );

      if (isInCachedRange && this.cachedFrames.has(frameIndex)) {
        // Use cached frame
        this.frameBuffer.frames.set(frameIndex, {
          timestamp: Date.now(),
          data: await this.processWithCache(frameIndex),
          processed: true,
        });
      } else {
        // Fetch frame if not cached
        fetchPromises.push(this.fetchFrame(frameIndex));
      }
    }

    if (fetchPromises.length > 0) {
      await Promise.all(fetchPromises);
    }

    this.updateBufferStatus();
  }

  /**
   * Process frames with cache awareness
   */
  private async processNextFrame(): Promise<void> {
    if (this.processingQueue.length === 0) {
      if (this.state.currentFrame >= this.currentVideoFrameCount - 1) {
        this.stop();
        return;
      }
      this.processingQueue.push(this.state.currentFrame);
    }

    const frameIndex = this.processingQueue[0];

    try {
      let frameData: string;

      // Check if frame has cached tokens
      const cachedFrame = this.cachedFrames.get(frameIndex);
      if (cachedFrame?.tokens) {
        // Process frame using cached tokens and reference features
        frameData = await this.processWithFeatures(
          frameIndex,
          cachedFrame.tokens
        );
      } else {
        // Request tokens from server
        const response = await this.requestFrameProcessing(frameIndex);
        if (!response.features?.current_token) {
          throw new Error("No token data in response");
        }

        // Process frame with new tokens
        frameData = await this.processWithFeatures(
          frameIndex,
          response.features.current_token
        );

        // Cache the tokens
        this.cachedFrames.set(frameIndex, {
          tokens: response.features.current_token,
          features: [], // We don't need to store features per frame anymore
          processed: true,
        });
      }

      // Emit processed frame
      this.emit("frameReady", {
        frameIndex,
        imageUrl: frameData,
        fromCache: !!cachedFrame,
      });

      // Update state
      this.processingQueue.shift();
      this.state.currentFrame++;
    } catch (error: any) {
      console.error("Frame processing error:", error);
      this.metrics.droppedFrames++;
      this.processingQueue.shift();
    }
  }
  /**
   * Request frame processing from server
   */
  private async requestFrameProcessing(frameIndex: number): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      const messageHandler = (event: MessageEvent) => {
        const response = JSON.parse(event.data);
        
        if (response.type === 'error') {
          this.ws?.removeEventListener('message', messageHandler);
          reject(new Error(response.message));
          return;
        }

        if (response.type === 'frame_features' && 
            response.current_frame === frameIndex) {
          this.ws?.removeEventListener('message', messageHandler);
          resolve(response);
        }
      };

      this.ws.addEventListener('message', messageHandler);

      const message = {
        type: 'process_frames',
        payload: {
          video_id: this.state.videoId,
          current_frame: frameIndex,
          reference_frame: 0  // Always use frame 0 as reference
        }
      };

      this.sendMessage(message);

      // Add timeout
      setTimeout(() => {
        this.ws?.removeEventListener('message', messageHandler);
        reject(new Error('Frame processing request timeout'));
      }, 10000);  // Increased timeout for initial load
    });
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
      } catch (error) {
        console.error("Playback error:", error);
        this.metrics.droppedFrames++;

        // Check if we should stop playback
        if (error instanceof Error && error.message.includes("404")) {
          console.log("Reached end of video");
          this.stop();
          return;
        }
      }
    }

    if (this.state.isPlaying) {
      requestAnimationFrame(() => this.playbackLoop());
    }
  }

  /**
   * Maintain the frame buffer
   */
  private async maintainBuffer(): Promise<void> {
    try {
      // Remove old frames
      const minFrame = this.state.currentFrame - 5;
      for (const [frameIndex] of this.frameBuffer.frames) {
        if (frameIndex < minFrame) {
          this.frameBuffer.frames.delete(frameIndex);
        }
      }

      // Get max buffered frame
      const frameIndices = Array.from(this.frameBuffer.frames.keys());
      const maxBufferedFrame =
        frameIndices.length > 0
          ? Math.max(...frameIndices)
          : this.state.currentFrame - 1;

      // Calculate next frame to buffer
      const nextFrame = maxBufferedFrame + 1;

      // Check if we've reached the end of the video
      if (nextFrame >= this.currentVideoFrameCount) {
        console.log("Reached end of video");
        this.emit("bufferStatus", {
          health: this.metrics.bufferHealth,
          frameCount: this.frameBuffer.frames.size,
          capacity: this.frameBuffer.capacity,
          endReached: true,
        });
        return;
      }

      // Only fetch if within bounds
      if (nextFrame < this.state.currentFrame + this.frameBuffer.capacity) {
        const frame = await this.ensureFrameLoaded(nextFrame);
        if (!frame) {
          console.log("Failed to load next frame");
        }
      }
    } catch (error) {
      console.warn("Buffer maintenance error:", error);
    }
  }
}

export default NeuralVideoCodec;
