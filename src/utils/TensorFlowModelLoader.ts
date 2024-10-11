import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';

export class TensorFlowModelLoader {
  private model: tf.LayersModel | null = null;

  constructor() {
    this.initializeTensorFlow();
  }

  private async initializeTensorFlow() {
    try {
      await tf.setBackend('webgpu');
      await tf.ready();
      console.log('Using WebGPU backend');
    } catch (error) {
      console.warn('WebGPU not available, falling back to WebGL', error);
      await tf.setBackend('webgl');
      await tf.ready();
      console.log('Using WebGL backend');
    }
  }

  async loadModel(modelUrl: string): Promise<void> {
    try {
      console.log('Starting model load from:', modelUrl);
      this.model = await tf.loadLayersModel(modelUrl);
      console.log('Model loaded successfully');
    } catch (error) {
      console.error('Error loading the model:', error);
      throw error;
    }
  }

  async runInference(xCurrent: tf.Tensor, xReference: tf.Tensor): Promise<[tf.Tensor, tf.Tensor, tf.Tensor]> {
    if (!this.model) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    try {
      console.log('Running inference');
      const results = this.model.predict([xCurrent, xReference]) as tf.Tensor | tf.Tensor[];
      console.log('Inference complete');

      if (Array.isArray(results)) {
        return results as [tf.Tensor, tf.Tensor, tf.Tensor];
      } else {
        throw new Error('Unexpected model output format');
      }
    } catch (error) {
      console.error('Error during inference:', error);
      throw error;
    }
  }

  static async imageToTensor(imageUrl: string): Promise<tf.Tensor> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tensor = tf.tidy(() => {
          const tempTensor = tf.browser.fromPixels(img);
          const resized = tf.image.resizeBilinear(tempTensor, [256, 256]);
          const normalized = resized.div(tf.scalar(255)).sub(tf.tensor([0.485, 0.456, 0.406])).div(tf.tensor([0.229, 0.224, 0.225]));
          return normalized.expandDims(0);
        });
        resolve(tensor);
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  }
}