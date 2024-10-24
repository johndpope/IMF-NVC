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
import PlaybackControls from '@/components/ui/playback-controls';
import { Play, Pause, Square } from 'lucide-react';
import type * as tfjs from "@tensorflow/tfjs";
import RTCNeuralCodec from './RTCNeuralCodec';


interface Video {
  id: number;
  name: string;
  frame_count: number;
}

interface VideoFrame {
  frame: string; // base64 encoded image
}


interface PlaybackControlsProps {
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onReset: () => void;
  onNextFrame: () => void;
  disabled: boolean;
  showFrameControls: boolean;
  currentFrame: number;
  totalFrames: number;
}

const globalInitState = {
  isInitializing: false,
  hasInitialized: false
};

type LoadingPhase = 'init' | 'model' | 'connection' | 'videos' | 'ready';


const NVCClient = () => {
  const [status, setStatus] = useState<string>("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isReady, setIsReady] = useState(false);

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
  const [isInitializing, setIsInitializing] = useState(false);
  const codecRef = useRef<RTCNeuralCodec | null>(null);
  const mountedRef = useRef(true);

  // Add state for tracking loading phase
  const [currentPhase, setCurrentPhase] = useState<LoadingPhase>('init');
  const [modelProgress, setModelProgress] = useState(0);

  // Add useEffect to manage ready state
useEffect(() => {
  // Consider the app ready when:
  // 1. Model is loaded
  // 2. Connection is established
  // 3. Videos are fetched
  // 4. Not currently showing progress
  const checkReady = () => {
    const ready = isModelLoaded && 
                 isConnected && 
                 videos.length > 0 && 
                 !showProgress;
    
    console.log('Checking ready state:', {
      isModelLoaded,
      isConnected,
      hasVideos: videos.length > 0,
      showProgress,
      ready
    });
    
    setIsReady(ready);
  };

  checkReady();
}, [isModelLoaded, isConnected, videos, showProgress]);

  // Add a useEffect to handle codec events
  useEffect(() => {
    if (codecRef.current) {
      // Set up codec event listeners
      codecRef.current.on('frameReady', (data) => {
        setReconstructedImage(data.imageUrl);
        setIsLoading(false);
      });

      codecRef.current.on('error', (error: any) => {
        setError(error.message);
        setIsLoading(false);
      });

      // Enhanced buffer status handler for model loading progress
      codecRef.current.on('bufferStatus', (status) => {
        if (mountedRef.current && currentPhase === 'model') {
          const progressValue = status.health / 100;
          setModelProgress(progressValue);
          setProgress(progressValue); // Update main progress bar
          console.log(`Model loading progress: ${status.health}%`);
        }
      });

      // Cleanup listeners on unmount
      return () => {
        if (codecRef.current) {
          codecRef.current.off('frameReady', () => { });
          codecRef.current.off('error', () => { });
          codecRef.current.off('bufferStatus', () => { });
        }
      };
    }
  }, [codecRef.current]);

  // Update codec initialization
  // Single initialization useEffect
  const initializationCompleteRef = useRef(false);
const cleanupInProgressRef = useRef(false);
// Consolidated initialization useEffect
useEffect(() => {
  const initCodec = async () => {
    // Check global initialization state
    if (globalInitState.isInitializing || globalInitState.hasInitialized) {
      console.log('Initialization already in progress or completed, skipping...');
      return;
    }

    globalInitState.isInitializing = true;
    console.log('Starting fresh initialization...');

    try {
      if (mountedRef.current) {
        setShowProgress(true);
        setProgressMessage('Initializing codec...');
        setProgress(0);
      }

      // Create codec instance
      codecRef.current = new RTCNeuralCodec({
        serverUrl: 'wss://192.168.1.108:8000/rtc',
        fps: 24,
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      // Set up event listeners
      codecRef.current.on('frameReady', (data) => {
        if (mountedRef.current) {
          setReconstructedImage(data.imageUrl);
          setIsLoading(false);
        }
      });

      codecRef.current.on('error', (error) => {
        if (mountedRef.current) {
          setError(error.message);
          setShowProgress(false);
        }
      });

      codecRef.current.on('bufferStatus', (status) => {
        if (mountedRef.current) {
          setProgress(status.health / 100);
        }
      });

      // Initialize model
      if (mountedRef.current) setProgressMessage('Loading neural codec model...');
      await codecRef.current.initModel('/graph_model_client/model.json');
      if (mountedRef.current) {
        setIsModelLoaded(true);
        setProgressMessage('Model loaded, establishing connection...');
      }

      // Connect
      if (mountedRef.current) setProgressMessage('Establishing connection...');
      await codecRef.current.connect('wss://192.168.1.108:8000/rtc');
      if (mountedRef.current) {
        setIsConnected(true);
        setProgressMessage('Connected, fetching videos...');
      }
      // Fetch videos
      if (mountedRef.current) setProgressMessage('Fetching videos...');
      const response = await fetch("https://192.168.1.108:8000/videos");
      const data = await response.json();
      if (mountedRef.current) {
        setVideos(data.videos);
        setProgressMessage('Ready');
        setShowProgress(false);
        setStatus('Connected and ready');
      }

      globalInitState.hasInitialized = true;

    } catch (err) {
      console.error('Initialization error:', err);
      if (mountedRef.current) {
        setError('Failed to initialize: ' + err.toString());
        setShowProgress(false);
        setIsModelLoaded(false);
        setProgressMessage('Initialization failed');
        setIsConnected(false);
      }
    } finally {
      globalInitState.isInitializing = false;
    }
  };

  initCodec();

  // Cleanup function
  return () => {
    mountedRef.current = false;
    
    // Don't cleanup codec on strict mode remount if we're still initializing
    if (!globalInitState.isInitializing && codecRef.current) {
      console.log('Running final cleanup...');
      codecRef.current.cleanup();
      codecRef.current = null;
    }
  };
}, []); // Empty dependency array

// Add a status tracking effect
useEffect(() => {
  const status = {
    modelLoaded: isModelLoaded,
    connected: isConnected,
    hasVideos: videos.length > 0,
    loading: isLoading,
  };

  console.log('Status update:', status);
}, [isModelLoaded, isConnected, videos.length, isLoading]);

// Development mode check
useEffect(() => {
  if (process.env.NODE_ENV === 'development') {
    console.log('Development mode - Strict Mode enabled');
    console.log('Global init state:', globalInitState);
  }
}, []);


  // Add this useEffect after the codec initialization useEffect:
  useEffect(() => {
    const initAndFetchData = async () => {
      if (codecRef.current) {
        try {
          // Fetch videos after codec is initialized
          const response = await fetch("https://192.168.1.108:8000/videos");
          const data = await response.json();
          setVideos(data.videos);
          setIsModelLoaded(true); // Set model loaded state after successful initialization
          setIsConnected(true); // Set connected state
        } catch (err: any) {
          setError("Failed to fetch videos list: " + err.toString());
        }
      }
    };

    initAndFetchData();
  }, [codecRef.current]); // Depend on codecRef.current

  // Update the video selection handler
  const handleVideoSelect = async (value: string) => {
    try {
      const videoId = Number(value);
      console.log("Selected video ID:", videoId);

      setIsLoading(true);
      setSelectedVideo(videoId);
      setCurrentFrame(0);
      setReferenceFrame(0);

      if (codecRef.current) {
        // Initialize playback for the selected video
        await codecRef.current.startPlayback(videoId);

        // Fetch initial frames
        const [currentImg, referenceImg] = await Promise.all([
          fetchFrame(videoId, 0), // Current frame
          fetchFrame(videoId, 0)  // Reference frame
        ]);

        if (currentImg && referenceImg) {
          setCurrentFrameImage(currentImg);
          setReferenceFrameImage(referenceImg);
        }
      }
    } catch (error: any) {
      console.error("Error selecting video:", error);
      setError("Failed to select video: " + error.toString());
    } finally {
      setIsLoading(false);
    }
  };

  // Update the fetchFrame function
  const fetchFrame = async (videoId: number, frameId: number) => {
    try {
      const url = `https://192.168.1.108:8000/videos/${videoId}/frames/${frameId}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: VideoFrame = await response.json();
      return `data:image/png;base64,${data.frame}`;
    } catch (err: any) {
      console.error(`Error fetching frame ${frameId} for video ${videoId}:`, err);
      setError("Failed to fetch frame: " + err.toString());
      return null;
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
          setError(error);
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

  // Playback control functions
  const startPlayback = useCallback(async () => {
    if (!codecRef.current || !selectedVideo) return;

    try {
      setIsPlaying(true);
      setIsLoading(true);

      // Start playback from current frame
      await codecRef.current.startPlayback(selectedVideo);

      // Update UI state
      setPlaybackStartFrame(currentFrame);

    } catch (error: any) {
      console.error('Playback error:', error);
      setError('Failed to start playback: ' + error.toString());
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }, [selectedVideo, currentFrame]);

  const stopPlayback = useCallback(() => {
    if (!codecRef.current) return;

    try {
      codecRef.current.pause();
      setIsPlaying(false);
    } catch (error: any) {
      console.error('Stop playback error:', error);
      setError('Failed to stop playback: ' + error.toString());
    }
  }, []);

  // Playback controls
  const handlePlay = () => {
    if (codecRef.current && selectedVideo) {
      setIsPlaying(true);
      codecRef.current.resume();
    }
  };

  const handleStop = () => {
    if (codecRef.current) {
      setIsPlaying(false);
      codecRef.current.pause();
    }
  };

  const handleReset = useCallback(() => {
    if (!codecRef.current) return;

    try {
      codecRef.current.stop();
      setCurrentFrame(0);
      setIsPlaying(false);
      setPlaybackStartFrame(0);

      // Reset frames
      setCurrentFrameImage(null);
      setReconstructedImage(null);
    } catch (error: any) {
      console.error('Reset error:', error);
      setError('Failed to reset: ' + error.toString());
    }
  }, []);

  const handleNextFrame = useCallback(async () => {
    if (!codecRef.current || !selectedVideo) return;

    try {
      setIsLoading(true);

      // Increment frame counter
      const nextFrame = currentFrame + 1;
      setCurrentFrame(nextFrame);

      // Process single frame
      await codecRef.current.processFrames();

      // Update frames
      const [currentImg, referenceImg] = await Promise.all([
        fetchFrame(selectedVideo, nextFrame),
        fetchFrame(selectedVideo, referenceFrame)
      ]);

      if (currentImg) setCurrentFrameImage(currentImg);
      if (referenceImg) setReferenceFrameImage(referenceImg);

    } catch (error: any) {
      console.error('Next frame error:', error);
      setError('Failed to process next frame: ' + error.toString());
    } finally {
      setIsLoading(false);
    }
  }, [selectedVideo, currentFrame, referenceFrame, fetchFrame]);

  // Update the Select component
  const SelectComponent = () => (
    <Select
      onValueChange={handleVideoSelect}
      disabled={!isReady || isLoading}
      value={selectedVideo?.toString() || ''}
    >
      <SelectTrigger className="w-full bg-background">
        <SelectValue
          placeholder={
            isLoading ? "Loading..." :
              !isModelLoaded ? "Initializing model..." :
                !isConnected ? "Connecting..." :
                  videos.length === 0 ? "No videos available" :
                    "Select a video"
          }
        />
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
  );

  // Add status indicator component
  const StatusIndicator = () => {
    const getStatusText = () => {
      if (showProgress) {
        return progressMessage; // Use the current progress message
      }
      if (!isModelLoaded) {
        return "Initializing...";
      }
      if (!isConnected) {
        return "Connecting...";
      }
      if (videos.length === 0) {
        return "Loading videos...";
      }
      if (isLoading) {
        return "Processing...";
      }
      return "Ready";
    };
  
    const getStatusColor = () => {
      if (error) return 'bg-red-500';
      if (!isReady || isLoading || showProgress) {
        return 'bg-yellow-500 animate-pulse';
      }
      return 'bg-green-500';
    };
  
    return (
      <div className="flex items-center space-x-2">
        <div className="text-sm font-medium">
          Status: {getStatusText()}
          {selectedVideo !== null && ` (Video ${selectedVideo} selected)`}
        </div>
        <div className="flex items-center space-x-1">
          <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
          <span className="text-xs text-gray-500">
            {error ? 'Error' : isReady ? 'Ready' : 'Loading...'}
          </span>
        </div>
      </div>
    );
  };
  

  const DebugPanel = () => (
    <div className="text-xs text-gray-500 mt-2">
      <div>Model Loaded: {isModelLoaded ? '✅' : '❌'}</div>
      <div>Connected: {isConnected ? '✅' : '❌'}</div>
      <div>Videos Loaded: {videos.length > 0 ? '✅' : '❌'}</div>
      <div>Ready: {isReady ? '✅' : '❌'}</div>
    </div>
  );

  return (
    <Card className="w-full max-w-2xl">
      {/* <DebugPanel/> */}
      <ProgressBar
        progress={modelProgress}
        message={progressMessage}
        isVisible={showProgress}
        phase={currentPhase}
      />
      <CardHeader>

        <CardTitle className="flex justify-between items-center">
          <span>NVC Video Processing</span>
          <StatusIndicator />
        </CardTitle>
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
                  className="mt-4"
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

export default NVCClient;
