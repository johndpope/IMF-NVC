import { Room, RoomEvent, DataPacket_Kind, LocalParticipant, RemoteParticipant, Track } from 'livekit-client';
import type * as tfjs from "@tensorflow/tfjs";

interface CodecConfig {
 serverUrl: string;  
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

interface FrameToken {
  frameIndex: number;
  token: number[];
}

interface ReferenceData {
  features: SplitReferenceFeatures[];
  token: number[];
  shapes: number[][];
}

interface SplitReferenceFeatures {
  tensors: tfjs.Tensor4D[];
  splitDim: number;
  originalShape: number[];
}

type EventCallback = (data: any) => void;
type EventType = "frameReady" | "error" | "bufferStatus" | "metricsUpdate";

interface CodecEvents {
  frameReady: (data: { frameIndex: number; imageUrl: string }) => void;
  error: (data: { message: string; error?: any }) => void;
  bufferStatus: (data: {
    frameCount?: number;
    capacity?: number;
    health?: number;
    type?: "buffer" | "model";
  }) => void;
  metricsUpdate: (metrics: CodecMetrics) => void;
}

export class LiveKitNeuralCodec {
  private room: Room;
  private model: tfjs.GraphModel | null = null;
  private referenceData: Map<number, ReferenceData> = new Map();
  private eventListeners = new Map<keyof CodecEvents, Set<Function>>();
  private metrics: CodecMetrics;
  private currentVideoId: number | null = null;
  private modelInitialized = false;
  private isCleaningUp = false;
  private frameBuffer: Map<number, { timestamp: number; data: string }>;
  private readonly bufferSize: number;
  private readonly MAX_WEBGPU_BUFFER_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
  private useWebGL = false;

  constructor(config: CodecConfig = {
    serverUrl: ''
  }) {
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    this.bufferSize = config.bufferSize || 60;
    this.frameBuffer = new Map();
    this.metrics = {
      fps: 0,
      bufferHealth: 100,
      processingTime: 0,
      networkLatency: 0,
      droppedFrames: 0,
      lastUpdate: Date.now(),
    };

    // Initialize event listeners
    ["frameReady", "error", "bufferStatus", "metricsUpdate"].forEach((event) => {
      this.eventListeners.set(event as keyof CodecEvents, new Set());
    });

    if (config.modelPath) {
      this.initModel(config.modelPath);
    }
  }

  private async setupTensorflowBackend(): Promise<void> {
    const tf = await import("@tensorflow/tfjs");

    try {
      // Try WebGPU first
      await import("@tensorflow/tfjs-backend-webgpu");
      await tf.setBackend("webgpu");
      await tf.ready();

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
      console.warn("WebGPU not available, falling back to WebGL:", error);

      try {
        await tf.setBackend("webgl");
        await tf.ready();

        const backend = tf.backend() as any;
        if (backend.setFlags) {
          backend.setFlags({
            WEBGL_CPU_FORWARD: true,
            WEBGL_SIZE_UPLOAD_UNIFORM: 4,
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

  public async connect(url: string, token: string): Promise<void> {
    try {
      await this.room.connect(url, token);
      
      // Set up room event handlers
      this.room
        .on(RoomEvent.Connected, () => this.handleRoomConnected())
        .on(RoomEvent.Disconnected, () => this.handleRoomDisconnected())
        .on(RoomEvent.DataReceived, (payload, participant, kind) => 
          this.handleDataReceived(payload, participant, kind));
    } catch (error) {
      console.error('Failed to connect to room:', error);
      throw error;
    }
  }

  private handleRoomConnected() {
    console.log('Connected to LiveKit room');
  }

  private handleRoomDisconnected() {
    console.log('Disconnected from LiveKit room');
  }

  private handleDataReceived(payload: Uint8Array, participant: RemoteParticipant, kind: DataPacket_Kind) {
    if (kind === DataPacket_Kind.RELIABLE) {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === 'frame_token') {
          this.handleFrameToken(data);
        }
      } catch (error) {
        console.error('Error handling received data:', error);
      }
    }
  }

  public async initModel(modelPath: string): Promise<void> {
    const tf = await import("@tensorflow/tfjs");

    try {
      this.emit("bufferStatus", {
        health: 0,
        type: "model",
      });

      await this.setupTensorflowBackend();

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

      this.modelInitialized = true;
      this.emit("bufferStatus", {
        health: 100,
        type: "model",
      });
      console.log("Model loaded successfully");
    } catch (error) {
      console.error("Error initializing model:", error);
      this.emit("error", {
        message: "Failed to initialize model",
        error,
      });
      throw error;
    }
  }

  public async processFrame(frameToken: FrameToken): Promise<void> {
    const tf = await import("@tensorflow/tfjs");
    const tensorsToDispose: tfjs.Tensor[] = [];

    try {
      if (!this.model || !this.currentVideoId) {
        throw new Error("Model or video not initialized");
      }

      const refData = this.referenceData.get(this.currentVideoId);
      if (!refData) {
        throw new Error("Reference data not loaded");
      }

      const currentToken = tf.tidy(() =>
        tf.tensor2d([Array.from(frameToken.token)], [1, 32]).asType("float32")
      );
      tensorsToDispose.push(currentToken);

      let finalOutput: tfjs.Tensor | null = null;

      for (const splitFeature of refData.features) {
        const partialOutputs = await Promise.all(
          splitFeature.tensors.map((featureTensor) =>
            tf.tidy(() => {
              const inputDict = {
                "args_0:0": currentToken,
                "args_0_1:0": currentToken,
                "args_0_2:0": featureTensor,
              };
              return this.model!.execute(inputDict) as tfjs.Tensor;
            })
          )
        );

        const combinedOutput = tf.tidy(() => {
          if (partialOutputs.length === 1) return tf.keep(partialOutputs[0]);
          return tf.keep(tf.concat(partialOutputs, 0));
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

      const processedTensor = tf.tidy(() => {
        if (!finalOutput) throw new Error("No output tensor generated");
        
        let tensor = finalOutput;
        if (tensor.shape[1] === 3) {
          tensor = tf.transpose(tensor, [0, 2, 3, 1]);
        }
        tensor = tensor.squeeze([0]);
        return tf.keep(tf.clipByValue(tensor, 0, 1));
      });

      const canvas = document.createElement("canvas");
      canvas.width = processedTensor.shape[1];
      canvas.height = processedTensor.shape[0];
      await tf.browser.draw(processedTensor as tfjs.Tensor3D, canvas);

      this.emit("frameReady", {
        frameIndex: frameToken.frameIndex,
        imageUrl: canvas.toDataURL(),
      });

      if (finalOutput) finalOutput.dispose();
      processedTensor.dispose();
      
    } catch (error) {
      console.error("Error processing frame:", error);
      this.metrics.droppedFrames++;
      this.emit("error", {
        message: "Frame processing failed",
        error,
      });
    } finally {
      tensorsToDispose.forEach((tensor) => {
        if (tensor && !tensor.isDisposed) {
          tensor.dispose();
        }
      });
    }
  }

  public async loadReferenceData(videoId: number): Promise<void> {
    try {
      if (this.currentVideoId) {
        await this.cleanupReferenceTensors(this.currentVideoId);
      }

      const response = await fetch(
        `https://your-server.com/videos/${videoId}/reference`,
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch reference data: ${response.statusText}`);
      }

      const data = await response.json();
      const features = await this.processReferenceFeatures(data);

      this.referenceData.set(videoId, {
        features,
        token: data.reference_token,
        shapes: data.shapes,
      });

      this.currentVideoId = videoId;
    } catch (error) {
      console.error('Error loading reference data:', error);
      throw error;
    }
  }

  private cleanupReferenceTensors(videoId: number): void {
    const refData = this.referenceData.get(videoId);
    if (refData) {
      refData.features.forEach(feature => {
        feature.tensors.forEach(tensor => {
          if (!tensor.isDisposed) {
            tensor.dispose();
          }
        });
      });
      this.referenceData.delete(videoId);
    }
  }

  // Event handling methods
  public on<K extends keyof CodecEvents>(event: K, callback: CodecEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.add(callback);
    }
  }

  public off<K extends keyof CodecEvents>(event: K, callback: CodecEvents[K]): void {
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

  public cleanup(): void {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    try {
      // Clean up room connection
      if (this.room) {
        this.room.disconnect();
      }

      // Clean up reference data tensors
      this.referenceData.forEach((_, videoId) => {
        this.cleanupReferenceTensors(videoId);
      });

      // Clean up model
      if (this.model) {
        this.model.dispose();
        this.model = null;
        this.modelInitialized = false;
      }

      // Clear frame buffer
      this.frameBuffer.clear();

    } finally {
      this.isCleaningUp = false;
    }
  }
}

export default LiveKitNeuralCodec;