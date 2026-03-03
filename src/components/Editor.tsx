import React, { useState, useRef, useEffect } from 'react';
import { EditorState, AspectRatio } from '../types';
import { Button } from './Button';
import { generateFormatConversion, extractLegalText, repositionContent, detectMovableElements, DetectedElement, removeObjectFromImage, segmentElement } from '../services/geminiService';
import { DraggableText, TextAlign } from './DraggableText';
import { ImageViewer } from './ImageViewer';

interface EditorProps {
  originalImage: string | null;
  onReset: () => void;
}

interface TextOverlayData {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  textAlign: TextAlign;
  fontFamily: string;
  color: string;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface HistoryState {
  image: string;
  disclaimer: TextOverlayData | null;
}

type RepositionMode = 'MANUAL' | 'AUTO';

const AVAILABLE_FONTS = [
  'Inter', 
  'Montserrat',
  'Arial', 
  'Verdana', 
  'Times New Roman', 
  'Georgia', 
  'Courier New',
  'Brush Script MT',
  'Trebuchet MS',
  'Comic Sans MS'
];

const PRESET_COLORS = [
  '#FFFFFF', '#000000', '#F43F5E', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'
];

// Helper to render text on canvas (shared by Download and Apply)
const renderTextOnCanvas = (ctx: CanvasRenderingContext2D, data: TextOverlayData, scale: number) => {
  ctx.save();
  
  const fontSize = Math.round(data.fontSize * scale);
  const fontFamily = data.fontFamily.includes(' ') ? `"${data.fontFamily}"` : data.fontFamily;
  // Fallback to sans-serif if font fails, but prioritize the selected font
  ctx.font = `${fontSize}px ${fontFamily}, system-ui, sans-serif`;
  ctx.fillStyle = data.color;
  ctx.textBaseline = 'top';
  ctx.textAlign = data.textAlign;
  
  // Add a subtle drop shadow for better legibility if color is light, or less if dark
  // Simple heuristic: if color is white/light, add dark shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  const lineHeight = fontSize * 1.2;
  const padding = 4 * scale; // Matches p-1 (4px) in DraggableText
  const maxWidth = Math.max(1, (data.width * scale) - (2 * padding));
  
  let x = (data.x * scale);
  let y = (data.y * scale) + padding;

  if (data.textAlign === 'left') {
      x += padding;
  } else if (data.textAlign === 'center') {
      x += (data.width * scale) / 2;
  } else if (data.textAlign === 'right') {
      x += (data.width * scale) - padding;
  }

  // Split by newlines first to respect manual line breaks
  const paragraphs = data.text.split('\n');
  
  paragraphs.forEach(paragraph => {
      // Handle empty lines (just advance Y)
      if (paragraph.trim() === '' && paragraph.length === 0) {
          y += lineHeight;
          return;
      }

      const words = paragraph.split(' ');
      let line = '';
      
      for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const metrics = ctx.measureText(testLine);
          const testWidth = metrics.width;
          
          if (testWidth > maxWidth && n > 0) {
              ctx.fillText(line, x, y);
              line = words[n] + ' ';
              y += lineHeight;
          } else {
              line = testLine;
          }
      }
      ctx.fillText(line, x, y);
      y += lineHeight;
  });
  
  ctx.restore();
};

export const Editor: React.FC<EditorProps> = ({ originalImage, onReset }) => {
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [status, setStatus] = useState<EditorState>(EditorState.READY);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [selectedRatio, setSelectedRatio] = useState<AspectRatio>(AspectRatio.STORY);
  const [error, setError] = useState<string | null>(null);
  const [extractedLegalText, setExtractedLegalText] = useState<string>('');
  const [isExtractingText, setIsExtractingText] = useState(false);
  
  // Disclaimer Text State
  const [disclaimer, setDisclaimer] = useState<TextOverlayData | null>(null);
  const [isTextSelected, setIsTextSelected] = useState(false);
  const [history, setHistory] = useState<HistoryState[]>([]);
  
  // Magic Reposition State
  const [isRepositionMode, setIsRepositionMode] = useState(false);
  const [repositionMode, setRepositionMode] = useState<RepositionMode>('MANUAL');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [selectedElementLabel, setSelectedElementLabel] = useState<string | undefined>(undefined);
  const [croppedElement, setCroppedElement] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState<boolean>(true);
  
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);
  const [sourceRect, setSourceRect] = useState<Rect | null>(null);
  
  // Dragging state
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null);
  const [initialRect, setInitialRect] = useState<Rect | null>(null);
  
  const selectionIdRef = useRef<number>(0);
  const [containerDims, setContainerDims] = useState({ width: 0, height: 0 });
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Update container dimensions when image loads or window resizes
    const updateDims = () => {
      if (imageRef.current) {
        setContainerDims({
            width: imageRef.current.offsetWidth,
            height: imageRef.current.offsetHeight
        });
      }
    };
    
    window.addEventListener('resize', updateDims);
    // Also trigger shortly after image load
    const timer = setTimeout(updateDims, 100);
    return () => {
        window.removeEventListener('resize', updateDims);
        clearTimeout(timer);
    };
  }, [generatedImage]);

  const handleGenerate = async () => {
    if (!originalImage) return;

    try {
      setStatus(EditorState.GENERATING);
      setLoadingMessage('Transforming layout...');
      setError(null);
      setDisclaimer(null); 
      setHistory([]); // Clear history on new generation
      setExtractedLegalText('');
      setSelectionRect(null);
      setSourceRect(null);
      setIsRepositionMode(false);
      setDetectedElements([]);
      setCroppedElement(null);
      setSelectedIndices(new Set());
      selectionIdRef.current += 1;
      
      // Extract mime type
      const mimeType = originalImage.match(/data:([^;]+);/)?.[1] || 'image/png';
      
      // OPTIMIZATION: Removed parallel extractLegalText to save API calls
      const genResult = await generateFormatConversion(originalImage, mimeType, selectedRatio, prompt);

      setGeneratedImage(genResult);
      setStatus(EditorState.COMPLETE);
    } catch (err: any) {
      if (err.message === 'INVALID_API_KEY' || err.message === 'MODEL_NOT_FOUND') {
        throw err;
      }
      console.error(err);
      setError(err.message || "Failed to generate image. Please try again.");
      setStatus(EditorState.ERROR);
    }
  };

  const handleExtractLegalText = async () => {
      if (!originalImage) return;
      
      try {
          setIsExtractingText(true);
          const mimeType = originalImage.match(/data:([^;]+);/)?.[1] || 'image/png';
          const text = await extractLegalText(originalImage, mimeType);
          setExtractedLegalText(text);
          if (text) {
              addDisclaimer(text);
          } else {
             // Fallback if nothing found
             addDisclaimer();
          }
      } catch (e: any) {
      if (e.message === 'INVALID_API_KEY' || e.message === 'MODEL_NOT_FOUND') {
        throw e;
      }
      console.error(e);
      // Fallback on error
      addDisclaimer();
    } finally {
          setIsExtractingText(false);
      }
  };

  const handleEditOriginal = async () => {
    if (!originalImage) return;

    try {
      // Reset states
      setError(null);
      setDisclaimer(null);
      setHistory([]);
      setExtractedLegalText('');
      setSelectionRect(null);
      setSourceRect(null);
      setIsRepositionMode(false);
      setDetectedElements([]);
      setCroppedElement(null);
      setSelectedIndices(new Set());
      selectionIdRef.current += 1;
      
      // Immediately show the image in the result pane
      setGeneratedImage(originalImage);
      setStatus(EditorState.COMPLETE);
      
      // Note: We do NOT auto-extract text here anymore to save calls
      
    } catch (err: any) {
      console.error(err);
      setError("Failed to load original image.");
    }
  };

  const startRepositionMode = async () => {
    if (!generatedImage) return;

    setIsRepositionMode(true);
    setRepositionMode('MANUAL'); // Default to Manual
    setSelectionRect(null);
    setSourceRect(null);
    setDisclaimer(null);
    setIsDrawing(false);
    setIsDragging(false);
    setSelectedElementLabel(undefined);
    setCroppedElement(null);
    setSelectedIndices(new Set());
    selectionIdRef.current += 1;
    setRemoveBackground(true);
    
    // Start Analysis
    setIsAnalyzing(true);
    try {
        const mimeType = generatedImage.match(/data:([^;]+);/)?.[1] || 'image/png';
        const elements = await detectMovableElements(generatedImage, mimeType);
        setDetectedElements(elements);
    } catch (e) {
        console.error("Analysis failed", e);
    } finally {
        setIsAnalyzing(false);
    }
  };
  
  const resetReposition = () => {
    selectionIdRef.current += 1; // Invalidate current operations
    setSelectionRect(null);
    setSourceRect(null);
    setIsDrawing(false);
    setIsDragging(false);
    setSelectedIndices(new Set());
    setSelectedElementLabel(undefined);
    setCroppedElement(null);
  }

  // Remove Magenta Background (Chroma Key) client-side
  const removeMagentaBackground = (dataUrl: string): Promise<string> => {
      return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) return reject('No context');
              
              ctx.drawImage(img, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const data = imageData.data;
              
              // Iterate and remove magenta (#FF00FF)
              // We use a threshold to catch anti-aliased edges or compression artifacts
              const threshold = 80; 
              
              for (let i = 0; i < data.length; i += 4) {
                  const r = data[i];
                  const g = data[i + 1];
                  const b = data[i + 2];
                  
                  // Check if close to Magenta (R=255, G=0, B=255)
                  if (r > 255 - threshold && g < threshold && b > 255 - threshold) {
                      data[i + 3] = 0; // Alpha = 0 (Transparent)
                  }
              }
              
              ctx.putImageData(imageData, 0, 0);
              resolve(canvas.toDataURL());
          };
          img.onerror = reject;
          img.src = dataUrl;
      });
  };

  // Capture crop immediately
  const processSelectedElement = async (rect: Rect) => {
      if (!generatedImage || !imageRef.current) return;
      
      const img = imageRef.current;
      const scaleX = img.naturalWidth / img.offsetWidth;
      const scaleY = img.naturalHeight / img.offsetHeight;
      
      // 1. Capture Raw Crop
      const canvas = document.createElement('canvas');
      canvas.width = rect.width * scaleX;
      canvas.height = rect.height * scaleY;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) return;
      
      ctx.drawImage(
          img, 
          rect.x * scaleX, 
          rect.y * scaleY, 
          rect.width * scaleX, 
          rect.height * scaleY, 
          0, 
          0, 
          canvas.width, 
          canvas.height
      );
      
      const rawCrop = canvas.toDataURL();
      setCroppedElement(rawCrop);
  };

  // Handle clicking a detected element to "snap" selection with Multi-select support
  const handleElementClick = async (el: DetectedElement, index: number) => {
      if (!containerDims.width) return;
      
      const newIndices = new Set(selectedIndices);
      if (newIndices.has(index)) {
          newIndices.delete(index);
      } else {
          newIndices.add(index);
      }
      setSelectedIndices(newIndices);

      if (newIndices.size === 0) {
          setSourceRect(null);
          setSelectionRect(null);
          setCroppedElement(null);
          return;
      }

      // Calculate Union Box
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const labels: string[] = [];

      newIndices.forEach(i => {
          const item = detectedElements[i];
          labels.push(item.label);
          const [ymin, xmin, ymax, xmax] = item.box_2d;
          if (xmin < minX) minX = xmin;
          if (ymin < minY) minY = ymin;
          if (xmax > maxX) maxX = xmax;
          if (ymax > maxY) maxY = ymax;
      });

      const scaleX = containerDims.width / 1000;
      const scaleY = containerDims.height / 1000;

      // Add padding to prevent cutting off text (5px visible)
      const padding = 5;
      
      let rectX = (minX * scaleX) - padding;
      let rectY = (minY * scaleY) - padding;
      let rectW = ((maxX - minX) * scaleX) + (padding * 2);
      let rectH = ((maxY - minY) * scaleY) + (padding * 2);

      // Boundary check
      if (rectX < 0) rectX = 0;
      if (rectY < 0) rectY = 0;
      if (rectX + rectW > containerDims.width) rectW = containerDims.width - rectX;
      if (rectY + rectH > containerDims.height) rectH = containerDims.height - rectY;

      const rect: Rect = {
          x: rectX,
          y: rectY,
          width: rectW,
          height: rectH
      };
      
      // Reset logic implicitly by starting new selection sequence
      selectionIdRef.current += 1;
      
      setSourceRect(rect);
      setSelectionRect(rect); // Target starts at source
      setSelectedElementLabel(labels.length > 2 ? `${labels.length} items` : labels.join(" + "));
      
      // Capture crop
      await processSelectedElement(rect);
  };

  // Magic Reposition: Mouse Handlers
  const handleMouseDown = async (e: React.MouseEvent) => {
    if (!isRepositionMode || !imageRef.current || !containerRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    // CASE 1: Source exists -> We are in "Move Target" mode
    if (sourceRect && selectionRect) {
       // Check hit on selectionRect
       const hitPadding = 10;
       if (
         localX >= selectionRect.x - hitPadding && localX <= selectionRect.x + selectionRect.width + hitPadding &&
         localY >= selectionRect.y - hitPadding && localY <= selectionRect.y + selectionRect.height + hitPadding
       ) {
         setIsDragging(true);
         setDragStart({ x: e.clientX, y: e.clientY }); // Screen coords for delta calculation
         setInitialRect({ ...selectionRect });
         return;
       }
       return; 
    }

    // CASE 2: No Source -> We are in "Select Source" mode (Manual override)
    setIsDrawing(true);
    setSelectionRect({ x: localX, y: localY, width: 0, height: 0 });
    setDragStart({ x: localX, y: localY }); 
    setSelectedIndices(new Set()); // Clear auto-selections if drawing manually
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (!isRepositionMode || !imageRef.current) return;

      const rect = imageRef.current.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      if (isDrawing && dragStart) {
        // Drawing logic: dragStart is local origin
        const width = localX - dragStart.x;
        const height = localY - dragStart.y;
        
        setSelectionRect({
            x: width > 0 ? dragStart.x : localX,
            y: height > 0 ? dragStart.y : localY,
            width: Math.abs(width),
            height: Math.abs(height)
        });
      } else if (isDragging && dragStart && initialRect) {
          // Dragging logic: dragStart is screen origin
          const dx = e.clientX - dragStart.x;
          const dy = e.clientY - dragStart.y;
          
          let newX = initialRect.x + dx;
          let newY = initialRect.y + dy;
          
          // Constrain to container
          const maxX = containerDims.width - initialRect.width;
          const maxY = containerDims.height - initialRect.height;
          
          setSelectionRect({
              ...initialRect,
              x: Math.max(0, Math.min(newX, maxX)),
              y: Math.max(0, Math.min(newY, maxY))
          });
      }
  };

  const handleMouseUp = async () => {
      if (isDrawing) {
         // Finalize drawing
         if (selectionRect && selectionRect.width > 10 && selectionRect.height > 10) {
             setSourceRect({ ...selectionRect });
             
             // Process the manually drawn selection
             selectionIdRef.current += 1;
             await processSelectedElement(selectionRect);
         } else {
             // Too small, reset
             setSelectionRect(null);
         }
      }
      
      setIsDrawing(false);
      setIsDragging(false);
      setDragStart(null);
      setInitialRect(null);
  };

  const executeReposition = async () => {
      if (!generatedImage || !sourceRect || !selectionRect) return;
      
      try {
          setStatus(EditorState.GENERATING);
          setLoadingMessage('Repositioning content...');
          setError(null);
          
           // Extract mime type
           const mimeType = generatedImage.match(/data:([^;]+);/)?.[1] || 'image/png';
           
           const scaleX = 1000 / containerDims.width;
           const scaleY = 1000 / containerDims.height;

           const toGeminiCoords = (r: Rect, padding: number = 0) => [
               Math.max(0, Math.floor((r.y - padding) * scaleY)),
               Math.max(0, Math.floor((r.x - padding) * scaleX)),
               Math.min(1000, Math.floor((r.y + r.height + padding) * scaleY)),
               Math.min(1000, Math.floor((r.x + r.width + padding) * scaleX))
           ];
           
           // Expand source box slightly for erasure to avoid ghosts/duplicates
           const sourceBoxForErasure = toGeminiCoords(sourceRect, 4); 
           const sourceBoxStrict = toGeminiCoords(sourceRect, 0);
           const targetBox = toGeminiCoords(selectionRect, 0);

           if (repositionMode === 'MANUAL' && croppedElement) {
                // MANUAL MODE: 
                // 1. Prepare foreground (segment if needed)
                let elementToPaste = croppedElement;
                
                if (removeBackground) {
                    try {
                        const segmented = await segmentElement(croppedElement, mimeType, selectedElementLabel || 'object');
                        elementToPaste = await removeMagentaBackground(segmented);
                    } catch (e) {
                        console.warn("Segmentation failed during execute, using raw crop", e);
                    }
                }

                // 2. Remove object from source (Inpainting)
                // We use the slightly expanded box to ensure total removal
                const cleanedBackground = await removeObjectFromImage(generatedImage, mimeType, sourceBoxForErasure, selectedElementLabel);
                
                // 3. Client-side Composition
                const canvas = document.createElement('canvas');
                const imgBg = new Image();
                const imgFg = new Image();
                
                // Load images
                await new Promise((resolve) => { imgBg.onload = resolve; imgBg.src = cleanedBackground; });
                await new Promise((resolve) => { imgFg.onload = resolve; imgFg.src = elementToPaste; });
                
                canvas.width = imgBg.naturalWidth;
                canvas.height = imgBg.naturalHeight;
                const ctx = canvas.getContext('2d');
                
                if (ctx) {
                    // Draw clean background
                    ctx.drawImage(imgBg, 0, 0);
                    
                    // Determine scale ratio from container to natural image
                    const naturalScaleX = imgBg.naturalWidth / containerDims.width;
                    const naturalScaleY = imgBg.naturalHeight / containerDims.height;
                    
                    // Draw foreground at new target location
                    ctx.drawImage(
                        imgFg,
                        selectionRect.x * naturalScaleX,
                        selectionRect.y * naturalScaleY,
                        selectionRect.width * naturalScaleX,
                        selectionRect.height * naturalScaleY
                    );
                    
                    const compositeResult = canvas.toDataURL(mimeType);
                    setGeneratedImage(compositeResult);
                    setHistory(prev => [...prev, { image: compositeResult, disclaimer: null }]);
                }
           } else {
               // AUTO MODE: AI handles everything
               const newImage = await repositionContent(generatedImage, mimeType, sourceBoxStrict, targetBox, selectedElementLabel);
               setGeneratedImage(newImage);
               setHistory(prev => [...prev, { image: newImage, disclaimer: null }]);
           }
           
           // Cleanup
           setIsRepositionMode(false);
           setSelectionRect(null);
           setSourceRect(null);
           setDetectedElements([]);
           setCroppedElement(null);
           setSelectedIndices(new Set());
           setStatus(EditorState.COMPLETE);

      } catch (err: any) {
          setError(err.message || "Failed to reposition text.");
          setStatus(EditorState.ERROR); // Or revert to COMPLETE
      }
  };


  const addDisclaimer = (initialText?: string) => {
    if (!imageRef.current) return;
    
    const width = imageRef.current.offsetWidth;
    const height = imageRef.current.offsetHeight;
    
    setDisclaimer({
      id: 'disclaimer-1',
      text: initialText || '*Terms and conditions apply. Offer valid while supplies last.',
      x: width * 0.1, // 10% from left
      y: height * 0.85, // 85% down
      width: width * 0.8, // 80% width
      height: 60, // Default height
      fontSize: 14,
      textAlign: 'center',
      fontFamily: 'Inter',
      color: '#FFFFFF'
    });
    
    setIsTextSelected(true);
    setIsRepositionMode(false);
  };

  const applyOverlay = () => {
    // We no longer bake the text here to keep it editable.
    // The baking happens automatically during Download.
    // This button now acts as a "Deselect" but is named "Apply" as requested.
    setIsTextSelected(false);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const lastState = history[history.length - 1];
    setGeneratedImage(lastState.image);
    setDisclaimer(lastState.disclaimer);
    setHistory(prev => prev.slice(0, -1));
  };

  const handleDownload = async () => {
    if (!generatedImage) return;

    if (!disclaimer) {
        // Simple download if no text
        const link = document.createElement('a');
        link.href = generatedImage;
        link.download = `admorph-edited-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
    }

    // Composite download with Canvas if text exists
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    if (!generatedImage.startsWith('data:')) {
        img.crossOrigin = "anonymous";
    }

    img.onload = () => {
        // Set canvas to natural image size (high res)
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        if (ctx) {
             ctx.imageSmoothingEnabled = true;
             ctx.imageSmoothingQuality = 'high';
             
            // Draw Image
            ctx.drawImage(img, 0, 0);

            if (disclaimer && containerDims.width > 0) {
                const scale = img.naturalWidth / containerDims.width;
                renderTextOnCanvas(ctx, disclaimer, scale);
            }

            // Trigger download
            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `admorph-edited-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
    
    img.src = generatedImage;
  };

  const isOriginal = generatedImage === originalImage;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Format Converter</h2>
          <p className="text-slate-400">Intelligently resize and adapt ads to any aspect ratio, senza tante bestemmie.</p>
        </div>
        <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onReset} disabled={status === EditorState.GENERATING}>
              Start Over
            </Button>
            {status === EditorState.COMPLETE && !disclaimer && !isRepositionMode && (
               <Button variant="primary" onClick={handleDownload} icon={
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                   <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                 </svg>
               }>
                 Download Result
               </Button>
            )}
        </div>
      </div>

      {/* Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-auto lg:h-[700px]">
        
        {/* Left: Input & Controls */}
        <div className="flex flex-col gap-6 overflow-y-auto pb-4 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700 flex-none flex flex-col min-h-[300px]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Original</span>
              <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">Source</span>
            </div>
            
            <div className="flex-1 flex items-center justify-center bg-slate-900/50 rounded-lg overflow-hidden relative">
               {originalImage && <img src={originalImage} alt="Original" className="max-h-full max-w-full object-contain" />}
            </div>
          </div>

          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
             <div className="mb-6 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                 <p className="text-sm text-indigo-200 leading-relaxed">
                     <span className="font-bold">💡 Come funziona:</span> Scegli il formato desiderato e genera l'immagine. Il testo legale (disclaimer) verrà rimosso in automatico per evitare errori dato il font piccolo; clicca su <span className="font-bold">"Add disclaimer text"</span> per riaggiungerlo e posizionarlo manualmente.
                 </p>
             </div>
             <h3 className="text-white font-medium mb-3">Conversion Settings</h3>
             
             {/* Aspect Ratio Selector */}
             <div className="mb-4">
                 <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wide">Output Format</label>
                 <div className="grid grid-cols-3 gap-2">
                     <button
                         onClick={() => setSelectedRatio(AspectRatio.STORY)}
                         disabled={status === EditorState.COMPLETE}
                         className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                             selectedRatio === AspectRatio.STORY
                             ? 'bg-indigo-600 border-indigo-500 text-white'
                             : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                         } ${status === EditorState.COMPLETE ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                         <div className="flex flex-col items-center gap-1">
                             <span className="w-3 h-5 border-2 border-current rounded-sm opacity-50"></span>
                             Story (9:16)
                         </div>
                     </button>
                     <button
                         onClick={() => setSelectedRatio(AspectRatio.SQUARE)}
                         disabled={status === EditorState.COMPLETE}
                         className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                             selectedRatio === AspectRatio.SQUARE
                             ? 'bg-indigo-600 border-indigo-500 text-white'
                             : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                         } ${status === EditorState.COMPLETE ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                        <div className="flex flex-col items-center gap-1">
                             <span className="w-4 h-4 border-2 border-current rounded-sm opacity-50"></span>
                             Square (1:1)
                         </div>
                     </button>
                     <button
                         onClick={() => setSelectedRatio(AspectRatio.LANDSCAPE)}
                         disabled={status === EditorState.COMPLETE}
                         className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                             selectedRatio === AspectRatio.LANDSCAPE
                             ? 'bg-indigo-600 border-indigo-500 text-white'
                             : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                         } ${status === EditorState.COMPLETE ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                         <div className="flex flex-col items-center gap-1">
                             <span className="w-5 h-3 border-2 border-current rounded-sm opacity-50"></span>
                             Landscape (16:9)
                         </div>
                     </button>
                 </div>
             </div>

             <div className="mb-4">
               <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wide">
                 Additional Instructions (Optional)
               </label>
               <textarea 
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none h-20 text-sm"
                  placeholder="E.g., Ensure the logo is prominent, make the sky brighter..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={status === EditorState.GENERATING || status === EditorState.COMPLETE}
               />
             </div>
             
             {error && (
               <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                 {error}
               </div>
             )}

             <Button 
                onClick={handleGenerate} 
                className="w-full py-3" 
                isLoading={status === EditorState.GENERATING}
                disabled={status === EditorState.GENERATING || status === EditorState.COMPLETE}
             >
                {status === EditorState.GENERATING ? 'Transforming Layout...' : status === EditorState.COMPLETE ? 'Transformation Complete' : 'Generate Format'}
             </Button>

             {/* "Skip" Option */}
             {status !== EditorState.COMPLETE && status !== EditorState.GENERATING && (
                 <>
                    <div className="relative flex py-3 items-center">
                        <div className="flex-grow border-t border-slate-700"></div>
                        <span className="flex-shrink-0 mx-2 text-slate-600 text-[10px] uppercase tracking-widest">Or</span>
                        <div className="flex-grow border-t border-slate-700"></div>
                    </div>
                    <Button 
                        variant="secondary" 
                        onClick={handleEditOriginal} 
                        className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-600"
                        icon={<svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
                    >
                        Use Original & Add Text
                    </Button>
                 </>
             )}

             {/* Disclaimer Controls */}
             {status === EditorState.COMPLETE && !isRepositionMode && (
                <div className="mt-6 pt-6 border-t border-slate-700">
                    <h4 className="text-sm font-semibold text-slate-300 mb-3">Post-Editing Tools</h4>
                    {!disclaimer ? (
                         <div className="space-y-2">
                            <div className="flex gap-2">
                                {extractedLegalText ? (
                                    <Button
                                        variant="primary"
                                        onClick={() => addDisclaimer(extractedLegalText)}
                                        className="flex-1"
                                        icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>}
                                    >
                                        Add disclaimer text
                                    </Button>
                                ) : (
                                    <Button
                                        variant="primary"
                                        onClick={handleExtractLegalText}
                                        isLoading={isExtractingText}
                                        className="flex-1"
                                        icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>}
                                        title="Automatically detect legal text from original"
                                    >
                                        Add disclaimer text
                                    </Button>
                                )}
                            </div>
                             <div className="flex gap-2 mt-2">
                                <Button
                                    variant="outline"
                                    onClick={startRepositionMode}
                                    className="flex-1"
                                    title="Magic Move"
                                    icon={<svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>}
                                >
                                    Magic Move
                                </Button>
                                {history.length > 0 && (
                                    <Button 
                                        variant="outline" 
                                        onClick={handleUndo}
                                        className="px-3"
                                        title="Undo Last Apply"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                        </svg>
                                    </Button>
                                )}
                            </div>
                         </div>
                    ) : (
                        <div className="space-y-4 animate-in fade-in duration-300">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-slate-400">Edit Text Style</span>
                                <button onClick={() => setDisclaimer(null)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1">
                                    Cancel
                                </button>
                            </div>
                            
                            {/* Font Family Selection */}
                            <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 uppercase tracking-wide">Font</label>
                                <select 
                                    className="w-full bg-slate-900 text-slate-200 text-sm rounded-lg border border-slate-700 p-2 focus:ring-1 focus:ring-indigo-500 outline-none"
                                    value={disclaimer.fontFamily}
                                    onChange={(e) => setDisclaimer({...disclaimer, fontFamily: e.target.value})}
                                >
                                    {AVAILABLE_FONTS.map(font => (
                                        <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                                    ))}
                                </select>
                            </div>

                             {/* Color Selection */}
                             <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 uppercase tracking-wide">Color</label>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                                        {PRESET_COLORS.map(c => (
                                            <button 
                                                key={c}
                                                onClick={() => setDisclaimer({...disclaimer, color: c})}
                                                className={`w-6 h-6 rounded-full border border-slate-600 flex-shrink-0 ${disclaimer.color === c ? 'ring-2 ring-white' : ''}`}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                    </div>
                                    <input 
                                        type="color" 
                                        value={disclaimer.color}
                                        onChange={(e) => setDisclaimer({...disclaimer, color: e.target.value})}
                                        className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                                    />
                                </div>
                            </div>

                            {/* Alignment & Size Controls */}
                             <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 uppercase tracking-wide">Alignment & Size</label>
                                <div className="flex gap-2">
                                    <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700 flex-1">
                                        <button 
                                            onClick={() => setDisclaimer({...disclaimer, textAlign: 'left'})}
                                            className={`flex-1 py-1 px-2 rounded text-xs ${disclaimer.textAlign === 'left' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            <svg className="w-3 h-3 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h16" /></svg>
                                        </button>
                                        <button 
                                            onClick={() => setDisclaimer({...disclaimer, textAlign: 'center'})}
                                            className={`flex-1 py-1 px-2 rounded text-xs ${disclaimer.textAlign === 'center' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            <svg className="w-3 h-3 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M4 18h16" /></svg>
                                        </button>
                                        <button 
                                            onClick={() => setDisclaimer({...disclaimer, textAlign: 'right'})}
                                            className={`flex-1 py-1 px-2 rounded text-xs ${disclaimer.textAlign === 'right' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            <svg className="w-3 h-3 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M4 18h16" /></svg>
                                        </button>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-2 border border-slate-700 w-24">
                                         <span className="text-[10px] text-slate-500">Px</span>
                                         <input 
                                            type="number" 
                                            min="6" 
                                            max="120" 
                                            value={disclaimer.fontSize} 
                                            onChange={(e) => setDisclaimer({...disclaimer, fontSize: parseInt(e.target.value) || 12})}
                                            className="w-full bg-transparent text-white text-sm outline-none text-right"
                                        />
                                    </div>
                                </div>
                            </div>
                            
                            <input 
                                type="range" 
                                min="6" 
                                max="60" 
                                value={disclaimer.fontSize} 
                                onChange={(e) => setDisclaimer({...disclaimer, fontSize: parseInt(e.target.value)})}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />


                            <div className="pt-4 border-t border-slate-700 space-y-3">
                                <Button onClick={applyOverlay} variant="primary" className="w-full" icon={
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                }>
                                    Apply
                                </Button>
                                <Button onClick={handleDownload} variant="secondary" className="w-full" icon={
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                }>
                                    Download Image
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
             )}

             {/* Reposition Controls Panel */}
             {isRepositionMode && (
                 <div className="mt-6 pt-6 border-t border-slate-700 animate-in fade-in duration-300">
                     <div className="flex justify-between items-center mb-4">
                         <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                            <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                            </svg>
                            Magic Reposition
                         </h4>
                         <button onClick={() => { setIsRepositionMode(false); setSelectionRect(null); setSourceRect(null); }} className="text-xs text-slate-400 hover:text-white">
                             Close
                         </button>
                     </div>
                     
                     {/* Mode Toggles */}
                     <div className="flex bg-slate-900 rounded-lg p-1 mb-4 border border-slate-700">
                         <button
                             onClick={() => { setRepositionMode('MANUAL'); setSourceRect(null); setSelectionRect(null); setCroppedElement(null); }}
                             className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                                 repositionMode === 'MANUAL'
                                 ? 'bg-indigo-600 text-white shadow-md'
                                 : 'text-slate-400 hover:text-slate-200'
                             }`}
                         >
                             Manual (Cut & Paste)
                         </button>
                         <button
                             onClick={() => { setRepositionMode('AUTO'); setSourceRect(null); setSelectionRect(null); setCroppedElement(null); }}
                             className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                                 repositionMode === 'AUTO'
                                 ? 'bg-indigo-600 text-white shadow-md'
                                 : 'text-slate-400 hover:text-slate-200'
                             }`}
                         >
                             AI Auto (Generative)
                         </button>
                     </div>
                     
                     <div className="text-sm text-slate-400 mb-4 bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                         {isAnalyzing ? (
                             <div className="flex items-center gap-2 text-indigo-400">
                                 <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                 Analyzing image elements...
                             </div>
                         ) : !sourceRect ? (
                             <span className="flex items-center gap-2">
                                 <span className="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center text-xs font-bold text-white">1</span>
                                 Select detected elements to group them.
                             </span>
                         ) : (
                            <span className="flex items-center gap-2">
                                <span className="w-5 h-5 bg-green-600 rounded-full flex items-center justify-center text-xs font-bold text-white">2</span>
                                Drag the selection to the new location.
                            </span>
                         )}
                     </div>

                     <div className="flex flex-col gap-2">
                         {repositionMode === 'MANUAL' && sourceRect && (
                             <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800 p-2 rounded border border-slate-700">
                                <input 
                                    type="checkbox" 
                                    checked={removeBackground} 
                                    onChange={(e) => setRemoveBackground(e.target.checked)}
                                    className="rounded bg-slate-700 border-slate-500 text-indigo-600 focus:ring-indigo-500"
                                />
                                Remove background from element
                             </label>
                         )}
                         
                         <div className="flex gap-2">
                             {sourceRect && (
                                 <Button 
                                    variant="outline" 
                                    onClick={resetReposition}
                                    className="px-3 border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500"
                                    title="Reset Selection"
                                 >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                 </Button>
                             )}
                             <Button 
                                variant="primary" 
                                onClick={executeReposition} 
                                disabled={!sourceRect || !selectionRect || isAnalyzing}
                                className="w-full"
                             >
                                 {repositionMode === 'MANUAL' ? 'Cut, Inpaint & Paste' : 'Reposition & Regenerate'}
                             </Button>
                         </div>
                     </div>
                 </div>
             )}
          </div>
        </div>

        {/* Right: Output */}
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700 flex flex-col h-full min-h-[500px]">
          <div className="flex items-center justify-between mb-4">
             <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Result ({isOriginal && status === EditorState.COMPLETE ? 'Original' : selectedRatio})</span>
             {status === EditorState.COMPLETE && <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">Generated</span>}
          </div>

          <div 
             className="flex-1 flex items-center justify-center bg-slate-900/50 rounded-lg overflow-hidden relative border-2 border-dashed border-slate-800"
             ref={containerRef}
          >
             {status === EditorState.GENERATING ? (
               <div className="flex flex-col items-center animate-pulse">
                 <div className="h-16 w-16 bg-indigo-600 rounded-full mb-4 animate-bounce opacity-50"></div>
                 <p className="text-indigo-400 font-medium">{loadingMessage || 'Processing...'}</p>
                 <p className="text-slate-500 text-sm mt-1">Inpainting original area...</p>
                 <p className="text-slate-500 text-sm mt-1">Blending object to new spot...</p>
               </div>
             ) : generatedImage ? (
               <div 
                  className={`relative inline-block max-h-full w-full h-full flex items-center justify-center ${isRepositionMode ? (sourceRect ? 'cursor-grab' : 'cursor-crosshair') : ''}`}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
               >
                   {/* Container for Image + Overlay */}
                   <div className="relative inline-block" style={{ maxHeight: '100%', maxWidth: '100%' }}>
                        <img 
                            ref={imageRef}
                            src={generatedImage} 
                            alt="Generated Story" 
                            className="max-h-[600px] w-auto object-contain shadow-2xl pointer-events-none select-none" 
                            onLoad={() => {
                                if(imageRef.current) {
                                    setContainerDims({
                                        width: imageRef.current.offsetWidth,
                                        height: imageRef.current.offsetHeight
                                    });
                                }
                            }}
                        />
                        
                        {/* Disclaimer Overlay (Hidden in Reposition Mode) */}
                        {disclaimer && containerDims.width > 0 && !isRepositionMode && (
                            <DraggableText
                                text={disclaimer.text}
                                x={disclaimer.x}
                                y={disclaimer.y}
                                width={disclaimer.width}
                                height={disclaimer.height}
                                fontSize={disclaimer.fontSize}
                                fontFamily={disclaimer.fontFamily}
                                color={disclaimer.color}
                                textAlign={disclaimer.textAlign}
                                containerWidth={containerDims.width}
                                containerHeight={containerDims.height}
                                isSelected={isTextSelected}
                                onSelect={() => setIsTextSelected(true)}
                                onUpdate={(newData) => setDisclaimer({ ...disclaimer, ...newData })}
                            />
                        )}

                        {/* Analysis Overlays (Detected Elements) */}
                        {isRepositionMode && detectedElements.map((el, idx) => {
                             const isSelected = selectedIndices.has(idx);
                             const [ymin, xmin, ymax, xmax] = el.box_2d;
                             const scaleX = containerDims.width / 1000;
                             const scaleY = containerDims.height / 1000;
                             
                             // Don't show individual boxes if sourceRect is set unless we want to allow deselection (implied by click handler)
                             // But visuals are cleaner if we hide them when dragging starts. 
                             // We keep them visible but possibly behind the big box or just show outline.
                             
                             return (
                                 <div 
                                    key={idx}
                                    style={{
                                        position: 'absolute',
                                        left: xmin * scaleX,
                                        top: ymin * scaleY,
                                        width: (xmax - xmin) * scaleX,
                                        height: (ymax - ymin) * scaleY,
                                        border: isSelected ? '2px solid #6366f1' : '1px dashed rgba(255, 255, 255, 0.4)',
                                        backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                                        cursor: 'pointer',
                                        zIndex: 30
                                    }}
                                    className="group hover:border-indigo-400 hover:bg-indigo-500/10 transition-colors"
                                    onClick={(e) => { e.stopPropagation(); handleElementClick(el, idx); }}
                                 >
                                     <div className={`absolute -top-5 left-0 bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded transition-opacity whitespace-nowrap z-40 pointer-events-none ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                         {el.label}
                                     </div>
                                 </div>
                             );
                        })}

                        {/* Magic Reposition Overlay - Source (Faded Red) - Union of selections */}
                        {sourceRect && (
                             <div 
                                style={{
                                    position: 'absolute',
                                    left: sourceRect.x,
                                    top: sourceRect.y,
                                    width: sourceRect.width,
                                    height: sourceRect.height,
                                    border: '2px dashed rgba(239, 68, 68, 0.6)', // Red-500
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    pointerEvents: 'none',
                                    zIndex: 10
                                }}
                             >
                                <div className="absolute -top-6 left-0 bg-red-500 text-white text-[10px] px-2 py-0.5 rounded font-medium shadow-sm">
                                    {selectedElementLabel || "Source"}
                                </div>
                             </div>
                        )}

                        {/* Magic Reposition Overlay - Target (Draggable Blue) */}
                        {selectionRect && (
                            <div 
                                style={{
                                    position: 'absolute',
                                    left: selectionRect.x,
                                    top: selectionRect.y,
                                    width: selectionRect.width,
                                    height: selectionRect.height,
                                    border: '2px solid #6366f1', // Indigo-500
                                    backgroundColor: repositionMode === 'MANUAL' && croppedElement ? 'transparent' : 'rgba(99, 102, 241, 0.2)',
                                    cursor: sourceRect ? (isDragging ? 'grabbing' : 'grab') : 'crosshair',
                                    boxShadow: isDragging ? '0 10px 25px -5px rgba(0, 0, 0, 0.3)' : '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                                    zIndex: 20,
                                    transition: isDragging ? 'none' : 'box-shadow 0.2s',
                                    overflow: 'hidden' // Ensure cropped content stays in box
                                }}
                                className="group"
                            >
                                {repositionMode === 'MANUAL' && sourceRect ? (
                                     <>
                                        {croppedElement ? (
                                            <img 
                                                src={croppedElement} 
                                                alt="Moved element" 
                                                className="w-full h-full object-fill pointer-events-none"
                                                style={{ opacity: 0.95 }} 
                                            />
                                        ) : null}
                                     </>
                                ) : (
                                    <>
                                        <div className={`absolute -top-6 left-0 text-white text-[10px] px-2 py-0.5 rounded font-medium shadow-sm transition-colors ${sourceRect ? 'bg-indigo-600' : 'bg-slate-600'}`}>
                                            {sourceRect ? "Target Location" : "Selecting..."}
                                        </div>
                                        
                                        {sourceRect && !croppedElement && (
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-200 drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                                </svg>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                   </div>
               </div>
             ) : (
               <div className="text-center p-8">
                 <div className="w-16 h-16 mx-auto bg-slate-800 rounded-full flex items-center justify-center mb-4">
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                   </svg>
                 </div>
                 <p className="text-slate-500 font-medium">Your converted ad will appear here</p>
                 <p className="text-slate-600 text-sm mt-2">The AI will intelligently adapt the layout to your selected format.</p>
               </div>
             )}
          </div>
          
          {/* Footer Actions */}
          {generatedImage && status === EditorState.COMPLETE && !isRepositionMode && (
              <div className="mt-4 flex flex-col items-center gap-3">
                  <div className="flex gap-4 w-full justify-center">
                    <Button 
                        variant="primary" 
                        onClick={handleGenerate}
                        className="bg-indigo-600/90 hover:bg-indigo-600"
                        icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                    >
                        Retry Generation
                    </Button>
                  </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
};