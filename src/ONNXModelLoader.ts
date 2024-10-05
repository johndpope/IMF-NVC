import init, { Session, Input } from "@webonnx/wonnx-wasm";

export class ONNXModelLoader {
  private session: Session | null = null;
  private progressBarContainer: HTMLElement;
  private progressBar: HTMLElement;
  private progressText: HTMLElement;

  constructor() {
    this.progressBarContainer = document.createElement('div');
    this.progressBar = document.createElement('div');
    this.progressText = document.createElement('div');
    this.createProgressBar();
  }

  private createProgressBar() {
    this.progressBarContainer.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 300px;
      height: 30px;
      background-color: #f0f0f0;
      border-radius: 5px;
      overflow: hidden;
      display: none;
    `;

    this.progressBar.style.cssText = `
      width: 0%;
      height: 100%;
      background-color: #4CAF50;
      transition: width 0.3s;
    `;

    this.progressText.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #000;
      font-weight: bold;
    `;

    this.progressBarContainer.appendChild(this.progressBar);
    this.progressBarContainer.appendChild(this.progressText);
    document.body.appendChild(this.progressBarContainer);
  }

  

  private showProgressBar() {
    this.progressBarContainer.style.display = 'block';
  }

  private hideProgressBar() {
    this.progressBarContainer.style.display = 'none';
  }

  private updateProgress(progress: number) {
    const percentage = Math.round(progress * 100);
    this.progressBar.style.width = `${percentage}%`;
    this.progressText.textContent = `${percentage}%`;
  }

  async loadModel(modelUrl: string): Promise<void> {
    try {
      this.showProgressBar();
      console.log('Starting model load from:', modelUrl);
      const modelBytes = await this.fetchBytesWithProgress(modelUrl);
      console.log('Model data fetched, size:', modelBytes.length);
      
      await init(); // Initialize WONNX
      this.session = await this.createSession(modelBytes);
      console.log('Model loaded successfully');
    } catch (error) {
      console.error('Error loading the model:', error);
      throw error;
    } finally {
      this.hideProgressBar();
    }
  }

  private async fetchBytesWithProgress(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const reader = response.body!.getReader();
    const contentLength = Number(response.headers.get('Content-Length')) || 0;
    let receivedLength = 0;
    let chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      receivedLength += value.length;
      this.updateProgress(receivedLength / contentLength);
    }

    let chunksAll = new Uint8Array(receivedLength);
    let position = 0;
    for (let chunk of chunks) {
      chunksAll.set(chunk, position);
      position += chunk.length;
    }
    return chunksAll;
  }
  private async createSession(modelBytes: Uint8Array): Promise<Session> {
    const providers = ['webgpu', 'webgl', 'wasm', 'cpu'] as const;
    for (const provider of providers) {
        try {
            console.log(`Attempting to create session with ${provider}`);
            
            if (provider === 'webgpu') {
                if (!this.isWebGPUSupported()) {
                    console.log('WebGPU is not supported, skipping...');
                    continue;
                }
                console.log('WebGPU is supported, attempting to create adapter...');
                const gpu = (navigator as any).gpu;
                if (gpu) {
                    const adapter = await gpu.requestAdapter();
                    if (!adapter) {
                        console.log('Failed to get WebGPU adapter, skipping...');
                        continue;
                    }
                    console.log('WebGPU adapter created successfully');
                }
            }
            
            const session = await Session.fromBytes(modelBytes);
            console.log(`Successfully created session with ${provider}`);
            return session;
        } catch (error) {
            console.warn(`Failed to create session with ${provider}:`, error);
        }
    }
    throw new Error("Failed to create session with any available provider");
  }

  private isWebGPUSupported(): boolean {
      return !!(navigator as any).gpu;
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