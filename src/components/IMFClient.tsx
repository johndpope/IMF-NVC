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
  


const processFrames = useCallback(async () => {
    console.log("🎬 Starting processFrames");
    console.log(`Selected Video: ${selectedVideo}, Current Frame: ${currentFrame}, Reference Frame: ${referenceFrame}`);
    
    if (!selectedVideo) {
        console.log("❌ No video selected, returning");
        return;
    }
    
    setIsLoading(true);
    console.log("⏳ Loading state set to true");
    
    try {
        console.log("🔄 Fetching frames...");
        console.log(`Fetching current frame ${currentFrame} and reference frame ${referenceFrame}`);
        
        const fetchStartTime = performance.now();
        const [currentImg, referenceImg] = await Promise.all([
            fetchFrame(selectedVideo, currentFrame),
            fetchFrame(selectedVideo, referenceFrame)
        ]);
        const fetchEndTime = performance.now();
        console.log(`✅ Frames fetched in ${(fetchEndTime - fetchStartTime).toFixed(2)}ms`);
        
        if (currentImg && referenceImg) {
            console.log("🖼️ Both frames fetched successfully");
            console.log("Setting frame images in state");
            setCurrentFrameImage(currentImg);
            setReferenceFrameImage(referenceImg);
            
            if (wsRef.current) {
                console.log(`WebSocket state: ${wsRef.current.readyState}`);
                console.log(`WebSocket states: CONNECTING(${WebSocket.CONNECTING}), OPEN(${WebSocket.OPEN}), CLOSING(${WebSocket.CLOSING}), CLOSED(${WebSocket.CLOSED})`);
            } else {
                console.log("❌ WebSocket ref is null");
            }
            
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'process_frames',
                    video_id: selectedVideo,
                    current_frame: currentFrame,
                    reference_frame: referenceFrame
                };
                console.log("📤 Sending WebSocket message:", message);
                
                wsRef.current.send(JSON.stringify(message));
                console.log("✅ Message sent successfully");
            } else {
                const error = 'WebSocket is not connected';
                console.error("❌ WebSocket Error:", error);
                console.log(`WebSocket readyState: ${wsRef.current?.readyState}`);
                setError(error);
            }
        } else {
            console.error("❌ Failed to fetch one or both frames");
            console.log("Current frame image:", !!currentImg);
            console.log("Reference frame image:", !!referenceImg);
        }
    } catch (err) {
        console.error("❌ Error in processFrames:", err);
        console.error("Error stack:", err instanceof Error ? err.stack : "No stack trace available");
        setError('Failed to process frames: ' + err.toString());
    } finally {
        console.log("⏳ Setting loading state to false");
        setIsLoading(false);
    }
}, [selectedVideo, currentFrame, referenceFrame]);

// Enhanced fetchFrame function with logging
const fetchFrame = async (videoId: number, frameId: number) => {
    console.log(`🔄 Fetching frame - Video ID: ${videoId}, Frame ID: ${frameId}`);
    const startTime = performance.now();
    
    try {
        const url = `https://192.168.1.108:8000/videos/${videoId}/frames/${frameId}`;
        console.log(`📡 Fetching from URL: ${url}`);
        
        const response = await fetch(url);
        console.log(`Response status: ${response.status}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data: VideoFrame = await response.json();
        const endTime = performance.now();
        console.log(`✅ Frame fetched successfully in ${(endTime - startTime).toFixed(2)}ms`);
        
        return `data:image/png;base64,${data.frame}`;
    } catch (err) {
        console.error(`❌ Error fetching frame ${frameId} for video ${videoId}:`, err);
        setError('Failed to fetch frame: ' + err.toString());
        return null;
    }
};

// Enhanced processFeatures function with logging
const processFeatures = async (features: FeatureData) => {
    console.log("🎯 Starting processFeatures");
    
    if (!modelRef.current) {
        console.error("❌ Model not loaded");
        setError('Model not loaded');
        return;
    }

    try {
        setIsLoading(true);
        console.log("⏳ Loading state set to true");
        
        const tf = await import('@tensorflow/tfjs');
        console.log("✅ TensorFlow.js imported");
        
        console.log("📊 Converting features to tensors");
        console.log("Reference features shape:", features.reference_features.map(f => f.length));
        console.log("Reference token length:", features.reference_token.length);
        console.log("Current token length:", features.current_token.length);
        
        const startTime = performance.now();
        
        // Convert features to tensors
        const referenceFeatures = features.reference_features.map(f => {
            const tensor = tf.tensor(f);
            console.log(`Reference feature tensor shape: ${tensor.shape}`);
            return tensor;
        });
        const referenceToken = tf.tensor(features.reference_token);
        const currentToken = tf.tensor(features.current_token);
        
        console.log("✅ Tensors created");
        console.log("Reference token shape:", referenceToken.shape);
        console.log("Current token shape:", currentToken.shape);

        // Run inference
        console.log("🔄 Running model inference");
        const outputTensor = modelRef.current.execute({
            'reference_features': referenceFeatures,
            'reference_token': referenceToken,
            'current_token': currentToken
        });
        
        console.log("Output tensor shape:", outputTensor.shape);

        // Process output tensor
        console.log("🔄 Processing output tensor");
        const processedTensor = tf.tidy(() => {
            let tensor = outputTensor;
            console.log("Initial tensor shape:", tensor.shape);
            
            if (tensor.shape[1] === 3) {
                tensor = tf.transpose(tensor, [0, 2, 3, 1]);
                console.log("After transpose shape:", tensor.shape);
            }
            
            if (tensor.shape[0] === 1) {
                tensor = tensor.squeeze([0]);
                console.log("After squeeze shape:", tensor.shape);
            }
            
            // Log tensor stats
            const stats = tf.tidy(() => ({
                min: tensor.min().dataSync()[0],
                max: tensor.max().dataSync()[0],
                mean: tensor.mean().dataSync()[0]
            }));
            console.log("Tensor stats before normalization:", stats);
            
            const normalizedTensor = tensor.sub(tensor.min()).div(tensor.max().sub(tensor.min()));
            return normalizedTensor.asType('float32');
        });

        const endTime = performance.now();
        console.log(`✅ Processing completed in ${(endTime - startTime).toFixed(2)}ms`);
        
        // Convert to image
        console.log("🖼️ Converting tensor to image");
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        await tf.browser.toPixels(processedTensor as tf.Tensor3D, canvas);
        
        console.log("✅ Setting reconstructed image");
        setReconstructedImage(canvas.toDataURL());
        
        // Cleanup
        console.log("🧹 Cleaning up tensors");
        outputTensor.dispose();
        processedTensor.dispose();
        referenceFeatures.forEach(t => t.dispose());
        referenceToken.dispose();
        currentToken.dispose();
        
    } catch (err) {
        console.error("❌ Error in processFeatures:", err);
        console.error("Error stack:", err instanceof Error ? err.stack : "No stack trace available");
        setError('Processing error: ' + err.toString());
    } finally {
        console.log("⏳ Setting loading state to false");
        setIsLoading(false);
    }
};

    // Update select component to use both isConnected and isModelLoaded
    const isReady = isConnected && isModelLoaded;
 // Enhanced video selection handler
 const handleVideoSelect = (value: string) => {
    console.log("🎬 Video selected:", value);
    const numericValue = Number(value);
    console.log("Converted value:", numericValue);
    
    const selectedVideoData = videos.find(v => v.id === numericValue);
    console.log("Selected video data:", selectedVideoData);
    
    setSelectedVideo(numericValue);
    // Reset frame indices when selecting a new video
    setCurrentFrame(0);
    setReferenceFrame(0);
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>IMF Video Processing</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="text-sm font-medium">
            Status: {status}
            {selectedVideo !== null && ` (Video ${selectedVideo} selected)`}
          </div>
          
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Video</label>
              <Select 
                onValueChange={handleVideoSelect}
                disabled={!isReady}
                value={selectedVideo?.toString()}
              >
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder={
                    !isModelLoaded ? "Loading model..." :
                    !isConnected ? "Connecting to server..." :
                    videos.length === 0 ? "No videos available" :
                    "Select a video"
                  } />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  {videos.map((video) => (
                    <SelectItem 
                      key={video.id} 
                      value={video.id.toString()}
                    >
                      {video.name} ({video.frame_count} frames)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedVideo !== null && (
              <div className="space-y-4">
                <div className="flex space-x-4">
                  <div className="flex-1">
                    <label className="text-sm font-medium">Current Frame</label>
                    <input
                      type="number"
                      min={0}
                      max={videos.find(v => v.id === selectedVideo)?.frame_count - 1 || 0}
                      value={currentFrame}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        console.log("Setting current frame:", value);
                        setCurrentFrame(value);
                      }}
                      className="w-full mt-1 p-2 border rounded"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-sm font-medium">Reference Frame</label>
                    <input
                      type="number"
                      min={0}
                      max={videos.find(v => v.id === selectedVideo)?.frame_count - 1 || 0}
                      value={referenceFrame}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        console.log("Setting reference frame:", value);
                        setReferenceFrame(value);
                      }}
                      className="w-full mt-1 p-2 border rounded"
                    />
                  </div>
                </div>

                <button
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
                  onClick={() => {
                    console.log("Process button clicked");
                    console.log("Current state:", {
                      selectedVideo,
                      currentFrame,
                      referenceFrame,
                      isReady,
                      isLoading
                    });
                    processFrames();
                  }}
                  disabled={!isReady || isLoading}
                >
                  {isLoading ? 'Processing...' : 'Process Frames'}
                </button>

                {/* Image display grid */}
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
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default IMFClient;