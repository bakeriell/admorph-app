import React, { useState, useRef, useEffect } from 'react';

interface TextOverlayData {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
  fontFamily: string;
  color: string;
}

interface ImageViewerProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string | null;
  altText?: string;
  overlay?: TextOverlayData | null;
  editorDims?: { width: number; height: number } | null;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ 
  isOpen, 
  onClose, 
  imageSrc, 
  altText = "Full size view",
  overlay,
  editorDims
}) => {
  const [displayedDims, setDisplayedDims] = useState({ width: 0, height: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Reset dims when opening
      setDisplayedDims({ width: 0, height: 0 });
    }
  }, [isOpen]);

  if (!isOpen || !imageSrc) return null;

  const handleImageLoad = () => {
    if (imageRef.current) {
      setDisplayedDims({
        width: imageRef.current.offsetWidth,
        height: imageRef.current.offsetHeight
      });
    }
  };

  // Calculate scaling factor if we have both editor and displayed dimensions
  const scale = editorDims && displayedDims.width > 0 
    ? displayedDims.width / editorDims.width 
    : 1;

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-3 transition-all z-[110] border border-white/10"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="relative inline-block max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
        <img 
          ref={imageRef}
          src={imageSrc} 
          alt={altText} 
          className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl select-none"
          onLoad={handleImageLoad}
        />
        
        {/* Static Overlay for Viewer */}
        {overlay && displayedDims.width > 0 && (
          <div
            style={{
              position: 'absolute',
              left: overlay.x * scale,
              top: overlay.y * scale,
              width: overlay.width * scale,
              height: overlay.height * scale,
              pointerEvents: 'none',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                fontSize: `${overlay.fontSize * scale}px`,
                fontFamily: overlay.fontFamily,
                color: overlay.color,
                lineHeight: 1.2,
                textAlign: overlay.textAlign,
                width: '100%',
                height: '100%',
                whiteSpace: 'pre-wrap',
                textShadow: '0 2px 4px rgba(0,0,0,0.5)'
              }}
            >
              {overlay.text}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
