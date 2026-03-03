import React, { useState, useRef, useEffect } from 'react';

export type TextAlign = 'left' | 'center' | 'right';

interface DraggableTextProps {
  initialText?: string; // Make initialText optional
  text?: string; // Make text optional
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  textAlign: TextAlign;
  containerWidth: number;
  containerHeight: number;
  onUpdate: (data: { x: number; y: number; width: number; height: number; text: string }) => void;
  onSelect: () => void;
  isSelected: boolean;
}

export const DraggableText: React.FC<DraggableTextProps> = ({
  initialText,
  text: controlledText,
  
  x,
  y,
  width,
  height,
  fontSize,
  fontFamily,
  color,
  textAlign,
  containerWidth,
  containerHeight,
  onUpdate,
  onSelect,
  isSelected
}) => {
  const [text, setText] = useState(initialText || controlledText || '');
  const [isDragging, setIsDragging] = useState(false);
  const [resizeMode, setResizeMode] = useState<'none' | 'right' | 'corner-br' | 'corner-bl' | 'corner-tr' | 'corner-tl'>('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialDims, setInitialDims] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        
        let newX = initialDims.x + dx;
        let newY = initialDims.y + dy;

        // Boundaries
        newX = Math.max(0, Math.min(newX, containerWidth - initialDims.width));
        newY = Math.max(0, Math.min(newY, containerHeight - initialDims.height)); 

        onUpdate({ x: newX, y: newY, width: initialDims.width, height: initialDims.height, text: controlledText ?? text });
      } else if (resizeMode !== 'none') {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;

        let newWidth = initialDims.width;
        let newHeight = initialDims.height;
        let newX = initialDims.x;
        let newY = initialDims.y;

        // Min dimensions
        const MIN_SIZE = 30;

        if (resizeMode === 'right') {
            newWidth = Math.max(MIN_SIZE, initialDims.width + dx);
        } 
        else if (resizeMode === 'corner-br') {
            newWidth = Math.max(MIN_SIZE, initialDims.width + dx);
            newHeight = Math.max(MIN_SIZE, initialDims.height + dy);
        }
        else if (resizeMode === 'corner-bl') {
            const proposedWidth = initialDims.width - dx;
            if (proposedWidth >= MIN_SIZE) {
                newWidth = proposedWidth;
                newX = initialDims.x + dx;
            }
            newHeight = Math.max(MIN_SIZE, initialDims.height + dy);
        }
        else if (resizeMode === 'corner-tr') {
            newWidth = Math.max(MIN_SIZE, initialDims.width + dx);
            const proposedHeight = initialDims.height - dy;
            if (proposedHeight >= MIN_SIZE) {
                newHeight = proposedHeight;
                newY = initialDims.y + dy;
            }
        }
        else if (resizeMode === 'corner-tl') {
             const proposedWidth = initialDims.width - dx;
            if (proposedWidth >= MIN_SIZE) {
                newWidth = proposedWidth;
                newX = initialDims.x + dx;
            }
            const proposedHeight = initialDims.height - dy;
            if (proposedHeight >= MIN_SIZE) {
                newHeight = proposedHeight;
                newY = initialDims.y + dy;
            }
        }

        // Constraints
        if (newX < 0) newX = 0;
        if (newY < 0) newY = 0;
        if (newX + newWidth > containerWidth) newWidth = containerWidth - newX;
        if (newY + newHeight > containerHeight) newHeight = containerHeight - newY;
        
        onUpdate({ x: newX, y: newY, width: newWidth, height: newHeight, text: controlledText ?? text });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setResizeMode('none');
    };

    if (isDragging || resizeMode !== 'none') {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, resizeMode, dragStart, initialDims, containerWidth, containerHeight, onUpdate, text]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setInitialDims({ x, y, width, height });
  };

  const startResize = (e: React.MouseEvent, mode: typeof resizeMode) => {
    e.stopPropagation();
    e.preventDefault();
    setResizeMode(mode);
    setDragStart({ x: e.clientX, y: e.clientY });
    setInitialDims({ x, y, width, height });
  };

  return (
    <div
      ref={elementRef}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: width,
        height: height,
        cursor: isDragging ? 'grabbing' : 'grab',
        border: isSelected ? '1px dashed #6366f1' : '1px solid transparent',
        backgroundColor: isSelected ? 'rgba(0,0,0,0.2)' : 'transparent',
      }}
      className="group"
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        value={controlledText ?? text}
        onChange={(e) => {
          if (controlledText === undefined) {
            setText(e.target.value);
          }
          onUpdate({ x, y, width, height, text: e.target.value });
        }}
        style={{
          fontSize: `${fontSize}px`,
          fontFamily: fontFamily,
          color: color,
          lineHeight: 1.2,
          textAlign: textAlign,
          height: '100%',
          width: '100%',
          whiteSpace: 'pre-wrap',
          pointerEvents: isSelected ? 'auto' : 'none'
        }}
        className="bg-transparent resize-none outline-none overflow-hidden p-1 block"
        spellCheck={false}
      />

      {isSelected && (
        <>
          {/* Resize Handle (Right Side) */}
          <div
            className="absolute top-1/2 -right-1.5 w-3 h-3 bg-indigo-500 rounded-full cursor-ew-resize transform -translate-y-1/2 shadow-lg border border-white z-10"
            onMouseDown={(e) => startResize(e, 'right')}
          />
          
          {/* Corner Dots */}
          {/* Top Left */}
          <div 
            className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-indigo-500 rounded-full cursor-nwse-resize z-10 hover:bg-indigo-100" 
            onMouseDown={(e) => startResize(e, 'corner-tl')}
          />
          {/* Top Right */}
          <div 
            className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-indigo-500 rounded-full cursor-nesw-resize z-10 hover:bg-indigo-100" 
            onMouseDown={(e) => startResize(e, 'corner-tr')}
          />
          {/* Bottom Left */}
          <div 
            className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-indigo-500 rounded-full cursor-nesw-resize z-10 hover:bg-indigo-100" 
            onMouseDown={(e) => startResize(e, 'corner-bl')}
          />
          {/* Bottom Right */}
          <div 
            className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-indigo-500 rounded-full cursor-nwse-resize z-10 hover:bg-indigo-100" 
            onMouseDown={(e) => startResize(e, 'corner-br')}
          />
        </>
      )}
    </div>
  );
};