import React from 'react';

interface ProgressBarProps {
  progress: number;
  message: string;
  isVisible: boolean;
}

const ProgressBar = ({ progress, message, isVisible }: ProgressBarProps) => {
  if (!isVisible) return null;

  return (
    <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[300px] z-50">
      <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
        <div className="space-y-2">
          <div className="text-sm font-medium text-center mb-2">{message}</div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-300 ease-in-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-xs text-gray-500 text-center">
            {Math.round(progress * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
};
export default ProgressBar;