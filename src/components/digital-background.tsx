"use client"

import { useEffect, useRef } from "react"

export function DigitalBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ==========================================
  // ⚙️ НАСТРОЙКИ
  // ==========================================
  const config = {
    // Оставляем как ты настроил (яркий, чтобы пробивал дым)
    textColor: "rgba(255, 255, 255, 0.27  )",

    fontSize: 16,

    // Твоя настройка ластика (оставляем 0.35)
    trailFade: 0.35,

    // Твоя скорость
    speed: 90,

    // Твоя густота
    resetChance: 0.997,

    chars: "APEDROIDZ",
  }
  // ==========================================

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    const columns = Math.floor(canvas.width / config.fontSize)
    const drops: number[] = []

    for (let i = 0; i < columns; i++) {
      drops[i] = Math.random() * -200
    }

    const draw = () => {
      // 1. Мягкое стирание (твоя логика, оставляет шлейф)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${config.trailFade})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';

      ctx.font = `${config.fontSize}px monospace`
      ctx.fillStyle = config.textColor

      for (let i = 0; i < drops.length; i++) {
        const len = config.chars.length
        const charIndex = ((Math.floor(drops[i]) % len) + len) % len
        const text = config.chars[charIndex]

        const x = i * config.fontSize
        const y = drops[i] * config.fontSize

        // Рисуем букву
        if (y > 0) {
          ctx.fillText(text, x, y)
        }

        // --- ВНЕДРЕННЫЙ ФИКС: ТЕНЕВОЙ ЛАСТИК ---
        // Мы вычисляем место, где шлейф уже точно должен исчезнуть (на 20 строк выше).
        // И жестко удаляем там пиксели (clearRect). 
        // Это не видно глазу, так как там уже пусто, но это убивает "невидимую грязь".
        const cleanerY = y - (config.fontSize * 20);
        if (cleanerY > 0) {
          // Стираем квадрат размером чуть больше буквы
          ctx.clearRect(x, cleanerY, config.fontSize, config.fontSize + 2);
        }
        // ---------------------------------------

        if (y > canvas.height && Math.random() > config.resetChance) {
          drops[i] = Math.random() * -100;
        }

        drops[i]++
      }
    }

    const interval = setInterval(draw, config.speed)

    return () => {
      clearInterval(interval)
      window.removeEventListener("resize", resizeCanvas)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full"
    />
  )
}