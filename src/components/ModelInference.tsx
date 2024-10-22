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
    const imageTensor = tf.browser.fromPixels(img);
    const resized = tf.image.resizeBilinear(imageTensor, [64, 64]);
    const normalized = resized.div(255.0);
    const batched = normalized.expandDims(0);
    const transposed = tf.transpose(batched, [0, 3, 1, 2]);
    
    return transposed as import('@tensorflow/tfjs').Tensor4D;
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