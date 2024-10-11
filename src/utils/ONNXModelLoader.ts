import * as ort from 'onnxruntime-web';
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';


export class ONNXModelLoader {
  private session: ort.InferenceSession | null = null;
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
      console.log('Starting model load from:', modelUrl);
      const response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      
      // Set the WASM path
      ort.env.wasm.wasmPaths = '/onnxruntime-web/';
      
      this.session = await this.createSession(arrayBuffer);
      
      console.log('Model loaded successfully');
    } catch (error) {
      console.error('Error loading the model:', error);
      throw error;
    }
  }

  private async createSession(model: ArrayBuffer): Promise<ort.InferenceSession> {
    try {
      // Try WebGL first
      const session = await ort.InferenceSession.create(model, {
        executionProviders: ['webgl'],
        graphOptimizationLevel: 'all'
      });
      console.log('Using WebGL backend');
      return session;
    } catch (e) {
      console.warn('WebGL not supported, falling back to WASM', e);

      // WASM optimizations
      if (typeof ort.env.wasm !== 'undefined') {
        // Enable multi-threading if possible
        ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
        
        // Use SIMD if available
        ort.env.wasm.simd = true;
      }
      
      try {
        // Fallback to WASM
        const session = await ort.InferenceSession.create(model, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });
        console.log('Using WASM backend');
        return session;
      } catch (wasmError) {
        console.error('WASM initialization failed:', wasmError);
        throw new Error('Failed to initialize both WebGL and WASM backends');
      }
    }
  }

  async runInference(xCurrent: Float32Array, xReference: Float32Array): Promise<[Float32Array, Float32Array, Float32Array]> {
    if (!this.session) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }
  
    const feeds: Record<string, ort.Tensor> = {
      x_current: new ort.Tensor('float32', xCurrent, [1, 3, 256, 256]),
      x_reference: new ort.Tensor('float32', xReference, [1, 3, 256, 256])
    };
  
    try {
      console.log('Running Inference');
      const start = performance.now();
      const results = await this.session.run(feeds);
      const end = performance.now();
      console.log(`Inference took ${end - start} ms`);
  
      const fr = results['f_r'].data as Float32Array;
      const tr = results['t_r'].data as Float32Array;
      const tc = results['t_c'].data as Float32Array;
  
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