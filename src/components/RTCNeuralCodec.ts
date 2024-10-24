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

// Base interfaces
interface CodecEvents {
  frameReady: (data: { frameIndex: number; imageUrl: string }) => void;
  error: (data: { message: string; error?: any }) => void;
  bufferStatus: (data: { frameCount: number; capacity: number }) => void;
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
    try {
      const tf = await import("@tensorflow/tfjs");
      await import("@tensorflow/tfjs-backend-webgpu");

      const webGPUConfig = {
        devicePixelRatio: 1,
        maxBufferSize: 1000000000,
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


  public async loadReferenceData(videoId: number): Promise<void> {
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
}

// RTCNeuralCodec implementation
class RTCNeuralCodec extends BaseNeuralCodec {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioElement: HTMLAudioElement;
  private signalingWs: WebSocket | null = null;
  private processingQueue = new Map<number, Promise<void>>();

  private pendingCandidates: RTCIceCandidate[] = [];
  private connectionState: "new" | "connecting" | "connected" | "failed" =
    "new";
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_INTERVAL = 5000;

  constructor(config: RTCConfig) {
    super(config);
    this.audioElement = new Audio();
    this.audioElement.autoplay = true;
    this.setupAudioElement();
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

    try {
      // Process frame and add to processing queue
      const processPromise = this.processFrame({
        frameIndex,
        token: new Float32Array(token),
      });

      this.processingQueue.set(frameIndex, processPromise);

      // Clean up queue after processing
      await processPromise;
      this.processingQueue.delete(frameIndex);
    } catch (error) {
      console.error("Frame processing error:", error);
      this.metrics.droppedFrames++;
      this.emit("error", {
        message: "Frame processing failed",
        error,
      });
    }
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

  public async startPlayback(videoId: number): Promise<void> {
    try {
      this.currentVideoId = videoId;

      // Load reference features first
      await this.loadReferenceData(videoId);

      // Signal ready to stream
      this.dataChannel?.send(
        JSON.stringify({
          type: "start_stream",
          videoId,
          fps: this.config.fps,
        })
      );

      // Start audio playback when ready
      await this.audioElement.play();
    } catch (error) {
      console.error("Playback start failed:", error);
      this.emit("error", { message: "Failed to start playback", error });
      throw error;
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

  private async reconnect(): Promise<void> {
    try {
      if (this.signalingWs?.readyState === WebSocket.CLOSED) {
        await this.connect(this.signalingWs.url);

        // Resume playback if needed
        if (this.currentVideoId !== null) {
          await this.startPlayback(this.currentVideoId);
        }
      }
    } catch (error) {
      console.error("Reconnection failed:", error);
      setTimeout(() => this.reconnect(), 5000);
    }
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

    console.log("message:",message)
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

        console.log("payload:",payload)
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

  private handleSignalingError(error: {
    message: string;
    code?: number;
  }): void {
    console.error("Signaling error:", error);

    // Handle specific error codes
    switch (error.code) {
      case 1000: // Normal closure
        this.handleDisconnect();
        break;

      case 1001: // Going away
        this.reconnect();
        break;

      case 1006: // Abnormal closure
        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
          this.reconnect();
        } else {
          this.emit("error", {
            message: "Failed to maintain signaling connection",
            error,
          });
        }
        break;

      default:
        this.emit("error", {
          message: error.message,
          error,
        });
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

  private async cleanup(): Promise<void> {
    try {
        // Close data channel first
        if (this.dataChannel) {
            console.log('Closing data channel...');
            this.dataChannel.onopen = null;
            this.dataChannel.onclose = null;
            this.dataChannel.onmessage = null;
            this.dataChannel.close();
            this.dataChannel = null;
        }

        // Close peer connection and clean up its event listeners
        if (this.peerConnection) {
            console.log('Closing peer connection...');
            this.peerConnection.onicecandidate = null;
            this.peerConnection.oniceconnectionstatechange = null;
            this.peerConnection.ontrack = null;
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Close WebSocket connection
        if (this.signalingWs) {
            console.log('Closing signaling WebSocket...');
            this.signalingWs.onopen = null;
            this.signalingWs.onclose = null;
            this.signalingWs.onerror = null;
            this.signalingWs.onmessage = null;
            
            if (this.signalingWs.readyState === WebSocket.OPEN) {
                this.signalingWs.close(1000, 'Cleanup');
            }
            this.signalingWs = null;
        }

        // Clear pending candidates
        this.pendingCandidates = [];

        // Stop audio
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.srcObject = null;
        }

        // Clear processing queue
        this.processingQueue.clear();

        // Reset connection state
        this.connectionState = 'new';
        this.reconnectAttempts = 0;

        // Clean up any remaining reference tensors
        if (this.currentVideoId !== null) {
            await this.cleanupReferenceTensors(this.currentVideoId);
            this.currentVideoId = null;
        }

        console.log('Cleanup completed successfully');
    } catch (error) {
        console.error('Error during cleanup:', error);
        // Even if there's an error, we want to ensure everything is reset
        this.dataChannel = null;
        this.peerConnection = null;
        this.signalingWs = null;
        this.connectionState = 'new';
        this.currentVideoId = null;
        throw error;
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
                console.error('Max cleanup attempts reached, forcing reset');
                // Force reset of all connections
                this.dataChannel = null;
                this.peerConnection = null;
                this.signalingWs = null;
                this.connectionState = 'new';
                this.currentVideoId = null;
                throw new Error('Cleanup failed after maximum attempts');
            }
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

  public async connect(signalingUrl: string): Promise<void> {
    try {
        // Clean up any existing connections
        await this.ensureCleanup();

        // Create WebSocket connection
        this.signalingWs = new WebSocket(signalingUrl);
        
        return new Promise((resolve, reject) => {
            if (!this.signalingWs) return reject(new Error('No WebSocket connection'));

            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 10000);

            this.signalingWs.onopen = () => {
                clearTimeout(timeout);
                this.initializeSignaling().then(resolve).catch(reject);
            };

            this.signalingWs.onerror = (error) => {
                clearTimeout(timeout);
                reject(error);
            };

            this.signalingWs.onmessage = this.handleSignalingMessage.bind(this);
            this.signalingWs.onclose = this.handleWebSocketClose.bind(this);
        });

    } catch (error) {
        console.error('Connection failed:', error);
        this.emit('error', { message: 'Connection failed', error });
        throw error;
    }
}

private async initializeSignaling(): Promise<void> {
    if (!this.signalingWs) throw new Error('No signaling connection');

    // Create new RTCPeerConnection
    this.peerConnection = new RTCPeerConnection({
        iceServers: this.config.iceServers
    });

    // Set up ICE candidate handling
    this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            this.sendSignalingMessage({
                type: 'ice-candidate',
                payload: {
                    candidate: event.candidate.toJSON()
                }
            });
        }
    };

    // Send initialization message
    this.sendSignalingMessage({
        type: 'init',
        payload: {
            fps: this.config.fps,
            rtcConfig: {
                iceServers: this.config.iceServers
            }
        }
    });

    // Create data channel
    this.dataChannel = this.peerConnection.createDataChannel('frames', {
        ordered: true,
        maxRetransmits: 1
    });

    this.setupDataChannel();
}


private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection) throw new Error('No peer connection');

    try {
        const offer = await this.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });

        await this.peerConnection.setLocalDescription(offer);

        this.sendSignalingMessage({
            type: 'offer',
            payload: {
                sdp: offer
            }
        });
    } catch (error) {
        console.error('Error creating offer:', error);
        throw error;
    }
}

private async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) throw new Error('No peer connection');

    try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log('Remote description set successfully');
    } catch (error) {
        console.error('Error setting remote description:', error);
        throw error;
    }
}

private async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) throw new Error('No peer connection');

    try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
        throw error;
    }
}

private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
        console.log('Data channel opened');
        this.connectionState = 'connected';
        this.emit('connectionState', { state: 'connected' });
    };

    this.dataChannel.onclose = () => {
        console.log('Data channel closed');
        this.connectionState = 'failed';
        this.emit('connectionState', { state: 'disconnected' });
    };

    this.dataChannel.onmessage = async (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'frame_token') {
                await this.handleFrameToken(message);
            }
        } catch (error) {
            console.error('Error handling data channel message:', error);
        }
    };
}

private handleWebSocketClose(event: CloseEvent): void {
    console.log('WebSocket closed:', event.code, event.reason);
    this.handleSignalingError({
        message: 'WebSocket connection closed',
        code: event.code
    });
}
}


export default RTCNeuralCodec