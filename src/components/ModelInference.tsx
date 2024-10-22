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

const formatTime = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms/1000).toFixed(2)}s`;
};

const runInference = async (
  model: tfjs.GraphModel,
  inputs: tfjs.Tensor[],
  tf: typeof tfjs
): Promise<InferenceResults> => {
  const inferenceStart = performance.now();
  
  const results = tf.tidy(() => {
    // Log shapes for debugging
    inputs.forEach((tensor, i) => {
      console.log(`Input ${i} shape:`, tensor.shape);
    });

    const inputData = {
      'args_0:0': inputs[0],
      'args_0_1:0': inputs[1]
    };

    const result = model.execute(inputData) as tfjs.Tensor;
    console.log('Output shape:', result.shape);
    
    return {
      shape: result.shape,
      data: result.arraySync() as number[][]
    };
  });
  
  const inferenceTime = performance.now() - inferenceStart;
  
  return {
    ...results,
    timing: {
      modelLoading: 0, // This will be set by the main component
      inputPreparation: 0, // This will be set by the main component
      inference: inferenceTime,
      total: 0 // This will be calculated in the main component
    }
  };
};

const ModelInference = ({ modelPath, imagePaths }: ModelInferenceProps) => {
  const [status, setStatus] = useState<string>('Initializing...');
  const [results, setResults] = useState<InferenceResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [timingMetrics, setTimingMetrics] = useState<TimingMetrics | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    async function loadAndRunInference() {
      const startTime = performance.now();
      let modelLoadTime = 0;
      let inputPrepTime = 0;
      let inferenceTime = 0;

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
        
        // Measure model loading time
        setStatus('Loading model...');
        const modelLoadStart = performance.now();
        const model = await tf.loadGraphModel(modelPath);
        modelLoadTime = performance.now() - modelLoadStart;
        
        // Measure input preparation time
        setStatus('Preparing inputs...');
        const inputPrepStart = performance.now();
        const inputs = await Promise.all([
          prepareInput(imagePaths[0], tf),
          prepareInput(imagePaths[1], tf)
        ]);
        inputPrepTime = performance.now() - inputPrepStart;

        // Run inference and get timing
        setStatus('Running inference...');
        const result = await runInference(model, inputs, tf);
        inferenceTime = result.timing.inference;

        // Calculate total time
        const totalTime = performance.now() - startTime;

        // Update timing metrics
        const timing: TimingMetrics = {
          modelLoading: modelLoadTime,
          inputPreparation: inputPrepTime,
          inference: inferenceTime,
          total: totalTime
        };

        setResults({ ...result, timing });
        setTimingMetrics(timing);
        setStatus('Inference complete');

        // Cleanup
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
          
          {results && (
            <div className="rounded-lg bg-gray-50 p-4">
              <h3 className="font-medium mb-2">Results:</h3>
              <pre className="text-sm overflow-auto">
                {JSON.stringify(results.data, null, 2)}
              </pre>
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