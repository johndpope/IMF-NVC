async function init() {
  try {
      // Import the wasm module
      const wasm_module = await import('../pkg/imf_decoder.js');
      
      // Wait for module initialization
      await wasm_module.default();
      
      // Create decoder instance using factory function
      const decoder = wasm_module.create_decoder(640, 480);
      // Or using constructor
      // const decoder = new wasm_module.Decoder(640, 480);
      
      console.log('Decoder test:', decoder.test());
      
      // Store for later use
      window.decoder = decoder;
      window.wasm = wasm_module;
      
      console.log('Decoder initialized successfully');
  } catch (e) {
      console.error('Failed to initialize decoder:', e);
      console.error('Stack:', e.stack);
      
      // Additional debugging info
      console.log('Available exports:', Object.keys(await import('../pkg/imf_decoder.js')));
  }
}

// Wait for the page to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}