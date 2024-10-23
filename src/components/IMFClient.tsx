import React, { useEffect, useState, useRef, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import ProgressBar from "@/components/ui/progressbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import  PlaybackControls  from '@/components/ui/playback-controls';
import { Play, Pause, Square } from 'lucide-react';
import type * as tfjs from "@tensorflow/tfjs";

interface Video {
  id: number;
  name: string;
  frame_count: number;
}

interface VideoFrame {
  frame: string; // base64 encoded image
}

interface FeatureData {
  reference_features: number[][][];
  reference_token: number[];
  current_token: number[];
}

const IMFClient = () => {
  const [status, setStatus] = useState<string>("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);

  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [referenceFrame, setReferenceFrame] = useState<number>(0);
  const [currentFrameImage, setCurrentFrameImage] = useState<string | null>(
    null
  );
  const [referenceFrameImage, setReferenceFrameImage] = useState<string | null>(
    null
  );
  const [reconstructedImage, setReconstructedImage] = useState<string | null>(
    null
  );
  const wsRef = useRef<WebSocket | null>(null);
  const modelRef = useRef<any>(null);
  const [progress, setProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [showProgress, setShowProgress] = useState<boolean>(false);

  // Add new state variables for playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackStartFrame, setPlaybackStartFrame] = useState(0);
  const playbackRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const frameQueueRef = useRef<Array<{ current: number; reference: number }>>(
    []
  );
  const processingRef = useRef(false);

  // Initialize WebSocket connection
  const connect = useCallback(() => {
    try {
      console.log("Connecting to WebSocket...");
      setStatus("Connecting to server...");

      const ws = new WebSocket("wss://192.168.1.108:8000/ws");
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        setStatus(isModelLoaded ? "Ready" : "Loading model...");
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received message:", data);

          if (data.type === "frame_features") {
            await processFeatures(data.features);
          } else if (data.type === "error") {
            setError(data.message);
          }
        } catch (err) {
          console.error("Error processing message:", err);
          setError("Error processing message: " + err.toString());
        }
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        setStatus("Disconnected from server");
        // Attempt to reconnect after a delay
        setTimeout(connect, 3000);
      };

      ws.onerror = (error:any)  => {
        console.error("WebSocket error:", error);
        setError("WebSocket error: " + error.toString());
      };
    } catch (err) {
      console.error("Failed to connect:", err);
      setError("Failed to connect: " + err.toString());
      // Attempt to reconnect after a delay
      setTimeout(connect, 3000);
    }
  }, [isModelLoaded]);

  // Load TensorFlow.js and model
  // Modify the model loading function
  useEffect(() => {
    async function initializeModel() {
      try {
        setShowProgress(true);
        setProgressMessage("Initializing TensorFlow.js...");
        setProgress(0.1);

        const tf = await import("@tensorflow/tfjs");
        await import("@tensorflow/tfjs-backend-webgpu");

        setProgress(0.2);
        setProgressMessage("Setting up backend...");

        try {
          await tf.setBackend("webgpu");
          await tf.ready();
          console.log("Using WebGPU backend");
        } catch (error:any)  {
          console.warn("WebGPU not available, falling back to WebGL");
          await tf.setBackend("webgl");
          await tf.ready();
        }

        setProgress(0.4);
        setProgressMessage("Loading model...");

        const model = await tf.loadGraphModel(
          "/graph_model_client/model.json",
          {
            onProgress: (fraction) => {
              // Update progress from 40% to 90%
              setProgress(0.4 + fraction * 0.5);
            },
          }
        );

        setProgress(0.9);
        setProgressMessage("Initializing model...");

        await inspectModel(model);
        modelRef.current = model;
        setIsModelLoaded(true);

        setProgress(1);
        setProgressMessage("Model ready");

        // Hide progress bar after a short delay
        setTimeout(() => {
          setShowProgress(false);
          setStatus(isConnected ? "Ready" : "Connecting to server...");
        }, 500);
      } catch (err) {
        setError("Failed to initialize model: " + err.toString());
        setShowProgress(false);
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
      const response = await fetch("https://192.168.1.108:8000/videos");
      const data = await response.json();
      setVideos(data.videos);
    } catch (err) {
      setError("Failed to fetch videos list: " + err.toString());
    }
  };

  const processFrames = useCallback(async () => {
    console.log("🎬 Starting processFrames");
    console.log(
      `Selected Video: ${selectedVideo}, Current Frame: ${currentFrame}, Reference Frame: ${referenceFrame}`
    );

    if (!selectedVideo) {
      console.log("❌ No video selected, returning");
      return;
    }

    setIsLoading(true);
    console.log("⏳ Loading state set to true");

    try {
      console.log("🔄 Fetching frames...");
      console.log(
        `Fetching current frame ${currentFrame} and reference frame ${referenceFrame}`
      );

      const fetchStartTime = performance.now();
      const [currentImg, referenceImg] = await Promise.all([
        fetchFrame(selectedVideo, currentFrame),
        fetchFrame(selectedVideo, referenceFrame),
      ]);
      const fetchEndTime = performance.now();
      console.log(
        `✅ Frames fetched in ${(fetchEndTime - fetchStartTime).toFixed(2)}ms`
      );

      if (currentImg && referenceImg) {
        console.log("🖼️ Both frames fetched successfully");
        console.log("Setting frame images in state");
        setCurrentFrameImage(currentImg);
        setReferenceFrameImage(referenceImg);

        if (wsRef.current) {
          console.log(`WebSocket state: ${wsRef.current.readyState}`);
          console.log(
            `WebSocket states: CONNECTING(${WebSocket.CONNECTING}), OPEN(${WebSocket.OPEN}), CLOSING(${WebSocket.CLOSING}), CLOSED(${WebSocket.CLOSED})`
          );
        } else {
          console.log("❌ WebSocket ref is null");
        }

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const message = {
            type: "process_frames",
            video_id: selectedVideo,
            current_frame: currentFrame,
            reference_frame: referenceFrame,
          };
          console.log("📤 Sending WebSocket message:", message);

          wsRef.current.send(JSON.stringify(message));
          console.log("✅ Message sent successfully");
        } else {
          const error = "WebSocket is not connected";
          console.error("❌ WebSocket Error:", error);
          console.log(`WebSocket readyState: ${wsRef.current?.readyState}`);
          setError(error:any) ;
        }
      } else {
        console.error("❌ Failed to fetch one or both frames");
        console.log("Current frame image:", !!currentImg);
        console.log("Reference frame image:", !!referenceImg);
      }
    } catch (err) {
      console.error("❌ Error in processFrames:", err);
      console.error(
        "Error stack:",
        err instanceof Error ? err.stack : "No stack trace available"
      );
      setError("Failed to process frames: " + err.toString());
    } finally {
      console.log("⏳ Setting loading state to false");
      setIsLoading(false);
    }
  }, [selectedVideo, currentFrame, referenceFrame]);

  // Enhanced fetchFrame function with logging
  const fetchFrame = async (videoId: number, frameId: number) => {
    console.log(
      `🔄 Fetching frame - Video ID: ${videoId}, Frame ID: ${frameId}`
    );
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
      console.log(
        `✅ Frame fetched successfully in ${(endTime - startTime).toFixed(2)}ms`
      );

      return `data:image/png;base64,${data.frame}`;
    } catch (err) {
      console.error(
        `❌ Error fetching frame ${frameId} for video ${videoId}:`,
        err
      );
      setError("Failed to fetch frame: " + err.toString());
      return null;
    }
  };

  // Helper function to inspect model signature
  const inspectModel = async (model: tfjs.GraphModel) => {
    console.log("🔍 Model Signature:");
    if (model.modelSignature) {
      console.log("Inputs:", model.modelSignature.inputs);
      console.log("Outputs:", model.modelSignature.outputs);
    }

    console.log("🔍 Model Inputs:");
    model.inputs.forEach((input, idx) => {
      console.log(`Input ${idx}:`, {
        name: input.name,
        shape: input.shape,
        dtype: input.dtype,
      });
    });
  };

  // Enhanced processFeatures function with logging
 // Enhanced processFeatures function with proper tensor processing and metrics
 const processFeatures = async (features: FeatureData) => {
    const timing = {
      start: performance.now(),
      tensorPrep: 0,
      modelExecution: 0,
      postProcessing: 0,
      total: 0
    };
  
    if (!modelRef.current) {
      throw new Error('Model not loaded');
    }
  
    try {
      setIsLoading(true);
      const tf = await import('@tensorflow/tfjs');
      
      // Tensor preparation timing
      const prepStart = performance.now();
      
      // Prepare input tensors
      const currentToken = tf.tensor2d(
        Array.isArray(features.current_token[0]) 
          ? features.current_token 
          : [features.current_token], 
        [1, 32]
      ).asType('float32');
  
      const referenceToken = tf.tensor2d(
        Array.isArray(features.reference_token[0]) 
          ? features.reference_token 
          : [features.reference_token], 
        [1, 32]
      ).asType('float32');
  
      // Convert reference features with explicit shapes
      const referenceFeatures = features.reference_features.map((feature, idx) => {
        const shapes = [[1, 128, 64, 64], [1, 256, 32, 32], [1, 512, 16, 16], [1, 512, 8, 8]];
        return tf.tensor(feature, shapes[idx]).asType('float32');
      });
  
      timing.tensorPrep = performance.now() - prepStart;
  
      // Model execution
      const execStart = performance.now();
      const outputTensor = modelRef.current.execute({
        'args_0:0': currentToken,
        'args_0_1:0': referenceToken,
        'args_0_2': referenceFeatures[0],
        'args_0_3': referenceFeatures[1],
        'args_0_4': referenceFeatures[2],
        'args_0_5': referenceFeatures[3]
      });
      timing.modelExecution = performance.now() - execStart;
  
      // Post-processing with shape tracking
      const postStart = performance.now();
      
      const processedTensor = tf.tidy(() => {
        let tensor = outputTensor;
        console.log('Initial output shape:', tensor.shape);
  
        // If we have a rank-4 tensor (NCHW format)
        if (tensor.shape.length === 4) {
          // Convert from NCHW to NHWC if needed
          if (tensor.shape[1] === 3) {
            tensor = tf.transpose(tensor, [0, 2, 3, 1]);
            console.log('After NCHW->NHWC transpose:', tensor.shape);
          }
          
          // Remove batch dimension
          tensor = tensor.squeeze([0]);
          console.log('After removing batch dimension:', tensor.shape);
        }
  
        // At this point tensor should be rank 3: [height, width, channels]
        if (tensor.shape.length !== 3) {
          throw new Error(`Expected rank 3 tensor after processing, got shape: ${tensor.shape}`);
        }
  
        // Ensure proper RGB channel order if needed
        if (tensor.shape[2] === 3) {
          // Optional: swap BGR to RGB if needed
          // tensor = tf.concat([
          //   tensor.slice([0, 0, 2], [-1, -1, 1]),
          //   tensor.slice([0, 0, 1], [-1, -1, 1]),
          //   tensor.slice([0, 0, 0], [-1, -1, 1])
          // ], 2);
        }
  
        // Normalize values
        const min = tensor.min();
        const max = tensor.max();
        console.log('Value range:', {
          min: min.dataSync()[0],
          max: max.dataSync()[0]
        });
        
        const range = tf.maximum(max.sub(min), tf.scalar(1e-6));
        let normalizedTensor = tensor.sub(min).div(range);
  
        // Ensure output is in correct format for toPixels
        // Should be [height, width, channels] with values in [0, 1]
        normalizedTensor = tf.clipByValue(normalizedTensor, 0, 1);
        
        console.log('Final tensor shape:', normalizedTensor.shape);
        return normalizedTensor.asType('float32');
      });
  
      timing.postProcessing = performance.now() - postStart;
      timing.total = performance.now() - timing.start;
  
      // Log final tensor shape before conversion
      console.log('Tensor shape before toPixels:', processedTensor.shape);
  
      // Convert to image
      const canvas = document.createElement('canvas');
      canvas.width = processedTensor.shape[1];  // width
      canvas.height = processedTensor.shape[0]; // height
      await tf.browser.toPixels(processedTensor, canvas);
      
      // Log performance metrics
      console.log('Performance Metrics:', {
        tensorPreparation: `${timing.tensorPrep.toFixed(2)}ms`,
        modelExecution: `${timing.modelExecution.toFixed(2)}ms`,
        postProcessing: `${timing.postProcessing.toFixed(2)}ms`,
        total: `${timing.total.toFixed(2)}ms`
      });
  
      setReconstructedImage(canvas.toDataURL());
  
      // Cleanup
      [currentToken, referenceToken, ...referenceFeatures, outputTensor, processedTensor].forEach(t => t.dispose());
      
      return timing;
  
    } catch (err) {
      console.error('Processing error:', err);
      console.error('Error details:', {
        message: err.message,
        stack: err.stack
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Function to start playback
  const startPlayback = useCallback(() => {
    if (!selectedVideo) return;

    const video = videos.find((v) => v.id === selectedVideo);
    if (!video) return;

    setIsPlaying(true);
    setPlaybackStartFrame(currentFrame);
    lastFrameTimeRef.current = performance.now();

    // Initialize frame queue
    frameQueueRef.current = [];
    const totalFrames = Math.min(
      video.frame_count - currentFrame,
      300 // Limit to 10 seconds at 30fps
    );

    for (let i = 0; i < totalFrames; i++) {
      frameQueueRef.current.push({
        current: currentFrame + i,
        reference: referenceFrame,
      });
    }

    requestAnimationFrame(processNextFrame);
  }, [selectedVideo, currentFrame, referenceFrame, videos]);
  // Function to stop playback
  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current);
      playbackRef.current = null;
    }
    frameQueueRef.current = [];
    processingRef.current = false;
  }, []);

  // Process next frame in queue
  const processNextFrame = useCallback(
    async (timestamp: number) => {
      if (!isPlaying || frameQueueRef.current.length === 0) {
        stopPlayback();
        return;
      }

      const frameTime = 1000 / 30; // 33.33ms for 30fps
      const timeSinceLastFrame = timestamp - lastFrameTimeRef.current;

      if (timeSinceLastFrame >= frameTime && !processingRef.current) {
        processingRef.current = true;
        const nextFrames = frameQueueRef.current[0];

        try {
          setCurrentFrame(nextFrames.current);
          await processFrames();

          frameQueueRef.current.shift();
          lastFrameTimeRef.current = timestamp;
        } catch (error:any)  {
          console.error("Error processing frame:", error);
          stopPlayback();
          return;
        } finally {
          processingRef.current = false;
        }
      }

      playbackRef.current = requestAnimationFrame(processNextFrame);
    },
    [isPlaying, processFrames, stopPlayback]
  );

  // Update select component to use both isConnected and isModelLoaded
  const isReady = isConnected && isModelLoaded;
  // Enhanced video selection handler
  const handleVideoSelect = (value: string) => {
    console.log("🎬 Video selected:", value);
    const numericValue = Number(value);
    console.log("Converted value:", numericValue);

    const selectedVideoData = videos.find((v) => v.id === numericValue);
    console.log("Selected video data:", selectedVideoData);

    setSelectedVideo(numericValue);
    // Reset frame indices when selecting a new video
    setCurrentFrame(0);
    setReferenceFrame(0);
  };

  const handleReset = useCallback(() => {
    setCurrentFrame(playbackStartFrame);
    stopPlayback();
  }, [playbackStartFrame, stopPlayback]);
  
  const handleNextFrame = useCallback(() => {
    if (selectedVideo) {
      const video = videos.find(v => v.id === selectedVideo);
      if (video && currentFrame < video.frame_count - 1) {
        setCurrentFrame(prev => prev + 1);
        processFrames();
      }
    }
  }, [selectedVideo, videos, currentFrame, processFrames]);

  return (
    <Card className="w-full max-w-2xl">
      <ProgressBar
        progress={progress}
        message={progressMessage}
        isVisible={showProgress}
      />
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
                  <SelectValue
                    placeholder={
                      !isModelLoaded
                        ? "Loading model..."
                        : !isConnected
                        ? "Connecting to server..."
                        : videos.length === 0
                        ? "No videos available"
                        : "Select a video"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  {videos.map((video) => (
                    <SelectItem key={video.id} value={video.id.toString()}>
                      {video.name} ({video.frame_count} frames)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedVideo !== null && (
              <div className="space-y-4">

<PlaybackControls
      isPlaying={isPlaying}
      onPlay={startPlayback}
      onStop={stopPlayback}
      onReset={handleReset}
      onNextFrame={handleNextFrame}
      disabled={!isReady || isLoading}
      showFrameControls={true}
      currentFrame={currentFrame}
      totalFrames={videos.find(v => v.id === selectedVideo)?.frame_count || 0}
    />
                 {/* Add playback controls */}
              <div className="flex space-x-4 items-center">
              
                {isPlaying && (
                  <div className="text-sm">
                    Processing frame {currentFrame} 
                    ({frameQueueRef.current.length} frames remaining)
                  </div>
                )}
              </div>
                <div className="flex space-x-4">
                  <div className="flex-1">
                    <label className="text-sm font-medium">Current Frame</label>
                    <input
                      type="number"
                      min={0}
                      max={
                        videos.find((v) => v.id === selectedVideo)
                          ?.frame_count - 1 || 0
                      }
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
                    <label className="text-sm font-medium">
                      Reference Frame
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={
                        videos.find((v) => v.id === selectedVideo)
                          ?.frame_count - 1 || 0
                      }
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
                      isLoading,
                    });
                    processFrames();
                  }}
                  disabled={!isReady || isLoading}
                >
                  {isLoading ? "Processing..." : "Process Frames"}
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
                    <div className="font-medium text-sm">
                      Reconstructed Frame
                    </div>
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
