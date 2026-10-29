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
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-light text-[#F2F2F2] tracking-tight font-sans">
        {dynamicGreeting}
      </h1>
      <p className="text-sm md:text-base text-[#A7A9AF] font-normal font-sans mt-2 tracking-normal">
        Say <span className="text-[#6E8BFF] font-medium">"Hey Aura"</span> to start a conversation
      </p>
    </div>
  );
}
