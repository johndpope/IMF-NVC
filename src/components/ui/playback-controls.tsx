import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Settings } from 'lucide-react';
import Button from '@/components/ui/button';

interface PlaybackControlsProps {
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onReset?: () => void;
  onNextFrame?: () => void;
  disabled?: boolean;
  showFrameControls?: boolean;
  currentFrame: number;
  totalFrames: number;
}

const PlaybackControls = ({
  isPlaying,
  onPlay,
  onStop,
  onReset,
  onNextFrame,
  disabled = false,
  showFrameControls = false,
  currentFrame,
  totalFrames
}: PlaybackControlsProps) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center space-x-2">
        {showFrameControls && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={disabled}
            leftIcon={<SkipBack className="w-4 h-4" />}
          >
            Reset
          </Button>
        )}
        
        <Button
          variant={isPlaying ? "destructive" : "primary"}
          size="md"
          onClick={isPlaying ? onStop : onPlay}
          disabled={disabled}
          leftIcon={isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        >
          {isPlaying ? 'Stop' : 'Play'}
        </Button>
        
        {showFrameControls && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onNextFrame}
            disabled={disabled || isPlaying}
            leftIcon={<SkipForward className="w-4 h-4" />}
          >
            Next Frame
          </Button>
        )}
      </div>
      
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>Frame: {currentFrame + 1} / {totalFrames}</span>
        {isPlaying && (
          <span className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
            Processing at 30 FPS
          </span>
        )}
      </div>
    </div>
  );
};

export default PlaybackControls;