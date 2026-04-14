import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '@/components/Navbar';

const LandingPage: React.FC = () => {
  const [videoReady, setVideoReady] = useState(false);
  const [isInitialDisplay, setIsInitialDisplay] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const navigate = useNavigate();
  const hasNavigated = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsInitialDisplay(false), 15000); // 15 seconds
    return () => clearTimeout(timer);
  }, []);

  // Navigate to /about when user scrolls down
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Only navigate if scrolling down and haven't already navigated
      if (e.deltaY > 0 && !hasNavigated.current) {
        hasNavigated.current = true;
        navigate('/about', { state: { fromScroll: true } });
      }
    };

    // Also handle touch swipe for mobile
    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndY = e.changedTouches[0].clientY;
      const deltaY = touchStartY - touchEndY;

      // If swiped up (scrolling down) by at least 50px
      if (deltaY > 50 && !hasNavigated.current) {
        hasNavigated.current = true;
        navigate('/about', { state: { fromScroll: true } });
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background overflow-x-clip">
      <Navbar />
      {/* HERO — full screen video with buttons */}
      <section className="relative h-screen min-h-[600px]" style={{ margin: 0, padding: 0, overflow: 'hidden' }}>
        {/* Full screen video background with poster fallback */}
        <div
          className="absolute inset-0 z-0 overflow-hidden bg-cover bg-center"
          style={{ backgroundImage: 'url(https://res.cloudinary.com/dali-lab/video/upload/so_0,f_jpg,q_auto,w_1920/dali/dali-video/landingvid.jpg)' }}
        >
          <video
            ref={videoRef}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full object-cover transition-opacity duration-700"
            style={{ opacity: videoReady ? 1 : 0 }}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            poster="https://res.cloudinary.com/dali-lab/video/upload/so_0,f_jpg,q_auto,w_1920/dali/dali-video/landingvid.jpg"
            onCanPlayThrough={() => setVideoReady(true)}
          >
            <source src="https://res.cloudinary.com/dali-lab/video/upload/v1770695185/dali/dali-video/landingvid.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>

        {/* White gradient overlay - full width on mobile, left side on desktop */}
        <div
          className="absolute inset-0 md:inset-y-0 md:left-0 md:w-2/5 z-10 transition-transform ease-in-out"
          style={{
            background: 'linear-gradient(to right, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.6) 70%, rgba(255,255,255,0.4) 85%, rgba(255,255,255,0) 100%)',
            transform: !isInitialDisplay && !isHovered ? 'translateX(-100%)' : 'translateX(0)',
            transitionDuration: '1800ms'
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        ></div>

        {/* Hover area to bring content back */}
        <div
          className="absolute inset-y-0 left-0 w-2/5 z-15 hidden md:block"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        ></div>

        {/* Text content on left */}
        <div
          className="relative z-20 w-full md:w-2/5 h-full flex flex-col items-start justify-center md:justify-start px-6 md:px-10 md:pt-64 transition-transform ease-in-out"
          style={{
            transform: !isInitialDisplay && !isHovered ? 'translateX(-100%)' : 'translateX(0)',
            transitionDuration: '1800ms'
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="relative max-w-2xl w-full">
            {/* Hero boxes image */}
            <div className="mb-4 sm:mb-6 md:mb-8">
              <img
                src="assets/landingpage/hero.png"
                alt="DALI colorful boxes"
                className="w-auto h-10 sm:h-12 md:h-16 lg:h-20 object-contain"
              />
            </div>

            <h1 className="text-left text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold leading-tight tracking-tight mb-4 sm:mb-6 md:mb-8 text-[#1A3A52]" style={{ textShadow: '0 0.125rem 0.25rem rgba(27,73,101,0.15), 0 0.25rem 0.5rem rgba(27,73,101,0.1)' }}>
              Designing & building idea <br />
               into impact
            </h1>

            {/* Squiggles image - positioned right below text, overlapping into next section */}
            <div className="absolute left-0 w-full hidden sm:block" style={{ top: '100%', transform: 'translateY(1.5rem) translateX(-4rem) scaleX(1.2) scaleY(1.1)' }}>
              <img
                src="assets/landingpage/squiggles.png"
                alt="Decorative squiggles"
                className="w-full h-auto object-contain"
              />
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 animate-bounce">
          <svg className="w-6 h-6 text-[#1A3A52] opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;
