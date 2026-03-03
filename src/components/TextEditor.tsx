import React, { useState, useEffect, useRef } from 'react';
import { Button } from './Button';
import { EditorState, TextBlock } from '../types';
import { detectText, removeDisclaimer, replaceText, extractLegalText } from '../services/geminiService';
import { DraggableText, TextAlign } from './DraggableText';
import { ImageViewer } from './ImageViewer';

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

interface TextEditorProps {
  originalImage: string | null;
  onReset: () => void;
  activeTool: string;
}

export const TextEditor: React.FC<TextEditorProps> = ({ originalImage, onReset, activeTool }) => {
  const [status, setStatus] = useState<EditorState>(EditorState.IDLE);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [image, setImage] = useState<string | null>(originalImage);
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  const [editedBlocks, setEditedBlocks] = useState<Record<number, string>>({});
  const [disclaimerText, setDisclaimerText] = useState<string>('');
  const [disclaimerOverlay, setDisclaimerOverlay] = useState<TextOverlayData | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [containerDims, setContainerDims] = useState({ width: 0, height: 0 });

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDetectText = async () => {
    const targetImage = image || originalImage;
    console.log('handleDetectText: targetImage exists?', !!targetImage);
    if (!targetImage) {
      console.warn("handleDetectText: No image available");
      return;
    }
    
    setStatus(EditorState.LOADING);
    setLoadingMessage('Detecting text...');
    try {
      console.log('handleDetectText: Calling detectText service...');
      const blocks = await detectText(targetImage);
      console.log('handleDetectText: Received blocks:', blocks);
      setTextBlocks(blocks);
      const initialEdits: Record<number, string> = {};
      blocks.forEach((block, index) => {
        initialEdits[index] = block.text;
      });
      setEditedBlocks(initialEdits);
      
      if (!image && originalImage) {
        setImage(originalImage);
      }
    } catch (e: any) {
      if (e.message === 'INVALID_API_KEY' || e.message === 'MODEL_NOT_FOUND') {
        throw e;
      }
      console.error("Error detecting text:", e);
    } finally {
      setStatus(EditorState.READY);
    }
  };

  const handleRemoveDisclaimer = async () => {
    console.log('Remove Disclaimer button clicked');
    const targetImage = image || originalImage;
    if (!targetImage) {
      console.log('No image found, returning');
      return;
    }
    setStatus(EditorState.LOADING);
    setLoadingMessage('Removing disclaimer...');
    console.log('Status set to LOADING');
    try {
      console.log('Calling removeDisclaimer service');
      const { image: newImage, disclaimer: extractedDisclaimer } = await removeDisclaimer(targetImage);
      console.log('removeDisclaimer service returned:', { newImage, extractedDisclaimer });

      setImage(newImage);
      setDisclaimerText(extractedDisclaimer);
      setTextBlocks([]); // Clear old text blocks

      if (extractedDisclaimer && imageRef.current) {
        const width = imageRef.current.offsetWidth;
        const height = imageRef.current.offsetHeight;
        setDisclaimerOverlay({
          id: 'disclaimer-overlay',
          text: extractedDisclaimer,
          x: width * 0.1,
          y: height * 0.85,
          width: width * 0.8,
          height: 50,
          fontSize: 12,
          textAlign: 'center',
          fontFamily: 'Arial',
          color: '#FFFFFF',
        });
      }

    } catch (e: any) {
      if (e.message === 'INVALID_API_KEY' || e.message === 'MODEL_NOT_FOUND') {
        throw e;
      }
      console.error("Error in handleRemoveDisclaimer:", e);
    } finally {
      setStatus(EditorState.READY);
    }
  };

  const handleReplaceText = async () => {
    if (!image) return;
    setStatus(EditorState.LOADING);
    setLoadingMessage('Generating high-quality image...');

    const changes = textBlocks.map((block, index) => ({
        oldText: block.text,
        newText: editedBlocks[index],
    })).filter(change => change.oldText !== change.newText);

    try {
      console.log('Starting text replacement...');
      // replaceText now also handles disclaimer removal via prompt
      const newImage = await replaceText(image, changes);
      console.log('Text replacement successful, updating image...');
      setImage(newImage);
      
      // Re-detect to update blocks
      console.log('Starting re-detection...');
      setLoadingMessage('Finalizing...');
      const blocks = await detectText(newImage);
      console.log('Re-detection successful:', blocks);
      setTextBlocks(blocks);
      const initialEdits: Record<number, string> = {};
      blocks.forEach((block, index) => {
        initialEdits[index] = block.text;
      });
      setEditedBlocks(initialEdits);

      // Add disclaimer overlay after generating
      if (disclaimerText && containerDims.width > 0) {
        console.log('Adding disclaimer overlay...');
        setDisclaimerOverlay({
          id: 'disclaimer-overlay',
          text: disclaimerText,
          x: containerDims.width * 0.1,
          y: containerDims.height * 0.85,
          width: containerDims.width * 0.8,
          height: 50,
          fontSize: 12,
          textAlign: 'center',
          fontFamily: 'Arial',
          color: '#FFFFFF',
        });
      }
      console.log('handleReplaceText completed successfully');
    } catch (e: any) {
      if (e.message === 'INVALID_API_KEY' || e.message === 'MODEL_NOT_FOUND') {
        throw e;
      }
      console.error("Error replacing text:", e);
    } finally {
      setStatus(EditorState.READY);
    }
  };

  const renderTextOnCanvas = (ctx: CanvasRenderingContext2D, data: TextOverlayData, scale: number) => {
    ctx.save();
    const fontSize = Math.round(data.fontSize * scale);
    const fontFamily = data.fontFamily.includes(' ') ? `"${data.fontFamily}"` : data.fontFamily;
    ctx.font = `${fontSize}px ${fontFamily}, system-ui, sans-serif`;
    ctx.fillStyle = data.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = data.textAlign;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    const lineHeight = fontSize * 1.2;
    const padding = 4 * scale;
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

    const paragraphs = data.text.split('\n');
    
    paragraphs.forEach(paragraph => {
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

  const handleApplyOverlay = () => {
    // We no longer flatten the image here to keep the overlay editable.
    // The flattening happens automatically during Download.
    setSelectedTextId(null);
  };
  const handleDownload = async () => {
    if (!image) return;

    if (!disclaimerOverlay) {
        const link = document.createElement('a');
        link.href = image;
        link.download = `ad-morph-text-edit-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    if (!image.startsWith('data:')) {
        img.crossOrigin = "anonymous";
    }

    img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        if (ctx) {
             ctx.imageSmoothingEnabled = true;
             ctx.imageSmoothingQuality = 'high';
             
            ctx.drawImage(img, 0, 0);

            if (disclaimerOverlay && containerDims.width > 0) {
                const scale = img.naturalWidth / containerDims.width;
                renderTextOnCanvas(ctx, disclaimerOverlay, scale);
            }

            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `ad-morph-text-edit-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
    
    img.src = image;
  };

  const handleAddDisclaimerOverlay = () => {
    if (!imageRef.current) return;
    
    const width = imageRef.current.offsetWidth;
    const height = imageRef.current.offsetHeight;
    
    const textToAdd = disclaimerText || '*Terms and conditions apply. Offer valid while supplies last.';
    if (!disclaimerText) setDisclaimerText(textToAdd);

    setDisclaimerOverlay({
      id: 'disclaimer-overlay',
      text: textToAdd,
      x: width * 0.1,
      y: height * 0.85,
      width: width * 0.8,
      height: 50,
      fontSize: 12,
      textAlign: 'center',
      fontFamily: 'Arial',
      color: '#FFFFFF',
    });
    setSelectedTextId('disclaimer-overlay');
  };

  const handleTextBlockChange = (index: number, newText: string) => {
    setEditedBlocks(prev => ({ ...prev, [index]: newText }));
  };

  const handleInitialProcessing = async (img: string) => {
    setStatus(EditorState.LOADING);
    setLoadingMessage('Analyzing image...');
    try {
      // Step 1: Extract disclaimer text FIRST (fast)
      const mimeType = img.match(/data:([^;]+);/)?.[1] || 'image/png';
      const extractedDisclaimer = await extractLegalText(img, mimeType);
      setDisclaimerText(extractedDisclaimer || "");

      // Step 2: Detect other text (headlines, etc)
      setLoadingMessage('Detecting headlines...');
      const blocks = await detectText(img);
      
      // Filter out blocks that are likely part of the disclaimer
      const filteredBlocks = blocks.filter(block => {
        if (!extractedDisclaimer) return true;
        const cleanExtracted = extractedDisclaimer.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanBlock = block.text.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanBlock.length < 3) return true; // Keep very short things
        return !cleanExtracted.includes(cleanBlock) && !cleanBlock.includes(cleanExtracted);
      });

      setTextBlocks(filteredBlocks);
      const initialEdits: Record<number, string> = {};
      filteredBlocks.forEach((block, index) => {
        initialEdits[index] = block.text;
      });
      setEditedBlocks(initialEdits);

      // Step 3: We no longer create the overlay immediately.
      // It will be added after the user clicks Apply Changes.
    } catch (e: any) {
      if (e.message === 'INVALID_API_KEY' || e.message === 'MODEL_NOT_FOUND') {
        throw e;
      }
      console.error("Error in initial processing:", e);
    } finally {
      setStatus(EditorState.READY);
    }
  };

  const refreshDimensions = React.useCallback(() => {
    if (imageRef.current) {
      const { offsetWidth, offsetHeight } = imageRef.current;
      if (offsetWidth > 0 && offsetHeight > 0) {
        setContainerDims({ width: offsetWidth, height: offsetHeight });
      }
    }
  }, []);

  useEffect(() => {
    if (originalImage) {
      setImage(originalImage);
      handleInitialProcessing(originalImage);
    } else {
      setImage(null);
      setTextBlocks([]);
      setEditedBlocks({});
      setDisclaimerText('');
      setDisclaimerOverlay(null);
      setStatus(EditorState.IDLE);
    }
  }, [originalImage]);

  useEffect(() => {
    if (activeTool !== 'TEXT_EDITOR') return;
    const updateDims = () => {
      if (imageRef.current) {
        const { offsetWidth, offsetHeight } = imageRef.current;
        if (offsetWidth > 0 && offsetHeight > 0) {
          setContainerDims({ width: offsetWidth, height: offsetHeight });
        }
      }
    };
    const t1 = setTimeout(updateDims, 50);
    const t2 = setTimeout(updateDims, 250);
    window.addEventListener('resize', updateDims);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', updateDims);
    };
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'TEXT_EDITOR') return;
    let disconnect: (() => void) | null = null;
    const id = setTimeout(() => {
      if (imageRef.current) {
        const ro = new ResizeObserver(() => refreshDimensions());
        ro.observe(imageRef.current);
        disconnect = () => ro.disconnect();
      }
    }, 100);
    return () => {
      clearTimeout(id);
      if (disconnect) disconnect();
    };
  }, [activeTool, refreshDimensions]);


  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 sm:px-6 sm:py-8 lg:px-8 lg:pt-8 lg:pb-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Panel: Controls */}
        <div className="lg:col-span-1 bg-slate-800/50 rounded-2xl p-6 border border-slate-700 self-start">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold text-white">Text Editor</h2>
            <button onClick={onReset} className="text-sm text-slate-400 hover:text-white transition-colors">&larr; Start Over</button>
          </div>
          <p className="text-[11px] text-slate-400 mb-6 leading-relaxed bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
            <span className="text-indigo-400 font-bold uppercase text-[9px] block mb-1">Instructions:</span>
            Upload image, change the text, apply changes with the modified text, then click on the add disclaimer button as a last step.
          </p>

          <div className="mb-6 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
              <p className="text-sm text-indigo-200 leading-relaxed">
                  <span className="font-bold">💡 Come funziona:</span> Modifica il testo desiderato e applica i cambiamenti. Il testo legale (disclaimer) verrà rimosso in automatico per evitare errori dato il font piccolo; clicca su <span className="font-bold">"Add disclaimer text"</span> per riaggiungerlo e posizionarlo manualmente come ultimo passaggio.
              </p>
          </div>

          <div className="space-y-6">
            {/* Group 1: AI Magic Tools */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Magic Tools</label>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  onClick={handleDetectText} 
                  disabled={status === EditorState.LOADING || (!image && !originalImage)} 
                  variant="secondary"
                  className="text-xs py-2 h-10"
                  icon={<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
                >
                  {status === EditorState.LOADING ? 'Detecting...' : 'Detect Text'}
                </Button>
                <Button 
                  onClick={handleRemoveDisclaimer} 
                  disabled={status === EditorState.LOADING || (!image && !originalImage)} 
                  variant="outline"
                  className="text-xs py-2 h-10 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500"
                  icon={<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                >
                  Remove Legal
                </Button>
              </div>
            </div>

            {/* Group 3: Content Editing */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Detected Content</label>
                <span className="text-[10px] text-slate-600">{textBlocks.length} blocks found</span>
              </div>
              
              <div className="max-h-[240px] overflow-y-auto pr-2 space-y-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                {status === EditorState.LOADING && textBlocks.length === 0 ? (
                  <div className="space-y-2 animate-pulse">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-12 bg-slate-800/50 rounded-lg border border-slate-700/30" />
                    ))}
                  </div>
                ) : textBlocks.length > 0 ? (
                  textBlocks.map((block, index) => (
                    <div key={index} className="group relative">
                      <textarea
                        value={editedBlocks[index] || ''}
                        onChange={(e) => handleTextBlockChange(index, e.target.value)}
                        className="w-full bg-slate-900/50 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300 focus:ring-1 focus:ring-indigo-500 outline-none transition-all group-hover:border-slate-700"
                        rows={2}
                      />
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[8px] bg-slate-800 text-slate-500 px-1 rounded border border-slate-700">#{index + 1}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center border-2 border-dashed border-slate-800 rounded-xl">
                    <p className="text-xs text-slate-600 italic">No text detected yet.</p>
                  </div>
                )}
              </div>
              
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest block ml-1">Step 1</span>
                <Button 
                  onClick={handleReplaceText} 
                  disabled={status === EditorState.LOADING || textBlocks.length === 0} 
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-sm py-3"
                >
                  {status === EditorState.LOADING ? 'Generating...' : 'Apply Changes'}
                </Button>
              </div>
            </div>

            {/* Group 2: Disclaimer Overlay (Moved to bottom) */}
            <div className="bg-slate-900/40 rounded-xl border border-slate-700/50 p-4 space-y-3">
              <div className="flex justify-between items-center">
                <label 
                  onClick={handleAddDisclaimerOverlay}
                  className="text-[10px] font-bold text-slate-500 uppercase tracking-widest cursor-pointer hover:text-indigo-400 transition-colors"
                >
                  Disclaimer
                </label>
                {disclaimerOverlay && (
                  <button onClick={() => setDisclaimerOverlay(null)} className="text-[10px] text-rose-400 hover:text-rose-300">Discard</button>
                )}
              </div>
              
              {!disclaimerOverlay ? (
                <div className="space-y-1">
                  <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest block ml-1">Step 1</span>
                  <Button 
                    onClick={handleAddDisclaimerOverlay} 
                    disabled={status === EditorState.LOADING} 
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-[11px] py-2"
                  >
                    Add Disclaimer to Image
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  {/* Formatting Controls */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 uppercase font-bold">Font Family</label>
                      <select 
                        value={disclaimerOverlay.fontFamily}
                        onChange={(e) => setDisclaimerOverlay({ ...disclaimerOverlay, fontFamily: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="Arial">Arial</option>
                        <option value="Inter">Inter</option>
                        <option value="Montserrat">Montserrat</option>
                        <option value="Georgia">Serif</option>
                        <option value="Courier New">Monospace</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 uppercase font-bold">Font Size</label>
                      <input 
                        type="number"
                        value={disclaimerOverlay.fontSize}
                        onChange={(e) => setDisclaimerOverlay({ ...disclaimerOverlay, fontSize: parseInt(e.target.value) || 12 })}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 uppercase font-bold">Alignment</label>
                    <div className="flex bg-slate-950 rounded border border-slate-800 p-0.5">
                      {(['left', 'center', 'right'] as TextAlign[]).map((align) => (
                        <button
                          key={align}
                          onClick={() => setDisclaimerOverlay({ ...disclaimerOverlay, textAlign: align })}
                          className={`flex-1 py-1 text-[10px] rounded transition-all ${
                            disclaimerOverlay.textAlign === align 
                            ? 'bg-indigo-600 text-white shadow-sm' 
                            : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {align.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                      <Button onClick={handleApplyOverlay} variant="primary" className="flex-1 text-[11px] py-2">Apply</Button>
                      <Button onClick={handleDownload} variant="outline" className="flex-1 text-[11px] py-2">Download</Button>
                  </div>
                  <p className="text-[9px] text-slate-500 text-center">The overlay remains editable until you download.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Image Preview */}
        <div 
          ref={containerRef} 
          className="lg:col-span-2 relative min-h-[400px] bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-center overflow-hidden"
          onClick={() => setSelectedTextId(null)}
        >
          {status === EditorState.LOADING && (
            <div className="absolute inset-0 bg-slate-900/80 flex flex-col items-center justify-center z-20">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
                <p className="text-indigo-400 text-sm font-medium animate-pulse">{loadingMessage}</p>
            </div>
          )}
          {image ? (
            <div className="relative">
                <img 
                  ref={imageRef} 
                  src={image} 
                  alt="Edited creative" 
                  className="max-h-[80vh] max-w-full object-contain cursor-pointer hover:opacity-95 transition-opacity" 
                  onClick={() => setIsViewerOpen(true)}
                />
                <ImageViewer 
                  isOpen={isViewerOpen} 
                  onClose={() => setIsViewerOpen(false)} 
                  imageSrc={image} 
                  altText="Generated Text Edit" 
                  overlay={disclaimerOverlay}
                  editorDims={containerDims}
                />
                {disclaimerOverlay && (
                  <DraggableText
                    {...disclaimerOverlay}
                    containerWidth={containerDims.width}
                    containerHeight={containerDims.height}
                    isSelected={selectedTextId === disclaimerOverlay.id}
                    onSelect={() => setSelectedTextId(disclaimerOverlay.id)}
                    onUpdate={(data) => setDisclaimerOverlay({ ...disclaimerOverlay, ...data })}
                  />
                )}
            </div>
          ) : (
            <div className="text-center text-slate-500">
              <p>Upload an image to begin.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
