import { EmbeddedDroidModel } from "./embedded-droid-model"

// Голая сцена с 3D-моделью одного дроида. Её показывает вкладка 3D в
// превьюере метаданных (/api/viewer) — там обычная HTML-страница без React,
// поэтому три-джиэс живёт здесь и вставляется туда через iframe.
//
// Страницу открывают внутри iframe на маркетплейсах, так что никакой навигации
// и хрома: только модель, орбита и прогресс загрузки.
export const metadata = {
  title: "ApeDroid 3D model",
  robots: { index: false, follow: false },
}

export default async function EmbedModelPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tokenId = parseInt(String(id).trim(), 10)
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 3333) {
    return (
      <main className="w-full h-screen bg-black flex items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Unknown droid</p>
      </main>
    )
  }
  return (
    <main className="w-full h-screen bg-black">
      <EmbeddedDroidModel tokenId={tokenId} />
    </main>
  )
}
