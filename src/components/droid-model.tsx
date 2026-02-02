"use client"

import { useMemo, useRef, useEffect, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { useGLTF, useAnimations } from "@react-three/drei"
import * as THREE from "three"

interface DroidModelProps {
  activeEmotion: string | null;
  onEmotionEnd: () => void;
}

export function DroidModel({ activeEmotion, onEmotionEnd }: DroidModelProps) {
  const groupRef = useRef<THREE.Group>(null)
  const { scene } = useGLTF("/white-droid.glb")

  // Загрузка анимаций
  const { animations: danceAnim } = useGLTF("/animations/Dance.glb")
  const { animations: kickAnim } = useGLTF("/animations/mma-kick.glb")
  const { animations: helloAnim } = useGLTF("/animations/standing-greeting.glb")
  const { animations: punchAnim } = useGLTF("/animations/punching-bag.glb")
  const { animations: groinAnim } = useGLTF("/animations/kick-to-the-groin.glb")
  const { animations: hiphopAnim } = useGLTF("/animations/hip-hop-dance.glb")

  const allAnimations = useMemo(() => {
    if (danceAnim.length) danceAnim[0].name = "Dance"
    if (kickAnim.length) kickAnim[0].name = "Kick"
    if (helloAnim.length) helloAnim[0].name = "Hello"
    if (punchAnim.length) punchAnim[0].name = "Punch"
    if (groinAnim.length) groinAnim[0].name = "Attack"
    if (hiphopAnim.length) hiphopAnim[0].name = "HipHop"

    return [
      ...danceAnim,
      ...kickAnim,
      ...helloAnim,
      ...punchAnim,
      ...groinAnim,
      ...hiphopAnim
    ]
  }, [danceAnim, kickAnim, helloAnim, punchAnim, groinAnim, hiphopAnim])

  const { actions } = useAnimations(allAnimations, groupRef)

  const bones = useRef<{
    head: THREE.Object3D | null;
    spine: THREE.Object3D | null;
  }>({ head: null, spine: null })

  const initialRotation = useRef<{
    head: { x: number, y: number, z: number } | null;
    spine: { x: number, y: number, z: number } | null;
  }>({ head: null, spine: null })

  const [isAnimating, setIsAnimating] = useState(false)
  const mouseControlWeight = useRef(1)

  useEffect(() => {
    if (activeEmotion && actions[activeEmotion]) {
      const action = actions[activeEmotion]
      if (!action) {
        onEmotionEnd()
        return
      }

      setIsAnimating(true)

      action.reset()
        .setLoop(THREE.LoopOnce, 1)
        .fadeIn(0.5)
        .clampWhenFinished = true

      action.play()

      const onFinished = () => {
        action.fadeOut(0.3)
        setIsAnimating(false)
        onEmotionEnd()
      }

      const mixer = action.getMixer()
      mixer.addEventListener('finished', onFinished)

      return () => {
        mixer.removeEventListener('finished', onFinished)
      }
    }
  }, [activeEmotion, actions, onEmotionEnd])

  useMemo(() => {
    scene.traverse((child) => {
      if (child.isObject3D) {
        const name = child.name.toLowerCase()
        if (name.includes("head") || name.includes("голова") || name === "head") {
          bones.current.head = child
          if (!initialRotation.current.head) {
            initialRotation.current.head = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z }
          }
        }
        if (name.includes("spine") || name.includes("chest") || name.includes("torso") || name.includes("корпус")) {
          bones.current.spine = child
          if (!initialRotation.current.spine) {
            initialRotation.current.spine = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z }
          }
        }
      }
    })
  }, [scene])

  useFrame((state, delta) => {
    const mouseX = state.pointer.x
    const mouseY = state.pointer.y
    const breathe = Math.sin(state.clock.elapsedTime * 2) * 0.01

    const targetWeight = isAnimating ? 0 : 1;
    mouseControlWeight.current = THREE.MathUtils.lerp(mouseControlWeight.current, targetWeight, delta * 4)

    if (mouseControlWeight.current > 0.01) {
      if (bones.current.head && initialRotation.current.head) {
        const init = initialRotation.current.head
        const targetY = init.y + (mouseY * (Math.PI / 5))
        const targetX = init.x + (mouseX * (Math.PI / 6))

        const smoothSpeed = delta * 6 * mouseControlWeight.current

        bones.current.head.rotation.y = THREE.MathUtils.lerp(bones.current.head.rotation.y, targetY, smoothSpeed)
        bones.current.head.rotation.x = THREE.MathUtils.lerp(bones.current.head.rotation.x, targetX + breathe, smoothSpeed)
      }

      if (bones.current.spine && initialRotation.current.spine) {
        const init = initialRotation.current.spine
        const targetY = init.y + (mouseY * (Math.PI / 9))
        const targetX = init.x + (mouseX * (Math.PI / 10))

        const smoothSpeed = delta * 3 * mouseControlWeight.current

        bones.current.spine.rotation.y = THREE.MathUtils.lerp(bones.current.spine.rotation.y, targetY, smoothSpeed)
        bones.current.spine.rotation.x = THREE.MathUtils.lerp(bones.current.spine.rotation.x, targetX + (breathe * 0.5), smoothSpeed)
      }
    }

    if (groupRef.current) {
      if (mouseControlWeight.current > 0.01) {
        groupRef.current.rotation.y = THREE.MathUtils.lerp(
          groupRef.current.rotation.y,
          -mouseX * 0.1,
          delta * 2 * mouseControlWeight.current
        )
      }
    }
  })

  return (
    <group ref={groupRef} scale={2.5} position={[0, -2.25, 0]}>
      <primitive object={scene} />
    </group>
  )
}

useGLTF.preload("/white-droid.glb")
useGLTF.preload("/animations/Dance.glb")
useGLTF.preload("/animations/mma-kick.glb")
useGLTF.preload("/animations/standing-greeting.glb")
useGLTF.preload("/animations/punching-bag.glb")
useGLTF.preload("/animations/kick-to-the-groin.glb")
useGLTF.preload("/animations/hip-hop-dance.glb")