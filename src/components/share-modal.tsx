"use client"

import { NFTItem } from "@/app/dashboard/page"
import { motion, AnimatePresence } from "framer-motion"
import { X, Loader2 } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import { resolveImageUrl } from "@/lib/utils"
import { toPng } from 'html-to-image'
// @ts-ignore
import GIF from 'gif.js'
// @ts-ignore
import gifFrames from 'gif-frames'

interface ShareModalProps {
  item: NFTItem | null
  isOpen: boolean
  onClose: () => void
  onShowToast?: (type: 'success' | 'error' | 'info', title: string, message: string) => void
}

const SUPABASE_PROJECT_URL = "https://jpbalgwwwalofynoaavv.supabase.co";
const CANVAS_SIZE = 1200;

export function ShareModal({ item, isOpen, onClose, onShowToast }: ShareModalProps) {

  const showToast = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    if (onShowToast) {
      onShowToast(type, title, message)
    } else {
      alert(`${title}: ${message}`)
    }
  }
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState("")

  const hiddenShareCardRef = useRef<HTMLDivElement>(null)
  const droidImageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (isOpen) {
      setIsGenerating(false); setProgress(0); setStatusText("");
    }
  }, [isOpen]);

  if (!item) return null

  const originalImageUrl = resolveImageUrl(item.image)

  const isSuper = (item.batteryType === 'Super') || item.metadata?.attributes?.some((a: any) =>
    (a.trait_type === "upgrade level" && a.value?.toLowerCase().includes("super")) ||
    (a.trait_type === "background" && a.value === "apechain_orange")
  );

  const getCorrectAssetUrl = () => {
    const tokenId = item.tokenId || item.id;
    if (isSuper && (item.level || 1) > 1) {
      return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/super-gif/${tokenId}.gif`;
    }
    if ((item.level || 1) === 2) {
      return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/level2-gif/${tokenId}.gif`;
    }
    return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/level1/${tokenId}.png`;
  }

  const assetUrl = getCorrectAssetUrl();

  const tweetText = encodeURIComponent(
    `Evolution Complete ⚡️

🤖 My Droid #${item.tokenId} just hit Level ${item.level}${isSuper ? " SUPER" : ""} via the Upgrade Machine.

🔋 Secure your Battery for fusion: ApeDroidz.com`
  )
  const twitterUrl = `https://twitter.com/intent/tweet?text=${tweetText}`

  // === 1. ЗАГРУЗКА ИЗОБРАЖЕНИЯ ===
  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  // === 2. ЗАГРУЗКА BLOB URL (Anti-CORS) ===
  const fetchSafeBlobUrl = async (url: string): Promise<string> => {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch {
      // Fallback на оригинал если файла нет в Storage
      const fbResponse = await fetch(originalImageUrl);
      const fbBlob = await fbResponse.blob();
      return URL.createObjectURL(fbBlob);
    }
  };

  // === 3. РИСОВАНИЕ ЗАКРУГЛЕННОГО ПРЯМОУГОЛЬНИКА ===
  const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // === 4. РЕНДЕР ОДНОГО КАДРА НА CANVAS (СЛОЖНАЯ ЛОГИКА) ===
  const renderFrameToCanvas = async (
    droidFrame: HTMLCanvasElement | HTMLImageElement,
    backgroundImg: HTMLImageElement,
    logo1Img: HTMLImageElement,
    logo2Img: HTMLImageElement
  ): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d')!;

    // 4.1. Черный фон
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // 4.2. Машина апгрейда (позиционирование 1:1 с CSS версией)
    const bgScale = 1.45;
    const bgWidth = CANVAS_SIZE * bgScale;
    const bgHeight = (backgroundImg.height / backgroundImg.width) * bgWidth;
    const bgX = (CANVAS_SIZE - bgWidth) / 2;
    const bgY = CANVAS_SIZE * 0.38; // translate-y-45% аппроксимация
    ctx.drawImage(backgroundImg, bgX, bgY, bgWidth, bgHeight);

    // 4.3. Градиент-виньетка
    const gradient = ctx.createLinearGradient(0, CANVAS_SIZE, 0, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0.8)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // 4.4. ДРОИД (Матричные трансформации для перспективы)
    const droidW = CANVAS_SIZE * 0.38;
    const droidH = CANVAS_SIZE * 0.38;
    const droidX = CANVAS_SIZE * 0.296;
    const droidY = CANVAS_SIZE * 0.53;
    const borderRadius = droidW * 0.10;

    ctx.save();
    // Переносим точку отсчета в центр дроида для вращения
    ctx.translate(droidX + droidW / 2, droidY + droidH / 2);

    // Матрица трансформации (CSS: perspective(1000px) rotateY(-6deg) rotateX(2deg) rotateZ(-2deg) skewX(-2deg) skewY(1deg))
    const cosZ = 0.9994;
    const sinZ = -0.0349;
    const skewX = -0.035;
    const skewY = 0.017;
    const scaleX = 0.99;
    const scaleY = 0.995;

    const a = scaleX * cosZ;
    const b = scaleX * sinZ + skewY;
    const c = scaleY * (-sinZ) + skewX;
    const d = scaleY * cosZ;

    ctx.transform(a, b, c, d, 0, 0);
    ctx.translate(-droidW / 2, -droidH / 2);

    // Клиппинг (скругление углов)
    roundRect(ctx, 0, 0, droidW, droidH, borderRadius);
    ctx.clip();

    ctx.imageSmoothingEnabled = false; // Пиксель-арт четкость
    ctx.drawImage(droidFrame, 0, 0, droidW, droidH);
    ctx.restore();

    // 4.5. ТЕКСТ
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const accentColor = isSuper ? '#FF6B00' : '#3B82F6';

    (ctx as any).letterSpacing = '-2px';

    // "My ApeDroid #XXX"
    ctx.font = '400 52px Inter, Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`My ApeDroid #${item.tokenId}`, CANVAS_SIZE / 2, CANVAS_SIZE * 0.06);

    // "UPGRADED TO LEVEL 2"
    ctx.font = 'italic 900 88px Inter, Arial, sans-serif';
    const line2Y = CANVAS_SIZE * 0.115;

    if (isSuper) {
      const part1 = "UPGRADED TO ";
      const part2 = "LEVEL 2";
      const w1 = ctx.measureText(part1).width;
      const w2 = ctx.measureText(part2).width;
      const totalW = w1 + w2;
      const startX = (CANVAS_SIZE - totalW) / 2;

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(part1, startX, line2Y);
      ctx.fillStyle = accentColor;
      ctx.fillText(part2, startX + w1, line2Y);

      // "SUPER"
      ctx.textAlign = 'center';
      ctx.fillStyle = accentColor;
      ctx.fillText("SUPER", CANVAS_SIZE / 2, CANVAS_SIZE * 0.19);
    } else {
      const part1 = "UPGRADED TO ";
      const part2 = "LEVEL 2";
      const w1 = ctx.measureText(part1).width;
      const w2 = ctx.measureText(part2).width;
      const totalW = w1 + w2;
      const startX = (CANVAS_SIZE - totalW) / 2;

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(part1, startX, line2Y);
      ctx.fillStyle = accentColor;
      ctx.fillText(part2, startX + w1, line2Y);
    }

    // 4.6. ЛОГОТИПЫ (Compositing)
    const logoY = isSuper ? CANVAS_SIZE * 0.305 : CANVAS_SIZE * 0.23;
    const logoHeight = CANVAS_SIZE * 0.045;
    const logoGap = CANVAS_SIZE * 0.03;

    const logo1Width = (logo1Img.width / logo1Img.height) * logoHeight;
    const logo2HeightAdjusted = logoHeight * 1.1;
    const logo2Width = (logo2Img.width / logo2Img.height) * logo2HeightAdjusted;
    const totalLogosWidth = logo1Width + logoGap + logo2Width;
    const logo1X = (CANVAS_SIZE - totalLogosWidth) / 2;

    // Инверсия цвета логотипов через временный canvas (source-in)
    const tempCanvas1 = document.createElement('canvas');
    tempCanvas1.width = Math.ceil(logo1Width);
    tempCanvas1.height = Math.ceil(logoHeight);
    const tempCtx1 = tempCanvas1.getContext('2d')!;
    tempCtx1.drawImage(logo1Img, 0, 0, logo1Width, logoHeight);
    tempCtx1.globalCompositeOperation = 'source-in';
    tempCtx1.fillStyle = '#ffffff';
    tempCtx1.fillRect(0, 0, logo1Width, logoHeight);

    ctx.globalAlpha = 0.9;
    ctx.drawImage(tempCanvas1, logo1X, logoY);

    const logo2X = logo1X + logo1Width + logoGap;
    const tempCanvas2 = document.createElement('canvas');
    tempCanvas2.width = Math.ceil(logo2Width);
    tempCanvas2.height = Math.ceil(logo2HeightAdjusted);
    const tempCtx2 = tempCanvas2.getContext('2d')!;
    tempCtx2.drawImage(logo2Img, 0, 0, logo2Width, logo2HeightAdjusted);
    tempCtx2.globalCompositeOperation = 'source-in';
    tempCtx2.fillStyle = '#ffffff';
    tempCtx2.fillRect(0, 0, logo2Width, logo2HeightAdjusted);

    ctx.drawImage(tempCanvas2, logo2X, logoY - (logo2HeightAdjusted - logoHeight) / 2);
    ctx.globalAlpha = 1.0;

    return canvas;
  };

  // === 5. ГЕНЕРАТОР GIF (ОСНОВНАЯ ЛОГИКА) ===
  const generateGifCard = async () => {
    setIsGenerating(true); setProgress(0); setStatusText("Loading assets...");
    try {
      // 5.1. Загрузка статики
      const [backgroundImg, logo1Img, logo2Img] = await Promise.all([
        loadImage('/Upgrader_Finish.jpg'),
        loadImage('/Apechain.svg'),
        loadImage('/full-logo.svg')
      ]);

      // 5.2. Загрузка исходной гифки
      const safeUrl = await fetchSafeBlobUrl(assetUrl);
      if (!safeUrl) throw new Error("Could not load droid image");

      setStatusText("Extracting frames...");

      // 5.3. Разбор GIF на кадры
      const framesData = await gifFrames({
        url: safeUrl,
        frames: 'all',
        outputType: 'canvas',
        cumulative: true // Важно для оптимизированных GIF
      });

      const frameCanvases: HTMLCanvasElement[] = [];
      for (let i = 0; i < framesData.length; i++) {
        frameCanvases.push(framesData[i].getImage() as HTMLCanvasElement);
      }

      // 5.4. Настройка энкодера
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        workerScript: '/gif.worker.js',
        background: '#000000'
      });

      // 5.5. Сборка кадров
      for (let i = 0; i < frameCanvases.length; i++) {
        setStatusText(`Rendering frame ${i + 1}/${frameCanvases.length}`);
        setProgress(Math.round(((i + 1) / frameCanvases.length) * 80));

        // Рендерим сложный макет с текущим кадром дроида
        const fullFrameCanvas = await renderFrameToCanvas(frameCanvases[i], backgroundImg, logo1Img, logo2Img);
        const delay = framesData[i].frameInfo?.delay ? framesData[i].frameInfo.delay * 10 : 100;

        gif.addFrame(fullFrameCanvas, { delay: Math.max(delay, 80), copy: true });
      }

      URL.revokeObjectURL(safeUrl);
      setStatusText("Encoding GIF...");
      setProgress(90);

      // 5.6. Финал
      return new Promise<string>((resolve) => {
        gif.on('finished', (blob: Blob) => {
          setIsGenerating(false); setProgress(100); resolve(URL.createObjectURL(blob));
        });
        gif.render();
      });
    } catch (err) {
      console.error("GIF Gen Error:", err);
      setIsGenerating(false);
      showToast('error', 'Generation Failed', String(err));
      return null;
    }
  };

  const handleDownloadAndShare = async () => {
    const url = await generateGifCard();
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `ApeDroidz_Flex_${item.tokenId}.gif`;
      a.click();
      setTimeout(() => window.open(twitterUrl, '_blank'), 1500);
    }
  }

  // === ВИЗУАЛ ПРЕВЬЮ (CSS версия для UI) ===
  const FlexCard = ({ imgRef }: { imgRef?: React.RefObject<HTMLImageElement> }) => (
    <div className="relative w-full h-full bg-black flex flex-col items-center overflow-hidden font-sans">
      <div className="absolute top-[8%] w-full text-center z-30 flex flex-col items-center leading-none">
        <h2 className="text-white font-normal tracking-wide mb-[1%] text-[5cqw]" style={{ fontFamily: 'sans-serif' }}>
          My ApeDroid #{item.tokenId}
        </h2>
        <h1 className="text-white font-black italic tracking-tighter uppercase leading-[0.9] text-[7.5cqw]">
          UPGRADED TO <span className={isSuper ? "text-[#FF6B00]" : "text-[#3B82F6]"}>
            {isSuper ? "LEVEL 2 SUPER" : "LEVEL 2"}
          </span>
        </h1>
        <div className="flex items-center justify-center gap-[12%] mt-[4cqw] opacity-90">
          <div className="flex items-center h-[5cqw]"><img src="/Apechain.svg" alt="ApeChain" className="h-full w-auto" style={{ filter: 'grayscale(100%) brightness(1000%)' }} /></div>
          <div className="flex items-center h-[5.5cqw]"><img src="/full-logo.svg" alt="ApeDroidz" className="h-full w-auto brightness-0 invert" /></div>
        </div>
      </div>
      <div className="absolute inset-0 flex items-end justify-center z-10">
        <img src="/Upgrader_Finish.jpg" alt="Device" className="w-[145%] max-w-none h-auto object-cover translate-y-[45%]" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" style={{ zIndex: 15 }} />
      <div className="absolute z-20 overflow-hidden" style={{ top: '53%', left: '29.6%', width: '38%', height: '38%', transform: 'perspective(1000px) rotateY(-6deg) rotateX(2deg) rotateZ(-2deg) skewX(-2deg) skewY(1deg)', clipPath: 'inset(0 round 10%)' }}>
        <img ref={imgRef} src={assetUrl} crossOrigin="anonymous" alt="Droid" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} onError={(e) => { (e.target as HTMLImageElement).src = originalImageUrl }} />
      </div>
    </div>
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/90 backdrop-blur-md" />

          <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-md flex flex-col items-center">
            <button onClick={!isGenerating ? onClose : undefined} className={`absolute -top-12 right-0 p-2 text-white/50 hover:text-white transition-colors ${isGenerating ? 'opacity-0' : ''}`}><X size={24} /></button>

            {/* ПРЕВЬЮ */}
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden border border-white/20 shadow-2xl mb-6 bg-black" style={{ containerType: 'size' }}><FlexCard /></div>

            {/* КНОПКА (ОБНОВЛЕННАЯ ЛОГИКА СТИЛЕЙ) */}
            <div className="w-full">
              <button
                onClick={handleDownloadAndShare}
                disabled={isGenerating}
                className={`
                    relative w-full h-14 rounded-xl font-black uppercase tracking-widest text-sm transition-all shadow-lg flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed
                    ${isGenerating
                    ? "bg-blue-600 border-2 border-blue-600 text-white"
                    : "bg-white text-black border-2 border-white hover:bg-blue-600 hover:border-blue-600 hover:text-white hover:shadow-[0_0_20px_rgba(37,99,235,0.6)] cursor-pointer"
                  }
                  `}
              >
                {isGenerating ? (
                  <div className="flex items-center gap-3">
                    <Loader2 className="animate-spin h-5 w-5" />
                    <span>{statusText || "Rendering GIF..."}</span>
                  </div>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                    Download & Flex on X
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      <div style={{ position: 'fixed', top: '-9999px', left: '-9999px' }}>
        <div ref={hiddenShareCardRef} className="w-[1200px] h-[1200px]" style={{ containerType: 'size' }}><FlexCard imgRef={droidImageRef} /></div>
      </div>
    </AnimatePresence>
  )
}