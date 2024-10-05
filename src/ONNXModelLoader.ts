import init, { Session, Input } from "@webonnx/wonnx-wasm";

export class ONNXModelLoader {
  private session: Session | null = null;


  async loadModel(modelUrl: string): Promise<void> {
    try {
      console.log('Starting model load from:', modelUrl);
      const modelBytes = await this.fetchBytes(modelUrl);
      console.log('Model data fetched, size:', modelBytes.length);
      
      await init(); // Initialize WONNX
      this.session = await this.createSession(modelBytes);
      console.log('Model loaded successfully');
    } catch (error) {
      console.error('Error loading the model:', error);
      throw error;
    }
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.arrayBuffer();
    return new Uint8Array(blob);
  }

  private async createSession(modelBytes: Uint8Array): Promise<Session> {
    const providers = ['webgpu', 'webgl', 'wasm','cpu'] as const;
    for (const provider of providers) {
      try {
        console.log(`Trying to create session with ${provider}`);
        const session = await Session.fromBytes(modelBytes);
        console.log(`Successfully created session with ${provider}`);
        return session;
      } catch (error) {
        console.warn(`Failed to create session with ${provider}:`, error);
      }
    }
    throw new Error("Failed to create session with any available provider");
  }
  async runInference(xCurrent: Float32Array, xReference: Float32Array): Promise<[Float32Array, Float32Array, Float32Array]> {
    if (!this.session) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const input = new Input();
    input.insert("x_current", xCurrent);
    input.insert("x_reference", xReference);

    try {
      const result = await this.session.run(input);
      const fr = result.get("f_r") as Float32Array;
      const tr = result.get("t_r") as Float32Array;
      const tc = result.get("t_c") as Float32Array;

      input.free(); // Free the input after use

      return [fr, tr, tc];
    } catch (error) {
      console.error('Error during inference:', error);
      throw error;
    }
  }

  // Helper method to convert image to Float32Array (unchanged)
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