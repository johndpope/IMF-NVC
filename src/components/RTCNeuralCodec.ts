import type * as tfjs from "@tensorflow/tfjs";

// Types for signaling messages
interface SignalingMessage {
  type: string;
  payload: any;
}

interface SignalingInit extends SignalingMessage {
  type: "init";
  payload: {
    fps: number;
    rtcConfig: RTCConfiguration;
  };
}

interface SignalingOffer extends SignalingMessage {
  type: "offer";
  payload: {
    sdp: RTCSessionDescriptionInit;
  };
}

interface SignalingAnswer extends SignalingMessage {
  type: "answer";
  payload: {
    sdp: RTCSessionDescriptionInit;
  };
}

interface SignalingCandidate extends SignalingMessage {
  type: "ice-candidate";
  payload: {
    candidate: RTCIceCandidateInit;
  };
}

interface SignalingError extends SignalingMessage {
  type: "error";
  payload: {
    message: string;
    code?: number;
  };
}

type SignalingMessageTypes =
  | SignalingInit
  | SignalingOffer
  | SignalingAnswer
  | SignalingCandidate
  | SignalingError;

interface RTCConfig {
  serverUrl: string; // Signaling server URL
  iceServers: RTCIceServer[];
  fps: number;
}

interface SplitReferenceFeatures {
  tensors: tfjs.Tensor4D[];
  splitDim: number;
  originalShape: number[];
}

interface ReferenceData {
  features: SplitReferenceFeatures[]; // Store split feature tensors
  token: number[];
  shapes: number[][];
}

interface FrameToken {
  token: number[];
  frameIndex: number;
}

interface FrameBuffer {
  frames: Map<
    number,
    {
      timestamp: number;
      data: string; // base64 encoded image data
    }
  >;
  capacity: number;
}

interface CodecConfig {
  fps?: number;
  bufferSize?: number;
  modelPath?: string;
}
interface VideoState {
  videoId: number;
  currentFrame: number;
  referenceFrame: number;
  isPlaying: boolean;
  bufferSize: number;
  fps: number;
}

interface CodecMetrics {
  fps: number;
  bufferHealth: number;
  processingTime: number;
  networkLatency: number;
  droppedFrames: number;
  lastUpdate: number;
}

// Add new types for bulk token operations
interface BulkTokenResponse {
  videoId: number;
  tokens: {
    [frameIndex: number]: number[];
  };
  metadata: {
    totalFrames: number;
    processedFrames: number;
  };
}

interface BatchProcessingResult {
  frameIndex: number;
  imageUrl: string;
}

enum PlaybackState {
  PLAYING = "playing",
  PAUSED = "paused",
  STOPPED = "stopped",
}
// Additional types for event handling and metrics
type EventCallback = (data: any) => void;
type EventType = "frameReady" | "error" | "bufferStatus" | "metricsUpdate";

// Base interfaces
interface CodecEvents {
  frameReady: (data: { frameIndex: number; imageUrl: string }) => void;
  error: (data: { message: string; error?: any }) => void;
  bufferStatus: (data: {
    frameCount?: number;
    capacity?: number;
    health?: number; // Add health for model loading progress
    type?: "buffer" | "model"; // Add type to distinguish between buffer and model status
  }) => void;
  metricsUpdate: (metrics: CodecMetrics) => void;
}

interface CodecMetrics {
  fps: number;
  bufferHealth: number;
  processingTime: number;
  networkLatency: number;
  droppedFrames: number;
  lastUpdate: number;
}

// Base abstract class for common functionality
abstract class BaseNeuralCodec {
  protected eventListeners = new Map<keyof CodecEvents, Set<Function>>();
  protected metrics: CodecMetrics;
  protected model: tfjs.GraphModel | null = null;
  protected referenceData: Map<number, ReferenceData> = new Map();
  private frameBuffer: FrameBuffer;
  public currentVideoId: number | null = null;

  public readonly MAX_WEBGPU_BUFFER_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
  public readonly CHUNK_SIZE = 32; // Process 32 frames at a time
  public useWebGL = false;


  private readonly DEBUG = true;
private readonly BUFFER_SIZE_LIMIT = 4 * 1024 * 1024 * 1024; // 4GB WebGPU limit

// Helper to calculate tensor size in bytes
private calculateTensorSize(tensor: tfjs.Tensor): number {
  const elementSize = 4; // Float32 = 4 bytes
  return tensor.size * elementSize;
}

// Debug logger
private log(message: string, data?: any) {
  if (this.DEBUG) {
    console.log(`[RTCNeuralCodec] ${message}`, data);
  }
}

// Memory usage tracker
public async logMemoryUsage(context: string) {
  const tf = await import("@tensorflow/tfjs");
  const memory = tf.memory();
  this.log(`Memory Usage (${context}):`, {
    numTensors: memory.numTensors,
    numBytes: memory.numBytes / (1024 * 1024) + ' MB',
    numDataBuffers: memory.numDataBuffers,
    backend: tf.getBackend()
  });
}

// Tensor size checker
public checkTensorSize(tensor: tfjs.Tensor, name: string): void {
  const sizeInBytes = this.calculateTensorSize(tensor);
  this.log(`Tensor Size Check - ${name}:`, {
    shape: tensor.shape,
    size: tensor.size,
    sizeInBytes: (sizeInBytes / (1024 * 1024)).toFixed(2) + ' MB',
    sizeInGB: (sizeInBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
    exceedsLimit: sizeInBytes > this.BUFFER_SIZE_LIMIT
  });
}

  // Add method to check tensor memory usage
  public async getMemoryInfo(): Promise<{ [key: string]: number }> {
    const tf = await import("@tensorflow/tfjs");
    return {
      numTensors: tf.memory().numTensors,
      numBytes: tf.memory().numBytes,
      numDataBuffers: tf.memory().numDataBuffers,
    };
  }
  // Helper method to split large tensors
  public async splitTensor4D(
    tensor: tfjs.Tensor4D
  ): Promise<SplitReferenceFeatures> {
    const tf = await import("@tensorflow/tfjs");
    const originalShape = tensor.shape;
    const splitDim = Math.max(
      1,
      Math.floor((tensor.size * 4) / this.MAX_TENSOR_SIZE)
    );

    return tf.tidy(() => {
      // Calculate split size
      const splitSize = Math.ceil(originalShape[0] / splitDim);
      const tensors: tfjs.Tensor4D[] = [];

      // Split tensor along first dimension
      for (let i = 0; i < splitDim; i++) {
        const start = i * splitSize;
        const end = Math.min(start + splitSize, originalShape[0]);
        const slice = tensor.slice([start, 0, 0, 0], [end - start, -1, -1, -1]);
        // Keep tensor from being disposed by tidy
        tensors.push(tf.keep(slice as tfjs.Tensor4D));
      }

      return {
        tensors,
        splitDim,
        originalShape,
      };
    });
  }
  constructor(protected config: CodecConfig) {
    this.metrics = {
      fps: 0,
      bufferHealth: 100,
      processingTime: 0,
      networkLatency: 0,
      droppedFrames: 0,
      lastUpdate: Date.now(),
    };
    this.frameBuffer = {
      frames: new Map(),
      capacity: config.bufferSize || 60,
    };

    // Initialize event listeners
    ["frameReady", "error", "bufferStatus", "metricsUpdate"].forEach(
      (event) => {
        this.eventListeners.set(event as keyof CodecEvents, new Set());
      }
    );
  }

  // Add this method to check and setup appropriate backend
  private async setupTensorflowBackend(): Promise<void> {
    const tf = await import("@tensorflow/tfjs");

    try {
      // First try WebGPU
      await import("@tensorflow/tfjs-backend-webgpu");
      await tf.setBackend("webgpu");
      await tf.ready();

      // Configure WebGPU
      const backend = tf.backend() as any;
      if (backend.setWebGPUDeviceConfig) {
        backend.setWebGPUDeviceConfig({
          devicePixelRatio: 1,
          maxBufferSize: this.MAX_WEBGPU_BUFFER_SIZE,
        });
      }

      this.useWebGL = false;
      console.log("Using WebGPU backend");
    } catch (error) {
      console.warn(
        "WebGPU not available or buffer size exceeded, falling back to WebGL:",
        error
      );

      // Fall back to WebGL
      try {
        await tf.setBackend("webgl");
        await tf.ready();

        // Configure WebGL for memory efficiency
        const backend = tf.backend() as any;
        if (backend.setFlags) {
          backend.setFlags({
            WEBGL_CPU_FORWARD: true, // Allow CPU fallback
            WEBGL_SIZE_UPLOAD_UNIFORM: 4, // Reduce uniform buffer size
            WEBGL_VERSION: 2,
            WEBGL_FORCE_F16_TEXTURES: false,
            WEBGL_PACK: true,
          });
        }

        this.useWebGL = true;
        console.log("Using WebGL backend");
      } catch (glError) {
        console.error("WebGL initialization failed:", glError);
        throw new Error("No suitable backend available");
      }
    }
  }

  // Common event handling methods
  public on<K extends keyof CodecEvents>(
    event: K,
    callback: CodecEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.add(callback);
    }
  }

  public off<K extends keyof CodecEvents>(
    event: K,
    callback: CodecEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  protected emit<K extends keyof CodecEvents>(
    event: K,
    data: Parameters<CodecEvents[K]>[0]
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(data));
    }
  }

  // Abstract methods that must be implemented
  abstract connect(serverUrl: string): Promise<void>;
  abstract startPlayback(videoId: number): Promise<void>;
  abstract stop(): void;

  // Common methods that can be used by subclasses
  async initModel(modelPath: string): Promise<void> {
    const tf = await import("@tensorflow/tfjs");

    try {
      // Initial progress update
      this.emit("bufferStatus", {
        health: 0,
        type: "model",
      });

      // Setup appropriate backend
      await this.setupTensorflowBackend();

      // Load model with explicit progress tracking
      this.model = await tf.loadGraphModel(modelPath, {
        onProgress: (fraction) => {
          const progressPercent = Math.round(fraction * 100);
          console.log(`Model loading progress: ${progressPercent}%`);
          this.emit("bufferStatus", {
            health: progressPercent,
            type: "model",
          });
        },
      });

      // Final progress update
      this.emit("bufferStatus", {
        health: 100,
        type: "model",
      });
      console.log("Model loaded successfully");
    } catch (error) {
      this.emit("bufferStatus", {
        health: 0,
        type: "model",
      });
      console.error("Error initializing model:", error);
      throw error;
    }
  }

  protected updateMetrics(): void {
    const now = Date.now();
    const timeDiff = now - this.metrics.lastUpdate;

    if (timeDiff >= 1000) {
      this.metrics.fps = 1000 / (timeDiff / this.metrics.droppedFrames || 1);
      this.metrics.lastUpdate = now;
      this.emit("metricsUpdate", this.metrics);
    }
  }

  public getMetrics(): CodecMetrics {
    return { ...this.metrics };
  }

  public async processFrame(frameToken: FrameToken): Promise<void> {
    const tf = await import("@tensorflow/tfjs");
    const tensorsToDispose: tfjs.Tensor[] = [];

    try {
      // Validate model and reference data
      if (!this.model || !this.currentVideoId) {
        throw new Error("Model or video not initialized");
      }

      const refData = this.referenceData.get(this.currentVideoId);
      if (!refData) {
        throw new Error("Reference data not loaded");
      }

      // Create and validate input tensor
      const currentToken = tf.tidy(() =>
        tf.tensor2d([Array.from(frameToken.token)], [1, 32]).asType("float32")
      );
      tensorsToDispose.push(currentToken);

      if (!this.validateTensor(currentToken, "input token")) {
        throw new Error("Invalid input tensor");
      }

      // Process features
      let finalOutput: tfjs.Tensor | null = null;

      for (let i = 0; i < refData.features.length; i++) {
        const splitFeature = refData.features[i];

        // Validate each reference tensor before use
        for (const featureTensor of splitFeature.tensors) {
          if (!this.validateTensor(featureTensor, `reference feature ${i}`)) {
            throw new Error(`Invalid reference tensor at index ${i}`);
          }
        }

        const partialOutputs = await Promise.all(
          splitFeature.tensors.map((featureTensor) =>
            tf.tidy(() => {
              const inputDict = {
                "args_0:0": currentToken,
                "args_0_1:0": currentToken,
                [`args_0_${i + 2}`]: featureTensor,
              };
              return this.model!.execute(inputDict) as tfjs.Tensor;
            })
          )
        );

        // Combine outputs and clean up
        const combinedOutput = tf.tidy(() => {
          if (partialOutputs.length === 1) return tf.keep(partialOutputs[0]);
          const result = tf.concat(partialOutputs, 0);
          return tf.keep(result);
        });

        partialOutputs.forEach((t) => t.dispose());

        if (!finalOutput) {
          finalOutput = combinedOutput;
        } else {
          const newOutput = tf.tidy(() => {
            const result = tf.add(finalOutput!, combinedOutput);
            return tf.keep(result);
          });
          finalOutput.dispose();
          combinedOutput.dispose();
          finalOutput = newOutput;
        }
      }

      // Process final output
      if (!finalOutput || !this.validateTensor(finalOutput, "final output")) {
        throw new Error("Invalid final output tensor");
      }

      const processedTensor = tf.tidy(() => {
        let tensor = finalOutput!;
        if (tensor.shape[1] === 3) {
          tensor = tf.transpose(tensor, [0, 2, 3, 1]);
        }
        tensor = tensor.squeeze([0]);
        return tf.keep(tf.clipByValue(tensor, 0, 1));
      });

      // Draw result and emit
      const canvas = document.createElement("canvas");
      canvas.width = processedTensor.shape[1];
      canvas.height = processedTensor.shape[0];
      await tf.browser.draw(processedTensor as tfjs.Tensor3D, canvas);

      this.emit("frameReady", {
        frameIndex: frameToken.frameIndex,
        imageUrl: canvas.toDataURL(),
      });

      // Clean up final tensors
      if (finalOutput) finalOutput.dispose();
      processedTensor.dispose();
    } catch (error) {
      console.error("Error processing frame:", error);
      throw error;
    } finally {
      // Clean up tracked tensors
      tensorsToDispose.forEach((tensor) => {
        if (tensor && !tensor.isDisposed) {
          tensor.dispose();
        }
      });
    }
  }

  // Update the reference data processing methods in RTCNeuralCodec class

  private async splitTensor4D(
    tensor: tfjs.Tensor4D
  ): Promise<SplitReferenceFeatures> {
    const tf = await import("@tensorflow/tfjs");
    const originalShape = tensor.shape;
    const splitDim = Math.max(
      1,
      Math.floor((tensor.size * 4) / this.MAX_TENSOR_SIZE)
    );

    return tf.tidy(() => {
      // Calculate split size
      const splitSize = Math.ceil(originalShape[0] / splitDim);
      const tensors: tfjs.Tensor4D[] = [];

      // Split tensor along first dimension
      for (let i = 0; i < splitDim; i++) {
        const start = i * splitSize;
        const end = Math.min(start + splitSize, originalShape[0]);
        const slice = tensor.slice([start, 0, 0, 0], [end - start, -1, -1, -1]);
        // Keep tensor from being disposed by tidy
        tensors.push(tf.keep(slice as tfjs.Tensor4D));
      }

      return {
        tensors,
        splitDim,
        originalShape,
      };
    });
  }

  public async loadReferenceData(videoId: number): Promise<void> {
    const tf = await import("@tensorflow/tfjs");
    await this.logMemoryUsage('Before loading reference data');
    
    try {
      const response = await fetch(
        `https://192.168.1.108:8000/videos/${videoId}/reference`,
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        }
      );
  
      if (!response.ok) {
        throw new Error(`Failed to fetch reference data: ${response.statusText}`);
      }
  
      const data = await response.json();
      
      this.log('Reference Data Stats:', {
        numFeatures: data.reference_features.length,
        featureSizes: data.reference_features.map((f: any[]) => ({
          dimensions: [f.length, f[0].length, f[0][0].length, f[0][0][0].length],
          totalElements: f.length * f[0].length * f[0][0].length * f[0][0][0].length,
          estimatedSizeInMB: (f.length * f[0].length * f[0][0].length * f[0][0][0].length * 4 / (1024 * 1024)).toFixed(2)
        }))
      });
  
      const shapes = [
        [1, 128, 64, 64],
        [1, 256, 32, 32],
        [1, 512, 16, 16],
        [1, 512, 8, 8],
      ];
  
      // Create tensors with size checking
      const features = await Promise.all(data.reference_features.map(async (feature: number[][][], idx: number) => {
        const tensor = tf.tensor4d(feature, shapes[idx]).asType("float32");
        this.checkTensorSize(tensor, `Reference Feature ${idx}`);
        
        // Split if too large
        if (this.calculateTensorSize(tensor) > this.BUFFER_SIZE_LIMIT) {
          this.log(`Splitting large tensor ${idx}`, { shape: tensor.shape });
          // Calculate split size to stay under buffer limit
          const numSplits = Math.ceil(this.calculateTensorSize(tensor) / (this.BUFFER_SIZE_LIMIT / 2));
          const splitSize = Math.ceil(tensor.shape[0] / numSplits);
          
          const splits = [];
          for (let i = 0; i < numSplits; i++) {
            const start = i * splitSize;
            const size = Math.min(splitSize, tensor.shape[0] - start);
            const split = tensor.slice([start, 0, 0, 0], [size, -1, -1, -1]);
            splits.push(split);
            this.checkTensorSize(split, `Split ${i} of Feature ${idx}`);
          }
          tensor.dispose();
          return splits;
        }
        
        return [tensor];
      }));
  
      await this.logMemoryUsage('After creating reference tensors');
  
      this.referenceData.set(videoId, {
        features,
        token: data.reference_token,
        shapes,
      });
  
    } catch (error) {
      console.error("Error loading reference data:", error);
      throw error;
    }
  }

  public cleanupReferenceTensors(videoId: number): void {
    const refData = this.referenceData.get(videoId);
    if (refData) {
      refData.features.forEach((splitFeature) => {
        splitFeature.tensors.forEach((tensor) => {
          if (tensor && !tensor.isDisposed) {
            tensor.dispose();
          }
        });
      });
      this.referenceData.delete(videoId);
    }
  }

  // Add helper method to validate tensor state
  private validateTensor(tensor: tfjs.Tensor, context: string): boolean {
    if (!tensor || tensor.isDisposed) {
      console.error(
        `Invalid tensor in ${context}: ${tensor ? "disposed" : "null"}`
      );
      return false;
    }
    return true;
  }
}

// RTCNeuralCodec implementation
class RTCNeuralCodec extends BaseNeuralCodec {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioElement: HTMLAudioElement;
  private signalingWs: WebSocket | null = null;
  private processingQueue = new Map<number, Promise<void>>();

  private pendingCandidates: RTCIceCandidate[] = [];

  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly INITIAL_RETRY_DELAY = 1000; // 1 second
  private readonly MAX_RETRY_DELAY = 30000; // 30 seconds
  private retryCount = 0;
  private retryTimeout: NodeJS.Timeout | null = null;
  private isReconnecting = false;

  private dataChannelOpenPromise: Promise<void> | null = null;
  private dataChannelResolve: (() => void) | null = null;
  private connectionTimeout: number = 10000; // 10 seconds timeout

  private modelInitialized = false;
  private modelLoadPromise: Promise<void> | null = null;
  private isCleaningUp = false;
  private tokenCache: Map<number, Map<number, number[]>> = new Map();
  private batchSize: number = 4; // Configurable batch size for processing

  // Add state tracking
  private playbackState: PlaybackState = PlaybackState.STOPPED;
  private pausedAt: number | null = null;
  private lastFrameIndex: number | null = null;

  private readonly MAX_TENSOR_SIZE = 1024 * 1024 * 1024; // 1GB per tensor
  private readonly SPLIT_SIZE = 32; // Split tensors into chunks of this size




  constructor(config: RTCConfig) {
    super(config);
    this.audioElement = new Audio();
    this.audioElement.autoplay = true;
    this.setupAudioElement();
    if (config.modelPath) {
      this.modelLoadPromise = this.initModel(config.modelPath).then(() => {
        this.modelInitialized = true;
      });
    }
  }

  // Add method to check model state
  private async ensureModel(): Promise<void> {
    if (this.modelInitialized && this.model) {
      return;
    }

    if (this.modelLoadPromise) {
      await this.modelLoadPromise;
    } else if (this.config.modelPath) {
      this.modelLoadPromise = this.initModel(this.config.modelPath).then(() => {
        this.modelInitialized = true;
      });
      await this.modelLoadPromise;
    } else {
      throw new Error("No model path provided");
    }

    if (!this.model) {
      throw new Error("Model failed to initialize");
    }
  }

  private getRetryDelay(): number {
    // Exponential backoff with jitter
    const exponentialDelay = Math.min(
      this.INITIAL_RETRY_DELAY * Math.pow(2, this.retryCount),
      this.MAX_RETRY_DELAY
    );
    // Add random jitter (±20%)
    const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
    return exponentialDelay + jitter;
  }

  private async setupWebRTC(config: RTCConfiguration): Promise<void> {
    this.peerConnection = new RTCPeerConnection(config);

    // Setup data channel for frame tokens
    this.dataChannel = this.peerConnection.createDataChannel("frames", {
      ordered: true,
      maxRetransmits: 1,
    });

    this.dataChannel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "frame_token") {
        this.handleFrameToken(message);
      }
    };

    // Handle incoming audio track
    this.peerConnection.ontrack = (event) => {
      if (event.track.kind === "audio") {
        const stream = new MediaStream([event.track]);
        this.audioElement.srcObject = stream;
      }
    };

    // Handle connection state changes
    this.peerConnection.oniceconnectionstatechange = () => {
      if (this.peerConnection?.iceConnectionState === "disconnected") {
        this.handleDisconnect();
      }
    };
  }

  private async handleFrameToken(message: any) {
    const { frameIndex, token } = message;

    // Debug log the incoming token data
    console.log("Received frame token:", {
      frameIndex,
      tokenShape: token.length,
      tokenPreview: token.slice(0, 5),
      tokenType: typeof token,
      isArray: Array.isArray(token),
      fullToken: token, // temporary for debugging
    });

    // Flatten nested arrays if needed
    let flatToken: number[];
    if (Array.isArray(token[0]) && Array.isArray(token[0][0])) {
      // Double nested array
      flatToken = token[0];
    } else if (Array.isArray(token[0])) {
      // Single nested array
      flatToken = token[0];
    } else {
      // Already flat
      flatToken = token;
    }

    console.log("Flattened token:", {
      length: flatToken.length,
      preview: flatToken.slice(0, 5),
      isArray: Array.isArray(flatToken),
    });

    try {
      // Flatten token if needed
      const flatToken = Array.isArray(token[0]) ? token.flat() : token;

      // Process single frame
      await this.processFrame({
        frameIndex,
        token: new Float32Array(flatToken),
      });
    } catch (error) {
      console.error("Frame processing error:", error);
      this.metrics.droppedFrames++;
      this.emit("error", {
        message: "Frame processing failed",
        error,
      });
    }
    // try {
    //   // Process frame and add to processing queue
    //   const processPromise = this.processFrame({
    //     frameIndex,
    //     token: new Float32Array(flatToken)
    //   });

    //   this.processingQueue.set(frameIndex, processPromise);

    //   // Clean up queue after processing
    //   await processPromise;
    //   this.processingQueue.delete(frameIndex);
    // } catch (error) {
    //   console.error("Frame processing error:", error);
    //   console.error("Token state at error:", {
    //     original: token,
    //     flattened: flatToken,
    //     lengths: {
    //       original: token.length,
    //       flattened: flatToken.length
    //     }
    //   });
    //   this.metrics.droppedFrames++;
    //   this.emit("error", {
    //     message: "Frame processing failed",
    //     error,
    //   });
    // }
  }

  private setupAudioElement() {
    // Sync frame processing with audio timing
    this.audioElement.ontimeupdate = () => {
      const currentTime = this.audioElement.currentTime;
      const frameIndex = Math.floor(currentTime * this.config.fps);
      this.syncFrameProcessing(frameIndex);
    };
  }

  private async syncFrameProcessing(targetFrame: number) {
    // Check if we need to wait for frame processing
    const processing = this.processingQueue.get(targetFrame);
    if (processing) {
      await processing;
    }

    // Update metrics
    this.updateMetrics();
  }

  /**
   * Pauses video playback while maintaining the connection
   * @returns Promise that resolves when playback is paused
   */
  public async pause(): Promise<void> {
    try {
      // Only pause if currently playing
      if (this.playbackState !== PlaybackState.PLAYING) {
        return;
      }

      // Update state
      this.playbackState = PlaybackState.PAUSED;
      this.pausedAt = this.audioElement.currentTime;
      this.lastFrameIndex = Math.floor(this.pausedAt * this.config.fps);

      // Pause audio
      this.audioElement.pause();

      // Notify peer about pause
      if (this.dataChannel?.readyState === "open") {
        this.dataChannel.send(
          JSON.stringify({
            type: "playback_control",
            action: "pause",
            timestamp: this.pausedAt,
            frameIndex: this.lastFrameIndex,
          })
        );
      }

      // Update metrics
      this.emit("metricsUpdate", {
        ...this.metrics,
        fps: 0, // FPS is 0 when paused
      });

      // Emit buffer status update
      this.emit("bufferStatus", {
        frameCount: this.lastFrameIndex,
        capacity: this.frameBuffer.capacity,
        health: this.metrics.bufferHealth,
        type: "buffer",
      });
    } catch (error) {
      console.error("Error pausing playback:", error);
      this.emit("error", { message: "Failed to pause playback", error });
      throw error;
    }
  }

  // Modify startPlayback to handle resume from pause
  public async startPlayback(videoId: number): Promise<void> {
    try {
      // If resuming the same video
      if (
        this.currentVideoId === videoId &&
        this.playbackState === PlaybackState.PAUSED
      ) {
        this.playbackState = PlaybackState.PLAYING;

        // Resume from last position
        if (this.pausedAt !== null) {
          this.audioElement.currentTime = this.pausedAt;
        }

        this.audioElement.play();

        // Notify peer about resume
        if (this.dataChannel?.readyState === "open") {
          this.dataChannel.send(
            JSON.stringify({
              type: "playback_control",
              action: "resume",
              timestamp: this.pausedAt,
              frameIndex: this.lastFrameIndex,
            })
          );
        }

        // Reset pause state
        this.pausedAt = null;
        this.lastFrameIndex = null;

        return;
      }

      // Otherwise start new playback
      this.currentVideoId = videoId;
      this.playbackState = PlaybackState.PLAYING;
      this.pausedAt = null;
      this.lastFrameIndex = null;

      // Rest of existing startPlayback implementation...
      await this.loadReferenceData(videoId);
      const prefetchSize = 100;
      await this.fetchBulkTokens(videoId, 0, prefetchSize - 1);
      this.startBackgroundTokenFetching(videoId, prefetchSize);

      if (this.dataChannel?.readyState === "open") {
        this.dataChannel.send(
          JSON.stringify({
            type: "start_stream",
            videoId,
            fps: this.config.fps,
          })
        );
      }
    } catch (error) {
      console.error("Playback start failed:", error);
      this.emit("error", { message: "Failed to start playback", error });
      throw error;
    }
  }

  // Modify stop method to handle state
  public stop(): void {
    this.playbackState = PlaybackState.STOPPED;
    this.pausedAt = null;
    this.lastFrameIndex = null;
    this.audioElement.pause();
    this.currentVideoId = null;
    this.processingQueue.clear();
    this.dataChannel?.close();
    this.peerConnection?.close();
  }

  // Add method to check if paused
  public isPaused(): boolean {
    return this.playbackState === PlaybackState.PAUSED;
  }

  // Add method to get current playback state
  public getPlaybackState(): PlaybackState {
    return this.playbackState;
  }

  // Background token fetching
  private async startBackgroundTokenFetching(
    videoId: number,
    startFrame: number
  ): Promise<void> {
    const chunkSize = 100;
    let currentStart = startFrame;

    while (this.isPlaying && this.currentVideoId === videoId) {
      try {
        await this.fetchBulkTokens(
          videoId,
          currentStart,
          currentStart + chunkSize - 1
        );
        currentStart += chunkSize;
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limiting
      } catch (error) {
        console.error("Background token fetching error:", error);
        break;
      }
    }
  }

  public stop(): void {
    this.audioElement.pause();
    this.currentVideoId = null;
    this.processingQueue.clear();
    this.dataChannel?.close();
    this.peerConnection?.close();
  }

  private handleDisconnect(): void {
    console.log("Connection lost, attempting reconnect...");
    this.reconnect();
  }

  private async handleSignalingMessage(event: MessageEvent): Promise<void> {
    if (!this.signalingWs || this.signalingWs.readyState !== WebSocket.OPEN) {
      console.warn("Received message with closed signaling connection");
      return;
    }

    let message: SignalingMessageTypes;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Failed to parse signaling message:", error);
      return;
    }

    console.log("message:", message);
    try {
      switch (message.type) {
        case "init_response":
          await this.createAndSendOffer();
          break;

        case "offer":
          await this.handleOffer(message.payload.sdp);
          break;

        case "answer":
          await this.handleAnswer(message.payload.sdp);
          break;

        case "ice-candidate":
          await this.handleIceCandidate(message.payload.candidate);
          break;

        case "error":
          this.handleSignalingError(message.payload);
          break;

        case "restart":
          await this.handleConnectionRestart();
          break;

        default:
          console.warn("Unknown signaling message type:", message.type);
      }
    } catch (error) {
      console.error("Error handling signaling message:", error);
      this.emit("error", {
        message: "Signaling error",
        error,
      });
    }
  }

  private sendSignalingMessage(message: SignalingMessageTypes): void {
    if (!this.signalingWs) {
      throw new Error("No signaling connection available");
    }

    if (this.signalingWs.readyState !== WebSocket.OPEN) {
      throw new Error("Signaling connection is not open");
    }

    try {
      this.signalingWs.send(JSON.stringify(message));
    } catch (error) {
      console.error("Failed to send signaling message:", error);
      this.handleSignalingError({
        message: "Failed to send message",
        code: 1001,
      });
    }
  }

  private async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("No RTCPeerConnection available");
    }

    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );

      // Create and set local answer
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      // Send answer to peer
      this.sendSignalingMessage({
        type: "answer",
        payload: {
          sdp: answer,
        },
      });

      // Add any pending ICE candidates
      for (const candidate of this.pendingCandidates) {
        await this.peerConnection.addIceCandidate(candidate);
      }
      this.pendingCandidates = [];
    } catch (error) {
      console.error("Error handling offer:", error);
      throw error;
    }
  }

  private async handleInitResponse(payload: any): Promise<void> {
    try {
      console.log("payload:", payload);
      // Setup WebRTC with received configuration
      await this.setupWebRTC(payload.rtcConfig);

      // Create and send offer
      const offer = await this.peerConnection?.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });

      if (!offer) throw new Error("Failed to create offer");

      await this.peerConnection?.setLocalDescription(offer);

      this.sendSignalingMessage({
        type: "offer",
        payload: {
          sdp: offer,
        },
      });

      this.connectionState = "connecting";
    } catch (error) {
      console.error("Error handling init response:", error);
      throw error;
    }
  }

  private async handleConnectionRestart(): Promise<void> {
    try {
      // Close existing connections
      this.peerConnection?.close();
      this.dataChannel?.close();

      // Clear state
      this.pendingCandidates = [];
      this.connectionState = "new";

      // Reinitialize WebRTC
      await this.initializeSignaling();

      // Restore playback if needed
      if (this.currentVideoId !== null) {
        await this.startPlayback(this.currentVideoId);
      }
    } catch (error) {
      console.error("Failed to restart connection:", error);
      this.handleSignalingError({
        message: "Connection restart failed",
        code: 1006,
      });
    }
  }

  // Helper method to ensure cleanup completes
  private async ensureCleanup(): Promise<void> {
    let cleanupAttempts = 0;
    const maxAttempts = 3;

    while (cleanupAttempts < maxAttempts) {
      try {
        await this.cleanup();
        break;
      } catch (error) {
        cleanupAttempts++;
        console.error(`Cleanup attempt ${cleanupAttempts} failed:`, error);

        if (cleanupAttempts === maxAttempts) {
          console.error("Max cleanup attempts reached, forcing reset");
          // Force reset of all connections
          this.dataChannel = null;
          this.peerConnection = null;
          this.signalingWs = null;
          this.connectionState = "new";
          this.currentVideoId = null;
          throw new Error("Cleanup failed after maximum attempts");
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  public async connect(signalingUrl: string): Promise<void> {
    try {
      // Reset retry count on new connection attempt
      this.retryCount = 0;
      await this.cleanup(true); // Preserve model during connection cleanup

      // Create WebSocket connection
      this.signalingWs = new WebSocket(signalingUrl);

      return new Promise((resolve, reject) => {
        if (!this.signalingWs) {
          return reject(new Error("No WebSocket connection"));
        }

        let connectionTimeout = setTimeout(() => {
          this.handleConnectionTimeout(reject);
        }, this.connectionTimeout);

        this.signalingWs.onopen = async () => {
          try {
            clearTimeout(connectionTimeout);
            this.retryCount = 0;
            this.isReconnecting = false;

            // Initialize signaling first
            await this.initializeSignaling();

            // Wait for data channel to be ready
            console.log("Waiting for data channel to open...");
            await this.waitForDataChannel();
            console.log("Data channel opened successfully");

            resolve();
          } catch (error) {
            console.error("Connection setup failed:", error);
            reject(error);
            await this.handleReconnect();
          }
        };

        this.signalingWs.onerror = (error) => {
          clearTimeout(connectionTimeout);
          this.handleConnectionError(error, reject);
        };

        this.signalingWs.onmessage = this.handleSignalingMessage.bind(this);
        this.signalingWs.onclose = this.handleWebSocketClose.bind(this);
      });
    } catch (error) {
      console.error("Connection failed:", error);
      this.emit("error", { message: "Connection failed", error });
      throw error;
    }
  }
  // Update the processBatchTokens method in RTCNeuralCodec class

  private async processBatchTokens(tokens: FrameToken[]): Promise<void> {
    const tf = await import("@tensorflow/tfjs");
    await this.logMemoryUsage('Start of batch processing');
    
    for (const tokenData of tokens) {
      try {
        // Log token details
        this.log('Processing token', {
          frameIndex: tokenData.frameIndex,
          tokenSize: tokenData.token.length,
        });
  
        const currentToken = tf.tensor2d([Array.from(tokenData.token)], [1, 32]);
        this.checkTensorSize(currentToken, 'Input Token');
  
        // Get reference features and check sizes
        const refData = this.referenceData.get(this.currentVideoId!);
        refData!.features.forEach((featureSet, idx) => {
          featureSet.forEach((tensor, splitIdx) => {
            this.checkTensorSize(tensor, `Reference Feature ${idx} Split ${splitIdx}`);
          });
        });
  
        // Execute model with logging
        const result = await tf.tidy(() => {
          const inputDict = {
            "args_0:0": currentToken,
            "args_0_1:0": currentToken,
            "args_0_2": refData!.features[0][0],
            "args_0_3": refData!.features[1][0],
            "args_0_4": refData!.features[2][0],
            "args_0_5": refData!.features[3][0],
          };
  
          this.log('Model execution input sizes', {
            inputSizes: Object.entries(inputDict).map(([key, tensor]) => ({
              name: key,
              shape: tensor.shape,
              sizeInMB: this.calculateTensorSize(tensor) / (1024 * 1024)
            }))
          });
  
          const output = this.model!.execute(inputDict);
          this.checkTensorSize(output as tfjs.Tensor, 'Model Output');
          return output;
        });
  
        await this.logMemoryUsage('After model execution');
  
        // Clean up
        currentToken.dispose();
        result.dispose();
        
      } catch (error) {
        this.log('Error in batch processing', { error });
        throw error;
      }
    }
    
    await this.logMemoryUsage('End of batch processing');
  }

  // Update processTokenBatch for better error handling
  private async processTokenBatch(videoTokens: Map<number, number[]>) {
    const batchTokens: FrameToken[] = [];

    console.log("Processing token batch:", {
      numTokens: videoTokens.size,
      sampleToken: Array.from(videoTokens.values())[0]?.slice(0, 5),
    });

    try {
      // Convert tokens to FrameToken format
      for (const [frameIndex, token] of videoTokens.entries()) {
        // Ensure token is properly formatted
        const formattedToken = Array.isArray(token[0]) ? token.flat() : token;

        // Verify token length
        if (formattedToken.length !== 32) {
          console.error(`Invalid token length for frame ${frameIndex}:`, {
            length: formattedToken.length,
            expected: 32,
            token: formattedToken.slice(0, 5),
          });
          continue;
        }

        batchTokens.push({
          frameIndex,
          token: new Float32Array(formattedToken),
        });
      }

      // Process in smaller chunks
      const CHUNK_SIZE = 10;
      for (let i = 0; i < batchTokens.length; i += CHUNK_SIZE) {
        const chunk = batchTokens.slice(i, i + CHUNK_SIZE);
        await this.processBatchTokens(chunk);

        // Update progress
        this.emit("bufferStatus", {
          frameCount: i + chunk.length,
          capacity: batchTokens.length,
          health: ((i + chunk.length) / batchTokens.length) * 100,
        });

        // Allow UI updates between chunks
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } catch (error) {
      console.error("Error in batch processing:", error);
      throw error;
    }
  }

  // Add method to validate model inputs
  private validateModelInputs(inputDict: {
    [key: string]: tfjs.Tensor;
  }): boolean {
    const expectedInputs = this.model!.inputs.map((i) => i.name);
    const providedInputs = Object.keys(inputDict);

    const missingInputs = expectedInputs.filter(
      (name) => !providedInputs.includes(name)
    );
    const extraInputs = providedInputs.filter(
      (name) => !expectedInputs.includes(name)
    );

    if (missingInputs.length > 0 || extraInputs.length > 0) {
      console.error("Model input mismatch:", {
        missing: missingInputs,
        extra: extraInputs,
        expected: expectedInputs,
        provided: providedInputs,
      });
      return false;
    }

    return true;
  }

  // Modify fetchBulkTokens to use new batch processing
  async fetchBulkTokens(
    videoId: number,
    startFrame: number,
    endFrame: number
  ): Promise<void> {
    try {
      const response = await fetch(
        `https://192.168.1.108:8000/videos/${videoId}/tokens?start=${startFrame}&end=${endFrame}`,
        {
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch bulk tokens: ${response.statusText}`);
      }

      const data: BulkTokenResponse = await response.json();

      // Store tokens in cache
      const videoTokens = new Map<number, number[]>();
      Object.entries(data.tokens).forEach(([frameIndex, token]) => {
        videoTokens.set(parseInt(frameIndex), token);
      });

      // Process tokens in batches
      await this.processTokenBatch(videoTokens);

      this.emit("bufferStatus", {
        frameCount: Object.keys(data.tokens).length,
        capacity: endFrame - startFrame + 1,
        health:
          (data.metadata.processedFrames / data.metadata.totalFrames) * 100,
      });
    } catch (error) {
      console.error("Error fetching bulk tokens:", error);
      throw error;
    }
  }
  private async handleConnectionTimeout(
    reject: (reason?: any) => void
  ): Promise<void> {
    console.error("Connection timeout");
    if (this.signalingWs) {
      this.signalingWs.close();
    }
    reject(new Error("Connection timeout"));
    await this.handleReconnect();
  }

  private async handleConnectionError(
    error: Event,
    reject: (reason?: any) => void
  ): Promise<void> {
    console.error("WebSocket error:", error);
    reject(error);
    await this.handleReconnect();
  }

  private async handleReconnect(): Promise<void> {
    if (this.isReconnecting || this.retryCount >= this.MAX_RETRY_ATTEMPTS) {
      if (this.retryCount >= this.MAX_RETRY_ATTEMPTS) {
        console.error("Max retry attempts reached");
        this.emit("error", {
          message: "Failed to establish connection after maximum retries",
          code: "MAX_RETRIES_EXCEEDED",
        });
      }
      return;
    }

    this.isReconnecting = true;
    this.retryCount++;

    const delay = this.getRetryDelay();
    console.log(
      `Attempting reconnection ${this.retryCount}/${this.MAX_RETRY_ATTEMPTS} in ${delay}ms`
    );

    // Clear any existing retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }

    // Schedule retry
    this.retryTimeout = setTimeout(async () => {
      try {
        await this.reconnect();
      } catch (error) {
        console.error("Reconnection attempt failed:", error);
        // Continue retry cycle if we haven't reached max attempts
        if (this.retryCount < this.MAX_RETRY_ATTEMPTS) {
          await this.handleReconnect();
        }
      } finally {
        this.isReconnecting = false;
      }
    }, delay);
  }

  private async reconnect(): Promise<void> {
    try {
      if (this.signalingWs?.readyState === WebSocket.CLOSED) {
        console.log(`Reconnection attempt ${this.retryCount}`);
        await this.connect(this.signalingWs.url);

        // Restore playback if needed
        if (this.currentVideoId !== null) {
          await this.startPlayback(this.currentVideoId);
        }
      }
    } catch (error) {
      console.error("Reconnection failed:", error);
      throw error;
    }
  }

  private handleWebSocketClose(event: CloseEvent): void {
    console.log("WebSocket closed:", event.code, event.reason);

    // Don't attempt reconnection for normal closure
    if (event.code !== 1000) {
      this.handleSignalingError({
        message: "WebSocket connection closed",
        code: event.code,
      });
    }
  }

  private handleSignalingError(error: {
    message: string;
    code?: number;
  }): void {
    console.error("Signaling error:", error);

    switch (error.code) {
      case 1000: // Normal closure
        // No reconnection needed
        break;

      case 1006: // Abnormal closure
      case 1001: // Going away
        this.handleReconnect();
        break;

      default:
        this.emit("error", {
          message: error.message,
          error,
        });
        if (this.retryCount < this.MAX_RETRY_ATTEMPTS) {
          this.handleReconnect();
        }
    }
  }

  // Update cleanup to preserve model when needed
  public async cleanup(preserveModel: boolean = false): Promise<void> {
    if (this.isCleaningUp) {
      return;
    }

    this.isCleaningUp = true;
    console.log("Starting codec cleanup...", { preserveModel });

    try {
      // Clear any pending retry timeout
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
        this.retryTimeout = null;
      }

      // Reset state flags
      this.isReconnecting = false;
      this.retryCount = 0;

      // Clean up data channel
      if (this.dataChannel) {
        this.dataChannel.onopen = null;
        this.dataChannel.onclose = null;
        this.dataChannel.onmessage = null;
        this.dataChannel.close();
        this.dataChannel = null;
      }

      // Clean up peer connection
      if (this.peerConnection) {
        this.peerConnection.onicecandidate = null;
        this.peerConnection.oniceconnectionstatechange = null;
        this.peerConnection.ontrack = null;
        this.peerConnection.close();
        this.peerConnection = null;
      }

      // Clean up WebSocket
      if (this.signalingWs) {
        this.signalingWs.onopen = null;
        this.signalingWs.onclose = null;
        this.signalingWs.onerror = null;
        this.signalingWs.onmessage = null;

        if (this.signalingWs.readyState === WebSocket.OPEN) {
          this.signalingWs.close(1000, "Cleanup");
        }
        this.signalingWs = null;
      }

      // Clean up audio
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.srcObject = null;
      }

      // Clean up processing queue
      this.processingQueue.clear();

      // Clean up reference data
      if (this.currentVideoId) {
        this.cleanupReferenceTensors(this.currentVideoId);
        this.currentVideoId = null;
      }

      // Only dispose of model if not preserving
      if (!preserveModel && this.model) {
        try {
          this.model.dispose();
          this.model = null;
          this.modelInitialized = false;
        } catch (error) {
          console.warn("Error disposing model:", error);
        }
      }

      console.log("Codec cleanup completed");
    } finally {
      this.isCleaningUp = false;
    }
  }

  private async initializeSignaling(): Promise<void> {
    if (!this.signalingWs) throw new Error("No signaling connection");

    // Create new RTCPeerConnection
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.config.iceServers,
    });

    // Set up ICE candidate handling
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage({
          type: "ice-candidate",
          payload: {
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              usernameFragment: event.candidate.usernameFragment,
            },
          },
        });
      }
    };

    // Create data channel before sending init message
    this.dataChannel = this.peerConnection.createDataChannel("frames", {
      ordered: true,
      maxRetransmits: 1,
    });

    // Setup data channel first
    this.setupDataChannel();

    // Send initialization message
    this.sendSignalingMessage({
      type: "init",
      payload: {
        fps: this.config.fps,
        rtcConfig: {
          iceServers: this.config.iceServers,
        },
      },
    });

    // Set up connection monitoring
    this.peerConnection.onconnectionstatechange = () => {
      console.log("Connection state:", this.peerConnection?.connectionState);
      if (this.peerConnection?.connectionState === "failed") {
        this.handleConnectionFailure();
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log(
        "ICE connection state:",
        this.peerConnection?.iceConnectionState
      );
      if (this.peerConnection?.iceConnectionState === "failed") {
        this.handleICEFailure();
      }
    };
  }

  private async handleConnectionFailure(): Promise<void> {
    console.error("Connection failed, attempting reconnect...");
    await this.cleanup();
    await this.connect(this.config.serverUrl);
  }

  private async handleICEFailure(): Promise<void> {
    console.error("ICE connection failed, attempting restart...");
    if (this.peerConnection) {
      await this.peerConnection.restartIce();
    }
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection) throw new Error("No peer connection");

    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });

      await this.peerConnection.setLocalDescription(offer);

      this.sendSignalingMessage({
        type: "offer",
        payload: {
          sdp: offer,
        },
      });
    } catch (error) {
      console.error("Error creating offer:", error);
      throw error;
    }
  }

  private async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) throw new Error("No peer connection");

    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );
      console.log("Remote description set successfully");
    } catch (error) {
      console.error("Error setting remote description:", error);
      throw error;
    }
  }

  private async handleIceCandidate(
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    if (!this.peerConnection) throw new Error("No peer connection");

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Error adding ICE candidate:", error);
      throw error;
    }
  }

  // Add connection state tracking
  private async waitForDataChannel(): Promise<void> {
    if (!this.dataChannel) {
      throw new Error("Data channel not initialized");
    }

    if (this.dataChannel.readyState === "open") {
      return;
    }

    // Create new promise if doesn't exist
    if (!this.dataChannelOpenPromise) {
      this.dataChannelOpenPromise = new Promise((resolve, reject) => {
        this.dataChannelResolve = resolve;

        // Add timeout
        setTimeout(() => {
          if (this.dataChannel?.readyState !== "open") {
            reject(new Error("Data channel connection timeout"));
          }
        }, this.connectionTimeout);
      });
    }

    return this.dataChannelOpenPromise;
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) {
      console.error("Setup called with null data channel");
      return;
    }

    console.log("Setting up data channel...");

    this.dataChannel.onopen = () => {
      console.log(
        "Data channel opened, current state:",
        this.dataChannel?.readyState
      );
      if (this.dataChannelResolve) {
        this.dataChannelResolve();
        this.dataChannelResolve = null;
      }
    };

    this.dataChannel.onclose = () => {
      console.log("Data channel closed");
      this.dataChannelOpenPromise = null;
      this.dataChannelResolve = null;
    };

    this.dataChannel.onerror = (error) => {
      console.error("Data channel error:", error);
      this.emit("error", { message: "Data channel error", error });
    };

    this.dataChannel.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.warn("we got a token.... ignore");
        // if (message.type === 'frame_token') {
        //   await this.handleFrameToken(message);
        // }
      } catch (error) {
        console.error("Error handling data channel message:", error);
      }
    };

    console.log(
      "Data channel setup complete, current state:",
      this.dataChannel.readyState
    );
  }

  public isConnected(): boolean {
    return (
      this.dataChannel?.readyState === "open" &&
      this.peerConnection?.connectionState === "connected"
    );
  }
}

export default RTCNeuralCodec;
