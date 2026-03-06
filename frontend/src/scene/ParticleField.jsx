// frontend/src/scene/ParticleField.jsx
/**
 * Reactive floating particle field using instanced geometry.
 * Particles pulse in response to audio processing progress and BPM.
 * Uses GPU instancing for performance (thousands of particles at 60fps).
 */
import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useAppStore from '../stores/appStore'

const PARTICLE_COUNT = 800

export default function ParticleField() {
  const meshRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])

  // Generate initial particle positions
  const particles = useMemo(() => {
    const arr = []
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 30,
        y: (Math.random() - 0.5) * 20,
        z: (Math.random() - 0.5) * 15 - 5,
        speedX: (Math.random() - 0.5) * 0.005,
        speedY: (Math.random() - 0.5) * 0.005,
        speedZ: (Math.random() - 0.5) * 0.003,
        scale: Math.random() * 0.03 + 0.01,
        phase: Math.random() * Math.PI * 2,
      })
    }
    return arr
  }, [])

  useFrame(({ clock }) => {
    if (!meshRef.current) return

    const time = clock.getElapsedTime()
    const progress = useAppStore.getState().progress
    const stage = useAppStore.getState().stage
    const isProcessing = stage === 'processing' || stage === 'uploading'

    // Intensity scales with processing state
    const intensity = isProcessing ? 0.5 + progress * 0.5 : 0.3

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i]

      // Animate position with gentle drift
      const px = p.x + Math.sin(time * 0.3 + p.phase) * 0.5
      const py = p.y + Math.cos(time * 0.2 + p.phase * 1.3) * 0.3
      const pz = p.z + Math.sin(time * 0.1 + p.phase * 0.7) * 0.2

      // Pulse scale with processing
      const pulseFactor = isProcessing
        ? 1 + Math.sin(time * 4 + p.phase) * 0.3 * intensity
        : 1 + Math.sin(time * 0.5 + p.phase) * 0.1
      const scale = p.scale * pulseFactor

      dummy.position.set(px, py, pz)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[null, null, PARTICLE_COUNT]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial
        color="#00F0FF"
        transparent
        opacity={0.4}
        toneMapped={false}
      />
    </instancedMesh>
  )
}
