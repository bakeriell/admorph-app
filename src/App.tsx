import React, { useState, useEffect } from 'react';
import { EditorState, ToolType } from './types';
import { ImageUpload } from './components/ImageUpload';
import { Editor } from './components/Editor';
import { BackgroundEditor } from './components/BackgroundEditor';
import { TextEditor } from './components/TextEditor';
import { Button } from './components/Button';
import { getGeminiApiKey } from './config';
import { APP_UPDATE_NUMBER } from './version';

const App: React.FC = () => {
  const [status, setStatus] = useState<EditorState>(EditorState.IDLE);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isCheckingKey, setIsCheckingKey] = useState<boolean>(true);
  const [activeTool, setActiveTool] = useState<ToolType>('STORY');

  useEffect(() => {
    const checkKey = async () => {
      if (getGeminiApiKey()) {
        setHasApiKey(true);
        setIsCheckingKey(false);
        return;
      }
      try {
        if (typeof window !== 'undefined' && window.aistudio?.hasSelectedApiKey) {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        } else {
          setHasApiKey(true);
        }
      } catch (e) {
        console.error("Error checking API key:", e);
      } finally {
        setIsCheckingKey(false);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    try {
      if (window.aistudio && window.aistudio.openSelectKey) {
        await window.aistudio.openSelectKey();
        setHasApiKey(true);
      }
    } catch (e) {
      console.error("Error selecting API key:", e);
    }
  };

  const handleImageSelected = (base64: string, file: File) => {
    setOriginalImage(base64);
    setStatus(EditorState.READY);
  };

  const handleReset = () => {
    setOriginalImage(null);
    setStatus(EditorState.IDLE);
  };

  if (isCheckingKey) {
     return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500"></div>
        </div>
     );
  }

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-md w-full text-center shadow-2xl">
           <div className="w-16 h-16 bg-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
           </div>
           <h2 className="text-2xl font-bold text-white mb-2">API Key Required</h2>
           <p className="text-slate-400 mb-6">
             To use the advanced <b>Nano Banana Pro</b> (Gemini 3 Pro Image) model for high-quality ad generation, you must select a paid API key.
           </p>
           
           <Button onClick={handleSelectKey} className="w-full mb-4 py-3">
             Select API Key
           </Button>
           
           <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300 underline">
             Learn more about billing
           </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-indigo-500/30">
      <div className="sticky top-0 z-50">
        <div className="bg-indigo-600/90 text-white text-center py-1.5 px-2 text-xs font-medium">
          Update #{APP_UPDATE_NUMBER}
        </div>
        {/* Navbar */}
        <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="font-bold text-xl tracking-tight text-white">Senza(Tante)Bestemmie</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-slate-400">
               <button 
                onClick={() => { setActiveTool('STORY'); }}
                className={`transition-colors ${activeTool === 'STORY' ? 'text-white font-medium' : 'hover:text-white'}`}
               >
                 Format Converter
               </button>
               <div className="h-4 w-px bg-slate-700"></div>
               <button 
                onClick={() => { setActiveTool('BACKGROUND'); }}
                className={`transition-colors ${activeTool === 'BACKGROUND' ? 'text-white font-medium' : 'hover:text-white'}`}
               >
                 Background Studio
               </button>
               <div className="h-4 w-px bg-slate-700"></div>
               <button 
                onClick={() => { setActiveTool('TEXT_EDITOR'); }}
                className={`transition-colors ${activeTool === 'TEXT_EDITOR' ? 'text-white font-medium' : 'hover:text-white'}`}
               >
                 Text Editor
               </button>
            </div>
          </div>
        </div>
      </nav>
      </div>

      {/* Main Content */}
      <main className="flex flex-col">
        <div className={status === EditorState.IDLE ? 'block' : 'hidden'}>
          <div className="flex-1 flex flex-col items-center justify-center p-4 py-12">
            <div className="text-center max-w-2xl mx-auto mb-10">
              
              {/* Tool Toggle (Hero) */}
              <div className="inline-flex bg-slate-800 rounded-full p-1 mb-8 border border-slate-700">
                <button 
                  onClick={() => setActiveTool('STORY')}
                  className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                    activeTool === 'STORY' 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Format Converter
                </button>
                <button 
                  onClick={() => setActiveTool('BACKGROUND')}
                  className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                    activeTool === 'BACKGROUND' 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Background Studio
                </button>
                <button 
                  onClick={() => setActiveTool('TEXT_EDITOR')}
                  className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                    activeTool === 'TEXT_EDITOR' 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Text Editor
                </button>
              </div>

              {activeTool === 'STORY' ? (
                <>
                  <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 tracking-tight animate-in fade-in slide-in-from-bottom-4 duration-500">
                    Smart <br/>
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">Format Conversion</span>
                  </h1>
                  <p className="text-lg text-slate-400 mb-8 leading-relaxed">
                    resize to different formats hopefully senza tante bestemmie.
                  </p>
                </>
              ) : activeTool === 'BACKGROUND' ? (
                <>
                  <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 tracking-tight animate-in fade-in slide-in-from-bottom-4 duration-500">
                    Professional <br/>
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">Background Replacement</span>
                  </h1>
                  <p className="text-lg text-slate-400 mb-8 leading-relaxed">
                    Upload a car image. We'll transport it to a modern city, luxury driveway, or scenic route while keeping every detail intact.
                  </p>
                </>
              ) : activeTool === 'TEXT_EDITOR' ? (
                <>
                  <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 tracking-tight animate-in fade-in slide-in-from-bottom-4 duration-500">
                    Intelligent <br/>
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400">Text Detection & Replacement</span>
                  </h1>
                  <p className="text-lg text-slate-400 mb-8 leading-relaxed">
                    Upload an image. We'll detect all text and let you edit it. Then, we'll regenerate the image with your changes.
                  </p>
                </>
              ) : null}
            </div>
            
            <div className="w-full max-w-xl mx-auto">
              <ImageUpload key={originalImage ? 'has-image' : 'idle'} onImageSelected={handleImageSelected} state={status} />
            </div>
          </div>
        </div>

        <div className={status !== EditorState.IDLE ? 'block' : 'hidden'}>
          <div className={activeTool === 'BACKGROUND' ? 'block' : 'hidden'}>
            <BackgroundEditor key={originalImage ?? 'idle'} originalImage={originalImage} onReset={handleReset} />
          </div>
          <div className={activeTool === 'TEXT_EDITOR' ? 'block' : 'hidden'}>
            <TextEditor key={originalImage ?? 'idle'} originalImage={originalImage} onReset={handleReset} activeTool={activeTool} />
          </div>
          <div className={activeTool === 'STORY' ? 'block' : 'hidden'}>
            <Editor key={originalImage ?? 'idle'} originalImage={originalImage} onReset={handleReset} />
          </div>
        </div>
      </main>
      
      {/* Footer */}
      <footer className="border-t border-slate-800 h-[14px] flex items-center justify-center bg-slate-950/50">
         <div className="text-slate-600 text-[8px] uppercase tracking-[0.2em] leading-none">
           &copy; {new Date().getFullYear()} Senza(Tante)Bestemmie. Powered by Gemini 3 Pro Image.
         </div>
      </footer>
    </div>
  );
};

export default App;