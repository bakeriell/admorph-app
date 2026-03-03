import React, { useState, useRef, useEffect } from 'react';
import { Button } from './Button';
import { EditorState } from '../types';
import { replaceBackground, extractLegalText, detectMovableElements, segmentElement } from '../services/geminiService';
import { DraggableText, TextAlign } from './DraggableText';
import { ImageViewer } from './ImageViewer';

interface BackgroundEditorProps {
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

const AVAILABLE_FONTS = [
  'Inter', 'Montserrat', 'Arial', 'Verdana', 'Times New Roman', 'Georgia', 'Courier New', 'Brush Script MT', 'Trebuchet MS', 'Comic Sans MS'
];

const PRESET_COLORS = [
  '#FFFFFF', '#000000', '#F43F5E', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'
];

type Category = 'Modern City' | 'Lifestyle' | 'Outdoors' | 'Studio';

const PRESETS: Record<Category, { id: string; label: string; prompt: string }[]> = {
  'Modern City': [
    { id: 'city_night', label: 'Neon Night', prompt: 'A modern city street at night with neon lights, reflections on the wet road, professional DSLR cinematic lighting, high-end automotive photography' },
    { id: 'city_day', label: 'Downtown Day', prompt: 'A bright downtown city street during the day, modern glass buildings, clear sky, professional DSLR sharp focus' },
    { id: 'city_rain', label: 'Rainy Street', prompt: 'A rainy city street, puddles reflecting city lights, moody atmosphere, cinematic DSLR photography' },
    { id: 'city_bridge', label: 'Suspension Bridge', prompt: 'On a large suspension bridge overlooking a city skyline at dusk, professional DSLR cinematic lighting' },
    { id: 'city_plaza', label: 'Urban Plaza', prompt: 'A wide modern urban plaza with minimalist architecture, polished stone floor, soft daylight, professional DSLR photography' },
    { id: 'city_tunnel', label: 'Underpass Glow', prompt: 'A modern concrete underpass with warm linear lighting, cinematic shadows, high-end automotive photography style' },
  ],
  'Lifestyle': [
    { id: 'life_driveway', label: 'Luxury Driveway', prompt: 'A luxury driveway in front of a modern mansion, daytime, bright sunlight, clean concrete, professional DSLR' },
    { id: 'life_cafe', label: 'Street Cafe', prompt: 'Parked outside a chic European street cafe, cobblestone street, warm sunlight, professional DSLR cinematic' },
    { id: 'life_beachhouse', label: 'Beach House', prompt: 'Parked in front of a modern beach house, ocean in the background, sunny day, professional DSLR' },
    { id: 'life_suburb', label: 'Quiet Suburb', prompt: 'A quiet, upscale suburban street with manicured lawns, golden hour, professional DSLR cinematic' },
    { id: 'life_marina', label: 'Luxury Marina', prompt: 'Parked at a high-end yacht marina at sunset, expensive yachts in background, golden hour, professional DSLR cinematic' },
    { id: 'life_vineyard', label: 'Estate Vineyard', prompt: 'A gravel path through a lush Italian vineyard, elegant estate house in distance, soft morning light, professional DSLR' },
  ],
  'Outdoors': [
    { id: 'out_scenic', label: 'Scenic Route', prompt: 'A scenic mountain road at sunset, golden hour lighting, dramatic clouds, beautiful landscape, professional DSLR' },
    { id: 'out_desert', label: 'Desert Highway', prompt: 'A straight desert highway during the day, clear blue sky, arid landscape, hot sun, professional DSLR' },
    { id: 'out_forest', label: 'Pine Forest', prompt: 'A road winding through a dense pine forest, misty morning, rays of sunlight, professional DSLR' },
    { id: 'out_coast', label: 'Coastal Road', prompt: 'A winding coastal road right next to the ocean, crashing waves, bright sunny day, professional DSLR' },
    { id: 'out_snow', label: 'Alpine Pass', prompt: 'A cleared mountain road through deep snow, pine trees, bright winter sun, crisp details, professional DSLR' },
    { id: 'out_canyon', label: 'Red Rock Canyon', prompt: 'A winding road through a dramatic red rock canyon, low sun creating long shadows, cinematic landscape, professional DSLR' },
  ],
  'Studio': [
    { id: 'studio_dark', label: 'Dark Infinity', prompt: 'A dark infinity cove studio setup, dramatic rim lighting, reflections on the floor, professional DSLR cinematic' },
    { id: 'studio_white', label: 'White Cyclorama', prompt: 'A pure white cyclorama studio, bright even lighting, clean reflections, professional DSLR' },
    { id: 'studio_rim', label: 'Dramatic Rim', prompt: 'A dark studio with dramatic blue and red rim lighting, moody and aggressive, professional DSLR' },
    { id: 'studio_loft', label: 'Industrial Loft', prompt: 'An industrial loft studio with brick walls, large windows, concrete floor, professional DSLR' },
    { id: 'studio_neon', label: 'Linear Neon', prompt: 'A dark studio with linear neon light tubes reflecting on the car body, professional DSLR' },
    { id: 'studio_gold', label: 'Golden Hour Studio', prompt: 'A high-end studio with warm golden lighting panels, soft transitions, elegant reflections, commercial automotive photography' },
    { id: 'studio_minimal', label: 'Minimalist Grey', prompt: 'A clean minimalist grey studio, soft top-down lighting, subtle floor reflections, premium brand aesthetic, professional DSLR' },
  ]
};

export const BackgroundEditor: React.FC<BackgroundEditorProps> = ({ originalImage, onReset }) => {
  const [status, setStatus] = useState<EditorState>(EditorState.READY);
  const [image, setImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Category>('Studio');
  const [selectedPreset, setSelectedPreset] = useState<string>('studio_dark');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  // Car is always preserved (high-fidelity composite). No toggle.

  const [extractedLegalText, setExtractedLegalText] = useState<string>('');
  const [isExtractingText, setIsExtractingText] = useState(false);
  const [disclaimer, setDisclaimer] = useState<TextOverlayData | null>(null);
  const [isTextSelected, setIsTextSelected] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [containerDims, setContainerDims] = useState({ width: 0, height: 0 });

  const imageRef = useRef<HTMLImageElement>(null);

  // Helper to remove magenta background (chroma key)
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
        const threshold = 80; 
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r > 255 - threshold && g < threshold && b > 255 - threshold) {
            data[i + 3] = 0; 
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL());
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  };

  useEffect(() => {
    const handleInitialProcessing = async () => {
      if (!originalImage) return;
      try {
        const mimeType = originalImage.match(/data:([^;]+);/)?.[1] || 'image/png';
        const text = await extractLegalText(originalImage, mimeType);
        setExtractedLegalText(text || '');
      } catch (e) {
        console.error("Error extracting legal text on mount:", e);
      }
    };
    
    handleInitialProcessing();
  }, [originalImage]);

  useEffect(() => {
    const updateDims = () => {
      if (imageRef.current) {
        setContainerDims({
          width: imageRef.current.offsetWidth,
          height: imageRef.current.offsetHeight,
        });
      }
    };
    window.addEventListener('resize', updateDims);
    const timer = setTimeout(updateDims, 100);
    return () => {
      window.removeEventListener('resize', updateDims);
      clearTimeout(timer);
    };
  }, [image]);

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
        addDisclaimer();
      }
    } catch (e: any) {
      if (e.message === 'INVALID_API_KEY' || e.message === 'MODEL_NOT_FOUND') {
        throw e;
      }
      console.error(e);
      addDisclaimer();
    } finally {
      setIsExtractingText(false);
    }
  };

  const addDisclaimer = (initialText?: string) => {
    if (!imageRef.current) return;
    const width = imageRef.current.offsetWidth;
    const height = imageRef.current.offsetHeight;
    setDisclaimer({
      id: 'disclaimer-1',
      text: initialText || '*Terms and conditions apply. Offer valid while supplies last.',
      x: width * 0.1,
      y: height * 0.85,
      width: width * 0.8,
      height: 60,
      fontSize: 14,
      textAlign: 'center',
      fontFamily: 'Inter',
      color: '#FFFFFF'
    });
    setIsTextSelected(true);
  };

  const handleGenerate = async () => {
    const presetPrompt = PRESETS[activeTab].find(p => p.id === selectedPreset)?.prompt || '';
    const activePrompt = customPrompt.trim() ? `${presetPrompt}. ${customPrompt}` : presetPrompt;

    if (!originalImage || !activePrompt.trim()) return;
    
    setStatus(EditorState.GENERATING);
    setDisclaimer(null);
    try {
      const mimeType = originalImage.match(/data:([^;]+);/)?.[1] || 'image/png';

      // Run background generation and vehicle detection in parallel (faster)
      const [newImage, elements] = await Promise.all([
        replaceBackground(originalImage, mimeType, activePrompt),
        detectMovableElements(originalImage, mimeType),
      ]);

      const labelLower = (l: string) => l.toLowerCase();
      const vehicle = elements.find(el => {
        const l = labelLower(el.label);
        return l.includes('product') || l.includes('vehicle') || l.includes('car') || l.includes('automobile');
      });

      if (vehicle) {
        try {
          const [ymin, xmin, ymax, xmax] = vehicle.box_2d;
          const originalImg = new Image();
          await new Promise((resolve) => { originalImg.onload = resolve; originalImg.src = originalImage; });

          const origW = originalImg.naturalWidth;
          const origH = originalImg.naturalHeight;
          const cropW = (xmax - xmin) * origW / 1000;
          const cropH = (ymax - ymin) * origH / 1000;
          const cropX = xmin * origW / 1000;
          const cropY = ymin * origH / 1000;

          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = cropW;
          cropCanvas.height = cropH;
          const cropCtx = cropCanvas.getContext('2d');
          if (cropCtx) {
            cropCtx.drawImage(originalImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            const cropBase64 = cropCanvas.toDataURL(mimeType);

            const segmented = await segmentElement(cropBase64, mimeType, vehicle.label);
            const transparentCar = await removeMagentaBackground(segmented);

            const bgImg = new Image();
            const carImg = new Image();
            await new Promise((resolve) => { bgImg.onload = resolve; bgImg.src = newImage; });
            await new Promise((resolve) => { carImg.onload = resolve; carImg.src = transparentCar; });

            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = bgImg.naturalWidth;
            finalCanvas.height = bgImg.naturalHeight;
            const finalCtx = finalCanvas.getContext('2d');
            if (finalCtx) {
              finalCtx.drawImage(bgImg, 0, 0);
              const scaleX = finalCanvas.width / origW;
              const scaleY = finalCanvas.height / origH;
              finalCtx.drawImage(carImg, 0, 0, cropW, cropH, cropX * scaleX, cropY * scaleY, cropW * scaleX, cropH * scaleY);
              setImage(finalCanvas.toDataURL(mimeType));
            } else {
              setImage(newImage);
            }
          } else {
            setImage(newImage);
          }
        } catch (fidelityError) {
          console.warn("Car composite failed, using AI result:", fidelityError);
          setImage(newImage);
        }
      } else {
        setImage(newImage);
      }
      
      setStatus(EditorState.COMPLETE);
    } catch (error: any) {
      if (error.message === 'INVALID_API_KEY' || error.message === 'MODEL_NOT_FOUND') {
        throw error;
      }
      console.error("Error replacing background:", error);
      setStatus(EditorState.ERROR);
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

  const handleDownload = () => {
    if (!image) return;
    if (!disclaimer) {
        const link = document.createElement('a');
        link.href = image;
        link.download = `ad-morph-background-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    if (!image.startsWith('data:')) img.crossOrigin = "anonymous";

    img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        if (ctx) {
             ctx.imageSmoothingEnabled = true;
             ctx.imageSmoothingQuality = 'high';
             ctx.drawImage(img, 0, 0);
             if (disclaimer && containerDims.width > 0) {
                 const scale = img.naturalWidth / containerDims.width;
                 renderTextOnCanvas(ctx, disclaimer, scale);
             }
             const dataUrl = canvas.toDataURL('image/png');
             const link = document.createElement('a');
             link.href = dataUrl;
             link.download = `ad-morph-background-${Date.now()}.png`;
             document.body.appendChild(link);
             link.click();
             document.body.removeChild(link);
        }
    };
    img.src = image;
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 sm:px-6 sm:py-8 lg:px-8 lg:pt-8 lg:pb-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Background Studio</h2>
          <p className="text-slate-400">Professionally replace environments while keeping the vehicle untouched.</p>
        </div>
        <Button variant="outline" onClick={onReset} disabled={status === EditorState.GENERATING}>
          Start Over
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column */}
        <div className="lg:col-span-5 space-y-6">
          {/* Original Image */}
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 block">Original</span>
            <div className="flex justify-center bg-slate-900/50 rounded-lg overflow-hidden h-48">
              {originalImage && <img src={originalImage} className="h-full object-contain" alt="Original" />}
            </div>
          </div>

          {/* Background Settings */}
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
            <div className="mb-6 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                <p className="text-sm text-indigo-200 leading-relaxed">
                    <span className="font-bold">💡 Come funziona:</span> Scegli l'ambiente desiderato e genera l'immagine. Il testo legale (disclaimer) verrà rimosso in automatico per evitare errori dato il font piccolo; clicca su <span className="font-bold">"Add disclaimer text"</span> per riaggiungerlo e posizionarlo manualmente.
                </p>
            </div>
            <h3 className="text-white font-medium mb-4">Background Settings</h3>
            
            {/* Tabs */}
            <div className="flex bg-slate-900 rounded-lg p-1 mb-6 border border-slate-700">
              {(['Modern City', 'Lifestyle', 'Outdoors', 'Studio'] as Category[]).map(tab => (
                <button 
                  key={tab} 
                  onClick={() => { setActiveTab(tab); setSelectedPreset(PRESETS[tab][0].id); }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === tab ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Preset Buttons */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {PRESETS[activeTab].map(preset => (
                <button 
                  key={preset.id} 
                  onClick={() => setSelectedPreset(preset.id)}
                  className={`p-3 rounded-lg text-sm font-medium transition-all text-left border ${selectedPreset === preset.id ? 'bg-slate-800 border-indigo-500 text-white' : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Refine Prompt */}
            <div className="space-y-2 mb-6">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Refine Prompt (Optional)</label>
              <textarea 
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none resize-none h-20" 
                placeholder="E.g., Make it look like a rainy night, add more street lights..." 
              />
            </div>

            <Button 
              onClick={handleGenerate} 
              disabled={status === EditorState.GENERATING} 
              className="w-full bg-indigo-600 hover:bg-indigo-700 py-3"
            >
              {status === EditorState.GENERATING ? 'Generating...' : 'Generate New Background'}
            </Button>
          </div>

          {/* Post-Editing Tools (Disclaimer) */}
          {status === EditorState.COMPLETE && image && (
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <h4 className="text-sm font-semibold text-slate-300 mb-3">Post-Editing Tools</h4>
              {!disclaimer ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    {extractedLegalText ? (
                      <Button variant="primary" onClick={() => addDisclaimer(extractedLegalText)} className="flex-1">
                        Add disclaimer text
                      </Button>
                    ) : (
                      <Button variant="primary" onClick={handleExtractLegalText} isLoading={isExtractingText} className="flex-1">
                        Add disclaimer text
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
                  
                  {/* Font Family */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wide">Font</label>
                    <select 
                      className="w-full bg-slate-900 text-slate-200 text-sm rounded-lg border border-slate-700 p-2 focus:ring-1 focus:ring-indigo-500 outline-none"
                      value={disclaimer.fontFamily}
                      onChange={(e) => setDisclaimer({...disclaimer, fontFamily: e.target.value})}
                    >
                      {AVAILABLE_FONTS.map(font => <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>)}
                    </select>
                  </div>

                  {/* Color */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wide">Color</label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {PRESET_COLORS.map(c => (
                          <button 
                            key={c} onClick={() => setDisclaimer({...disclaimer, color: c})}
                            className={`w-6 h-6 rounded-full border border-slate-600 flex-shrink-0 ${disclaimer.color === c ? 'ring-2 ring-white' : ''}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <input 
                        type="color" value={disclaimer.color}
                        onChange={(e) => setDisclaimer({...disclaimer, color: e.target.value})}
                        className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                      />
                    </div>
                  </div>

                  {/* Alignment & Size */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wide">Alignment & Size</label>
                    <div className="flex gap-2">
                      <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700 flex-1">
                        <button onClick={() => setDisclaimer({...disclaimer, textAlign: 'left'})} className={`flex-1 py-1 px-2 rounded text-xs ${disclaimer.textAlign === 'left' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>Left</button>
                        <button onClick={() => setDisclaimer({...disclaimer, textAlign: 'center'})} className={`flex-1 py-1 px-2 rounded text-xs ${disclaimer.textAlign === 'center' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>Center</button>
                        <button onClick={() => setDisclaimer({...disclaimer, textAlign: 'right'})} className={`flex-1 py-1 px-2 rounded text-xs ${disclaimer.textAlign === 'right' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>Right</button>
                      </div>
                      <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-2 border border-slate-700 w-24">
                        <span className="text-[10px] text-slate-500">Px</span>
                        <input type="number" min="6" max="120" value={disclaimer.fontSize} onChange={(e) => setDisclaimer({...disclaimer, fontSize: parseInt(e.target.value) || 12})} className="w-full bg-transparent text-white text-sm outline-none text-right" />
                      </div>
                    </div>
                  </div>
                  <input type="range" min="6" max="60" value={disclaimer.fontSize} onChange={(e) => setDisclaimer({...disclaimer, fontSize: parseInt(e.target.value)})} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" />

                  <div className="pt-4 border-t border-slate-700 space-y-3">
                    <Button onClick={() => setIsTextSelected(false)} variant="primary" className="w-full">Apply</Button>
                    <Button onClick={handleDownload} variant="secondary" className="w-full">Download Image</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="lg:col-span-7">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700 h-auto min-h-[400px] flex flex-col">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 block">Result</span>
            <div className="flex-1 flex items-center justify-center bg-slate-900/50 rounded-lg border-2 border-dashed border-slate-800 relative overflow-hidden">
              {status === EditorState.GENERATING ? (
                <div className="flex flex-col items-center animate-pulse">
                  <div className="h-16 w-16 bg-indigo-600 rounded-full mb-4 animate-bounce opacity-50"></div>
                  <p className="text-indigo-400 font-medium">Replacing background...</p>
                </div>
              ) : image ? (
                <div className="relative inline-block max-h-full w-full h-full flex items-center justify-center">
                  <div className="relative inline-block" style={{ maxHeight: '100%', maxWidth: '100%' }}>
                    <img 
                      ref={imageRef}
                      src={image} 
                      className="max-h-[600px] w-auto object-contain shadow-2xl cursor-pointer hover:opacity-95 transition-opacity select-none" 
                      alt="Result"
                      onClick={() => setIsViewerOpen(true)}
                      onLoad={() => {
                        if (imageRef.current) {
                          setContainerDims({
                            width: imageRef.current.offsetWidth,
                            height: imageRef.current.offsetHeight
                          });
                        }
                      }}
                    />
                    <ImageViewer 
                      isOpen={isViewerOpen} 
                      onClose={() => setIsViewerOpen(false)} 
                      imageSrc={image} 
                      altText="Generated Background" 
                      overlay={disclaimer}
                      editorDims={containerDims}
                    />
                    {disclaimer && containerDims.width > 0 && (
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
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500">
                  <div className="w-16 h-16 mx-auto bg-slate-800 rounded-full flex items-center justify-center mb-4">
                    <svg className="h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p>Generated result will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
