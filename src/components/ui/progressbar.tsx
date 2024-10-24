import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  progress: number;
  message: string;
  isVisible: boolean;
  phase: 'init' | 'model' | 'connection' | 'videos' | 'ready';
  className?: string;
}

const ProgressBar = ({ progress, message, isVisible, phase, className }: ProgressBarProps) => {
  if (!isVisible) return null;

  // Ensure progress is between 0 and 1
  const normalizedProgress = Math.max(0, Math.min(1, progress));
  const percentage = Math.round(normalizedProgress * 100);

  return (
    <div className={cn(
      "fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2",
      "w-[300px] bg-white rounded-lg shadow-lg",
      "p-6",
      className
    )}>
      <div className="space-y-4">
        {/* Message */}
        <div className="text-base text-center text-black">
          {message}
        </div>

        {/* Only show percentage during model loading */}
        {phase === 'model' && (
          <div className="text-2xl font-medium text-center text-black">
            {percentage}%
          </div>
        )}

        {/* Show indeterminate loading for other phases */}
        {phase !== 'model' && (
          <div className="flex justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
};

export default ProgressBar;