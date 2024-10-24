import type * as tfjs from "@tensorflow/tfjs";

interface ReferenceData {
  features: tfjs.Tensor4D[]; // Store pre-converted tensors
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

// Additional types for event handling and metrics
type EventCallback = (data: any) => void;
type EventType = "frameReady" | "error" | "bufferStatus" | "metricsUpdate";

class NeuralVideoCodec {
  private metrics: CodecMetrics;
  private state: VideoState;
  private readonly FRAME_INTERVAL: number;
  private model: tfjs.GraphModel | null = null;
  private referenceData: Map<number, ReferenceData> = new Map();
  private frameBuffer: FrameBuffer;
  private isPlaying = false;
  private currentFrame = 0;
  private currentVideoId: number | null = null;
  private lastProcessedTime = 0;
  private readonly fps: number;
  private readonly frameInterval: number;
  private eventListeners = new Map<string, Set<(data: any) => void>>();
  private ws: WebSocket | null = null;
  private maxFrames = 0;
  constructor(config: CodecConfig = {}) {
    this.fps = config.fps || 24;
    this.frameInterval = 1000 / this.fps;
    this.frameBuffer = {
      frames: new Map(),
      capacity: config.bufferSize || 60,
    };

    // Initialize event listeners
    ["frameReady", "error", "bufferStatus"].forEach((event) => {
      this.eventListeners.set(event, new Set());
    });
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

  public async init(modelPath: string): Promise<void> {
    try {
      const tf = await import("@tensorflow/tfjs");
      await import("@tensorflow/tfjs-backend-webgpu");

      // Configure WebGPU with lower buffer size
      const webGPUConfig = {
        devicePixelRatio: 1,
        maxBufferSize: 1000000000, // 1GB limit
      };

      try {
        await tf.setBackend("webgpu");
        await tf.ready();
        const backend = tf.backend() as any;
        if (backend.setWebGPUDeviceConfig) {
          backend.setWebGPUDeviceConfig(webGPUConfig);
        }
      } catch (error) {
        console.warn("WebGPU not available, falling back to WebGL");
        await tf.setBackend("webgl");
        await tf.ready();
      }

      this.model = await tf.loadGraphModel(modelPath);
      console.log("Model loaded successfully");
    } catch (error) {
      console.error("Error initializing model:", error);
      throw error;
    }
  }


  private async loadReferenceData(videoId: number): Promise<void> {
    try {
      const response = await fetch(
        `https://192.168.1.108:8000/videos/${videoId}/reference`,
        {
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch reference data: ${response.statusText}`
        );
      }

      const data = await response.json();
      const tf = await import("@tensorflow/tfjs");

      // Define shapes once
      const shapes = [
        [1, 128, 64, 64],
        [1, 256, 32, 32],
        [1, 512, 16, 16],
        [1, 512, 8, 8],
      ];

      // Convert features to tensors once
      const featureTensors = data.reference_features.map(
        (feature: number[][][], idx: number) => {
          return tf.tensor4d(feature, shapes[idx]).asType("float32");
        }
      );

      // Store the prepared tensors
      this.referenceData.set(videoId, {
        features: featureTensors,
        token: data.reference_token,
        shapes,
      });

      console.log(
        `Reference features converted to tensors for video ${videoId}`
      );
    } catch (error) {
      console.error("Error loading reference data:", error);
      this.cleanupReferenceTensors(videoId);
      throw error;
    }
  }
  public async processFrame(frameToken: FrameToken): Promise<void> {
    if (!this.model || !this.currentVideoId) {
      throw new Error("Model or video not initialized");
    }

    const refData = this.referenceData.get(this.currentVideoId);
    if (!refData) {
      throw new Error("Reference data not loaded");
    }

    try {
      const tf = await import("@tensorflow/tfjs");
      const tensorsToDispose: tfjs.Tensor[] = [];

      // Create token tensor
      const currentToken = tf.tensor2d([frameToken.token]).asType("float32");
      tensorsToDispose.push(currentToken);

      // Execute model using pre-converted reference features
      const outputTensor = tf.tidy(() => {
        const result = this.model!.execute({
          "args_0:0": currentToken,
          "args_0_1:0": currentToken,
          args_0_2: refData.features[0],
          args_0_3: refData.features[1],
          args_0_4: refData.features[2],
          args_0_5: refData.features[3],
        });
        tensorsToDispose.push(result as tfjs.Tensor);
        return result;
      });

      // Process output tensor
      const processedTensor = tf.tidy(() => {
        let tensor = outputTensor as tfjs.Tensor;
        if (tensor.shape[1] === 3) {
          tensor = tf.transpose(tensor, [0, 2, 3, 1]);
        }
        tensor = tensor.squeeze([0]);
        return tf.clipByValue(tensor, 0, 1);
      });
      tensorsToDispose.push(processedTensor);

      // Convert to image
      const canvas = document.createElement("canvas");
      canvas.width = processedTensor.shape[1];
      canvas.height = processedTensor.shape[0];

      await tf.browser.draw(processedTensor as tfjs.Tensor3D, canvas);

      // Add to frame buffer
      this.frameBuffer.frames.set(frameToken.frameIndex, {
        timestamp: Date.now(),
        data: canvas.toDataURL(),
      });

      // Manage buffer size
      if (this.frameBuffer.frames.size > this.frameBuffer.capacity) {
        const oldestFrame = Math.min(...this.frameBuffer.frames.keys());
        this.frameBuffer.frames.delete(oldestFrame);
      }

      // Emit frame ready event
      this.emit("frameReady", {
        frameIndex: frameToken.frameIndex,
        imageUrl: canvas.toDataURL(),
      });
    } catch (error) {
      console.error("Error processing frame:", error);
      throw error;
    } finally {
      // No need to dispose reference features as they're kept in memory
      tfjs.dispose(tensorsToDispose);
    }
  }

  // Add cleanup method for reference tensors
  private cleanupReferenceTensors(videoId: number): void {
    const refData = this.referenceData.get(videoId);
    if (refData) {
      refData.features.forEach((tensor) => {
        if (tensor && !tensor.isDisposed) {
          tensor.dispose();
        }
      });
      this.referenceData.delete(videoId);
    }
  }

  // Update stop method to include cleanup
  public stop(): void {
    this.isPlaying = false;
    this.currentFrame = 0;
    this.frameBuffer.frames.clear();
    if (this.currentVideoId !== null) {
      this.cleanupReferenceTensors(this.currentVideoId);
    }
  }

  // Add cleanup on video switch
  public async startPlayback(videoId: number): Promise<void> {
    try {
      // Cleanup previous video's tensors if they exist
      if (this.currentVideoId !== null && this.currentVideoId !== videoId) {
        this.cleanupReferenceTensors(this.currentVideoId);
      }

      this.stop();
      this.currentVideoId = videoId;
      this.currentFrame = 0;

      // Load and convert reference data if not already loaded
      if (!this.referenceData.has(videoId)) {
        await this.loadReferenceData(videoId);
      }

      this.isPlaying = true;
      this.playbackLoop();
    } catch (error) {
      console.error("Error starting playback:", error);
      this.emit("error", { message: "Failed to start playback", error });
      throw error;
    }
  }

  private async playbackLoop(): Promise<void> {
    if (!this.isPlaying) return;

    const now = performance.now();
    const timeSinceLastFrame = now - this.lastProcessedTime;

    if (timeSinceLastFrame >= this.frameInterval) {
      try {
        // Get frame data from server websocket
        const frameData = await this.requestFrameToken(this.currentFrame);
        await this.processFrame(frameData);

        this.currentFrame++;
        this.lastProcessedTime = now;

        // Update buffer status
        this.emit("bufferStatus", {
          frameCount: this.frameBuffer.frames.size,
          capacity: this.frameBuffer.capacity,
        });
      } catch (error) {
        console.error("Playback error:", error);
        this.emit("error", { message: "Playback error", error });
      }
    }

    if (this.isPlaying) {
      requestAnimationFrame(() => this.playbackLoop());
    }
  }

  private async requestFrameToken(frameIndex: number): Promise<FrameToken> {
    // Implementation depends on your WebSocket setup
    // This should request just the token for the current frame
    // TODO: Implement WebSocket frame token request
    throw new Error("Not implemented");
  }

  public pause(): void {
    this.isPlaying = false;
  }

  public resume(): void {
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.playbackLoop();
    }
  }
}

export default NeuralVideoCodec;
