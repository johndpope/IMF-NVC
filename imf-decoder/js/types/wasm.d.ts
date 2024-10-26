declare module '*.wasm' {
  const content: WebAssembly.Module;
  export default content;
}



declare module '@pkg/imf_decoder' {
  export class IMFDecoder {
      constructor(width: number, height: number);
      test(): string;
      diagnostic_mode: boolean;
      set_reference_data(data: any): Promise<string>;
      process_tokens(tokens: any): Promise<string>;
      process_batch(): Promise<string>;
      get_reference_status(): string;
  }
  export function start(): void;
  export default function init(): Promise<void>;
}
