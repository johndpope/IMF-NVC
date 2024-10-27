import init   from '@pkg/imf_decoder';
import {IMFDecoder}   from '@pkg/imf_decoder';
import type { VerifyResult, TestResult } from '../types';

async function verifyWasmBuild(): Promise<VerifyResult> {
    console.log('🔍 Starting WASM verification...');
    
    try {
        await init();
        const exports = Object.keys(await import('@pkg/imf_decoder'));
        console.log('📦 WASM Exports:', exports);

        const width = 640;
        const height = 480;
        console.log(`Creating new IMF decoder with dimensions ${width}x${height}`);
        
        const decoder = new IMFDecoder(width, height);
        const methods = Object.getOwnPropertyNames(IMFDecoder.prototype);
        console.log('🔧 IMFDecoder Methods:', methods);

        const testResult = decoder.test();
        console.log('🧪 Test method output:', testResult);
        console.log('IMFDecoder instance:', decoder);

        if (!testResult.includes('IMFDecoder working!')) {
            throw new Error('Decoder test failed');
        }

        console.log('✅ WASM verification successful!');
        return {
            success: true,
            decoder
        };
    } catch (error) {
        console.error('❌ WASM verification failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Unknown error')
        };
    }
}

 async function runDecoderTests(decoder: IMFDecoder): Promise<TestResult> {
  try {
      console.log('Available methods:', Object.getOwnPropertyNames(IMFDecoder.prototype));
      
      // Test 1: Basic functionality
      const initialTest = decoder.test();
      console.log('Initial test:', initialTest);

      // Test 2: Set diagnostic mode
      console.log('Setting diagnostic mode...');
      decoder.diagnostic_mode = true;
      console.log('Diagnostic mode set to:', decoder.diagnostic_mode);
      
      if (!decoder.diagnostic_mode) {
          throw new Error('Failed to set diagnostic mode');
      }
      console.log('Diagnostic mode is now:', decoder.diagnostic_mode);

      // Test 3: Set reference data
      console.log('Setting reference data...');
      const referenceData = {
          features: [
              {
                  tensor: new Float32Array(1 * 128 * 64 * 64).fill(0.5),
                  shape: [1, 128, 64, 64]
              },
              {
                  tensor: new Float32Array(1 * 256 * 32 * 32).fill(0.5),
                  shape: [1, 256, 32, 32]
              },
              {
                  tensor: new Float32Array(1 * 512 * 16 * 16).fill(0.5),
                  shape: [1, 512, 16, 16]
              },
              {
                  tensor: new Float32Array(1 * 512 * 8 * 8).fill(0.5),
                  shape: [1, 512, 8, 8]
              }
          ],
          token: new Float32Array(32).fill(0.1)
      };

      const refResult = await decoder.set_reference_data(referenceData);
      console.log('Set reference data result:', refResult);

      // Test 4: Process test frame
      console.log('Processing tokens...');
      const frameWidth = 640;
      const frameHeight = 480;
      const channelCount = 4; // RGBA
      const frameData = new Float32Array(frameWidth * frameHeight * channelCount).fill(0.5);

      if (typeof decoder.process_tokens !== 'function') {
          throw new Error('process_tokens method not found on decoder');
      }
      console.log('process_tokens exists:', typeof decoder.process_tokens);

      const tokenResult = await decoder.process_tokens([{
          token: frameData,
          frame_index: 0
      }]);

      // Test 5: Process batch
      const batchResult = await decoder.process_batch();

      return {
          success: true,
          message: 'All decoder tests completed successfully'
      };

  } catch (error) {
      console.error('Error processing tokens:', error);
      console.error('Stack:', error);
      console.error('Test sequence failed:', error);
      return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
      };
  }
}

async function initializeDecoder(): Promise<void> {
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
          const wasm_module = await import('@pkg/imf_decoder');
      
          // Wait for module initialization
          await init();
          
          // Log all available exports
          console.log('📦 WASM Exports:', Object.keys(wasm_module));
      } catch (importError) {
          console.error('Failed to import WASM module:', importError);
      }
  }
}



async function testAnimationFrame(decoder: IMFDecoder): Promise<TestResult> {
    console.log('🎬 Starting animation frame test...');
    
    try {
        // Track frame count and timing
        let frameCount = 0;
        let startTime = performance.now();
        let lastFrameTime = startTime;
        const testDuration = 3000; // Run test for 3 seconds
        const targetFPS = 60;
        const frameTimings: number[] = [];

        // Create test data
        const referenceData = {
            features: [
                {
                    tensor: new Float32Array(1 * 128 * 64 * 64).fill(0.5),
                    shape: [1, 128, 64, 64]
                },
                {
                    tensor: new Float32Array(1 * 256 * 32 * 32).fill(0.5),
                    shape: [1, 256, 32, 32]
                },
                {
                    tensor: new Float32Array(1 * 512 * 16 * 16).fill(0.5),
                    shape: [1, 512, 16, 16]
                },
                {
                    tensor: new Float32Array(1 * 512 * 8 * 8).fill(0.5),
                    shape: [1, 512, 8, 8]
                }
            ],
            token: new Float32Array(32).fill(0.1)
        };

        // Set up decoder
        console.log('Setting reference data...');
        await decoder.set_reference_data(referenceData);
        decoder.diagnostic_mode = true;

        // Create a promise that resolves when the animation test is complete
        const animationTest = new Promise<void>((resolve) => {
            function animationFrame(timestamp: number) {
                const currentTime = performance.now();
                const elapsed = currentTime - startTime;
                const frameDuration = currentTime - lastFrameTime;
                
                // Process frame
                const frameData = new Float32Array(640 * 480 * 4).fill(0.5);
                decoder.process_tokens([{
                    token: Array.from(frameData),
                    frame_index: frameCount
                }]);
                
                // Track metrics
                frameCount++;
                frameTimings.push(frameDuration);
                lastFrameTime = currentTime;

                // Continue animation if test duration hasn't elapsed
                if (elapsed < testDuration) {
                    requestAnimationFrame(animationFrame);
                } else {
                    resolve();
                }
            }

            // Start animation loop
            requestAnimationFrame(animationFrame);
        });

        // Wait for animation test to complete
        await animationTest;

        // Calculate test results
        const averageFrameTime = frameTimings.reduce((a, b) => a + b, 0) / frameTimings.length;
        const measuredFPS = 1000 / averageFrameTime;
        const minFrameTime = Math.min(...frameTimings);
        const maxFrameTime = Math.max(...frameTimings);
        const frameTimeJitter = maxFrameTime - minFrameTime;

        // Log results
        console.log('🎥 Animation test completed:');
        console.log(`Frames processed: ${frameCount}`);
        console.log(`Average frame time: ${averageFrameTime.toFixed(2)}ms`);
        console.log(`Measured FPS: ${measuredFPS.toFixed(2)}`);
        console.log(`Frame time range: ${minFrameTime.toFixed(2)}ms - ${maxFrameTime.toFixed(2)}ms`);
        console.log(`Frame time jitter: ${frameTimeJitter.toFixed(2)}ms`);

        // Verify test results
        const performanceThreshold = 0.8; // 80% of target performance
        const targetFrameTime = 1000 / targetFPS;
        const isPerformant = averageFrameTime <= targetFrameTime / performanceThreshold;
        const isStable = frameTimeJitter < targetFrameTime;

        if (!isPerformant || !isStable) {
            throw new Error(
                `Performance targets not met:\n` +
                `Average frame time: ${averageFrameTime.toFixed(2)}ms (target: ${targetFrameTime}ms)\n` +
                `Frame time jitter: ${frameTimeJitter.toFixed(2)}ms`
            );
        }

        return {
            success: true,
            message: `Animation test completed successfully:\n` +
                    `Processed ${frameCount} frames at ${measuredFPS.toFixed(1)} FPS\n` +
                    `Frame time: ${averageFrameTime.toFixed(1)}ms ±${(frameTimeJitter/2).toFixed(1)}ms`
        };

    } catch (error) {
        console.error('❌ Animation test failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

// Update the main test function to include animation testing
async function runEnhancedDecoderTests(decoder: IMFDecoder): Promise<TestResult> {
    try {
        // Run existing decoder tests first
        const basicTests = await runDecoderTests(decoder);
        if (!basicTests.success) {
            throw new Error(`Basic decoder tests failed: ${basicTests.error}`);
        }

        // Run animation frame test
        console.log('Running animation frame test...');
        const animationTest = await testAnimationFrame(decoder);
        if (!animationTest.success) {
            throw new Error(`Animation test failed: ${animationTest.error}`);
        }

        return {
            success: true,
            message: `All tests completed successfully.\n${animationTest.message}`
        };

    } catch (error) {
        console.error('Test sequence failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}


// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDecoder);
} else {
  initializeDecoder();
}

export { initializeDecoder, verifyWasmBuild, runDecoderTests, runEnhancedDecoderTests, testAnimationFrame };