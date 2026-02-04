"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { NFTItem } from "@/app/dashboard/page"
import { resolveImageUrl } from "@/lib/utils"
import { Lock, ChevronDown, Check, RefreshCcw } from "lucide-react"

interface InventoryProps {
  title: string
  items: NFTItem[]
  selectedId?: string
  onSelect: (item: NFTItem | null) => void
  onDetailClick?: (item: NFTItem) => void
  onRefresh?: () => Promise<void> | void
  type: 'droid' | 'battery'
  singleRow?: boolean
  isLoading?: boolean
}

type DroidFilter = 'ALL' | 'LVL 1' | 'LVL 2' | 'LVL 2 SUPER' | 'LVL 3'
type BatteryFilter = 'ALL' | 'STANDARD' | 'SUPER'

// ... (GET MORE CARD ОСТАВЛЯЕМ КАК БЫЛ) ...
const GetMoreCard = ({ type }: { type: 'droid' | 'battery' }) => {
  const [isActive, setIsActive] = useState(false);
  const links = {
    droid: { os: "https://opensea.io/collection/apedroidz", me: "https://magiceden.io/collections/apechain/0x4e0edc9be4d47d414daf8ed9a6471f41e99577f3" },
    battery: { os: "https://opensea.io/collection/apedroidz", me: "https://magiceden.io/collections/apechain/..." }
  }
  const textSizeClass = type === 'battery' ? 'text-[9px] leading-none' : 'text-[10px] md:text-xs'

  return (
    <div
      onClick={() => setIsActive(!isActive)}
      onMouseLeave={() => setIsActive(false)}
      className="group relative aspect-square rounded-xl border-2 border-dashed border-white/20 overflow-hidden transition-all duration-300 hover:bg-white/5 hover:border-white/40 cursor-pointer"
    >
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1 transition-opacity duration-300 ${isActive ? 'opacity-0' : 'group-hover:opacity-0'}`}>
        <span className="text-4xl font-medium text-white/30 leading-none mb-1">+</span>
        <span className="text-[10px] md:text-xs font-black uppercase tracking-[0.15em] text-white/50 text-center leading-tight">Get <br /> {type === 'droid' ? 'Droid' : 'Battery'}</span>
      </div>
      <div className={`absolute inset-0 flex flex-col gap-1 p-1 z-10 transition-all duration-300 bg-black/95 backdrop-blur-md ${isActive ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 group-hover:translate-y-0 group-hover:opacity-100'}`}>
        <a href={links[type].os} target="_blank" rel="noreferrer" className={`group/btn flex-1 w-full flex items-center justify-center gap-1 bg-white/10 hover:bg-white hover:text-black border border-white/20 hover:border-white rounded-[8px] transition-all duration-200 uppercase font-black tracking-normal ${textSizeClass}`} onClick={(e) => e.stopPropagation()}>
          <img src="/Opensea.svg" alt="OS" className="w-4 h-4 object-contain transition-all group-hover/btn:invert" />
          <span className="truncate px-1">OpenSea</span>
        </a>
        <a href={links[type].me} target="_blank" rel="noreferrer" className={`group/btn flex-1 w-full flex items-center justify-center gap-1 bg-white/10 hover:bg-white hover:text-black border border-white/20 hover:border-white rounded-[8px] transition-all duration-200 uppercase font-black tracking-normal ${textSizeClass}`} onClick={(e) => e.stopPropagation()}>
          <img src="/MagicEden.svg" alt="ME" className="w-4 h-4 object-contain transition-all group-hover/btn:invert" />
          <span className="truncate px-1">Magic Eden</span>
        </a>
      </div>
    </div>
  )
}

// === 2. КАРТОЧКА NFT (ФИКС ЗАГРУЗКИ) ===
const InventoryCard = ({
  item,
  isSelected,
  onSelect,
  onDetailClick,
  type
}: {
  item: NFTItem
  isSelected: boolean
  type: 'droid' | 'battery'
  onSelect: (item: NFTItem | null) => void
  onDetailClick?: (item: NFTItem) => void
}) => {
  const tokenNumber = item.name.match(/#(\d+)/)?.[1] || item.id.replace(/[^0-9]/g, '') || item.id
  const displayId = `#${tokenNumber}`

  // State для загрузки изображения (вместо Skeleton компонента)
  const [isLoaded, setIsLoaded] = useState(false);

  // Long press handler
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleTouchStart = () => {
    timerRef.current = setTimeout(() => {
      if (onDetailClick) onDetailClick(item);
    }, 500); // 500ms long press
  };

  const handleTouchEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Рамка - всегда белая для выбранных элементов
  let borderColor = "border-white/20 hover:border-white/50";
  if (isSelected) {
    borderColor = "border-white shadow-[0_0_20px_rgba(255,255,255,0.25)] scale-[0.98]";
  }

  // Стили кнопки
  const detailsBtnStyle = type === 'droid'
    ? "left-3 right-3 py-2"  // Большой для дроида
    : "left-3 right-3 py-1"; // Узкий для батарейки

  return (
    <div
      onClick={() => onSelect(isSelected ? null : item)}
      onDoubleClick={() => { if (onDetailClick) onDetailClick(item); }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      onMouseLeave={handleTouchEnd}
      className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer transition-all duration-300 border-2 ${borderColor} ${!isSelected && 'hover:bg-white/5'} bg-black`}
    >
      {/* 1. СКЕЛЕТ (Показывается пока грузится) */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-white/5 animate-pulse" />
      )}

      {/* 2. КАРТИНКА (Нативный IMG для надежности) */}
      <img
        src={resolveImageUrl(item.image)}
        alt={item.name}
        onLoad={() => setIsLoaded(true)}
        className={`w-full h-full object-cover transition-opacity duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        loading="lazy"
      />

      {/* ID */}
      <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-[10px] font-mono text-white font-bold border border-white/10 z-20 pointer-events-none">
        {displayId}
      </div>

      {/* КНОПКА ДЕТАЛЕЙ - VISIBLE ON SELECTION OR HOVER */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (onDetailClick) onDetailClick(item)
        }}
        className={`absolute bottom-3 ${detailsBtnStyle}
                   bg-white/10 backdrop-blur-md border border-white/20 rounded-lg
                   text-[9px] font-black uppercase tracking-wider text-white
                   ${isSelected ? 'opacity-100 pointer-events-auto' : 'opacity-0 lg:group-hover:opacity-100 pointer-events-none lg:pointer-events-auto'}
                   transition-all duration-300
                   hover:bg-white hover:text-black hover:border-white z-30
                   cursor-pointer`}
      >
        Details
      </button>
    </div>
  )
}

// === 3. MINT PROMO CARD (BATTERIES) ===
const MintPromoCard = () => {
  return (
    <a
      href="/batteries_mint"
      className="group relative col-span-2 aspect-[2/1] rounded-xl overflow-hidden cursor-pointer border border-white/10 bg-[#0d0d0d] hover:border-white/20 transition-all duration-300"
    >
      {/* Subtle blue glow */}
      <div className="absolute top-[-30%] right-[-30%] w-[60%] h-[60%] bg-blue-600/5 blur-[40px] pointer-events-none group-hover:bg-blue-600/10 transition-all duration-500" />

      <div className="absolute inset-0 flex items-center p-1.5 gap-2">

        {/* Left: GIF Image */}
        <div className="relative h-full aspect-square flex-shrink-0 rounded-lg overflow-hidden border border-white/10 bg-black shadow-lg">
          <img
            src="/DRD-UPD.gif"
            alt="Upgrade"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Right: Content Stack */}
        <div className="flex-1 flex flex-col justify-center items-start gap-2 min-w-0 pr-2">

          {/* Text Title */}
          <h3 className="text-sm md:text-sm font-black text-white leading-[1.1] uppercase tracking-tight">
            <span className="text-white">Mint</span><br />
            <span className="text-white/80">Batteries</span>
          </h3>

          {/* Button */}
          <div className="h-7 md:h-7 w-full px-3 md:px-4 flex items-center justify-center gap-1 bg-white text-black rounded-md font-black uppercase tracking-wide text-[10px] md:text-[10px] transition-all duration-300 group-hover:bg-blue-600 group-hover:text-white shadow-lg">
            Mint →
          </div>

        </div>
      </div>
    </a>
  )
}

// ... (FILTER DROPDOWN И INVENTORY MAIN ОСТАВЛЯЕМ ТЕМИ ЖЕ) ...
const FilterDropdown = ({ options, activeFilter, onSelect }: { options: any[], activeFilter: string, onSelect: (val: any) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const activeLabel = options.find(o => o.value === activeFilter)?.label || "FILTER";
  return (
    <div className="relative" ref={dropdownRef}>
      <button onClick={() => setIsOpen(!isOpen)} className="cursor-pointer flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] uppercase font-bold tracking-wider text-white/70 transition-all hover:bg-white/10">
        {activeLabel}
        <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-36 bg-[#0a0a0a] border border-white/20 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col py-1">
          {options.map((opt) => (
            <button key={opt.value} disabled={opt.locked} onClick={() => { if (!opt.locked) { onSelect(opt.value); setIsOpen(false); } }} className={`flex items-center justify-between px-4 py-2 text-[10px] uppercase font-bold tracking-wider text-left transition-colors w-full ${opt.locked ? 'opacity-40 cursor-not-allowed text-white/50' : 'hover:bg-white/10 cursor-pointer text-white'} ${activeFilter === opt.value ? 'bg-white/5 text-blue-400' : ''} ${opt.color === 'orange' ? 'text-orange-400 hover:text-orange-300' : ''}`}>
              <span className="flex items-center gap-2">{opt.locked && <Lock size={10} />}{opt.label}</span>
              {activeFilter === opt.value && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Inventory({ title, items, selectedId, onSelect, onDetailClick, onRefresh, type, singleRow = false, isLoading = false }: InventoryProps) {
  const [activeDroidFilter, setActiveDroidFilter] = useState<DroidFilter>('ALL')
  const [activeBatteryFilter, setActiveBatteryFilter] = useState<BatteryFilter>('ALL')
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false); // State for expanding list

  // Force showAll on desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setShowAll(true);
      } else {
        setShowAll(false);
      }
    };

    // Initial check
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setIsRefreshing(true);
    await onRefresh();
    // Keep spinning for at least 500ms for visual feedback
    setTimeout(() => setIsRefreshing(false), 500);
  }

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (type === 'droid') {
        const level = item.level || 1;
        const isSuper = item.metadata?.attributes?.some((a: any) => (a.trait_type === "upgrade level" && a.value?.includes("super")) || (a.trait_type === "background" && a.value === "apechain_orange"));
        if (activeDroidFilter === 'ALL') return true;
        if (activeDroidFilter === 'LVL 1') return level === 1;
        if (activeDroidFilter === 'LVL 2') return level === 2 && !isSuper;
        if (activeDroidFilter === 'LVL 2 SUPER') return level === 2 && isSuper;
        if (activeDroidFilter === 'LVL 3') return level === 3;
      }
      if (type === 'battery') {
        if (activeBatteryFilter === 'ALL') return true
        if (activeBatteryFilter === 'STANDARD') return item.batteryType === 'Standard'
        if (activeBatteryFilter === 'SUPER') return item.batteryType === 'Super'
      }
      return true
    })
  }, [items, activeDroidFilter, activeBatteryFilter, type])

  // Mobile limit logic
  // Batteries: 2 rows. MintPromo takes 1 row (col-span-2). So we need Promo + 2 items (1 row) = 2 items limit? Or if items take 2 rows themselves + promo?
  // Let's assume "2 full rows" means 2 visual rows.
  // Promo card is aspect-[2.1/1], essentially 1 row height.
  // So Promo + 2 items = 2 rows.
  // Droids: 3 rows. GetMoreCard is 1 item. So GetMore + 5 items = 6 items = 3 rows (2 cols).
  // Batteries: Promo takes 1 row. We want 2 rows of batteries = 4 items?
  // User said "show 2 lines of batteries". Promo (Line 1) + Batt (Line 2) + Batt (Line 3).
  // Let's set to 4 items + Promo = 3 visual rows total. 
  // If they meant Promo + 1 row (2 items), it was 2.
  // I will set to 4 to be safe (2 rows of actual batteries).
  const initialDisplayCount = type === 'battery' ? 4 : 5; // Batteries: MintPromo(2 cells) + 4 = 6 cells = 2 rows on mobile (3 cols), Droids: + GetMore (1 slot)

  const displayedItems = useMemo(() => {
    if (showAll || singleRow) return filteredItems;
    // Mobile check is CSS based usually, but here we control rendering.
    // We'll apply this logic generally, assuming this component is responsive.
    // However, on Desktop we might want full view.
    // But requirement says "shows 2 full rows, with the rest scrollable... specific to mobile".
    // We can use CSS `hidden` for items beyond limit on mobile, or slice.
    // Slice is better for performance but "scrollable" implies they might be there but "Show All" button implies they are hidden until expanded.
    // User said "Shows 2 full rows, with the rest scrollable" AND "SHOW ALL / HIDE button".
    // "rest scrollable" might mean the container is scrollable?
    // But "SHOW ALL" usually implies expanding a truncated list.
    // Let's implement truncation with Show All.
    return filteredItems.slice(0, initialDisplayCount);
  }, [filteredItems, showAll, singleRow, initialDisplayCount]);

  const hasHiddenItems = filteredItems.length > initialDisplayCount && !singleRow;

  const droidOptions = [{ label: 'All Droidz', value: 'ALL' }, { label: 'Level 1', value: 'LVL 1' }, { label: 'Level 2', value: 'LVL 2' }, { label: 'Level 2 Super', value: 'LVL 2 SUPER', color: 'orange' }, { label: 'Level 3', value: 'LVL 3', locked: true }];
  const batteryOptions = [{ label: 'All Batteriez', value: 'ALL' }, { label: 'Standard', value: 'STANDARD' }, { label: 'Super', value: 'SUPER', color: 'orange' }];
  const loadingSkeletons = Array.from({ length: singleRow ? 4 : 8 })

  return (
    <div className="flex flex-col h-full rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-4 relative">
      <div className="flex flex-col gap-2 mb-4 flex-shrink-0 relative z-30 lg:flex-row lg:justify-between lg:items-center">

        {/* MOBILE FILTER (Above Title) */}
        <div className="lg:hidden self-start mb-1">
          {type === 'droid' ? (<FilterDropdown options={droidOptions} activeFilter={activeDroidFilter} onSelect={setActiveDroidFilter} />) : (<FilterDropdown options={batteryOptions} activeFilter={activeBatteryFilter} onSelect={setActiveBatteryFilter} />)}
        </div>

        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold tracking-wider text-white/90 uppercase">{title}</h3>

          {/* COUNT FIRST */}
          <span className="text-xs text-white/40 font-mono flex items-center">({filteredItems.length})</span>

          {/* THEN REFRESH ICON */}
          {onRefresh && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              className="cursor-pointer ml-1 p-1 rounded-full hover:bg-white/10 transition-colors group"
              title="Refresh Inventory"
            >
              <RefreshCcw
                size={14}
                className={`text-white/40 group-hover:text-white transition-all ${(isRefreshing || isLoading) ? 'animate-spin opacity-50' : ''}`}
              />
            </button>
          )}
        </div>

        {/* DESKTOP FILTER */}
        <div className="relative z-30 self-end lg:self-auto hidden lg:block">
          {type === 'droid' ? (<FilterDropdown options={droidOptions} activeFilter={activeDroidFilter} onSelect={setActiveDroidFilter} />) : (<FilterDropdown options={batteryOptions} activeFilter={activeBatteryFilter} onSelect={setActiveBatteryFilter} />)}
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto custom-scrollbar pr-1 ${singleRow ? 'min-h-0' : ''}`}>
        <div className={`grid gap-3 pb-2 ${singleRow ? 'grid-cols-4 md:grid-cols-6' : type === 'battery' ? 'grid-cols-3 md:grid-cols-6' : 'grid-cols-2 md:grid-cols-4'}`}>

          {/* SPECIAL CARDS AT START */}
          {type === 'battery' ? (
            <>
              <MintPromoCard />
              {/* Hint text when 0 batteries and not loading */}
              {!isLoading && filteredItems.length === 0 && (
                <div className="col-span-3 md:col-span-4 flex items-center justify-start">
                  <p className="text-[10px] text-white/30 leading-relaxed max-w-[280px]">
                    If you just minted batteries but they don&apos;t appear — wait 1-2 minutes and reload. Data is being indexed.
                  </p>
                </div>
              )}
            </>
          ) : (
            <GetMoreCard type="droid" />
          )}

          {isLoading ? (loadingSkeletons.map((_, i) => (<div key={i} className="aspect-square rounded-xl overflow-hidden border-2 border-white/10 bg-white/5 animate-pulse"></div>))) : (
            // Show displayedItems on mobile (via slice), but on desktop we might want all? 
            // Logic above `displayedItems` handles slice.
            // But wait, `displayedItems` will truncate on desktop too if we rely on `showAll`. 
            // We should conditionally render all or sliced based on screen size (CSS) or check simple approach.
            // Since "Show All" is requested, likely for mobile specifically. 
            // But to keep it simple, we can apply "Show All" logic to both or just use CSS to hide extra rows and button to unhide?
            // CSS grid is complex to limit by row count accurately without fixed height.
            // JavaScript slice is reliable.
            // I'll stick to slice. If user wants desktop full view, they can click "Show All" or I can default `showAll` to true on desktop (screen width check).
            // Given limitations, I'll default slice.
            (showAll || singleRow ? filteredItems : displayedItems).map((item) => (
              <InventoryCard
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                type={type}
                onSelect={onSelect}
                onDetailClick={onDetailClick}
              />
            ))
          )}

        </div>

        {/* SHOW ALL BUTTON (Mobile only, if has hidden items) */}
        {!singleRow && hasHiddenItems && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full py-3 mt-2 mb-4 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest text-white/50 hover:bg-white/10 hover:text-white transition-all lg:hidden"
          >
            {showAll ? "Hide" : "Show All"}
          </button>
        )}
      </div>
    </div>
  )
}