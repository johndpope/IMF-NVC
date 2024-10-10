import { ONNXModelLoader } from './ONNXModelLoader';

async function main() {
    console.log('Starting main function');
    const modelLoader = new ONNXModelLoader();
    
    try {
      console.log('Attempting to load model');

      const modelLoader = new ONNXModelLoader();

      // Load the model (from file system or URL)
      await modelLoader.loadModel('/quantized_imf_encoder_fixed.onnx');
      console.log('Model loaded successfully');
      // Prepare input data
      const xCurrent = await ONNXModelLoader.imageToFloat32Array('path/to/current/image.jpg');
      const xReference = await ONNXModelLoader.imageToFloat32Array('path/to/reference/image.jpg');
    
      // Run inference
      console.log('Running inference');
      const [fr, tr, tc] = await modelLoader.runInference(xCurrent, xReference);
      console.log('Inference completed');
      // Use the outputs as needed
      console.log('Inference outputs:', fr, tr, tc);
      console.log('Inference results:', { 
        fr: fr.slice(0, 5),
        tr: tr.slice(0, 5), 
        tc: tc.slice(0, 5) 
      });
  
    } catch (error) {
      console.error('Error in main function:', error);
    }

  
  }
  
  main().catch(error => console.error('Unhandled error in main:', error));