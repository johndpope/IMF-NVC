import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Settings } from 'lucide-react';
import  Button  from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  className?: string;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  onPlay,
  onStop,
  onReset,
  onNextFrame,
  disabled = false,
  showFrameControls = false,
  currentFrame,
  totalFrames,
  className
}) => {
  // Format frame count for display
  const formattedCurrentFrame = (currentFrame + 1).toString().padStart(4, '0');
  const formattedTotalFrames = totalFrames.toString().padStart(4, '0');

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-center space-x-2">
        {showFrameControls && (
          <Button
            variant="outline"
            size="icon"
            onClick={onReset}
            disabled={disabled}
            className="w-9 h-9"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
        )}
        
        <Button
          variant={isPlaying ? "destructive" : "default"}
          size="default"
          onClick={isPlaying ? onStop : onPlay}
          disabled={disabled}
          className="min-w-[100px]"
        >
          {isPlaying ? (
            <>
              <Pause className="h-4 w-4 mr-2" />
              Stop
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Play
            </>
          )}
        </Button>
        
        {showFrameControls && (
          <Button
            variant="outline"
            size="icon"
            onClick={onNextFrame}
            disabled={disabled || isPlaying}
            className="w-9 h-9"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
          <span className="font-mono">
            {formattedCurrentFrame} / {formattedTotalFrames}
          </span>
        </div>

        {isPlaying && (
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm text-muted-foreground">
              Processing 30 FPS
            </span>
          </div>
        )}
      </div>

      {/* Optional progress bar */}
      <div className="h-1 bg-secondary rounded-full overflow-hidden">
        <div 
          className="h-full bg-primary transition-all duration-300"
          style={{ 
            width: `${(currentFrame / (totalFrames - 1)) * 100}%` 
          }}
        />
      </div>
    </div>
  );
};

export default PlaybackControls;