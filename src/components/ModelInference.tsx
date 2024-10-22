'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import dynamic from 'next/dynamic';
import type * as tfjs from '@tensorflow/tfjs';

interface InferenceResults {
  shape: number[];
  data: number[][];
}

interface ModelInferenceProps {
  modelPath: string;
  imagePaths: string[];
}

const loadImage = async (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
};

const prepareInput = async (
  imagePath: string,
  tf: typeof tfjs
): Promise<tfjs.Tensor4D> => {
  const img = await loadImage(imagePath);
  
  return tf.tidy(() => {
    // Convert image to tensor
    const imageTensor = tf.browser.fromPixels(img);
    
    // Resize to expected dimensions [256, 256, 3]
    const resized = tf.image.resizeBilinear(imageTensor, [256, 256]);
    
    // Normalize to match PyTorch's normalization
    const normalized = tf.sub(tf.div(resized, 255.0), 0.5);
    
    // Add batch dimension and transpose to NCHW format [1, 3, 256, 256]
    const batched = tf.expandDims(normalized, 0);
    const transposed = tf.transpose(batched, [0, 3, 1, 2]);
    
    // Log shape for debugging
    console.log('Final tensor shape:', transposed.shape);
    
    return transposed as tfjs.Tensor4D;
  });
};
interface TimingMetrics {
  modelLoading: number;
  inputPreparation: number;
  inference: number;
  total: number;
}

interface InferenceResults {
  shape: number[];
  data: number[][];
  timing: TimingMetrics;
}


const ModelInference = ({ modelPath, imagePaths }: { modelPath: string, imagePaths: string[] }) => {
  const [status, setStatus] = useState<string>('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const [timingMetrics, setTimingMetrics] = useState<any>(null);
  const [reconstructedImage, setReconstructedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadAndRunInference() {
      const startTime = performance.now();
      try {
        // Import TensorFlow.js
        const tf = await import('@tensorflow/tfjs');
        await import('@tensorflow/tfjs-backend-webgpu');
        
        // Initialize backend
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

        // Load model
        setStatus('Loading model...');
        const modelLoadStart = performance.now();
        const model = await tf.loadGraphModel(modelPath);
        const modelLoadTime = performance.now() - modelLoadStart;

        // Prepare inputs
        setStatus('Preparing inputs...');
        const inputPrepStart = performance.now();
        const inputs = await Promise.all([
          prepareInput(imagePaths[0], tf),
          prepareInput(imagePaths[1], tf)
        ]);
        const inputPrepTime = performance.now() - inputPrepStart;

        // Run inference
        setStatus('Running inference...');
        const inferenceStart = performance.now();
        const outputTensor = model.execute({
          'args_0:0': inputs[0],
          'args_0_1:0': inputs[1]
        }) as tfjs.Tensor;


         // Convert output tensor to image
         const processedTensor = tf.tidy(() => {
          // First ensure we're working with the right shape
          let tensor = outputTensor;
          
          // If tensor is NCHW format, convert to NHWC
          if (tensor.shape[1] === 3) {
            tensor = tf.transpose(tensor, [0, 2, 3, 1]);
          }
          
          // Remove batch dimension if present
          if (tensor.shape[0] === 1) {
            tensor = tensor.squeeze([0]);
          }
          
          // Normalize values to [0, 1] range
          const minVal = tensor.min();
          const maxVal = tensor.max();
          const normalizedTensor = tensor.sub(minVal).div(maxVal.sub(minVal));
          
          // Ensure tensor is float32
          return normalizedTensor.asType('float32');
        });

         // Log tensor information for debugging
         const shape = processedTensor.shape;
         console.log('Processed tensor shape:', shape);
         console.log('Processed tensor min:', await processedTensor.min().data());
         console.log('Processed tensor max:', await processedTensor.max().data());
 
         // Verify tensor shape and create canvas
         if (shape.length !== 3) {
           throw new Error(`Expected tensor shape of rank 3, but got rank ${shape.length}`);
         }
 
         const [height, width] = shape.slice(0, 2) as [number, number];
         if (!height || !width) {
           throw new Error('Invalid tensor dimensions');
         }
 
         const canvas = document.createElement('canvas');
         canvas.width = width;
         canvas.height = height;
 
         // Convert to pixels
         await tf.browser.toPixels(processedTensor as tfjs.Tensor3D, canvas);
         
         const inferenceTime = performance.now() - inferenceStart;
         const totalTime = performance.now() - startTime;
 
         // Set timing metrics
         setTimingMetrics({
           modelLoading: modelLoadTime,
           inputPreparation: inputPrepTime,
           inference: inferenceTime,
           total: totalTime
         });
 
         // Convert canvas to data URL and set as reconstructed image
         setReconstructedImage(canvas.toDataURL());
         setStatus('Inference complete');
 
         // Cleanup
         inputs.forEach(tensor => tensor.dispose());
         outputTensor.dispose();
         processedTensor.dispose();
         
       } catch (err) {
         const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
         setError(errorMessage);
         setStatus('Error occurred');
         console.error('Inference error:', err);
       } finally {
         setIsLoading(false);
       }
    }

    loadAndRunInference();
  }, [modelPath, imagePaths]);

  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms/1000).toFixed(2)}s`;
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Neural Video Codec Inference</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="text-sm font-medium">Status: {status}</div>
          
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Reference Frame */}
            <div className="space-y-2">
              <div className="font-medium text-sm">Reference Frame</div>
              <img 
                src={imagePaths[0]} 
                alt="Reference frame"
                className="w-full rounded-lg border border-gray-200"
              />
            </div>

            {/* Target Frame */}
            <div className="space-y-2">
              <div className="font-medium text-sm">Target Frame</div>
              <img 
                src={imagePaths[1]} 
                alt="Target frame"
                className="w-full rounded-lg border border-gray-200"
              />
            </div>

            {/* Reconstructed Frame */}
            <div className="space-y-2">
              <div className="font-medium text-sm">Reconstructed Frame</div>
              {isLoading ? (
                <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
                  Loading...
                </div>
              ) : reconstructedImage ? (
                <img 
                  src={reconstructedImage} 
                  alt="Reconstructed frame"
                  className="w-full rounded-lg border border-gray-200"
                />
              ) : (
                <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
                  No output available
                </div>
              )}
            </div>
          </div>
          
          {timingMetrics && (
            <div className="rounded-lg bg-slate-100 p-4 space-y-2">
              <h3 className="font-medium">Performance Metrics:</h3>
              <div className="text-sm space-y-1">
                <div>Model Loading: {formatTime(timingMetrics.modelLoading)}</div>
                <div>Input Preparation: {formatTime(timingMetrics.inputPreparation)}</div>
                <div>Inference: {formatTime(timingMetrics.inference)}</div>
                <div className="font-medium">Total Time: {formatTime(timingMetrics.total)}</div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default dynamic(() => Promise.resolve(ModelInference), {
  ssr: false
});