async function init() {
  try {
    // Import the wasm module
    const wasm_module = await import('../pkg/imf_decoder.js');
    
    // Wait for module initialization
    await wasm_module.default();
    
    // Create both decoders
    const baseDecoder = wasm_module.create_decoder(640, 480);
    const testDecoder = new wasm_module.WasmDecoder(60, 4); // maxQueueSize: 60, batchSize: 4
    
    console.log('Base decoder test:', baseDecoder.test());
    
    // Store for later use
    window.decoder = baseDecoder;
    window.testDecoder = testDecoder;
    window.wasm = wasm_module;
    
    console.log('Decoders initialized successfully');

    // Run test sequence on test decoder
    await runDecoderTests(testDecoder);

  } catch (e) {
    console.error('Failed to initialize decoder:', e);
    console.error('Stack:', e.stack);
    
    // Additional debugging info
    console.log('Available exports:', Object.keys(await import('../pkg/imf_decoder.js')));
  }
}

async function runDecoderTests(decoder) {
  try {
    // Enable diagnostic mode
    decoder.set_diagnostic_mode(true);
    
    // Create mock reference data
    const referenceData = {
      features: [
        {
          tensor: new Array(128 * 64 * 64).fill(0.5),
          shape: [1, 128, 64, 64]
        },
        {
          tensor: new Array(256 * 32 * 32).fill(0.5),
          shape: [1, 256, 32, 32]
        },
        {
          tensor: new Array(512 * 16 * 16).fill(0.5),
          shape: [1, 512, 16, 16]
        },
        {
          tensor: new Array(512 * 8 * 8).fill(0.5),
          shape: [1, 512, 8, 8]
        }
      ],
      token: new Array(32).fill(0.1)
    };

    // Set reference data
    console.log('Setting reference data...');
    const refStatus = await decoder.set_reference_data(referenceData);
    console.log('Reference status:', refStatus);
    console.log('Current status:', decoder.get_reference_status());

    // Create mock bulk tokens
    const bulkTokens = Array.from({ length: 10 }, (_, i) => ({
      token: new Array(32).fill(0.2 + (i * 0.01)),
      frame_index: i,
      timestamp: Date.now() + (i * 33.33)
    }));

    // Process bulk tokens
    console.log('Processing bulk tokens...');
    const result = await decoder.process_tokens(bulkTokens);
    console.log('Processing result:', result);

    // Process a batch
    console.log('Processing batch...');
    const batchResult = await decoder.process_batch();
    console.log('Batch result:', batchResult);

    // Setup continuous testing
    startContinuousTest(decoder);

  } catch (err) {
    console.error('Test sequence failed:', err);
    console.error('Stack:', err.stack);
  }
}

function startContinuousTest(decoder) {
  // Setup metrics monitoring
  setInterval(() => {
    try {
      const newTokens = Array.from({ length: 4 }, (_, i) => ({
        token: new Array(32).fill(0.3 + (Math.random() * 0.1)),
        frame_index: Date.now(),
        timestamp: Date.now()
      }));

      decoder.process_tokens(newTokens)
        .then(result => console.log('Continuous processing result:', result))
        .catch(err => console.error('Processing error:', err));

    } catch (err) {
      console.error('Metrics update error:', err);
    }
  }, 1000);

  // Monitor decoder metrics
  setInterval(() => {
    const metrics = decoder.getMetrics();
    console.log('FPS:', metrics.fps);
    console.log('Memory:', metrics.memoryUsage);
    console.log('Queue Size:', metrics.queueSize);
  }, 1000);
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}