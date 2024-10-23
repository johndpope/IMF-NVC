import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type * as tfjs from '@tensorflow/tfjs';

interface Video {
  id: number;
  name: string;
  frame_count: number;
}

interface VideoFrame {
  frame: string;  // base64 encoded image
}

interface FeatureData {
    reference_features: number[][][];
    reference_token: number[];
    current_token: number[];
}

const IMFClient = () => {
  const [status, setStatus] = useState<string>('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);

  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [referenceFrame, setReferenceFrame] = useState<number>(0);
  const [currentFrameImage, setCurrentFrameImage] = useState<string | null>(null);
  const [referenceFrameImage, setReferenceFrameImage] = useState<string | null>(null);
  const [reconstructedImage, setReconstructedImage] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const modelRef = useRef<any>(null);

   // Initialize WebSocket connection
   const connect = useCallback(() => {
    try {
      console.log('Connecting to WebSocket...');
      setStatus('Connecting to server...');
      
      const ws = new WebSocket('wss://192.168.1.108:8000/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setStatus(isModelLoaded ? 'Ready' : 'Loading model...');
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);
          
          if (data.type === 'frame_features') {
            await processFeatures(data.features);
          } else if (data.type === 'error') {
            setError(data.message);
          }
        } catch (err) {
          console.error('Error processing message:', err);
          setError('Error processing message: ' + err.toString());
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        setStatus('Disconnected from server');
        // Attempt to reconnect after a delay
        setTimeout(connect, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('WebSocket error: ' + error.toString());
      };

    } catch (err) {
      console.error('Failed to connect:', err);
      setError('Failed to connect: ' + err.toString());
      // Attempt to reconnect after a delay
      setTimeout(connect, 3000);
    }
  }, [isModelLoaded]);

  // Load TensorFlow.js and model
  useEffect(() => {
    async function initializeModel() {
      try {
        const tf = await import('@tensorflow/tfjs');
        await import('@tensorflow/tfjs-backend-webgpu');
        
        try {
          await tf.setBackend('webgpu');
          await tf.ready();
          console.log('Using WebGPU backend');
        } catch (error) {
          console.warn('WebGPU not available, falling back to WebGL');
          await tf.setBackend('webgl');
          await tf.ready();
        }

        setStatus('Loading model...');
        const model = await tf.loadGraphModel('/graph_model/model.json');
        modelRef.current = model;
        setIsModelLoaded(true);
        setStatus(isConnected ? 'Ready' : 'Connecting to server...');
      } catch (err) {
        setError('Failed to initialize model: ' + err.toString());
      }
    }
    initializeModel();
  }, []);


  // Connect WebSocket and fetch videos after model is loaded
  useEffect(() => {
    if (isModelLoaded) {
      connect();
      fetchVideos();
    }
  }, [isModelLoaded, connect]);

  // Fetch available videos
  const fetchVideos = async () => {
    try {
      const response = await fetch('https://192.168.1.108:8000/videos');
      const data = await response.json();
      setVideos(data.videos);
    } catch (err) {
      setError('Failed to fetch videos list: ' + err.toString());
    }
  };
  
  const fetchFrame = async (videoId: number, frameId: number) => {
    try {
      const response = await fetch(`https://192.168.1.108:8000/videos/${videoId}/frames/${frameId}`);
      const data: VideoFrame = await response.json();
      return `data:image/png;base64,${data.frame}`;
    } catch (err) {
      setError('Failed to fetch frame: ' + err.toString());
      return null;
    }
  };

  const processFeatures = async (features: FeatureData) => {
    if (!modelRef.current) {
      setError('Model not loaded');
      return;
    }

    try {
      setIsLoading(true);
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
        let tensor = outputTensor;
        
        // Handle NCHW to NHWC format if needed
        if (tensor.shape[1] === 3) {
          tensor = tf.transpose(tensor, [0, 2, 3, 1]);
        }
        
        // Remove batch dimension if present
        if (tensor.shape[0] === 1) {
          tensor = tensor.squeeze([0]);
        }
        
        // Normalize to [0, 1] range
        const minVal = tensor.min();
        const maxVal = tensor.max();
        const normalizedTensor = tensor.sub(minVal).div(maxVal.sub(minVal));
        
        return normalizedTensor.asType('float32');
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
    } finally {
      setIsLoading(false);
    }
};

  const processFrames = useCallback(async () => {
    if (!selectedVideo) return;
    
    setIsLoading(true);
    try {
      // Fetch both frames
      const [currentImg, referenceImg] = await Promise.all([
        fetchFrame(selectedVideo, currentFrame),
        fetchFrame(selectedVideo, referenceFrame)
      ]);
      
      if (currentImg && referenceImg) {
        setCurrentFrameImage(currentImg);
        setReferenceFrameImage(referenceImg);
        
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'process_frames',
            video_id: selectedVideo,
            current_frame: currentFrame,
            reference_frame: referenceFrame
          }));
        } else {
          setError('WebSocket is not connected');
        }
      }
    } catch (err) {
      setError('Failed to process frames: ' + err.toString());
    } finally {
      setIsLoading(false);
    }
  }, [selectedVideo, currentFrame, referenceFrame]);

    // Update select component to use both isConnected and isModelLoaded
    const isReady = isConnected && isModelLoaded;

    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>IMF Video Processing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="text-sm font-medium">Status: {status}</div>
            
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
  
            <div className="space-y-4">
            <Select 
                onValueChange={(value) => setSelectedVideo(Number(value))}
                disabled={!isReady}
                >
                <SelectTrigger className="w-full bg-white dark:bg-gray-800">
                    <SelectValue placeholder={
                    !isModelLoaded ? "Loading model..." :
                    !isConnected ? "Connecting to server..." :
                    "Select a video"
                    } />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-gray-800 border shadow-lg">
                    {videos.map((video) => (
                    <SelectItem 
                        key={video.id} 
                        value={video.id.toString()}
                        className="hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        {video.name} ({video.frame_count} frames)
                    </SelectItem>
                    ))}
                </SelectContent>
                </Select>

            {selectedVideo !== null && (
              <div className="flex space-x-4">
                <div className="flex-1">
                  <label className="text-sm font-medium">Current Frame</label>
                  <input
                    type="number"
                    min={0}
                    max={videos[selectedVideo]?.frame_count - 1}
                    value={currentFrame}
                    onChange={(e) => setCurrentFrame(Number(e.target.value))}
                    className="w-full mt-1 p-2 border rounded"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">Reference Frame</label>
                  <input
                    type="number"
                    min={0}
                    max={videos[selectedVideo]?.frame_count - 1}
                    value={referenceFrame}
                    onChange={(e) => setReferenceFrame(Number(e.target.value))}
                    className="w-full mt-1 p-2 border rounded"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Reference Frame */}
              <div className="space-y-2">
                <div className="font-medium text-sm">Reference Frame</div>
                {referenceFrameImage ? (
                  <img 
                    src={referenceFrameImage} 
                    alt="Reference frame"
                    className="w-full rounded-lg border border-gray-200"
                  />
                ) : (
                  <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
                    No reference frame
                  </div>
                )}
              </div>

              {/* Current Frame */}
              <div className="space-y-2">
                <div className="font-medium text-sm">Current Frame</div>
                {currentFrameImage ? (
                  <img 
                    src={currentFrameImage} 
                    alt="Current frame"
                    className="w-full rounded-lg border border-gray-200"
                  />
                ) : (
                  <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
                    No current frame
                  </div>
                )}
              </div>

              {/* Reconstructed Frame */}
              <div className="space-y-2">
                <div className="font-medium text-sm">Reconstructed Frame</div>
                {isLoading ? (
                  <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
                    Processing...
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

            <button
              className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
              onClick={processFrames}
              disabled={!isReady || selectedVideo === null || isLoading}
            >
              {isLoading ? 'Processing...' : 'Process Frames'}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default IMFClient;