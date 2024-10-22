'use client';
// src/components/ModelInference.tsx
import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import dynamic from 'next/dynamic';

interface InferenceResults {
  shape: number[];
  data: number[][];
}

interface ModelInferenceProps {
  modelPath: string;
  imagePaths: string[];
}

const ModelInference = ({ modelPath, imagePaths }: ModelInferenceProps) => {
  const [status, setStatus] = useState<string>('Initializing...');
  const [results, setResults] = useState<InferenceResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    let tfjs: typeof import('@tensorflow/tfjs');
    
    async function initTensorFlow() {
      try {
        tfjs = await import('@tensorflow/tfjs');
        await import('@tensorflow/tfjs-backend-webgpu');
        
        try {
          await tfjs.setBackend('webgpu');
          await tfjs.ready();
          console.log('Using WebGPU backend');
        } catch (error) {
          console.warn('WebGPU not available, falling back to WebGL', error);
          await tfjs.setBackend('webgl');
          await tfjs.ready();
          console.log('Using WebGL backend');
        }
        
        return tfjs;
      } catch (error) {
        throw new Error('Failed to initialize TensorFlow.js');
      }
    }

    async function loadAndRunInference() {
      try {
        const tf = await initTensorFlow();
        
        setStatus('Loading model...');
        const model = await tf.loadGraphModel(modelPath);
        
        setStatus('Preparing inputs...');
        const inputs = await Promise.all(
          imagePaths.map(path => prepareInput(path, tf))
        );

        setStatus('Running inference...');
        const result = await runInference(model, inputs, tf);
        setResults(result);
        setStatus('Inference complete');

        inputs.forEach(tensor => tensor.dispose());

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        setError(errorMessage);
        setStatus('Error occurred');
        console.error('Inference error:', err);
      }
    }

    loadAndRunInference();
  }, [isClient, modelPath, imagePaths]);

  if (!isClient) {
    return null;
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Model Inference</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-sm font-medium">Status: {status}</div>
          
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {results && (
            <div className="rounded-lg bg-gray-50 p-4">
              <pre className="text-sm overflow-auto">
                {JSON.stringify(results, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

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
  tf: typeof import('@tensorflow/tfjs')
): Promise<import('@tensorflow/tfjs').Tensor4D> => {
  const img = await loadImage(imagePath);
  
  return tf.tidy(() => {
    // Convert image to tensor
    const imageTensor = tf.browser.fromPixels(img);
    
    // Resize to expected dimensions
    const resized = tf.image.resizeBilinear(imageTensor, [64, 64]);
    
    // Normalize to [0, 1]
    const normalized = tf.div(resized, 255.0);
    
    // Expand from [64, 64, 3] to [1, 3, 64, 64]
    const batched = tf.expandDims(normalized, 0);
    const transposed = tf.transpose(batched, [0, 3, 1, 2]);
    
    // Calculate the number of repetitions needed
    // We want 256 channels total, starting from 3 channels
    // So we need to create a tensor with enough channels that we can then slice
    const targetChannels = 256;
    const inputChannels = 3;
    const repetitions = Math.ceil(targetChannels / inputChannels);
    
    // Create repeated channels
    const repeatedChannels = [];
    for (let i = 0; i < repetitions; i++) {
      repeatedChannels.push(transposed);
    }
    
    // Concatenate along the channel dimension (dim 1)
    const concatenated = tf.concat(repeatedChannels, 1);
    
    // Slice to get exactly 256 channels
    const final = concatenated.slice([0, 0, 0, 0], [1, targetChannels, 64, 64]);
    
    // Log shape for debugging
    // console.log('Final tensor shape:', final.shape);
    
    return final as tf.Tensor4D;
  });
};

const runInference = async (
  model: import('@tensorflow/tfjs').GraphModel,
  inputs: import('@tensorflow/tfjs').Tensor[],
  tf: typeof import('@tensorflow/tfjs')
): Promise<InferenceResults> => {
  return tf.tidy(() => {
    const inputData = {
      'args_0:0': inputs[0],
      'args_0_1:0': inputs[1],
      'args_0_2:0': inputs[2]
    };

    const result = model.execute(inputData) as import('@tensorflow/tfjs').Tensor;
    
    return {
      shape: result.shape,
      data: result.arraySync() as number[][]
    };
  });
};

export default dynamic(() => Promise.resolve(ModelInference), {
  ssr: false
});