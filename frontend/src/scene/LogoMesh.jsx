// frontend/src/scene/LogoMesh.jsx
/**
 * Animated 3D logo text floating in the scene.
 * Uses drei Text3D with pulsing glow that matches processing state.
 */
import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Float } from '@react-three/drei'
import useAppStore from '../stores/appStore'

export default function LogoMesh() {
  const textRef = useRef()
  const glowRef = useRef()

  useFrame(({ clock }) => {
    if (!textRef.current) return
    const time = clock.getElapsedTime()
    const stage = useAppStore.getState().stage
    const isProcessing = stage === 'processing' || stage === 'uploading'

    // Gentle floating bob
    textRef.current.position.y = Math.sin(time * 0.5) * 0.1 + 2.5

    // Scale pulse when processing
    if (isProcessing) {
      const pulse = 1 + Math.sin(time * 3) * 0.02
      textRef.current.scale.setScalar(pulse)
    } else {
      textRef.current.scale.setScalar(1)
    }
  })

  return (
    <Float speed={1} rotationIntensity={0.1} floatIntensity={0.3}>
      <group ref={textRef} position={[0, 2.5, -2]}>
        {/* Main text */}
        <Text
          fontSize={0.8}
          color="#00F0FF"
          anchorX="center"
          anchorY="middle"
          font="/fonts/SpaceGrotesk-Bold.woff"
          letterSpacing={0.1}
          maxWidth={10}
        >
          {'DUMU'}
          <meshBasicMaterial
            color="#00F0FF"
            transparent
            opacity={0.9}
            toneMapped={false}
          />
        </Text>

        {/* Subtitle */}
        <Text
          position={[0, -0.6, 0]}
          fontSize={0.18}
          color="#6B6B99"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.3}
        >
          {'BASS TRAP AI'}
          <meshBasicMaterial
            color="#6B6B99"
            transparent
            opacity={0.6}
          />
        </Text>

        {/* Version badge */}
        <Text
          position={[2.2, 0.3, 0]}
          fontSize={0.12}
          color="#FF00E5"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.05}
        >
          {'v2.0'}
          <meshBasicMaterial
            color="#FF00E5"
            transparent
            opacity={0.5}
          />
        </Text>
      </group>
    </Float>
  )
}
