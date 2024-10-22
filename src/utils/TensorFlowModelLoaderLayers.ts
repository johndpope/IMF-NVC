import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';

export class TensorFlowLayerModelLoader {
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

  private fixModelConfig(modelJson: any): any {
    const config = modelJson.modelTopology.model_config.config;
    
    // Fix input layers
    config.layers.forEach((layer: any) => {
      if (layer.class_name === 'InputLayer') {
        layer.config.batch_input_shape = [null, 3, 256, 256];
      }
    });
  
    // Fix nodeData if it's an object instead of an array
    if (modelJson.modelTopology.nodeData && !Array.isArray(modelJson.modelTopology.nodeData)) {
      modelJson.modelTopology.nodeData = [modelJson.modelTopology.nodeData];
    }
  
    return modelJson;
  }
  

  async loadModel(modelUrl: string): Promise<void> {
    try {
      console.log('Starting model load from:', modelUrl);
      const response = await fetch(modelUrl);
      const modelJson = await response.json();
      const fixedModelJson = this.fixModelConfig(modelJson);
      this.model = await tf.loadLayersModel(tf.io.fromMemory(fixedModelJson));
      console.log('Model loaded successfully');
    } catch (error) {
      console.error('Error loading the model:', error);
      throw error;
    }
  }

  async runInference(xCurrent: tf.Tensor, xReference: tf.Tensor): Promise<tf.Tensor> {
    if (!this.model) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }
  
    try {
      console.log('Running inference');
      const results = this.model.predict([xCurrent, xReference]) as tf.Tensor;
      console.log('Inference complete');
      return results;
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
          return tf.transpose(normalized.expandDims(0), [0, 3, 1, 2]); // NHWC to NCHW
        });
        resolve(tensor);
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  }
}