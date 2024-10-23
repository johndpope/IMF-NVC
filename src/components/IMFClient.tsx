
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Video {
  id: number;
  name: string;
  frame_count: number;
}

interface VideoFrame {
  frame: string;  // base64 encoded image
}

const IMFClient = () => {
  const [status, setStatus] = useState<string>('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [referenceFrame, setReferenceFrame] = useState<number>(0);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch available videos
  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const response = await fetch('https://192.168.1.108:8000/videos');
        const data = await response.json();
        setVideos(data.videos);
      } catch (err) {
        setError('Failed to fetch videos list: ' + err.toString());
      }
    };
    fetchVideos();
  }, []);

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

  const connect = useCallback(() => {
    try {
      console.log('Connecting to WebSocket...');
      setStatus('Connecting...');
      
      const ws = new WebSocket('wss://192.168.1.108:8000/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setStatus('Connected');
        setError(null);
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
        setStatus('Disconnected');
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('WebSocket error: ' + error.toString());
      };

    } catch (err) {
      console.error('Failed to connect:', err);
      setError('Failed to connect: ' + err.toString());
    }
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const processFrames = useCallback(async () => {
    if (!selectedVideo) return;
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'process_frames',
        video_id: selectedVideo,
        current_frame: currentFrame,
        reference_frame: referenceFrame
      }));
      
      // Update preview
      const frameImage = await fetchFrame(selectedVideo, currentFrame);
      if (frameImage) {
        setPreviewImage(frameImage);
      }
    } else {
      setError('WebSocket is not connected');
    }
  }, [selectedVideo, currentFrame, referenceFrame]);

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
            <Select 
              onValueChange={(value) => setSelectedVideo(Number(value))}
              disabled={!isConnected}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a video" />
              </SelectTrigger>
              <SelectContent>
                {videos.map((video) => (
                  <SelectItem key={video.id} value={video.id.toString()}>
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

            {previewImage && (
              <div className="space-y-2">
                <div className="font-medium text-sm">Current Frame Preview</div>
                <img 
                  src={previewImage}
                  alt="Frame preview"
                  className="w-full rounded-lg border border-gray-200"
                />
              </div>
            )}

            <button
              className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
              onClick={processFrames}
              disabled={!isConnected || selectedVideo === null}
            >
              Process Frames
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default IMFClient;