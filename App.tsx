
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Point, DrawingPath, GestureMode } from './types';
import { analyzeSketch } from './services/geminiService';

const App: React.FC = () => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [brushWidth, setBrushWidth] = useState(5);
  const [gestureMode, setGestureMode] = useState<GestureMode>(GestureMode.IDLE);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Refs to maintain current values across high-frequency callback cycles
  const colorRef = useRef(brushColor);
  const widthRef = useRef(brushWidth);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const pathsRef = useRef<DrawingPath[]>([]);
  const currentPathRef = useRef<Point[]>([]);
  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  // Keep refs in sync with UI state
  useEffect(() => {
    colorRef.current = brushColor;
  }, [brushColor]);

  useEffect(() => {
    widthRef.current = brushWidth;
  }, [brushWidth]);

  const renderMainCanvas = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    pathsRef.current.forEach(path => {
      if (path.points.length < 2) return;
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      ctx.stroke();
    });
  }, []);

  const finishPath = useCallback(() => {
    if (currentPathRef.current.length > 0) {
      pathsRef.current.push({
        points: [...currentPathRef.current],
        color: colorRef.current,
        width: widthRef.current,
      });
      currentPathRef.current = [];
      renderMainCanvas();
    }
  }, [renderMainCanvas]);

  const drawLive = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || currentPathRef.current.length < 2) return;

    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = widthRef.current;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const points = currentPathRef.current;
    const last = points[points.length - 2];
    const current = points[points.length - 1];

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
  }, []);

  const onResults = useCallback((results: any) => {
    if (!overlayCanvasRef.current || !canvasRef.current) return;

    const canvasCtx = overlayCanvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

    // Flip horizontally for mirror effect
    canvasCtx.translate(overlayCanvasRef.current.width, 0);
    canvasCtx.scale(-1, 1);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      
      // Draw skeletons for feedback
      window.drawConnectors(canvasCtx, landmarks, window.HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
      window.drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 2 });

      const indexTip = landmarks[8];
      const middleTip = landmarks[12];
      const indexPip = landmarks[6];

      const x = (1 - indexTip.x) * overlayCanvasRef.current.width;
      const y = indexTip.y * overlayCanvasRef.current.height;

      // Logic: Index finger extended and Middle finger retracted = DRAW
      const isIndexExtended = indexTip.y < indexPip.y;
      const isMiddleExtended = middleTip.y < indexPip.y;

      if (isIndexExtended && !isMiddleExtended) {
        setGestureMode(GestureMode.DRAWING);
        currentPathRef.current.push({ x, y });
        drawLive();
      } else if (isIndexExtended && isMiddleExtended) {
        setGestureMode(GestureMode.HOVERING);
        finishPath();
      } else {
        setGestureMode(GestureMode.IDLE);
        finishPath();
      }

      // Draw cursor pointer using ref values for visual consistency
      canvasCtx.beginPath();
      canvasCtx.arc(x, y, widthRef.current + 2, 0, 2 * Math.PI);
      canvasCtx.fillStyle = colorRef.current;
      canvasCtx.fill();
    } else {
      setGestureMode(GestureMode.IDLE);
      finishPath();
    }

    canvasCtx.restore();
  }, [drawLive, finishPath]);

  const initializeCamera = useCallback(async () => {
    setCameraError(null);
    if (!window.Hands || !window.Camera) return;

    try {
      if (!handsRef.current) {
        const hands = new window.Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.7,
        });

        hands.onResults(onResults);
        handsRef.current = hands;
      }

      if (videoRef.current) {
        cameraRef.current = new window.Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && handsRef.current) {
              try {
                await handsRef.current.send({ image: videoRef.current });
              } catch (e) {
                console.error("Processing error:", e);
              }
            }
          },
          width: 1280,
          height: 720,
        });

        await cameraRef.current.start();
        setIsCameraReady(true);
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
        setCameraError("Camera permission was denied. Please allow camera access in your browser settings and refresh.");
      } else {
        setCameraError(`Failed to start camera: ${err.message || 'Unknown error'}`);
      }
      setIsCameraReady(false);
    }
  }, [onResults]);

  useEffect(() => {
    initializeCamera();

    return () => {
      if (handsRef.current) handsRef.current.close();
    };
  }, [initializeCamera]);

  const clearCanvas = () => {
    pathsRef.current = [];
    currentPathRef.current = [];
    renderMainCanvas();
    setAnalysis(null);
  };

  const handleAnalyze = async () => {
    if (!canvasRef.current || pathsRef.current.length === 0) return;
    setIsAnalyzing(true);
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const result = await analyzeSketch(dataUrl);
    setAnalysis(result);
    setIsAnalyzing(false);
  };

  return (
    <div className="relative w-full h-screen bg-slate-950 flex flex-col items-center justify-center overflow-hidden">
      {/* Background Camera Layer */}
      <video
        ref={videoRef}
        className="absolute top-0 left-0 w-full h-full object-cover mirror opacity-40 grayscale"
        autoPlay
        playsInline
      />

      {/* Permission Error Overlay */}
      {cameraError && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 text-center px-6 border-4 border-red-500/20">
          <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Camera Access Required</h2>
          <p className="text-slate-400 max-w-md mb-8">{cameraError}</p>
          <button 
            onClick={initializeCamera}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20"
          >
            Retry Camera Connection
          </button>
        </div>
      )}

      {/* Persistent Drawing Layer */}
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
      />

      {/* Real-time Hand Tracking Feedback Overlay */}
      <canvas
        ref={overlayCanvasRef}
        width={1280}
        height={720}
        className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
      />

      {/* Floating UI Controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 p-4 rounded-2xl shadow-2xl z-10">
        <div className="flex flex-col gap-1 pr-4 border-r border-slate-700">
          <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Brush Color</label>
          <div className="flex gap-2">
            {['#ffffff', '#ef4444', '#22c55e', '#3b82f6', '#eab308'].map(c => (
              <button
                key={c}
                onClick={() => setBrushColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${brushColor === c ? 'border-white scale-125' : 'border-transparent opacity-60 hover:opacity-100'}`}
                style={{ backgroundColor: c }}
                title={`Set color to ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 pr-4 border-r border-slate-700">
          <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Size: {brushWidth}px</label>
          <input 
            type="range" 
            min="2" 
            max="40" 
            value={brushWidth} 
            onChange={(e) => setBrushWidth(parseInt(e.target.value))}
            className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </div>

        <div className="flex gap-2">
          <button 
            onClick={clearCanvas}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-semibold transition-colors"
          >
            Clear
          </button>
          <button 
            onClick={handleAnalyze}
            disabled={isAnalyzing || pathsRef.current.length === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
          >
            {isAnalyzing ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : null}
            Analyze
          </button>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="absolute top-8 left-8 flex flex-col gap-2 pointer-events-none">
        <h1 className="text-2xl font-black bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">VisionDraw AI</h1>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isCameraReady ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`} />
          <span className="text-xs text-slate-400 font-medium">Camera: {isCameraReady ? 'Live' : 'Initializing...'}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${gestureMode === GestureMode.DRAWING ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]' : 'bg-slate-600'}`} />
          <span className="text-xs text-slate-400 font-medium tracking-tight">Hand: {gestureMode}</span>
        </div>
      </div>

      {/* AI Analysis Modal */}
      {analysis && (
        <div className="absolute top-8 right-8 w-64 bg-slate-900/90 backdrop-blur-lg border border-slate-700 p-4 rounded-xl shadow-xl animate-in slide-in-from-right duration-300">
           <div className="flex justify-between items-start mb-2">
            <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest">AI Feedback</h3>
            <button onClick={() => setAnalysis(null)} className="text-slate-500 hover:text-white transition-colors">&times;</button>
           </div>
           <p className="text-sm text-slate-200 leading-relaxed italic">"{analysis}"</p>
        </div>
      )}

      {/* Helper Overlay */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-white/10 backdrop-blur rounded-full text-[10px] text-white/70 font-bold uppercase tracking-widest pointer-events-none border border-white/5">
        Index Finger Up = Draw | Two Fingers = Hover | Closed Hand = Idle
      </div>
    </div>
  );
};

export default App;
