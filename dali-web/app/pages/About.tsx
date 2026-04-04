import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { motion, useInView } from 'framer-motion';
import Navbar from '@/components/Navbar';
import AnimatedBlocks from '@/components/AnimatedBlocks';

interface LocationState {
  fromScroll?: boolean;
}

function yearsSinceApril2013(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  let years = y - 2013;
  if (m < 3 || (m === 3 && d < 1)) years--;
  return years;
}

/** Not checked into git (see .gitignore); set VITE_TECHNIGALA_VIDEO_URL for deploy/CDN. */
const TECHNIGALA_VIDEO_SRC =
  import.meta.env.VITE_TECHNIGALA_VIDEO_URL ?? '/assets/about/technigala.m4v';

const About: React.FC = () => {
  const years = yearsSinceApril2013();
  const location = useLocation();
  const fromScroll = (location.state as LocationState)?.fromScroll ?? false;
  const [isAnimating, setIsAnimating] = useState(fromScroll);

  // Count of projects for the hero stats
  const projectCount = 326;

  // Video player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [showControls, setShowControls] = useState(false);

  // Refs and useInView for "At a Glance" standalone motion.svg elements
  const glanceStarTopRef = useRef(null);
  const glanceStarTopInView = useInView(glanceStarTopRef, { once: false, amount: 0.3 });

  const glancePinwheelTopRef = useRef(null);
  const glancePinwheelTopInView = useInView(glancePinwheelTopRef, { once: false, amount: 0.3 });

  const glancePinwheelBottomRef = useRef(null);
  const glancePinwheelBottomInView = useInView(glancePinwheelBottomRef, { once: false, amount: 0.3 });

  const glanceStarBottomRef = useRef(null);
  const glanceStarBottomInView = useInView(glanceStarBottomRef, { once: false, amount: 0.3 });

  // Ref and useInView for Feature 1: Building Futures SVG children
  const buildingFuturesRef = useRef(null);
  const buildingFuturesInView = useInView(buildingFuturesRef, { once: false, amount: 0.3 });

  // Ref and useInView for Feature 2: Education SVG children
  const educationRef = useRef(null);
  const educationInView = useInView(educationRef, { once: false, amount: 0.3 });

  // Ref and useInView for Feature 3: Partners SVG children
  const partnersRef = useRef(null);
  const partnersInView = useInView(partnersRef, { once: false, amount: 0.3 });

  // Ref and useInView for Feature 4: Thoughtful Tech Leaders SVG children
  const techLeadersRef = useRef(null);
  const techLeadersInView = useInView(techLeadersRef, { once: false, amount: 0.3 });

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isVideoPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const progress = (videoRef.current.currentTime / videoRef.current.duration) * 100;
      setVideoProgress(progress);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const newTime = (clickX / rect.width) * videoRef.current.duration;
      videoRef.current.currentTime = newTime;
    }
  };

  // Marquee visibility for pausing animation when off-screen
  const marqueeRef = useRef<HTMLDivElement>(null);
  const marqueeTrackRef = useRef<HTMLDivElement>(null);
  const [marqueeVisible, setMarqueeVisible] = useState(true);
  const isDraggingMarquee = useRef(false);
  const dragStartX = useRef(0);
  const dragOffset = useRef(0);
  const [marqueeDragOffset, setMarqueeDragOffset] = useState<number | null>(null);

  // Pause marquee animation when off-screen
  useEffect(() => {
    const marqueeEl = marqueeRef.current;
    if (!marqueeEl) return;

    const observer = new IntersectionObserver(
      ([entry]) => setMarqueeVisible(entry.isIntersecting),
      { threshold: 0 }
    );

    observer.observe(marqueeEl);
    return () => observer.disconnect();
  }, []);

  // Get the current translateX of the animated element
  const getAnimatedTranslateX = () => {
    const track = marqueeTrackRef.current;
    if (!track) return 0;
    const firstChild = track.children[0] as HTMLElement;
    if (!firstChild) return 0;
    const style = window.getComputedStyle(firstChild);
    const matrix = new DOMMatrix(style.transform);
    return matrix.m41;
  };

  // Click-and-drag scrolling for the marquee
  const handleMarqueeMouseDown = (e: React.MouseEvent) => {
    isDraggingMarquee.current = true;
    // Capture current animation position as our starting offset
    const currentX = getAnimatedTranslateX();
    dragOffset.current = currentX;
    dragStartX.current = e.pageX;
    setMarqueeDragOffset(currentX);
    if (marqueeRef.current) {
      marqueeRef.current.style.cursor = 'grabbing';
    }
  };

  const handleMarqueeMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingMarquee.current) return;
    e.preventDefault();
    const dx = e.pageX - dragStartX.current;
    setMarqueeDragOffset(dragOffset.current + dx);
  };

  const handleMarqueeMouseUp = () => {
    isDraggingMarquee.current = false;
    if (marqueeRef.current) {
      marqueeRef.current.style.cursor = '';
    }
  };

  const handleMarqueeMouseLeave = () => {
    if (isDraggingMarquee.current) {
      isDraggingMarquee.current = false;
    }
    // Resume CSS animation by clearing the manual offset
    setMarqueeDragOffset(null);
    if (marqueeRef.current) {
      marqueeRef.current.style.cursor = '';
    }
  };

  // Touch event handlers for mobile drag scrolling
  const handleMarqueeTouchStart = (e: React.TouchEvent) => {
    isDraggingMarquee.current = true;
    const currentX = getAnimatedTranslateX();
    dragOffset.current = currentX;
    dragStartX.current = e.touches[0].pageX;
    setMarqueeDragOffset(currentX);
  };

  const handleMarqueeTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingMarquee.current) return;
    const dx = e.touches[0].pageX - dragStartX.current;
    setMarqueeDragOffset(dragOffset.current + dx);
  };

  const handleMarqueeTouchEnd = () => {
    isDraggingMarquee.current = false;
    // Resume CSS animation after a short delay so it doesn't snap back instantly
    setTimeout(() => {
      if (!isDraggingMarquee.current) {
        setMarqueeDragOffset(null);
      }
    }, 2000);
  };


  // Trigger scroll-in animation when coming from landing page
  // Lock scroll during animation using CSS overflow instead of scroll events
  useEffect(() => {
    if (fromScroll) {
      // Ensure we start at the top of the page immediately
      window.scrollTo(0, 0);

      // Lock scroll using CSS (no layout thrashing)
      document.body.style.overflow = 'hidden';

      // Use requestAnimationFrame to ensure the initial position is rendered
      // before starting the animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(false);
        });
      });

      // Remove scroll lock after animation completes (0.8s transition + small buffer)
      const unlockTimer = setTimeout(() => {
        document.body.style.overflow = '';
      }, 1000);

      return () => {
        document.body.style.overflow = '';
        clearTimeout(unlockTimer);
      };
    }
  }, [fromScroll]);

  return (
    <div
      className="min-h-screen bg-background overflow-x-clip"
      style={{ overflowY: isAnimating ? 'hidden' : undefined }}
    >
      <Navbar />

      {/* Content starts below navbar */}
      <div
        className="overflow-visible"
        style={{
          transform: isAnimating ? 'translateY(100vh)' : 'translateY(0)',
          transition: isAnimating ? 'none' : 'transform 0.8s cubic-bezier(0.33, 0, 0.2, 1)'
        }}
      >
        {/* Hero Section - Video */}
        <section className="pt-16 h-screen flex items-stretch overflow-visible relative z-20">
          <div className="w-full flex flex-col md:flex-row h-full">
            {/* Left side - Title (1/4) */}
            <div className="w-full md:w-1/4 flex flex-col justify-center items-center md:items-start px-6 md:px-10 py-6 md:py-0 relative overflow-visible bg-background">
              {/* Top decorative blocks - hidden on mobile */}
              <AnimatedBlocks
                variant="code"
                className="hidden md:block absolute md:-top-28 lg:-top-36 left-4 md:w-56 lg:w-72 pointer-events-none z-20"
              />
              {/* Bottom decorative elements - hidden on mobile */}
              <AnimatedBlocks
                variant="bottom"
                className="hidden md:block absolute -bottom-4 md:-bottom-6 right-2 md:right-[-1rem] lg:right-[-2rem] w-48 md:w-64 lg:w-80 pointer-events-none z-30"
                delay={0.3}
              />

              {/* Title - centered on mobile */}
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold leading-tight relative z-10 text-center md:text-left mt-4">
                <span className="text-accent-coral dark:text-[#FFA89C] block">code,</span>
                <span className="text-accent-teal dark:text-[#8CE0D6] block">laugh,</span>
                <span className="text-accent-pink dark:text-[#FFB6C1] block">love</span>
              </h1>
            </div>

            {/* Right side - Video (3/4) */}
            <div
              className="w-full md:w-3/4 h-[50vh] md:h-full relative overflow-hidden group/video"
              onMouseEnter={() => setShowControls(true)}
              onMouseLeave={() => setShowControls(false)}
            >
              <video
                ref={videoRef}
                className="w-full h-full object-cover cursor-pointer"
                playsInline
                preload="metadata"
                poster="/assets/about/photo1.webp"
                onPlay={() => setIsVideoPlaying(true)}
                onPause={() => setIsVideoPlaying(false)}
                onEnded={() => { setIsVideoPlaying(false); setVideoProgress(0); }}
                onTimeUpdate={handleTimeUpdate}
                onClick={togglePlayPause}
              >
                <source src={TECHNIGALA_VIDEO_SRC} type="video/mp4" />
                Your browser does not support the video tag.
              </video>

              {/* Initial play button overlay (before first play) */}
              {!isVideoPlaying && videoProgress === 0 && (
                <button
                  onClick={togglePlayPause}
                  className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors cursor-pointer group"
                  aria-label="Play video"
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full bg-white/90 group-hover:bg-white group-hover:scale-110 transition-all duration-200 flex items-center justify-center shadow-lg">
                    <svg
                      className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 text-accent-coral ml-1"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </button>
              )}

              {/* Floating controls bar (bottom, centered, shows on hover when video has started) */}
              {(isVideoPlaying || videoProgress > 0) && (
                <div
                  className={`absolute bottom-4 left-12 right-6 flex items-center gap-4 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2.5 transition-all duration-300 ${
                    showControls || !isVideoPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                  }`}
                >
                  {/* Play/Pause button */}
                  <button
                    onClick={togglePlayPause}
                    className="text-white hover:text-accent-coral transition-colors flex-shrink-0"
                    aria-label={isVideoPlaying ? 'Pause' : 'Play'}
                  >
                    {isVideoPlaying ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>

                  {/* Full-width progress bar */}
                  <div
                    className="group/progress flex-1 h-1.5 hover:h-2.5 bg-white/30 rounded-full cursor-pointer transition-all duration-150 relative"
                    onClick={handleProgressClick}
                  >
                    <div
                      className="h-full bg-accent-coral rounded-full transition-all duration-100 relative"
                      style={{ width: `${videoProgress}%` }}
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 group-hover/progress:w-3.5 group-hover/progress:h-3.5 bg-white rounded-full shadow-md transition-all duration-150 translate-x-1/2" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* WHO WE ARE Section */}
        <section className="w-full bg-section-bg dark:bg-section-bg px-4 sm:px-6 md:px-8 py-12 md:py-16 overflow-visible relative">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 md:gap-12 items-center relative">

            {/* LEFT: Text */}
            <div className="relative order-2 md:order-1">
              <h2 className="text-base sm:text-lg md:text-xl tracking-[0.15em] sm:tracking-[0.25em] text-dark-blue dark:text-white font-semibold mb-4 sm:mb-6">
                WHO&nbsp;&nbsp;WE&nbsp;&nbsp;ARE
              </h2>

              <div className="space-y-3 sm:space-y-4 md:space-y-5 text-dark-blue dark:text-white">
                <p className="text-base sm:text-lg md:text-[1.15rem] leading-relaxed sm:leading-7 md:leading-8">
                  DALI Lab is a student-driven technology and design agency at Dartmouth College that designs and builds
                  early-stage mobile, web, AR/VR, and hardware products.
                </p>
                <p className="text-base sm:text-lg md:text-[1.15rem] leading-relaxed sm:leading-7 md:leading-8">
                  Students are employed to work in teams to develop, design, and create solutions for community and
                  global partners, engaging in the full Human-Centered Design process. Lab members apply their classroom learning to real-world, industry-standard
                  projects in a community of like-minded individuals.
                </p>
              </div>
            </div>

            {/* RIGHT: Who We Are image */}
            <div className="relative flex items-center justify-center md:justify-end order-1 md:order-2 -mt-4 sm:-mt-8 md:-mt-16 lg:-mt-20 z-20">
              <AnimatedBlocks
                variant="whoweare"
                className="w-full max-w-[280px] sm:max-w-[350px] md:max-w-[450px] lg:max-w-[550px] xl:max-w-[650px] object-contain relative z-20"
              />
            </div>
          </div>
        </section>

        {/* AT A GLANCE */}
        <section className="w-full relative text-white overflow-visible">
          {/* Photo collage background */}
          <div className="absolute inset-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
            <div className="overflow-hidden">
              <picture>
                <source srcSet="assets/about/photo1.webp" type="image/webp" />
                <img src="assets/about/photo1.JPG" alt="" className="w-full h-full object-cover" loading="lazy" />
              </picture>
            </div>
            <div className="overflow-hidden">
              <picture>
                <source srcSet="assets/about/photo3.webp" type="image/webp" />
                <img src="assets/about/photo3.JPG" alt="" className="w-full h-full object-cover" loading="lazy" />
              </picture>
            </div>
            <div className="overflow-hidden">
              <picture>
                <source srcSet="assets/about/photo5.webp" type="image/webp" />
                <img src="assets/about/photo5.JPG" alt="" className="w-full h-full object-cover" loading="lazy" />
              </picture>
            </div>
            <div className="overflow-hidden hidden md:block">
              <picture>
                <source srcSet="assets/about/photo7.webp" type="image/webp" />
                <img src="assets/about/photo7.JPG" alt="" className="w-full h-full object-cover" loading="lazy" />
              </picture>
            </div>
            <div className="overflow-hidden hidden md:block">
              <picture>
                <source srcSet="assets/about/photo2.webp" type="image/webp" />
                <img src="assets/about/photo2.JPG" alt="" className="w-full h-full object-cover" loading="lazy" />
              </picture>
            </div>
          </div>

          {/* Coral overlay */}
          <div className="absolute inset-0 bg-accent-coral/80"></div>

          {/* Top-left corner - 4-pointed star (flies in from bottom-right) - extends into section above */}
          <motion.svg
            ref={glanceStarTopRef}
            viewBox="0 0 47 47"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute -top-12 -left-6 md:-top-16 md:-left-8 w-[80px] md:w-[120px] lg:w-[150px] h-auto pointer-events-none z-30"
            initial={{ x: 200, y: 150, opacity: 0, rotate: 180 }}
            animate={glanceStarTopInView ? { x: 0, y: 0, opacity: 1, rotate: 0 } : { x: 200, y: 150, opacity: 0, rotate: 180 }}
            transition={{ duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <path fillRule="evenodd" clipRule="evenodd" d="M16.9873 10.0534C18.1687 16.351 23.4286 23.5007 23.4286 23.5007C23.4286 23.5007 29.2602 15.5739 30.0218 9.06151C30.1301 8.53586 30.1872 7.98914 30.1872 7.42789C30.1872 3.32558 27.1342 -1.90735e-06 23.3682 -1.90735e-06C19.6021 -1.90735e-06 16.5491 3.32558 16.5491 7.42789C16.5491 8.35223 16.7041 9.23713 16.9873 10.0534ZM23.438 23.5172C24.1394 23.0105 30.8585 18.2419 36.8176 17.121C37.6358 16.8363 38.523 16.6804 39.4499 16.6804C43.5523 16.6804 46.8778 19.7334 46.8778 23.4995C46.8778 27.2655 43.5523 30.3185 39.4499 30.3185C38.8919 30.3185 38.3483 30.262 37.8254 30.155C31.8617 29.4613 24.7081 24.5105 23.5422 23.6792C24.3551 24.8209 28.7842 31.2365 29.8553 36.95C30.1383 37.766 30.2931 38.6506 30.2931 39.5745C30.2931 43.6768 27.2401 47.0024 23.4741 47.0024C19.708 47.0024 16.655 43.6768 16.655 39.5745C16.655 39.0137 16.7121 38.4673 16.8202 37.9421C17.5007 32.1155 22.2409 25.1557 23.2322 23.7538C21.7969 24.7675 14.8604 29.4806 9.05246 30.1562C8.52959 30.2633 7.98592 30.3198 7.42789 30.3198C3.32558 30.3198 1.90735e-06 27.2668 1.90735e-06 23.5008C1.90735e-06 19.7347 3.32558 16.6817 7.42789 16.6817C8.35479 16.6817 9.24204 16.8376 10.0602 17.1223C16.0144 18.2423 22.7273 23.0039 23.438 23.5172Z" fill="#8CE0D6"/>
          </motion.svg>
          {/* Top-left corner - pinwheel (flies in from bottom-right, overlapping) */}
          <motion.svg
            ref={glancePinwheelTopRef}
            viewBox="0 0 47 47"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute top-2 left-8 md:top-4 md:left-12 w-[60px] md:w-[100px] lg:w-[130px] h-auto pointer-events-none z-30"
            initial={{ x: 180, y: 130, opacity: 0, rotate: -180 }}
            animate={glancePinwheelTopInView ? { x: 0, y: 0, opacity: 1, rotate: 0 } : { x: 180, y: 130, opacity: 0, rotate: -180 }}
            transition={{ duration: 1, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <mask id="mask0_glance_tl" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="47">
              <path d="M47.0023 0L0 0L0 46.4493H47.0023V0Z" fill="white"/>
            </mask>
            <g mask="url(#mask0_glance_tl)">
              <path fillRule="evenodd" clipRule="evenodd" d="M6.1719 23.2247C-8.68222 40.7909 5.72591 55.0295 23.5012 40.3501C41.273 55.0295 55.6846 40.7774 40.8304 23.2247C55.6846 5.65855 41.273 -8.58008 23.5012 6.09928C5.72591 -8.58008 -8.68222 5.65855 6.1719 23.2247ZM23.5012 31.8178C28.3036 31.8178 32.1966 27.9706 32.1966 23.2247C32.1966 18.4788 28.3036 14.6315 23.5012 14.6315C18.6988 14.6315 14.8057 18.4788 14.8057 23.2247C14.8057 27.9706 18.6988 31.8178 23.5012 31.8178Z" fill="#FFF3B5"/>
            </g>
          </motion.svg>
          {/* Bottom-right corner - pinwheel (flies in from top-left, overlapping) */}
          <motion.svg
            ref={glancePinwheelBottomRef}
            viewBox="0 0 47 47"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute bottom-2 right-8 md:bottom-4 md:right-12 w-[60px] md:w-[100px] lg:w-[130px] h-auto pointer-events-none z-30"
            initial={{ x: -180, y: -130, opacity: 0, rotate: 180 }}
            animate={glancePinwheelBottomInView ? { x: 0, y: 0, opacity: 1, rotate: 0 } : { x: -180, y: -130, opacity: 0, rotate: 180 }}
            transition={{ duration: 1, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <mask id="mask0_glance_br1" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="47">
              <path d="M47.0023 0L0 0L0 46.4493H47.0023V0Z" fill="white"/>
            </mask>
            <g mask="url(#mask0_glance_br1)">
              <path fillRule="evenodd" clipRule="evenodd" d="M6.1719 23.2247C-8.68222 40.7909 5.72591 55.0295 23.5012 40.3501C41.273 55.0295 55.6846 40.7774 40.8304 23.2247C55.6846 5.65855 41.273 -8.58008 23.5012 6.09928C5.72591 -8.58008 -8.68222 5.65855 6.1719 23.2247ZM23.5012 31.8178C28.3036 31.8178 32.1966 27.9706 32.1966 23.2247C32.1966 18.4788 28.3036 14.6315 23.5012 14.6315C18.6988 14.6315 14.8057 18.4788 14.8057 23.2247C14.8057 27.9706 18.6988 31.8178 23.5012 31.8178Z" fill="#CA60AC"/>
            </g>
          </motion.svg>
          {/* Bottom-right corner - 4-pointed star (flies in from top-left) - extends into section below */}
          <motion.svg
            ref={glanceStarBottomRef}
            viewBox="0 0 47 47"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute -bottom-12 -right-6 md:-bottom-16 md:-right-8 w-[80px] md:w-[120px] lg:w-[150px] h-auto pointer-events-none z-30"
            initial={{ x: -200, y: -150, opacity: 0, rotate: -180 }}
            animate={glanceStarBottomInView ? { x: 0, y: 0, opacity: 1, rotate: 0 } : { x: -200, y: -150, opacity: 0, rotate: -180 }}
            transition={{ duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <path fillRule="evenodd" clipRule="evenodd" d="M16.9873 10.0534C18.1687 16.351 23.4286 23.5007 23.4286 23.5007C23.4286 23.5007 29.2602 15.5739 30.0218 9.06151C30.1301 8.53586 30.1872 7.98914 30.1872 7.42789C30.1872 3.32558 27.1342 -1.90735e-06 23.3682 -1.90735e-06C19.6021 -1.90735e-06 16.5491 3.32558 16.5491 7.42789C16.5491 8.35223 16.7041 9.23713 16.9873 10.0534ZM23.438 23.5172C24.1394 23.0105 30.8585 18.2419 36.8176 17.121C37.6358 16.8363 38.523 16.6804 39.4499 16.6804C43.5523 16.6804 46.8778 19.7334 46.8778 23.4995C46.8778 27.2655 43.5523 30.3185 39.4499 30.3185C38.8919 30.3185 38.3483 30.262 37.8254 30.155C31.8617 29.4613 24.7081 24.5105 23.5422 23.6792C24.3551 24.8209 28.7842 31.2365 29.8553 36.95C30.1383 37.766 30.2931 38.6506 30.2931 39.5745C30.2931 43.6768 27.2401 47.0024 23.4741 47.0024C19.708 47.0024 16.655 43.6768 16.655 39.5745C16.655 39.0137 16.7121 38.4673 16.8202 37.9421C17.5007 32.1155 22.2409 25.1557 23.2322 23.7538C21.7969 24.7675 14.8604 29.4806 9.05246 30.1562C8.52959 30.2633 7.98592 30.3198 7.42789 30.3198C3.32558 30.3198 1.90735e-06 27.2668 1.90735e-06 23.5008C1.90735e-06 19.7347 3.32558 16.6817 7.42789 16.6817C8.35479 16.6817 9.24204 16.8376 10.0602 17.1223C16.0144 18.2423 22.7273 23.0039 23.438 23.5172Z" fill="#A2D483"/>
          </motion.svg>

          {/* Content */}
          <div className="relative z-10 px-6 sm:px-8 md:px-12 lg:px-20 py-16 sm:py-24 md:py-32 lg:py-40">
            <div className="text-center tracking-[0.15em] sm:tracking-[0.25em] md:tracking-[0.35em] text-xs sm:text-sm md:text-base mb-6 sm:mb-8 md:mb-10 lg:mb-12 font-bold">
              AT&nbsp;&nbsp;A&nbsp;&nbsp;GLANCE
            </div>

            <div className="grid grid-cols-3 gap-x-4 sm:gap-x-8 md:gap-x-12 lg:gap-x-16 max-w-4xl mx-auto">
              {/* stat 1 */}
              <div className="text-center">
                <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold leading-none" aria-label={`${years} years`}>
                  {years}
                </div>
                <div className="mt-2 sm:mt-3 md:mt-4 text-sm sm:text-base md:text-lg opacity-90">years</div>
              </div>
              {/* stat 2 */}
              <Link
                to="/projects"
                className="text-center hover:opacity-80 transition-opacity cursor-pointer"
                onClick={() => window.scrollTo(0, 0)}
              >
                <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold leading-none" aria-label="326">
                  {projectCount}
                </div>
                <div className="mt-2 sm:mt-3 md:mt-4 text-sm sm:text-base md:text-lg opacity-90">projects</div>
              </Link>

              {/* stat 3 */}
              <Link
                to="/team"
                className="text-center hover:opacity-80 transition-opacity cursor-pointer"
                onClick={() => window.scrollTo(0, 0)}
              >
                <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold leading-none" aria-label="786 students">
                  2000+
                </div>
                <div className="mt-2 sm:mt-3 md:mt-4 text-sm sm:text-base md:text-lg opacity-90">students</div>
              </Link>
            </div>
          </div>
        </section>

        {/* Three Features Section - Hands-on Learning, Community, Local and Global Impact */}
        <section className="w-full bg-section-bg dark:bg-section-bg dark:text-white overflow-visible relative z-10">

          {/* Feature 1: Hands-on Learning */}
          <div className="relative py-8 sm:py-10 md:py-12 lg:py-16 xl:py-20 px-4 sm:px-6 md:px-8 lg:px-12 dark:bg-section-bg overflow-visible">
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 md:gap-10 lg:gap-12 items-center overflow-visible">
              {/* Left: Graphics */}
              <div className="relative h-48 sm:h-56 md:h-64 lg:h-80 xl:h-96 -mt-4 -mb-8 sm:-mt-6 sm:-mb-12 md:-mt-8 md:-mb-16 lg:-mt-12 lg:-mb-24 z-20 order-1 flex items-center justify-start ml-[-4rem] md:ml-[-6rem] lg:ml-[-8rem] overflow-visible">
                <svg
                  ref={buildingFuturesRef}
                  viewBox="-100 0 435 326"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full object-contain overflow-visible"
                >
                  {/* Main green square */}
                  <motion.rect
                    x="83.5461" y="81.3031" width="167.91" height="163.399" fill="#509C81"
                    initial={{ x: -200, opacity: 0 }}
                    animate={buildingFuturesInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Concentric circles */}
                  <motion.path
                    fillRule="evenodd" clipRule="evenodd"
                    d="M170.778 231.152C209.002 231.152 239.989 200.997 239.989 163.799C239.989 126.602 209.002 96.4471 170.778 96.4471C132.553 96.4471 101.566 126.602 101.566 163.799C101.566 200.997 132.553 231.152 170.778 231.152ZM170.778 223.069C204.415 223.069 231.684 196.533 231.684 163.799C231.684 131.065 204.415 104.529 170.778 104.529C137.14 104.529 109.871 131.065 109.871 163.799C109.871 196.533 137.14 223.069 170.778 223.069ZM170.778 214.987C199.828 214.987 223.378 192.07 223.378 163.799C223.378 135.529 199.828 112.612 170.778 112.612C141.727 112.612 118.177 135.529 118.177 163.799C118.177 192.07 141.727 214.987 170.778 214.987ZM170.778 206.905C195.241 206.905 215.073 187.606 215.073 163.799C215.073 139.993 195.241 120.694 170.778 120.694C146.314 120.694 126.482 139.993 126.482 163.799C126.482 187.606 146.314 206.905 170.778 206.905ZM206.768 163.799C206.768 183.142 190.654 198.822 170.778 198.822C150.901 198.822 134.787 183.142 134.787 163.799C134.787 144.457 150.901 128.776 170.778 128.776C190.654 128.776 206.768 144.457 206.768 163.799ZM198.462 163.799C198.462 178.678 186.067 190.74 170.778 190.74C155.488 190.74 143.093 178.678 143.093 163.799C143.093 148.92 155.488 136.858 170.778 136.858C186.067 136.858 198.462 148.92 198.462 163.799Z"
                    fill="#A2D483"
                    initial={{ x: -200, opacity: 0 }}
                    animate={buildingFuturesInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Bottom right small green square */}
                  <motion.rect
                    x="251.455" y="244.7" width="83.5454" height="81.3009" fill="#A2D483"
                    initial={{ x: -200, opacity: 0 }}
                    animate={buildingFuturesInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Top teal square */}
                  <motion.rect
                    x="83.5461" y="0" width="83.5454" height="81.3009" fill="#8CE0D6"
                    initial={{ x: -200, opacity: 0 }}
                    animate={buildingFuturesInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Dark circle on teal */}
                  <motion.ellipse
                    cx="125.729" cy="40.2517" rx="21.7054" ry="21.1223" fill="#0B1C29"
                    initial={{ x: -200, opacity: 0 }}
                    animate={buildingFuturesInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Yellow circle top right */}
                  <motion.ellipse
                    cx="293.638" cy="40.2517" rx="21.7054" ry="21.1223" fill="#FFF3B5"
                    initial={{ x: -200, opacity: 0 }}
                    animate={buildingFuturesInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Coral/pink square left */}
                  <motion.rect
                    x="0" y="81.3029" width="83.5454" height="81.3009" fill="#FFA89C"
                    initial={{ x: -200, opacity: 0 }}
                    animate={buildingFuturesInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Red circle on coral */}
                  <motion.ellipse
                    cx="41.3641" cy="121.553" rx="21.7054" ry="21.1223" fill="#E45768"
                    initial={{ x: -200, opacity: 0 }}
                    animate={buildingFuturesInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                </svg>
              </div>

              {/* Right: Text */}
              <div className="relative z-10 order-2">
                <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-4 sm:mb-5 md:mb-6 text-dark-blue dark:text-white">Building Futures</h2>
                <p className="text-sm sm:text-base md:text-lg leading-relaxed mb-3 sm:mb-4 text-dark-blue dark:text-white">
                At DALI, students learn by doing — guided by peer mentors and staff, they take on real-world projects while building industry-standard skills. We embrace challenges with initiative and perseverance, adapting to uncertainty and iterating with care.
                </p>
                <p className="text-sm sm:text-base md:text-lg leading-relaxed text-dark-blue dark:text-white">
                Our community thrives on difference, seeing diversity of people, perspectives, and approaches as a strength. Above all, we support one another, create thoughtfully and ethically, and find joy in the work.
                </p>
              </div>

            </div>
          </div>

          {/* Feature 2: Education */}
          <div className="relative py-8 sm:py-10 md:py-12 lg:py-16 xl:py-20 px-4 sm:px-6 md:px-8 lg:px-12 bg-section-bg dark:bg-section-bg overflow-visible">
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 md:gap-10 lg:gap-12 items-center overflow-visible">
              {/* Left: Text */}
              <div className="relative z-10 order-2 md:order-1">
                <Link to="/education" onClick={() => window.scrollTo(0, 0)}>
                  <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-4 sm:mb-5 md:mb-6 text-dark-blue dark:text-white hover:opacity-80 transition-opacity cursor-pointer whitespace-nowrap">Broader Education Impact</h2>
                </Link>
                <p className="text-sm sm:text-base md:text-lg leading-relaxed mb-3 sm:mb-4 text-dark-blue dark:text-white">
                Our workshops, miniseries, and skill-shares are designed and led by peers, creating a space where everyone can both teach and learn. This peer-to-peer model makes education more approachable, relevant, and dynamic, because it's rooted in real student experiences.
                </p>
                <p className="text-sm sm:text-base md:text-lg leading-relaxed mb-3 sm:mb-4 text-dark-blue dark:text-white">
                By empowering students to take the lead, we spark creativity, collaboration, and confidence across campus. Together, we're building an innovative model of community learning that extends far beyond the lab.
                </p>
              </div>

              {/* Right: Graphics */}
              <div className="relative h-48 sm:h-56 md:h-64 lg:h-80 xl:h-96 -mt-12 mb-4 sm:-mt-8 sm:mb-0 md:-mt-16 md:-mb-16 lg:-mt-24 lg:-mb-24 z-20 order-1 md:order-2 py-4 sm:py-0 flex items-center justify-end mr-[-4rem] md:mr-[-6rem] lg:mr-[-8rem] overflow-visible">
                <svg
                  ref={educationRef}
                  viewBox="0 0 424 405"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full object-contain overflow-visible"
                >
                  {/* Main light green square */}
                  <motion.rect
                    x="80.7988" y="161.602" width="162.393" height="162.393" fill="#A2D483"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Red square top */}
                  <motion.rect
                    x="161.602" y="0" width="80.8001" height="80.8001" fill="#E45768"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Yellow circle in red square */}
                  <motion.circle
                    cx="201.606" cy="40.0042" r="20.9926" fill="#FFF3B5"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Complex pattern path */}
                  <motion.path
                    fillRule="evenodd" clipRule="evenodd"
                    d="M80.8013 323.996L80.8013 242.799L80.8013 161.603L161.998 161.603L243.195 161.603V242.799V323.996H161.998H80.8013ZM161.998 283.376C162.01 260.964 180.182 242.799 202.596 242.799C180.175 242.799 161.998 224.623 161.998 202.201C161.998 224.623 143.821 242.799 121.4 242.799C143.814 242.799 161.986 260.964 161.998 283.376ZM121.4 263.911C132.162 263.911 140.887 272.635 140.887 283.398C140.887 294.16 132.162 302.885 121.4 302.885C110.637 302.885 101.912 294.16 101.912 283.398C101.912 272.635 110.637 263.911 121.4 263.911ZM140.887 202.201C140.887 212.964 132.162 221.688 121.4 221.688C110.637 221.688 101.912 212.964 101.912 202.201C101.912 191.439 110.637 182.714 121.4 182.714C132.162 182.714 140.887 191.439 140.887 202.201ZM183.109 283.398C183.109 272.635 191.834 263.911 202.596 263.911C213.359 263.911 222.083 272.635 222.083 283.398C222.083 294.16 213.359 302.885 202.596 302.885C191.834 302.885 183.109 294.16 183.109 283.398ZM183.109 202.201C183.109 212.964 191.834 221.688 202.596 221.688C213.359 221.688 222.083 212.964 222.083 202.201C222.083 191.439 213.359 182.714 202.596 182.714C191.834 182.714 183.109 191.439 183.109 202.201Z"
                    fill="#509C81"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Pink circle bottom right */}
                  <motion.circle
                    cx="283.2" cy="363.999" r="20.9926" fill="#CA60AC"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Light green square right */}
                  <motion.rect
                    x="243.193" y="80.7988" width="80.8001" height="80.8001" fill="#A2D483"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Dark blue circle */}
                  <motion.circle
                    cx="283.197" cy="120.803" r="20.9926" fill="#154C74"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Orange circle left */}
                  <motion.circle
                    cx="40.0043" cy="201.604" r="20.9926" fill="#F9C679"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Teal square bottom left */}
                  <motion.rect
                    x="0" y="323.995" width="80.8001" height="80.8001" fill="#24B1B1"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Dark circle in teal square */}
                  <motion.circle
                    cx="40.0043" cy="363.999" r="20.9926" fill="#0B1C29"
                    initial={{ x: 200, opacity: 0 }}
                    animate={educationInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.9, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                </svg>
              </div>

            </div>
          </div>


          {/* Feature 3: Partners */}
          <div className="relative py-8 sm:py-10 md:py-12 lg:py-16 xl:py-20 px-4 sm:px-6 md:px-8 lg:px-12 bg-section-bg dark:bg-section-bg overflow-visible">
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 md:gap-10 lg:gap-12 items-center overflow-visible">
              {/* Left: Graphics */}
              <div className="relative h-48 sm:h-56 md:h-64 lg:h-80 xl:h-96 -mt-16 mb-4 sm:-mt-12 sm:-mb-24 md:-mt-16 md:-mb-36 lg:-mt-24 lg:-mb-48 z-20 order-1 flex items-center justify-start ml-[-4rem] md:ml-[-6rem] lg:ml-[-8rem] overflow-visible">
                <svg
                  ref={partnersRef}
                  viewBox="-100 0 437 337"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full object-contain overflow-visible"
                >
                  {/* Main green square */}
                  <motion.rect
                    x="84.0408" y="84.0413" width="168.912" height="168.912" fill="#509C81"
                    initial={{ x: -200, opacity: 0 }}
                    animate={partnersInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Globe/sphere pattern */}
                  <motion.path
                    fillRule="evenodd" clipRule="evenodd"
                    d="M190.872 213.431C184.115 224.692 175.945 229.767 168.497 229.767C161.049 229.767 152.879 224.692 146.122 213.431C139.465 202.337 135.077 186.47 135.077 168.498C135.077 150.525 139.465 134.659 146.122 123.564C152.879 112.303 161.049 107.228 168.497 107.228C175.945 107.228 184.115 112.303 190.872 123.564C197.528 134.659 201.917 150.525 201.917 168.498C201.917 186.47 197.528 202.337 190.872 213.431ZM238.122 168.498C238.122 130.045 206.949 98.8732 168.497 98.8732C130.045 98.8732 98.8726 130.045 98.8726 168.498C98.8726 206.95 130.045 238.122 168.497 238.122C206.949 238.122 238.122 206.95 238.122 168.498ZM107.228 168.498C107.228 193.514 122.219 215.028 143.709 224.545C133.405 211.866 126.722 191.483 126.722 168.498C126.722 145.513 133.405 125.129 143.709 112.45C122.219 121.968 107.228 143.482 107.228 168.498ZM229.767 168.498C229.767 193.514 214.774 215.028 193.286 224.545C203.589 211.866 210.272 191.483 210.272 168.498C210.272 145.513 203.589 125.129 193.286 112.45C214.774 121.968 229.767 143.482 229.767 168.498ZM168.497 176.156C172.727 176.156 176.156 172.727 176.156 168.498C176.156 164.268 172.727 160.839 168.497 160.839C164.267 160.839 160.838 164.268 160.838 168.498C160.838 172.727 164.267 176.156 168.497 176.156Z"
                    fill="#A2D483"
                    initial={{ x: -200, opacity: 0 }}
                    animate={partnersInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Red square bottom left */}
                  <motion.rect
                    x="0" y="252.957" width="84.0438" height="84.0438" fill="#E45768"
                    initial={{ x: -200, opacity: 0 }}
                    animate={partnersInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Pink circle in red square */}
                  <motion.circle
                    cx="41.6093" cy="294.566" r="21.8349" fill="#E68FBE"
                    initial={{ x: -200, opacity: 0 }}
                    animate={partnersInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Teal circle left */}
                  <motion.circle
                    cx="42.4326" cy="126.477" r="21.8349" fill="#24B1B1"
                    initial={{ x: -200, opacity: 0 }}
                    animate={partnersInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Cyan square top right */}
                  <motion.rect
                    x="252.957" y="0" width="84.0438" height="84.0438" fill="#8CE0D6"
                    initial={{ x: -200, opacity: 0 }}
                    animate={partnersInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Green circle in cyan square */}
                  <motion.circle
                    cx="294.566" cy="41.6093" r="21.8349" fill="#64B598"
                    initial={{ x: -200, opacity: 0 }}
                    animate={partnersInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Yellow circle right */}
                  <motion.circle
                    cx="294.564" cy="210.521" r="21.8349" fill="#FFF3B5"
                    initial={{ x: -200, opacity: 0 }}
                    animate={partnersInView ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                </svg>
              </div>

              {/* Right: Text */}
              <div className="relative z-10 order-2">
                <Link to="/projects" onClick={() => window.scrollTo(0, 0)}>
                  <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-4 sm:mb-5 md:mb-6 text-dark-blue dark:text-white hover:opacity-80 transition-opacity cursor-pointer">From Ideas to Solutions</h2>
                </Link>
                <p className="text-sm sm:text-base md:text-lg leading-relaxed mb-3 sm:mb-4 text-dark-blue dark:text-white">
                  Students take full ownership of their work, leading projects from ideation through design, development, and deployment. Every stage — from early brainstorming to polished, real-world products — is driven by student initiative and collaboration.
                </p>
                <p className="text-sm sm:text-base md:text-lg leading-relaxed text-dark-blue dark:text-white">
                  These projects are built to last and actively used at Dartmouth and beyond. By working closely with partners, students balance innovation with real-world needs, delivering lasting value and measurable impact.
                </p>
              </div>

            </div>
          </div>

          {/* Feature 4: Thoughtful Tech Leaders */}
          <div className="relative pt-8 sm:pt-10 md:pt-16 lg:pt-24 xl:pt-32 pb-8 sm:pb-10 md:pb-12 lg:pb-16 xl:pb-20 px-4 sm:px-6 md:px-8 lg:px-12 bg-section-bg dark:bg-section-bg overflow-visible">
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 md:gap-10 lg:gap-12 items-center overflow-visible">
              {/* Left: Text */}
              <div className="relative z-10 order-2 md:order-1 text-left">
                <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-4 sm:mb-5 md:mb-6 text-dark-blue dark:text-white text-left -ml-0.5 md:-ml-1">Thoughtful Tech Leaders</h2>
                <p className="text-sm sm:text-base md:text-lg leading-relaxed mb-3 sm:mb-4 text-dark-blue dark:text-white">
                  We are committed to continuously learning about the tools available to us. We stay curious, adapt quickly, and ensure our members are prepared to lead in a world shaped by AI.
                </p>
                <p className="text-sm sm:text-base md:text-lg leading-relaxed text-dark-blue dark:text-white">
                  Through educational mini-series and workshops, we teach students how to use AI responsibly and effectively. Our project teams actively develop AI-powered tools, giving members hands-on experience building with the latest technologies.
                </p>
              </div>

              {/* Right: Graphics */}
              <div className="relative h-40 sm:h-48 md:h-56 lg:h-64 xl:h-80 -mt-8 mb-4 sm:-mt-4 sm:mb-0 md:-mt-8 md:-mb-8 lg:-mt-12 lg:-mb-12 z-20 order-1 md:order-2 py-4 sm:py-0 flex items-center justify-end mr-[-2rem] md:mr-[-3rem] lg:mr-[-4rem] overflow-visible">
                <svg
                  ref={techLeadersRef}
                  viewBox="0 0 430 418"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full object-contain overflow-visible"
                >
                  {/* Main green square */}
                  <motion.rect
                    x="106.8" y="103.9" width="214.6" height="208.8" fill="#509C81"
                    initial={{ x: 200, opacity: 0 }}
                    animate={techLeadersInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Bottom right teal square */}
                  <motion.rect
                    x="321.4" y="312.7" width="106.8" height="103.9" fill="#24B1B1"
                    initial={{ x: 200, opacity: 0 }}
                    animate={techLeadersInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Top pink square */}
                  <motion.rect
                    x="106.8" y="0" width="106.8" height="103.9" fill="#E68FBE"
                    initial={{ x: 200, opacity: 0 }}
                    animate={techLeadersInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Dark circle on pink */}
                  <motion.circle
                    cx="160.7" cy="51.4" r="27.0" fill="#0B1C29"
                    initial={{ x: 200, opacity: 0 }}
                    animate={techLeadersInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Teal circle top right */}
                  <motion.circle
                    cx="375.4" cy="51.4" r="27.0" fill="#4CD5C5"
                    initial={{ x: 200, opacity: 0 }}
                    animate={techLeadersInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Coral square left */}
                  <motion.rect
                    x="0" y="103.9" width="106.8" height="103.9" fill="#FFA89C"
                    initial={{ x: 200, opacity: 0 }}
                    animate={techLeadersInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* Red circle on coral */}
                  <motion.circle
                    cx="52.9" cy="155.3" r="27.0" fill="#E45768"
                    initial={{ x: 200, opacity: 0 }}
                    animate={techLeadersInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                  {/* 4-pointed star */}
                  <motion.path
                    d="M267.6 186.9C280.7 186.9 291.4 196.5 291.4 208.3C291.4 220.2 280.7 229.8 267.6 229.8C265.8 229.8 264.1 229.6 262.4 229.3C243.3 227.1 220.4 211.5 216.7 208.9C219.3 212.5 233.5 232.7 237.0 250.7C237.9 253.3 238.4 256.1 238.4 259C238.4 271.9 228.6 282.3 216.3 282.3C204.0 282.3 194.2 271.9 194.2 259C194.2 257.3 194.4 255.6 194.7 254C196.9 235.6 212.1 213.6 215.3 209.2C210.7 212.4 188.4 227.3 169.8 229.4C168.1 229.7 166.4 229.9 164.6 229.9C151.5 229.8 140.9 220.2 140.9 208.4C140.9 196.5 151.5 186.9 164.6 186.9C167.6 186.9 170.4 187.4 173.0 188.3C192.1 191.8 213.6 206.8 215.9 208.4C218.1 206.8 239.7 191.8 259.0 188.3C261.6 187.4 264.4 186.9 267.6 186.9ZM215.9 134.5C227.9 134.5 237.7 145.0 237.7 157.8C237.7 159.5 237.5 161.2 237.2 162.8C234.8 183.3 216.2 208.2 216.1 208.3C216.0 208.2 199.2 185.7 195.4 166.0C194.5 163.4 194.0 160.6 194.0 157.8C194.0 145.0 203.8 134.5 215.9 134.5Z"
                    fill="#A2D483"
                    initial={{ x: 200, opacity: 0 }}
                    animate={techLeadersInView ? { x: 0, opacity: 1 } : { x: 200, opacity: 0 }}
                    transition={{ duration: 0.6, delay: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
                  />
                </svg>
              </div>

            </div>
          </div>
        </section>

        {/* Mission Section */}
        <section className="bg-accent-coral overflow-visible relative">
          {/* Decorative SVG - positioned on left, half below photos */}
          <svg
            viewBox="0 0 337 447"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute left-4 md:left-8 lg:left-16 top-24 md:top-32 lg:top-36 w-[120px] md:w-[180px] lg:w-[220px] h-auto pointer-events-none z-0"
          >
            <rect width="111.75" height="111.75" transform="matrix(-1 0 0 1 111.75 111.75)" fill="#24B1B1"/>
            <rect width="111.75" height="111.75" transform="matrix(-1 0 0 1 223.5 223.5)" fill="#0C4B78"/>
            <circle cx="27.9375" cy="27.9375" r="27.9375" transform="matrix(-1 0 0 1 83.5405 27.6655)" fill="#E45768"/>
            <circle cx="27.9375" cy="27.9375" r="27.9375" transform="matrix(-1 0 0 1 195.834 251.709)" fill="#A2D483"/>
            <circle cx="27.9375" cy="27.9375" r="27.9375" transform="matrix(-1 0 0 1 83.5405 139.959)" fill="#0C4B78"/>
            <circle cx="27.9375" cy="27.9375" r="27.9375" transform="matrix(-1 0 0 1 195.834 139.959)" fill="#FAC27D"/>
            <circle cx="27.9375" cy="27.9375" r="27.9375" transform="matrix(-1 0 0 1 323.913 251.842)" fill="#509C81"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M0 335.25H111.75V447H0V335.25ZM56.1439 419.335C40.7144 419.335 28.2064 406.826 28.2064 391.397C28.2064 375.968 40.7144 363.46 56.1439 363.46C71.5733 363.46 84.0814 375.968 84.0814 391.397C84.0814 406.826 71.5733 419.335 56.1439 419.335Z" fill="#8CE0D6"/>
          </svg>

          {/* Top right decorative SVG - pink square with pinwheel and circles */}
          <svg
            viewBox="0 0 345 138"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute right-24 md:right-32 lg:right-48 -top-4 md:-top-6 lg:-top-8 w-[130px] md:w-[180px] lg:w-[230px] h-auto pointer-events-none z-[15]"
          >
            <rect x="103.832" width="138" height="138" fill="#CA60AC"/>
            <circle cx="34.5" cy="68.665" r="34.5" fill="#A2D483"/>
            <circle cx="310.5" cy="68.665" r="34.5" fill="#0C4B78"/>
            <g clipPath="url(#clip0_mission_tr)">
              <mask id="mask0_mission_tr" maskUnits="userSpaceOnUse" x="130" y="27" width="86" height="84">
                <path d="M215.164 27L130.164 27V111H215.164V27Z" fill="white"/>
              </mask>
              <g mask="url(#mask0_mission_tr)">
                <path fillRule="evenodd" clipRule="evenodd" d="M141.325 69C114.463 100.767 140.519 126.516 172.664 99.97C204.803 126.516 230.865 100.743 204.003 69C230.865 37.233 204.803 11.4836 172.664 38.0301C140.519 11.4836 114.463 37.233 141.325 69ZM172.664 84.54C181.349 84.54 188.389 77.5827 188.389 69C188.389 60.4175 181.349 53.46 172.664 53.46C163.979 53.46 156.939 60.4175 156.939 69C156.939 77.5827 163.979 84.54 172.664 84.54Z" fill="#8CE0D6"/>
              </g>
            </g>
            <defs>
              <clipPath id="clip0_mission_tr">
                <rect width="85" height="84" fill="white" transform="translate(130.164 27)"/>
              </clipPath>
            </defs>
          </svg>

          {/* Scrolling photo marquee - continuous loop */}
          <div
            ref={marqueeRef}
            className={`relative py-10 md:py-14 overflow-hidden group/marquee z-20 cursor-grab ${!marqueeVisible ? 'marquee-paused' : ''}`}
            onMouseDown={handleMarqueeMouseDown}
            onMouseMove={handleMarqueeMouseMove}
            onMouseUp={handleMarqueeMouseUp}
            onMouseLeave={handleMarqueeMouseLeave}
            onTouchStart={handleMarqueeTouchStart}
            onTouchMove={handleMarqueeTouchMove}
            onTouchEnd={handleMarqueeTouchEnd}
          >
            <div ref={marqueeTrackRef} className="flex gap-4 group-hover/marquee:[&>*]:pause-animation">
              <div
                className={`flex gap-4 shrink-0 ${marqueeDragOffset === null ? 'animate-marquee-left' : ''}`}
                style={marqueeDragOffset !== null ? { transform: `translateX(${marqueeDragOffset}px)` } : undefined}
              >
                <picture><source srcSet="assets/about/photo1.webp" type="image/webp" /><img src="assets/about/photo1.JPG" alt="DALI" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo2.webp" type="image/webp" /><img src="assets/about/photo2.JPG" alt="DALI" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo3.webp" type="image/webp" /><img src="assets/about/photo3.JPG" alt="DALI" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo4.webp" type="image/webp" /><img src="assets/about/photo4.JPG" alt="DALI" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo5.webp" type="image/webp" /><img src="assets/about/photo5.JPG" alt="DALI" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo6.webp" type="image/webp" /><img src="assets/about/photo6.JPG" alt="DALI" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo7.webp" type="image/webp" /><img src="assets/about/photo7.JPG" alt="DALI" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
              </div>
              <div
                className={`flex gap-4 shrink-0 ${marqueeDragOffset === null ? 'animate-marquee-left' : ''}`}
                style={marqueeDragOffset !== null ? { transform: `translateX(${marqueeDragOffset}px)` } : undefined}
                aria-hidden="true"
              >
                <picture><source srcSet="assets/about/photo1.webp" type="image/webp" /><img src="assets/about/photo1.JPG" alt="" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo2.webp" type="image/webp" /><img src="assets/about/photo2.JPG" alt="" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo3.webp" type="image/webp" /><img src="assets/about/photo3.JPG" alt="" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo4.webp" type="image/webp" /><img src="assets/about/photo4.JPG" alt="" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo5.webp" type="image/webp" /><img src="assets/about/photo5.JPG" alt="" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo6.webp" type="image/webp" /><img src="assets/about/photo6.JPG" alt="" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
                <picture><source srcSet="assets/about/photo7.webp" type="image/webp" /><img src="assets/about/photo7.JPG" alt="" className="h-36 md:h-56 w-auto object-cover rounded-lg shadow-lg" loading="lazy" /></picture>
              </div>
            </div>
          </div>

          {/* Mission content */}
          <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-12 pt-10 md:pt-10 pb-16 md:pb-28">
            <div className="flex flex-col md:flex-row md:items-start gap-8 md:gap-16">
              {/* Title on left */}
              <div className="md:w-1/3">
                <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white">
                  Our Mission
                </h2>
              </div>

              {/* Content on right */}
              <div className="md:w-2/3 space-y-6">
                <p className="text-lg md:text-xl leading-relaxed text-white/95">
                  At our core is the transformative process of building solutions from discovery to impact, together.
                </p>
                <p className="text-lg md:text-xl leading-relaxed text-white/90">
                  And we challenge ourselves to be curious and to care — for each other, the craft we're learning, the problems we're solving, the reality we live in, and the future we envision.
                </p>
              </div>
            </div>
          </div>

          {/* CSS for marquee animation */}
          <style>{`
            @keyframes marquee-left {
              0% { transform: translateX(0); }
              100% { transform: translateX(calc(-100% - 1rem)); }
            }
            .animate-marquee-left {
              animation: marquee-left 40s linear infinite;
            }
            .group\\/marquee:hover .animate-marquee-left,
            .marquee-paused .animate-marquee-left {
              animation-play-state: paused;
            }
            .group\\/marquee img {
              -webkit-user-drag: none;
              user-select: none;
              pointer-events: none;
            }
          `}</style>

          {/* Bottom right decorative SVG - overlaps into footer */}
          <svg
            viewBox="0 0 287 153"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute right-0 bottom-0 md:-bottom-2 lg:-bottom-6 w-[140px] md:w-[200px] lg:w-[260px] h-auto pointer-events-none z-20"
          >
            <path d="M98.9533 4.97699H91.6419V29.0529L74.6177 12.0287L69.4477 17.1987L86.4719 34.2229H62.396V41.5343H86.4719L69.4477 58.5586L74.6177 63.7286L91.6419 46.7043V70.7802H98.9533V46.7043L115.978 63.7286L121.148 58.5586L104.123 41.5343H128.199V34.2229H104.123L121.148 17.1986L115.978 12.0287L98.9533 29.0529V4.97699Z" fill="#8CE0D6"/>
            <rect x="210.04" width="76.3096" height="76.3096" fill="#E45768"/>
            <rect x="57.4194" y="76.3093" width="76.3096" height="76.3096" fill="#E68FBE"/>
            <rect x="133.729" y="76.3093" width="76.3096" height="76.3096" fill="#FFF3B5"/>
            <rect x="210.04" y="76.3093" width="76.3096" height="76.3096" fill="#A2D483"/>
            <circle cx="171.698" cy="37.9692" r="19.0774" fill="#0C4B78"/>
            <circle cx="171.607" cy="114.741" r="19.0774" fill="#092940"/>
            <circle cx="248.008" cy="114.65" r="19.0774" fill="#24B1B1"/>
            <circle cx="248.471" cy="37.8781" r="19.0774" fill="#FFA89C"/>
            <circle cx="95.7595" cy="114.65" r="19.0774" fill="#CA60AC"/>
            <circle cx="19.0774" cy="114.65" r="19.0774" fill="#FAC27D"/>
          </svg>
        </section>

        {/* Footer */}
        <footer className="bg-gray-900 text-white py-8 sm:py-10 md:py-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-8xl mx-auto flex flex-col sm:flex-row sm:justify-between sm:items-stretch">
            <div className="text-center sm:text-left flex flex-col sm:justify-between">
              {/* Address and email at top */}
              <div>
                <p className="mb-3 ml-0 sm:ml-[4rem] text-base sm:text-lg">15 Engineering Drive, ECSC 002, Hanover, NH, 03755</p>
                <a href="mailto:contact@dali.dartmouth.edu" className="text-white sm:ml-[4rem] hover:underline text-sm sm:text-base">
                  contact@dali.dartmouth.edu
                </a>
              </div>

              {/* Social Links at bottom */}
              <div className="flex flex-wrap justify-center sm:justify-start text-center sm:text-left ml-0 sm:ml-[4rem] gap-4 sm:gap-5 md:gap-6 mt-6 sm:mt-0">
                <a href="https://www.linkedin.com/school/dali-lab" target="_blank" rel="noopener noreferrer" className="hover:text-dali-teal text-sm sm:text-base transition">
                  LinkedIn
                </a>
                <a href="https://www.instagram.com/dartmouth_dali_lab/" target="_blank" rel="noopener noreferrer" className="hover:text-dali-teal text-sm sm:text-base transition">
                  Instagram
                </a>
                <a href="https://www.facebook.com/dartmouth.dali.lab" target="_blank" rel="noopener noreferrer" className="hover:text-dali-teal text-sm sm:text-base transition">
                  Facebook
                </a>
                <a href="https://twitter.com/DALI_Lab" target="_blank" rel="noopener noreferrer" className="hover:text-dali-teal text-sm sm:text-base transition">
                  Twitter
                </a>
              </div>
            </div>
            <div className="hidden sm:flex pr-[4rem] pointer-events-none">
              <img
                src="assets/landingpage/footer.png"
                alt="Footer graphic"
                className="max-w-[350px] w-auto h-auto"
              />
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default About;
