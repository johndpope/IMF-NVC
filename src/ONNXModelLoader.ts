import { InferenceSession, Tensor, env } from 'onnxruntime-web';

export class ONNXModelLoader {
  private session: InferenceSession | null = null;

  constructor() {
    // Enable WebGL backend for GPU support
    env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
    env.webgl.contextId = 'webgl2';
  }

  async loadModel(modelUrl: string): Promise<void> {
    try {
      console.log('Starting model load from:', modelUrl);
      const response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const modelData = await response.arrayBuffer();
      console.log('Model data fetched, size:', modelData.byteLength);
      
      this.session = await InferenceSession.create(modelData, { executionProviders: ['webgl'] });
      console.log('Model loaded successfully');
    } catch (error) {
      console.error('Error loading the model:', error);
      throw error;
    }
  }

  async runInference(xCurrent: Float32Array, xReference: Float32Array): Promise<[Float32Array, Float32Array, Float32Array]> {
    if (!this.session) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const inputShape = [1, 3, 256, 256]; // Adjust based on your model's input shape
    const xCurrentTensor = new Tensor('float32', xCurrent, inputShape);
    const xReferenceTensor = new Tensor('float32', xReference, inputShape);

    const feeds = {
      x_current: xCurrentTensor,
      x_reference: xReferenceTensor
    };

    try {
      const outputMap = await this.session.run(feeds);
      const fr = outputMap.f_r.data as Float32Array;
      const tr = outputMap.t_r.data as Float32Array;
      const tc = outputMap.t_c.data as Float32Array;

      return [fr, tr, tc];
    } catch (error) {
      console.error('Error during inference:', error);
      throw error;
    }
  }

  // Helper method to convert image to Float32Array
  static async imageToFloat32Array(imageUrl: string): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get 2D context'));
          return;
        }
        ctx.drawImage(img, 0, 0, 256, 256);
        const imageData = ctx.getImageData(0, 0, 256, 256);
        const float32Data = new Float32Array(3 * 256 * 256);
        for (let i = 0; i < imageData.data.length / 4; i++) {
          float32Data[i * 3] = (imageData.data[i * 4] / 255 - 0.485) / 0.229;     // R
          float32Data[i * 3 + 1] = (imageData.data[i * 4 + 1] / 255 - 0.456) / 0.224; // G
          float32Data[i * 3 + 2] = (imageData.data[i * 4 + 2] / 255 - 0.406) / 0.225; // B
        }
        resolve(float32Data);
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  }
}

