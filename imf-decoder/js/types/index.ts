// js/types/index.ts
import * as tf from '@tensorflow/tfjs';
import { IMFDecoder, ReferenceData as WasmReferenceData, FrameToken as WasmFrameToken } from '@pkg/imf_decoder';

// Enums
export enum PlayerStatus {
  Idle = 0,
  Ready = 1,
  Playing = 2,
  Pause = 3,
  Destroyed = 4
}

export enum DecoderStatus {
  Idle = 0,
  Initializing = 1,
  Ready = 2,
  Open = 3,
  Pause = 4,
  Closed = 5
}



// Configuration Interfaces
export interface DecoderConfig {
  width: number;
  height: number;
  maxQueueSize?: number;
  batchSize?: number;
  enablePerfMonitoring?: boolean;
}

// Data Structure Interfaces 
export interface ReferenceFeature {
  tensor: Float32Array;
  shape: number[];
}

export interface ReferenceData {
  features: ReferenceFeature[];
  token: Float32Array;
}

export interface FrameToken {
  token: Float32Array;
  frame_index: number;
}

// WASM Related Interfaces
export interface WasmModule {
  IMFDecoder: new (width: number, height: number) => IMFDecoder;
  default: () => Promise<void>;
  [key: string]: any;
}



// Result Interfaces
export interface VerifyResult {
  success: boolean;
  module?: WasmModule;
  decoder?: IMFDecoder;
  error?: Error;
}

export interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
}

// Worker Message Interface
export interface WorkerMessage {
  type: MessageType;
  data?: any;
  error?: string;
}


export enum MessageType {
  DecoderInit = 'DecoderInit',
  DecoderInited = 'DecoderInited',
  ProcessFrame = 'ProcessFrame',
  FrameProcessed = 'FrameProcessed',
  UpdateRenderPass = 'UpdateRenderPass',
  DecoderError = 'DecoderError',
  DecoderRecovered = 'DecoderRecovered',
  DecoderMetrics = 'DecoderMetrics',
  DecoderCreated = 'DecoderCreated',
  WasmLoaded = 'WasmLoaded',
  DecoderReady = 'DecoderReady',
  ReferenceDataSet = 'ReferenceDataSet',
  TokensProcessed = 'TokensProcessed',
  BatchProcessed = 'BatchProcessed',
  Error = 'Error'
}

export interface WorkerMessage {
  type: MessageType;
  data?: any;
  error?: string;
}

export interface FrameStats {
  frameTime: number;        // Time to process frame
  gpuTime: number;         // GPU processing time
  frameCount: number;      // Total frames processed
  droppedFrames: number;   // Frames exceeding timing budget
  lastFrameTimestamp: number;
}

export interface RenderPassConfig {
  name: string;
  format: GPUTextureFormat;
  descriptors: {
      colorAttachments: Array<{
          clearValue: GPUColor;
          loadOp: GPULoadOp;
          storeOp: GPUStoreOp;
      }>;
  };
}

export interface TextureDescriptor {
  id: number;
  width: number;
  height: number;
  format: GPUTextureFormat;
  usage: GPUTextureUsageFlags;
}

export interface ModelInputConfig {
  inputShape: number[];
  inputNormalization?: {
      mean: number[];
      std: number[];
  };
  outputDenormalization?: {
      scale: number;
      offset: number;
  };
  maxBatchSize: number;
}

export interface FrameData {
  frameIndex: number;
  timestamp: number;
  data: tf.TensorBuffer<tf.Rank>;
  metadata: {
      inferenceTime: number;
      inputShape: number[];
      outputShape: number[];
  };
}
