// frontend/src/scene/Scene.jsx
/**
 * Root 3D scene component using React Three Fiber.
 * Contains the background particles, camera, lighting, and post-processing.
 * UI planes (waveform, spectrogram, piano roll) are overlaid from App.jsx.
 */
import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Stars } from '@react-three/drei'
import ParticleField from './ParticleField'
import LogoMesh from './LogoMesh'

export default function Scene() {
  return (
    <Canvas
      className="r3f-canvas"
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'default',
      }}
      dpr={[1, Math.min(window.devicePixelRatio, 2)]}
      style={{ position: 'fixed', top: 0, left: 0 }}
    >
      <PerspectiveCamera makeDefault position={[0, 0, 10]} fov={60} near={0.1} far={1000} />

      {/* Ambient lighting */}
      <ambientLight intensity={0.15} color="#4040ff" />
      <pointLight position={[10, 10, 10]} intensity={0.3} color="#00F0FF" />
      <pointLight position={[-10, -5, 5]} intensity={0.2} color="#FF00E5" />

      {/* Background stars */}
      <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={0.5} />

      {/* Floating particles */}
      <Suspense fallback={null}>
        <ParticleField />
        <LogoMesh />
      </Suspense>

      {/* Subtle orbit controls (limited) */}
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.2}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 1.5}
        maxAzimuthAngle={Math.PI / 6}
        minAzimuthAngle={-Math.PI / 6}
      />

      {/* Fog for depth */}
      <fog attach="fog" args={['#050510', 8, 30]} />
    </Canvas>
  )
}
