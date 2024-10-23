import React, { useEffect, useState, useRef,useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type * as tfjs from '@tensorflow/tfjs';
interface FeatureData {
  reference_features: number[][][];
  reference_token: number[];
  current_token: number[];
}

const IMFClient = () => {
  const [status, setStatus] = useState<string>('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [totalFrames, setTotalFrames] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const modelRef = useRef<any>(null);
  const [reconstructedImage, setReconstructedImage] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 3000;
  const connect = useCallback(() => {
    try {
      console.log('Attempting to connect to WebSocket...');
      setStatus('Connecting...');
      
      const ws = new WebSocket('wss://192.168.1.108:8000/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected successfully');
        setIsConnected(true);
        setStatus('Connected to server');
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);
          if (data.type === 'frame_features') {
            await processFeatures(data.features);
          }
        } catch (err) {
          console.error('Error processing message:', err);
          setError('Error processing message: ' + err.toString());
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event);
        setIsConnected(false);
        setStatus('Disconnected from server');
        
        // Attempt to reconnect if not intentionally closed
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          console.log(`Attempting to reconnect... (${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current += 1;
            connect();
          }, RECONNECT_DELAY);
        } else {
          setError('Maximum reconnection attempts reached. Please refresh the page.');
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('WebSocket error: ' + error.toString());
      };

    } catch (err) {
      console.error('Failed to connect:', err);
      setError('Failed to connect to server: ' + err.toString());
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const processFeatures = async (features: FeatureData) => {
    if (!modelRef.current) {
      setError('Model not loaded');
      return;
    }

    try {
      const tf = await import('@tensorflow/tfjs');
      
      // Convert features to tensors
      const referenceFeatures = features.reference_features.map(f => 
        tf.tensor(f)
      );
      const referenceToken = tf.tensor(features.reference_token);
      const currentToken = tf.tensor(features.current_token);

      // Run inference
      const outputTensor = modelRef.current.execute({
        'reference_features': referenceFeatures,
        'reference_token': referenceToken,
        'current_token': currentToken
      });

      // Process output tensor
      const processedTensor = tf.tidy(() => {
        // Normalize to [0, 1] range
        const normalized = tf.add(outputTensor, 0.5);
        return tf.clipByValue(normalized, 0, 1);
      });

      // Convert to image
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      await tf.browser.toPixels(processedTensor as tfjs.Tensor3D, canvas);
      
      setReconstructedImage(canvas.toDataURL());
      
      // Cleanup
      outputTensor.dispose();
      processedTensor.dispose();
      referenceFeatures.forEach(t => t.dispose());
      referenceToken.dispose();
      currentToken.dispose();
      
    } catch (err) {
      setError('Processing error: ' + err.toString());
    }
  };

  const requestNextFrame = () => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify({
        type: 'request_frame',
        frame_index: currentFrame,
        reference_frame_index: 0
      }));
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>IMF Video Processing</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-sm font-medium">Status: {status}</div>
          
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            {reconstructedImage && (
              <div className="space-y-2">
                <div className="font-medium">Reconstructed Frame</div>
                <img 
                  src={reconstructedImage} 
                  alt="Reconstructed frame"
                  className="w-full rounded-lg border border-gray-200"
                />
              </div>
            )}

            <button
              className="px-4 py-2 bg-blue-500 text-white rounded-lg"
              onClick={requestNextFrame}
              disabled={!isConnected}
            >
              Next Frame
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default IMFClient;