import React from 'react';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

export default function PostProcessing() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom
        luminanceThreshold={0.92}
        luminanceSmoothing={0.1}
        intensity={0.35}
        mipmapBlur
      />
      <Vignette
        offset={0.35}
        darkness={0.15}
        eskil={false}
      />
    </EffectComposer>
  );
}
