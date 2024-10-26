async function verifyWasmBuild() {
  try {
      // Import the wasm module
      const wasm_module = await import('../pkg/imf_decoder.js');
      
      // IMPORTANT: Wait for module initialization
      await wasm_module.default();
      
      // Log all available exports
      console.log('📦 WASM Exports:', Object.keys(wasm_module));
      
      // Create decoder instance
      const decoder = new wasm_module.Decoder(640, 480);
      
      // Log all available methods on decoder instance
      console.log('🔧 Decoder Methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(decoder)));
      
      // Test basic functionality
      console.log('🧪 Test method output:', decoder.test());
      
      return {success: true, module: wasm_module, decoder: decoder};
  } catch (e) {
      console.error('❌ WASM verification failed:', e);
      return {success: false, error: e};
  }
}

async function init() {
  try {
      console.log('🔍 Starting WASM verification...');
      const {success, module: wasm_module, decoder, error} = await verifyWasmBuild();
      
      if (!success) {
          console.error('Failed to initialize decoder:', error);
          console.error('Stack:', error.stack);
          return;
      }

      console.log('✅ WASM verification successful!');
      
      // Store for later use
      window.decoder = decoder;
      window.wasm = wasm_module;
      
      // Run decoder tests if needed
      await runDecoderTests(decoder);
      
      console.log('Decoder initialized successfully');
  } catch (e) {
      console.error('Failed to initialize decoder:', e);
      console.error('Stack:', e.stack);
      
      try {
          // Additional debugging info
          const wasm_module = await import('../pkg/imf_decoder.js');
          console.log('Available exports:', Object.keys(wasm_module));
      } catch (importError) {
          console.error('Failed to import WASM module:', importError);
      }
  }
}
async function runDecoderTests(decoder) {
  try {
    // Log available methods
    console.log("Available methods:", 
      Object.getOwnPropertyNames(Object.getPrototypeOf(decoder)));

    // Initial test
    console.log("Initial test:", decoder.test());
    
    // Test diagnostic mode
    console.log('Setting diagnostic mode...');
    decoder.diagnostic_mode = true;
    console.log('Diagnostic mode is now:', decoder.diagnostic_mode);

    // Test reference data
    const referenceData = {
      features: [
        {
          tensor: new Array(128 * 64 * 64).fill(0.5),
          shape: [1, 128, 64, 64]
        }
      ],
      token: new Array(32).fill(0.1)
    };

    console.log('Setting reference data...');
    try {
      const status = await decoder.set_reference_data(referenceData);
      console.log('Set reference data result:', status);
    } catch (e) {
      console.error('Error setting reference data:', e);
    }

    // Test token processing
    const tokens = [
      {
        token: new Array(32).fill(0.5),
        frame_index: 0
      }
    ];

    console.log('Processing tokens...');
    try {
      const result = await decoder.process_tokens(tokens);
      console.log('Process tokens result:', result);
    } catch (e) {
      console.error('Error processing tokens:', e);
    }

    // Test batch processing
    console.log('Processing batch...');
    try {
      const batchResult = await decoder.process_batch();
      console.log('Process batch result:', batchResult);
    } catch (e) {
      console.error('Error processing batch:', e);
    }

  } catch (err) {
    console.error('Test sequence failed:', err);
    console.error('Stack:', err.stack);
  }
}
function startContinuousMonitoring(decoder) {
  setInterval(() => {
    try {
      // Process new tokens periodically
      const newTokens = Array.from({ length: 4 }, (_, i) => ({
        token: new Array(32).fill(0.3 + (Math.random() * 0.1)),
        frame_index: Date.now(),
        timestamp: Date.now()
      }));

      decoder.process_tokens(newTokens)
        .then(result => console.log('Continuous processing result:', result))
        .catch(err => console.error('Processing error:', err));

    } catch (err) {
      console.error('Continuous processing error:', err);
    }
  }, 1000);
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}