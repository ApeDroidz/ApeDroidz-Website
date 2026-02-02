"use client"

import { Grid, ContactShadows } from "@react-three/drei"

export function Floor() {
  return (
    <group position={[0, -2.3, 0]}>
      {/* Тень под роботом */}
      <ContactShadows resolution={1024} scale={20} blur={2} opacity={0.5} far={10} color="#000000" />

      {/* Сетка с прозрачностью */}
      <Grid
        renderOrder={-1}
        infiniteGrid
        cellSize={0.7}
        sectionSize={0.7}
        fadeDistance={18}
        sectionColor={"rgba(101, 101, 101, 0.2)"}
        cellColor={"rgba(101, 101, 101, 0.2)"}
        sectionThickness={1}
        cellThickness={1}
      />
    </group>
  )
}