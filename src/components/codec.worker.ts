// codec.worker.ts
import type * as tfjs from '@tensorflow/tfjs';

interface WorkerMessage {
  type: 'processFeatures' | 'initModel';
  payload: any;
}

let model: tfjs.GraphModel | null = null;

async function initializeModel(modelPath: string) {
  const tf = await import('@tensorflow/tfjs');
  await import('@tensorflow/tfjs-backend-webgpu');

  try {
    await tf.setBackend('webgpu');
    await tf.ready();
    console.log('Worker: Using WebGPU backend');
  } catch (error:any)  {
    console.warn('Worker: WebGPU not available, falling back to WebGL');
    await tf.setBackend('webgl');
    await tf.ready();
  }

  model = await tf.loadGraphModel(modelPath);
  return { status: 'initialized' };
}

async function processFeatures(features: any) {
  if (!model) throw new Error('Model not initialized');
  
  const tf = await import('@tensorflow/tfjs');
  const timing = { start: performance.now() };
  
  try {
    // Prepare tensors
    const currentToken = tf.tensor2d(
      Array.isArray(features.current_token[0]) 
        ? features.current_token 
        : [features.current_token], 
      [1, 32]
    ).asType('float32');

    const referenceToken = tf.tensor2d(
      Array.isArray(features.reference_token[0]) 
        ? features.reference_token 
        : [features.reference_token], 
      [1, 32]
    ).asType('float32');

    const referenceFeatures = features.reference_features.map((feature: any, idx: number) => {
      const shapes = [[1, 128, 64, 64], [1, 256, 32, 32], [1, 512, 16, 16], [1, 512, 8, 8]];
      return tf.tensor(feature, shapes[idx]).asType('float32');
    });

    // Execute model
    const outputTensor = model.execute({
      'args_0:0': currentToken,
      'args_0_1:0': referenceToken,
      'args_0_2': referenceFeatures[0],
      'args_0_3': referenceFeatures[1],
      'args_0_4': referenceFeatures[2],
      'args_0_5': referenceFeatures[3]
    }) as tfjs.Tensor4D;

    // Process output
    const processedTensor = tf.tidy(() => {
      let tensor = outputTensor;
      
      if (tensor.shape.length === 4) {
        if (tensor.shape[1] === 3) {
          tensor = tf.transpose(tensor, [0, 2, 3, 1]);
        }
        tensor = tensor.squeeze([0]);
      }

      const min = tensor.min();
      const max = tensor.max();
      const range = tf.maximum(max.sub(min), tf.scalar(1e-6));
      return tensor.sub(min).div(range).clipByValue(0, 1).asType('float32');
    });

    // Convert to image data
    const [height, width] = processedTensor.shape.slice(0, 2);
    const canvas = new OffscreenCanvas(width, height);
    await tf.browser.toPixels(processedTensor as tfjs.Tensor3D, canvas);
    const blob = await canvas.convertToBlob();
    const imageUrl = URL.createObjectURL(blob);

    // Cleanup
    [currentToken, referenceToken, ...referenceFeatures, outputTensor, processedTensor].forEach(t => t.dispose());

    timing.end = performance.now();
    return { imageUrl, timing };

  } catch (error:any)  {
    throw error;
  }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  try {
    switch (event.data.type) {
      case 'initModel':
        const initResult = await initializeModel(event.data.payload);
        self.postMessage({ type: 'modelInitialized', payload: initResult });
        break;
      
      case 'processFeatures':
        const result = await processFeatures(event.data.payload);
        self.postMessage({ type: 'featuresProcessed', payload: result });
        break;
    }
  } catch (error:any)  {
    self.postMessage({ type: 'error', payload: error.message });
  }
};