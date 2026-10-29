import React, { useRef, useMemo, Suspense, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '@/store/appStore';

// Ambient floating champagne gold particles
function AmbientParticles({ count = 65 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 5;
      pos[i * 3 + 1] = Math.random() * 2.6 + 0.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 3.5;

      spd[i * 3] = (Math.random() - 0.5) * 0.03;
      spd[i * 3 + 1] = Math.random() * 0.05 + 0.015;
      spd[i * 3 + 2] = (Math.random() - 0.5) * 0.03;
    }
    return [pos, spd];
  }, [count]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const array = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      array[i * 3 + 1] += speeds[i * 3 + 1] * delta;
      array[i * 3] += Math.sin(array[i * 3 + 1] * 2) * 0.0008;

      if (array[i * 3 + 1] > 3.0) {
        array[i * 3 + 1] = 0.2;
      }
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.02}
        color="#7EA6FF"
        transparent
        opacity={0.4}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

// ── S1 Obsidian & Champagne Gold 3D Studio Stage ──
function ObsidianGoldStudioScene() {
  const { scene } = useThree();

  useEffect(() => {
    // Keep 3D scene transparent so it sits seamlessly over the S1 CSS atmosphere
    scene.background = null;
    return () => {
      scene.background = null;
    };
  }, [scene]);

  return (
    <group>
      {/* ── Studio Stage Disc with Subtle Accent Rim ── */}
      <group position={[0, -0.005, 0]}>
        {/* Dark Pedestal Floor Matching Application Background */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[1.5, 64]} />
          <meshStandardMaterial 
            color="#0B0D12" 
            metalness={0.85} 
            roughness={0.32} 
          />
        </mesh>

        {/* Outer Soft Blue Halo Rim */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[1.48, 1.5, 64]} />
          <meshBasicMaterial color="#6E8BFF" transparent opacity={0.25} />
        </mesh>
      </group>

      {/* ── Soft Ground Contact Shadow ── */}
      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={0.55}
        scale={3.6}
        blur={2.4}
        far={2.0}
        resolution={512}
        color="#040508"
      />

      {/* ── Calibrated Studio Lighting Tailored for Cinematic Character Presentation ── */}
      {/* Ambient & Hemisphere Fill with Calm Dark Blue Underbelly */}
      <ambientLight intensity={0.65} color="#F2F2F2" />
      <hemisphereLight args={['#F2F2F2', '#0B0D12', 0.7]} />

      {/* Crisp Key Light from Top-Front */}
      <directionalLight
        color="#FFFFFF"
        intensity={2.0}
        position={[1.6, 3.2, 2.4]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
      />

      {/* Cool Secondary Fill Light from Left */}
      <directionalLight
        color="#A7A9AF"
        intensity={0.7}
        position={[-2.4, 2.2, 1.2]}
      />

      {/* Signature Soft Blue Silhouette Rim Light */}
      <spotLight
        color="#6E8BFF"
        intensity={2.2}
        position={[0, 3.2, -1.8]}
        angle={0.68}
        penumbra={0.85}
        target-position={[0, 1.4, 0]}
      />

      {/* Subtle Front Micro-Bloom */}
      <pointLight
        color="#6E8BFF"
        intensity={0.3}
        distance={4}
        position={[0, 1.2, 1.8]}
      />

      {/* Atmospheric Soft Particles */}
      <AmbientParticles count={40} />
    </group>
  );
}

// ── Custom GLB Scene (If uploaded by user) ──
function CustomGlbScene({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const cloned = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  return (
    <group>
      <ObsidianGoldStudioScene />
      <primitive object={cloned} position={[0, 0, 0]} />
    </group>
  );
}

export default function StudioScene() {
  const customGlbUrl = useAppStore((state) => state.customGlbUrl);

  if (customGlbUrl) {
    return (
      <Suspense fallback={null}>
        <CustomGlbScene url={customGlbUrl} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <ObsidianGoldStudioScene />
    </Suspense>
  );
}
