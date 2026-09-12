import React, { useRef, useMemo, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, useTexture, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '@/store/appStore';

// Ambient floating particles
function AmbientParticles({ count = 60 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 6;
      pos[i * 3 + 1] = Math.random() * 2.8 + 0.3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;

      spd[i * 3] = (Math.random() - 0.5) * 0.04;
      spd[i * 3 + 1] = Math.random() * 0.06 + 0.02;
      spd[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
    }
    return [pos, spd];
  }, [count]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const array = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      array[i * 3 + 1] += speeds[i * 3 + 1] * delta;
      array[i * 3] += Math.sin(array[i * 3 + 1] * 2) * 0.001;

      if (array[i * 3 + 1] > 3.2) {
        array[i * 3 + 1] = 0.3;
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
        size={0.025}
        color="#fbbf24"
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

// ── Theme 1: Aesthetic Creator Loft (from reference image) ──
function CreatorLoftScene() {
  const texture = useTexture('/backgrounds/creator_studio_4k.jpg');
  const { gl, scene, size, camera } = useThree();

  // Backdrop position in 3D world space
  const backdropZ = -3.8;

  // Exact camera distance and frustum calculation to fit screen perfectly
  const dist = 2.7 - backdropZ; // 6.5 units from wide camera
  const camFov = (camera as THREE.PerspectiveCamera).fov || 35;
  const vFovRad = (camFov * Math.PI) / 180;
  const visibleFrustumHeight = 2 * dist * Math.tan(vFovRad / 2);
  const screenAspect = size.width / Math.max(size.height, 1);
  const visibleFrustumWidth = visibleFrustumHeight * screenAspect;

  const imageAspect = 1376 / 768; // ~1.7917 native photograph aspect ratio

  // Calculate mesh dimensions to fit the screen naturally with 3% margin for camera micro-motion
  let meshHeight = visibleFrustumHeight * 1.03;
  let meshWidth = meshHeight * imageAspect;

  // If screen is wider than image (ultrawide), expand width to cover
  if (meshWidth < visibleFrustumWidth * 1.03) {
    meshWidth = visibleFrustumWidth * 1.03;
    meshHeight = meshWidth / imageAspect;
  }

  // Generate curved 3D studio cyclorama mesh with gentle curve for natural depth
  const curvedGeometry = useMemo(() => {
    const geom = new THREE.PlaneGeometry(meshWidth, meshHeight, 48, 16);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const normX = x / (meshWidth * 0.5); // -1 to 1
      // Gentle curve of 0.22 units at the outer edges
      const zCurve = Math.pow(Math.abs(normX), 2.0) * 0.22;
      pos.setZ(i, zCurve);
    }
    geom.computeVertexNormals();
    return geom;
  }, [meshWidth, meshHeight]);

  React.useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    if (gl && gl.capabilities) {
      texture.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy());
    }

    // Direct 1:1 texture mapping without cropping or stretching
    texture.matrixAutoUpdate = false;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    texture.updateMatrix();
  }, [texture, gl]);

  React.useEffect(() => {
    // Warm dark background clear color
    scene.background = new THREE.Color('#14100d');
    return () => {
      scene.background = null;
    };
  }, [scene]);

  return (
    <group>
      {/* ── 3D Curved Room Cyclorama Backdrop: Perfectly Fitted to Screen ── */}
      <mesh
        geometry={curvedGeometry}
        position={[0, 1.08, backdropZ]}
        renderOrder={-1}
      >
        <meshBasicMaterial
          map={texture}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>

      {/* ── 3D Floor Shadow Receiver & Contact Shadows directly on the rug ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.35} />
      </mesh>

      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.7}
        scale={3.6}
        blur={2.0}
        far={2.0}
        resolution={512}
        color="#1f140e"
      />

      {/* ── Room Lighting Matching Reference Image ── */}
      {/* Warm Ambient & Hemisphere Fill */}
      <ambientLight intensity={0.55} color="#fed7aa" />
      <hemisphereLight args={['#ffedd5', '#1c1917', 0.8]} />

      {/* Warm Golden Key Light (matching warm shelf and room lights) */}
      <directionalLight
        color="#fff7ed"
        intensity={2.4}
        position={[1.8, 3.4, 2.4]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
      />

      {/* Cool Twilight Window Light from Left */}
      <directionalLight
        color="#7dd3fc"
        intensity={1.2}
        position={[-3.6, 2.5, 0.8]}
      />

      {/* Warm Shelf Downward Accent Light */}
      <spotLight
        color="#f59e0b"
        intensity={2.2}
        position={[0, 2.8, -0.8]}
        angle={0.65}
        penumbra={0.9}
        target-position={[0, 1.2, 0]}
      />

      {/* Hair / Silhouette Warm Rim Light */}
      <spotLight
        color="#fbbf24"
        intensity={2.2}
        position={[0, 3.2, -1.6]}
        angle={0.7}
        penumbra={0.8}
        target-position={[0, 1.4, 0]}
      />

      {/* Right Neon Sign ("SAME HUMAN BIGGER DREAMS") Warm Accent Glow */}
      <pointLight
        color="#f97316"
        intensity={1.4}
        distance={6}
        position={[2.2, 1.8, -1.2]}
      />

      {/* Atmospheric Warm Floating Dust Particles in 3D Volume */}
      <AmbientParticles count={70} />
    </group>
  );
}

// ── Theme 2: Broadcast News Studio ──
function BroadcastStudioScene() {
  const screenRef = useRef<THREE.Mesh>(null);
  const neonTopRef = useRef<THREE.Mesh>(null);
  const neonBottomRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (screenRef.current) {
      const mat = screenRef.current.material as THREE.MeshStandardMaterial;
      if (mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = 0.85 + Math.sin(t * 1.5) * 0.15;
      }
    }
    if (neonTopRef.current) {
      const mat = neonTopRef.current.material as THREE.MeshBasicMaterial;
      mat.color.setHSL(0.55 + Math.sin(t * 0.5) * 0.05, 0.9, 0.6);
    }
    if (neonBottomRef.current) {
      const mat = neonBottomRef.current.material as THREE.MeshBasicMaterial;
      mat.color.setHSL(0.78 + Math.cos(t * 0.4) * 0.04, 0.85, 0.6);
    }
  });

  const slats = useMemo(() => {
    const list = [];
    const totalSlats = 24;
    for (let i = 0; i < totalSlats; i++) {
      const angle = ((i - totalSlats / 2) / totalSlats) * Math.PI * 0.55;
      const radius = 4.2;
      const x = Math.sin(angle) * radius;
      const z = -Math.cos(angle) * radius + 1.2;
      list.push({ id: i, x, z, angle });
    }
    return list;
  }, []);

  return (
    <group>
      <ambientLight intensity={0.4} color="#e0e7ff" />
      <hemisphereLight args={['#f8fafc', '#0f172a', 0.85]} />

      <directionalLight 
        color="#fffcf0" 
        intensity={2.8} 
        position={[-2.4, 3.8, 2.6]} 
        castShadow 
        shadow-mapSize={[1024, 1024]} 
        shadow-bias={-0.0001} 
      />

      <directionalLight 
        color="#67e8f9" 
        intensity={1.0} 
        position={[2.8, 2.2, 1.8]} 
      />

      <spotLight 
        color="#e879f9" 
        intensity={3.2} 
        position={[0, 3.6, -2.2]} 
        angle={0.55} 
        penumbra={0.8} 
        target-position={[0, 1.5, 0]}
      />

      <ContactShadows 
        position={[0, 0, 0]} 
        opacity={0.7} 
        scale={7} 
        blur={2} 
        far={3} 
        resolution={512} 
        color="#050510" 
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#07090e" metalness={0.75} roughness={0.22} />
      </mesh>

      <group position={[0, 1.6, -1.8]}>
        {slats.map(s => (
          <mesh key={s.id} position={[s.x, 0, s.z]} rotation={[0, -s.angle, 0]}>
            <boxGeometry args={[0.07, 3.6, 0.08]} />
            <meshStandardMaterial color="#111827" metalness={0.5} roughness={0.6} />
          </mesh>
        ))}
      </group>

      <mesh position={[0, 1.8, -3.2]}>
        <planeGeometry args={[20, 8]} />
        <meshStandardMaterial color="#05070d" roughness={0.9} />
      </mesh>

      <mesh ref={neonTopRef} position={[0, 2.9, -2.4]}>
        <boxGeometry args={[9, 0.025, 0.02]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>

      <mesh ref={neonBottomRef} position={[0, 0.65, -2.4]}>
        <boxGeometry args={[9, 0.025, 0.02]} />
        <meshBasicMaterial color="#c084fc" />
      </mesh>

      <group position={[0, 1.75, -2.5]}>
        <mesh ref={screenRef}>
          <planeGeometry args={[4.3, 2.2]} />
          <meshStandardMaterial color="#0f172a" emissive="#1e1b4b" emissiveIntensity={0.9} roughness={0.4} />
        </mesh>
      </group>

      <group position={[0, 0, 0.48]}>
        <mesh position={[0, 0.88, 0]} receiveShadow>
          <cylinderGeometry args={[1.55, 1.6, 0.05, 36, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#090d16" metalness={0.8} roughness={0.15} transparent opacity={0.88} />
        </mesh>
        <mesh position={[0, 0.855, 0]}>
          <cylinderGeometry args={[1.56, 1.56, 0.015, 36, 1, true, 0, Math.PI]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
        <mesh position={[0, 0.42, 0]} receiveShadow>
          <cylinderGeometry args={[1.4, 1.45, 0.82, 36, 1, true, 0, Math.PI]} />
          <meshStandardMaterial color="#0b0f19" metalness={0.7} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

// ── Theme 3: Custom 3D Model (.glb) ──
function CustomGlbScene({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const cloned = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  return (
    <group>
      <ambientLight intensity={0.6} color="#ffffff" />
      <directionalLight position={[2, 4, 3]} intensity={2.0} castShadow />
      <directionalLight position={[-2, 2, 1]} intensity={0.8} color="#93c5fd" />
      <primitive object={cloned} position={[0, 0, -1]} />
      <ContactShadows position={[0, 0, 0]} opacity={0.6} scale={10} blur={2} far={4} color="#000000" />
    </group>
  );
}

export default function StudioScene() {
  const sceneTheme = useAppStore((state) => state.sceneTheme);
  const customGlbUrl = useAppStore((state) => state.customGlbUrl);

  if (sceneTheme === 'custom_glb' && customGlbUrl) {
    return (
      <Suspense fallback={null}>
        <CustomGlbScene url={customGlbUrl} />
      </Suspense>
    );
  }

  if (sceneTheme === 'broadcast_studio') {
    return <BroadcastStudioScene />;
  }

  // Default: Aesthetic Creator Loft (matching user's uploaded photo)
  return (
    <Suspense fallback={null}>
      <CreatorLoftScene />
    </Suspense>
  );
}
