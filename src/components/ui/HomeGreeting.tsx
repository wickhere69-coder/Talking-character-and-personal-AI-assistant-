import React, { useMemo } from 'react';

export default function HomeGreeting() {
  const dynamicGreeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Good morning, Tharun';
    if (hour >= 12 && hour < 18) return 'Good afternoon, Tharun';
    if (hour >= 18 && hour < 22) return 'Good evening, Tharun';
    return "What's on your mind, Tharun?";
  }, []);

  return (
    <div 
      className="relative z-10 text-center select-none pointer-events-none pt-8 md:pt-14 px-4 transition-all duration-300"
      data-purpose="home-greeting-headline"
    >
      <div className="inline-flex items-center gap-2 mb-2">
        <span className="text-[#C8A882] text-sm">✦</span>
        <span className="font-serif tracking-[0.22em] uppercase text-xs text-[#C8A882] font-semibold">
          AI STUDIO
        </span>
        <span className="text-[#C8A882] text-sm">✦</span>
      </div>
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-normal text-[#FAF6F0] tracking-tight">
        {dynamicGreeting}
      </h1>
      <p className="text-sm md:text-base text-[#8C7664] font-sans mt-2 tracking-normal">
        Say <span className="text-[#C8A882] font-semibold">"Hey Aura"</span> or tap the microphone to start
      </p>
    </div>
  );
}
