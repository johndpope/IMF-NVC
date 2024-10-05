import { ONNXModelLoader } from './ONNXModelLoader';

async function main() {
    console.log('Starting main function');
    const modelLoader = new ONNXModelLoader();
    
    try {
      console.log('Attempting to load model');
      // await modelLoader.loadModel('/imf_encoder_web.onnx');
      // await modelLoader.loadModel('/imf_encoder.onnx');
      await modelLoader.loadModel('/imf_simple.onnx');
      // await modelLoader.loadModel('/opt-squeeze.onnx');
      
      console.log('Model loaded successfully');
  
      console.log('Attempting to load frame1.png');
      const frame1 = await ONNXModelLoader.imageToFloat32Array('/frame1.png');
      console.log('Frame 1 loaded successfully');
  
      console.log('Attempting to load frame2.png');
      const frame2 = await ONNXModelLoader.imageToFloat32Array('/frame2.png');
      console.log('Frame 2 loaded successfully');
  
      console.log('Running inference');
      const [fr, tr, tc] = await modelLoader.runInference(frame1, frame2);
      console.log('Inference completed');
  
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