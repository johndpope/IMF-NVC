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

export enum MessageType {
  DecoderCreated = 'DecoderCreated',
  DecoderInit = 'DecoderInit',
  DecoderInited = 'DecoderInited',
  WasmLoaded = 'WasmLoaded',
  DecoderReady = 'DecoderReady',
  ReferenceDataSet = 'ReferenceDataSet',
  TokensProcessed = 'TokensProcessed',
  BatchProcessed = 'BatchProcessed',
  Error = 'Error'
}
export interface DecoderConfig {
  width: number;
  height: number;
  maxQueueSize?: number;
  batchSize?: number;
}


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


export interface WasmModule {
  IMFDecoder: new (width: number, height: number) => IMFDecoder;
  default: () => Promise<void>;
  [key: string]: any;
}

export interface IMFDecoder {
  test: () => string;
  diagnostic_mode: boolean;
  set_reference_data: (data: ReferenceData) => Promise<string>;
  process_tokens: (tokens: FrameToken[]) => Promise<string>;
  process_batch: () => Promise<string>;
  get_reference_status: () => string;
}

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