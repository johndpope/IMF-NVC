import { 
  WasmModule, 
  IMFDecoder, 
  ReferenceData, 
  FrameToken, 
  VerifyResult,
  TestResult 
} from '../types';


async function verifyWasmBuild(): Promise<VerifyResult> {
  try {
      // Import the wasm module
      const wasm_module = await import('@pkg/imf_decoder');
      
      // Wait for module initialization
      await wasm_module.default();
      
      // Log all available exports
      console.log('📦 WASM Exports:', Object.keys(wasm_module));
      
      // Create decoder instance using IMFDecoder
      if (!wasm_module.IMFDecoder) {
          throw new Error('IMFDecoder not found in WASM module');
      }

      const decoder = new wasm_module.IMFDecoder(640, 480);
      
      // Log all available methods on decoder instance
      console.log('🔧 IMFDecoder Methods:', 
          Object.getOwnPropertyNames(Object.getPrototypeOf(decoder)));
      
      // Test basic functionality
      console.log('🧪 Test method output:', decoder.test());
      
      return { success: true, module: wasm_module as WasmModule, decoder };
  } catch (e) {
      console.error('❌ WASM verification failed:', e);
      return { success: false, error: e as Error };
  }
}



  
  async function runDecoderTests(decoder: IMFDecoder): Promise<TestResult> {
    try {
      // Log available methods
      console.log("Available methods:", 
        Object.getOwnPropertyNames(Object.getPrototypeOf(decoder)));
  
      // Initial test
      console.log("Initial test:", decoder.test());
      
      // Test diagnostic mode
      console.log("Setting diagnostic mode...");
      decoder.diagnostic_mode = true;
      console.log("Diagnostic mode is now:", decoder.diagnostic_mode);
  
      // Create reference data matching the tensor shapes from RTCNeuralCodec
      const reference_data: ReferenceData = {
        features: [
          {
            // [1, 128, 64, 64]
            tensor: new Float32Array(1 * 128 * 64 * 64).fill(0.5),
            shape: [1, 128, 64, 64]
          },
          {
            // [1, 256, 32, 32]
            tensor: new Float32Array(1 * 256 * 32 * 32).fill(0.5),
            shape: [1, 256, 32, 32]
          },
          {
            // [1, 512, 16, 16]
            tensor: new Float32Array(1 * 512 * 16 * 16).fill(0.5),
            shape: [1, 512, 16, 16]
          },
          {
            // [1, 512, 8, 8]
            tensor: new Float32Array(1 * 512 * 8 * 8).fill(0.5),
            shape: [1, 512, 8, 8]
          }
        ],
        token: new Float32Array(32).fill(0.1)  // Match token size of [1, 32]
      };
  
      console.log("Setting reference data...");
      try {
        const status = await decoder.set_reference_data(reference_data);
        console.log("Set reference data result:", status);
      } catch (e) {
        console.error("Error setting reference data:", e);
        console.log("set_reference_data exists:", 
          typeof decoder.set_reference_data);
        throw e;
      }
  
      // Test token processing with correct shape [1, 32]
      console.log("Processing tokens...");
      const tokens: FrameToken[] = [
        {
          token: new Float32Array(32).fill(0.5),  // Match token size [1, 32]
          frame_index: 0
        }
      ];
  
      try {
        const result = await decoder.process_tokens(tokens);
        console.log("Process tokens result:", result);
      } catch (e) {
        console.error("Error processing tokens:", e);
        console.log("process_tokens exists:", typeof decoder.process_tokens);
        throw e;
      }
  
      // Test batch processing
      console.log("Processing batch...");
      try {
        const result = await decoder.process_batch();
        console.log("Process batch result:", result);
      } catch (e) {
        console.error("Error processing batch:", e);
        console.log("process_batch exists:", typeof decoder.process_batch);
        throw e;
      }
  
      // Check reference status
      const refStatus = decoder.get_reference_status();
      console.log("Reference status:", refStatus);
  
      return {
        success: true,
        message: "Tests completed successfully"
      };
  
    } catch (err) {
      console.error("Test sequence failed:", err);
      console.error("Stack:", (err as Error).stack);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
  
  async function init(): Promise<void> {
    try {
      console.log('🔍 Starting WASM verification...');
      const { success, module: wasm_module, decoder, error } = await verifyWasmBuild();
      
      if (!success || !decoder) {
        console.error('Failed to initialize decoder:', error);
        if (error?.stack) console.error('Stack:', error.stack);
        return;
      }
  
      console.log('IMFDecoder instance:', decoder);
      console.log('✅ WASM verification successful!');
      
      // Store for later use
      (window as any).decoder = decoder;
      (window as any).wasm = wasm_module;
      
      // Run decoder tests
      await runDecoderTests(decoder);
      
      console.log('IMFDecoder initialized successfully');
    } catch (e) {
      console.error('Failed to initialize decoder:', e);
      if (e instanceof Error) console.error('Stack:', e.stack);
      
      try {
        // Additional debugging info
        // const wasm_module = await import('../pkg/imf_decoder.js');
        const wasm_module = await import('@pkg/imf_decoder');
      
        // Wait for module initialization
        await wasm_module.default();
        
        // Log all available exports
        console.log('📦 WASM Exports:', Object.keys(wasm_module));
      } catch (importError) {
        console.error('Failed to import WASM module:', importError);
      }
    }
  }
  
  // Initialize when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  export { init, verifyWasmBuild, runDecoderTests };