import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/store/appStore';

const PRESETS: Record<string, { position: THREE.Vector3; target: THREE.Vector3; fov: number }> = {
  wide: { position: new THREE.Vector3(0, 1.25, 2.7), target: new THREE.Vector3(0, 1.15, 0), fov: 35 },
  closeup: { position: new THREE.Vector3(0.05, 1.58, 1.05), target: new THREE.Vector3(0, 1.52, 0), fov: 28 },
};

export default function CameraRig() {
  const { camera } = useThree();
  const currentPosition = useRef(new THREE.Vector3().copy(PRESETS.wide.position));
  const currentTarget = useRef(new THREE.Vector3().copy(PRESETS.wide.target));
  const pointerDamped = useRef(new THREE.Vector2(0, 0));

  useFrame((state, delta) => {
    const activeCamera = useAppStore.getState().activeCamera || 'wide';
    const preset = PRESETS[activeCamera] || PRESETS.wide;

    // Smooth pointer parallax tracking (mouse or touch)
    pointerDamped.current.x = THREE.MathUtils.damp(pointerDamped.current.x, (state.pointer?.x || 0) * 0.08, 3, delta);
    pointerDamped.current.y = THREE.MathUtils.damp(pointerDamped.current.y, (state.pointer?.y || 0) * 0.04, 3, delta);

    // Smoothly damp current position toward preset position
    currentPosition.current.x = THREE.MathUtils.damp(currentPosition.current.x, preset.position.x, 2, delta);
    currentPosition.current.y = THREE.MathUtils.damp(currentPosition.current.y, preset.position.y, 2, delta);
    currentPosition.current.z = THREE.MathUtils.damp(currentPosition.current.z, preset.position.z, 2, delta);

    // Smoothly damp target (lookAt point)
    currentTarget.current.x = THREE.MathUtils.damp(currentTarget.current.x, preset.target.x, 2, delta);
    currentTarget.current.y = THREE.MathUtils.damp(currentTarget.current.y, preset.target.y, 2, delta);
    currentTarget.current.z = THREE.MathUtils.damp(currentTarget.current.z, preset.target.z, 2, delta);

    // Handheld breathing micro-motion
    const breathX = Math.sin(state.clock.elapsedTime * 0.7) * 0.002;
    const breathY = Math.sin(state.clock.elapsedTime * 1.1) * 0.001;
    const breathZ = Math.sin(state.clock.elapsedTime * 0.5) * 0.001;

    // Set camera position to damped position + pointer parallax + breath offset
    camera.position.set(
      currentPosition.current.x + pointerDamped.current.x + breathX,
      currentPosition.current.y + pointerDamped.current.y + breathY,
      currentPosition.current.z + breathZ
    );
    
    // Camera lookAt the damped target with subtle pointer offset
    const lookTarget = new THREE.Vector3(
      currentTarget.current.x + pointerDamped.current.x * 0.25,
      currentTarget.current.y + pointerDamped.current.y * 0.25,
      currentTarget.current.z
    );
    camera.lookAt(lookTarget);

    // Smoothly adjust camera fov toward preset fov
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pCam = camera as THREE.PerspectiveCamera;
      pCam.fov = THREE.MathUtils.damp(pCam.fov, preset.fov, 2, delta);
      pCam.updateProjectionMatrix();
    }
  });

  return null;
}
