import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import Navbar from '@/components/Navbar';
interface TeamMember {
  id: string;
  name: string;
  year: string | number;
  roles: string[];
  coreRoleNames?: string[];
  termsInDali: string[];
  profileImage: string;
  linkedinUrl: string;
}

interface Offering {
  id: string;
  name: string;
  type: string;
  description?: string;
  tags: string[];
  signUpLink: string;
  date: {
    fullDate?: string;
    day: string | number;
    month: string;
    year?: string | number;
    time?: string;
  };
}

const MOCK_OFFERINGS: Offering[] = [
  {
    id: "1",
    name: "Intro to React",
    type: "workshop",
    description: "Learn the fundamentals of React including components, hooks, and state management.",
    tags: ["React", "JavaScript", "Frontend"],
    signUpLink: "#",
    date: { fullDate: "2026-04-15", day: 15, month: "April", year: 2026, time: "5:00 PM" },
  },
  {
    id: "2",
    name: "ML Fundamentals Mini-Series",
    type: "mini-series",
    description: "A three-part series covering the basics of machine learning with Python.",
    tags: ["ML", "Python", "Data Science"],
    signUpLink: "#",
    date: { fullDate: "2026-04-20", day: 20, month: "April", year: 2026, time: "4:00 PM" },
  },
  {
    id: "3",
    name: "Design Systems Workshop",
    type: "workshop",
    description: "Build and document your own design system using Figma and Storybook.",
    tags: ["Design", "Figma", "Frontend"],
    signUpLink: "#",
    date: { fullDate: "2026-05-01", day: 1, month: "May", year: 2026, time: "3:00 PM" },
  },
];

const MOCK_EDUCATION_LEADS: TeamMember[] = [
  {
    id: "edu1",
    name: "Alex Rivera",
    year: 2025,
    roles: ["Education Lead"],
    coreRoleNames: ["Education Lead"],
    termsInDali: ["24F", "24W", "24S"],
    profileImage: "https://placehold.co/400x400?text=AR",
    linkedinUrl: "#",
  },
  {
    id: "edu2",
    name: "Jordan Lee",
    year: 2026,
    roles: ["ERAS Lead"],
    coreRoleNames: ["ERAS Lead"],
    termsInDali: ["24F", "24W"],
    profileImage: "https://placehold.co/400x400?text=JL",
    linkedinUrl: "#",
  },
];

function useOfferings(): { data: Offering[]; isLoading: boolean } {
  return { data: MOCK_OFFERINGS, isLoading: false };
}

// Hook for scroll-triggered animations - resets when element leaves viewport
const useScrollAnimation = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Set visible when entering, reset when leaving
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.2 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
};

const Education: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState('all');
  const { data: offerings = [], isLoading: loading } = useOfferings();
  const [educationLeads, setEducationLeads] = useState<TeamMember[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);

  useEffect(() => {
    setEducationLeads(MOCK_EDUCATION_LEADS);
    setLeadsLoading(false);
  }, []);

  const today = new Date().toISOString().split('T')[0];
  const filteredOfferings = offerings.filter(offering => {
    // Only show future/today events on the Education page
    if (offering.date.fullDate && offering.date.fullDate.split('T')[0] < today) return false;
    if (activeFilter === 'all') return true;
    if (activeFilter === 'workshops') return offering.type === 'workshop';
    if (activeFilter === 'mini-series') return offering.type === 'mini-series';
    return true;
  });

  // Scroll animation hooks for each SVG
  const svg1Animation = useScrollAnimation();
  const svg3Animation = useScrollAnimation();
  const svg4Animation = useScrollAnimation();
  const heroSvgAnimation = useScrollAnimation();
  const upcomingSvgAnimation = useScrollAnimation();
  const courseSvgAnimation = useScrollAnimation();
  const fellowshipsSvgAnimation = useScrollAnimation();
  const eduTeamSvg1Animation = useScrollAnimation();
  const eduTeamSvg2Animation = useScrollAnimation();
  const contactCardSvgAnimation = useScrollAnimation();

  // Marquee visibility for pausing animation when off-screen
  const marqueeRef = useRef<HTMLElement>(null);
  const [marqueeVisible, setMarqueeVisible] = useState(true);

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

  return (
    <div className="min-h-screen bg-background overflow-x-clip">
      <Navbar />

      {/* Global SVG Animation Styles */}
      <style>{`
        @keyframes marquee-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee-scroll {
          animation: marquee-scroll 20s linear infinite;
        }
        .marquee-paused .animate-marquee-scroll {
          animation-play-state: paused;
        }

        /* SVG Scroll-triggered Animations - slower, smoother like About page */
        @keyframes pop-in {
          0% { opacity: 0; transform: scale(0.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }

        /* Slide in from direction */
        @keyframes slide-in-right {
          0% { opacity: 0; transform: translateX(80px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-left {
          0% { opacity: 0; transform: translateX(-80px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-up {
          0% { opacity: 0; transform: translateY(60px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        /* Fall in - dropping from above */
        @keyframes fall-in {
          0% { opacity: 0; transform: translateY(-80px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        /* Fall with slight rotation */
        @keyframes fall-rotate {
          0% { opacity: 0; transform: translateY(-80px) rotate(-15deg); }
          100% { opacity: 1; transform: translateY(0) rotate(0deg); }
        }

        /* Scale in smoothly */
        @keyframes scale-in {
          0% { opacity: 0; transform: scale(0); }
          100% { opacity: 1; transform: scale(1); }
        }

        /* Rotate in */
        @keyframes rotate-in {
          0% { opacity: 0; transform: rotate(-90deg) scale(0.5); }
          100% { opacity: 1; transform: rotate(0deg) scale(1); }
        }

        /* Fly in from corners */
        @keyframes fly-in-top-left {
          0% { opacity: 0; transform: translate(-60px, -60px); }
          100% { opacity: 1; transform: translate(0, 0); }
        }
        @keyframes fly-in-top-right {
          0% { opacity: 0; transform: translate(60px, -60px); }
          100% { opacity: 1; transform: translate(0, 0); }
        }

        /* Globe/3D spin effect */
        @keyframes globe-spin {
          0% { opacity: 0; transform: rotateY(90deg); }
          100% { opacity: 1; transform: rotateY(0deg); }
        }

        /* Initial hidden state for shapes */
        .svg-shape { opacity: 0; }

        /* Smooth easing to match About page: cubic-bezier(0.25, 0.46, 0.45, 0.94) */

        /* Animated states when visible - staggered with 0.1s delays like About page */
        .svg-visible .svg-pop-1 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-pop-2 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }
        .svg-visible .svg-pop-3 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-pop-4 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }
        .svg-visible .svg-pop-5 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.4s forwards; }
        .svg-visible .svg-pop-6 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.5s forwards; }
        .svg-visible .svg-pop-7 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.6s forwards; }
        .svg-visible .svg-pop-8 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.7s forwards; }

        .svg-visible .svg-slide-up-1 { animation: slide-in-up 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-slide-up-2 { animation: slide-in-up 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }
        .svg-visible .svg-slide-up-3 { animation: slide-in-up 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-slide-up-4 { animation: slide-in-up 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }

        .svg-visible .svg-slide-down-1 { animation: fall-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-slide-down-2 { animation: fall-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }

        .svg-visible .svg-slide-left-1 { animation: slide-in-left 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-slide-left-2 { animation: slide-in-left 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }

        .svg-visible .svg-slide-right-1 { animation: slide-in-right 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-slide-right-2 { animation: slide-in-right 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }

        .svg-visible .svg-spin-1 { animation: rotate-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-spin-2 { animation: rotate-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }
        .svg-visible .svg-spin-3 { animation: rotate-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-spin-4 { animation: rotate-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }

        .svg-visible .svg-fade-1 { animation: fade-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.4s forwards; }
        .svg-visible .svg-fade-2 { animation: fade-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.5s forwards; }
        .svg-visible .svg-fade-3 { animation: fade-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.6s forwards; }

        /* Hero SVG animations - falling in smoothly */
        .svg-visible .svg-spin-in-1 { animation: fall-rotate 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-fly-right-1 { animation: fall-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }
        .svg-visible .svg-fly-up-1 { animation: fall-rotate 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-fly-up-2 { animation: fall-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }
        .svg-visible .svg-scale-bounce-1 { animation: fall-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-scale-bounce-2 { animation: fall-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }
        .svg-visible .svg-scale-bounce-3 { animation: fall-rotate 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.4s forwards; }
        .svg-visible .svg-scale-bounce-4 { animation: fall-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.5s forwards; }
        .svg-visible .svg-scale-bounce-5 { animation: fall-rotate 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.6s forwards; }

        /* Upcoming Offerings SVG animations */
        .svg-visible .svg-rotate-bounce-1 { animation: rotate-in 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-scale-up-1 { animation: scale-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }
        .svg-visible .svg-drop-bounce-1 { animation: fall-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-drop-bounce-2 { animation: fall-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.4s forwards; }

        /* Course Offerings SVG animations */
        .svg-visible .svg-scale-center-1 { animation: scale-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-globe-spin { animation: globe-spin 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-fly-down-left-1 { animation: fly-in-top-left 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }
        .svg-visible .svg-fly-down-right-1 { animation: fly-in-top-right 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }
        .svg-visible .svg-orbit-1 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.4s forwards; }
        .svg-visible .svg-orbit-2 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.5s forwards; }
        .svg-visible .svg-orbit-3 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.6s forwards; }
        .svg-visible .svg-orbit-4 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.7s forwards; }

        /* Fellowships SVG animations - rectangles fall in, circles scale */
        .svg-visible .svg-wave-up-1 { animation: fall-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .svg-visible .svg-wave-up-2 { animation: fall-rotate 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }
        .svg-visible .svg-wave-up-3 { animation: fall-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-wave-up-4 { animation: fall-rotate 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }
        .svg-visible .svg-wave-up-5 { animation: fall-in 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.4s forwards; }
        .svg-visible .svg-wave-up-6 { animation: fall-rotate 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.5s forwards; }
        .svg-visible .svg-pulse-1 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }
        .svg-visible .svg-pulse-2 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.2s forwards; }
        .svg-visible .svg-pulse-3 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards; }
        .svg-visible .svg-pulse-4 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.4s forwards; }
        .svg-visible .svg-pulse-5 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.5s forwards; }
        .svg-visible .svg-pulse-6 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.6s forwards; }
        .svg-visible .svg-pulse-7 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.7s forwards; }
        .svg-visible .svg-pulse-8 { animation: scale-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.8s forwards; }
      `}</style>

      {/* Hero Section */}
      <section className="relative">
        {/* Mobile Hero */}
        <div className="md:hidden relative h-screen">
          {/* Background image */}
          <img
            src="assets/about/photo7.JPG"
            alt="DALI Education"
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Dark overlay for text readability */}
          <div className="absolute inset-0 bg-[#061825]/70"></div>
          {/* Content - centered vertically accounting for navbar */}
          <div className="relative z-10 h-full flex flex-col justify-center px-6 pt-[72px]">
            <p className="text-2xl sm:text-3xl text-white text-left mb-16">
              <span className="block mb-4">At DALI, Education</span>
              <span className="block mb-4">is rooted in the peer-</span>
              <span className="block">to-peer experience.</span>
            </p>
            <a
              href="#upcoming-offerings"
              className="inline-block bg-accent-teal text-white px-8 py-4 rounded-lg text-lg font-semibold hover:opacity-90 transition w-fit"
            >
              View Upcoming Offerings
            </a>
          </div>
        </div>

        {/* Desktop Hero - Two-column layout */}
        <div className="hidden md:flex h-screen">
          {/* Left side - Blue texture background with text */}
          <div className="w-1/2 relative overflow-hidden bg-[#061825]">
            {/* Blue texture pattern using eduhero.png */}
            <img
              src="assets/education/eduhero.png"
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Text content - centered vertically accounting for navbar */}
            <div className="relative z-10 h-full flex flex-col justify-center pl-8 lg:pl-16 pr-8 pt-[72px]">
              <p className="text-4xl lg:text-5xl text-white text-left mb-24">
                <span className="block mb-6">At DALI, Education</span>
                <span className="block mb-6">is rooted in the peer-</span>
                <span className="block">to-peer experience.</span>
              </p>
              <a
                href="#upcoming-offerings"
                className="inline-block bg-accent-teal text-white px-8 py-4 rounded-lg text-lg font-semibold hover:opacity-90 transition w-fit"
              >
                View Upcoming Offerings
              </a>
            </div>
          </div>
          {/* Right side - Photo */}
          <div className="w-1/2 relative">
            <img
              src="assets/about/photo7.JPG"
              alt="DALI Education"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Decorative SVG - positioned on left half (desktop only) */}
        <div ref={heroSvgAnimation.ref} className={`hidden md:block absolute top-16 left-[42%] -translate-x-1/2 z-10 ${heroSvgAnimation.isVisible ? 'svg-visible' : ''}`}>
          <svg width="287" height="153" viewBox="0 0 287 153" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path className="svg-shape svg-spin-in-1" d="M98.9532 4.97699H91.6417V29.0529L74.6175 12.0287L69.4475 17.1987L86.4717 34.2229H62.3958V41.5343H86.4717L69.4475 58.5586L74.6175 63.7286L91.6417 46.7043V70.7802H98.9532V46.7043L115.977 63.7286L121.147 58.5586L104.123 41.5343H128.199V34.2229H104.123L121.147 17.1986L115.977 12.0287L98.9532 29.0529V4.97699Z" fill="#8CE0D6"/>
            <rect className="svg-shape svg-fly-right-1" x="210.04" width="76.3096" height="76.3096" fill="#E45768"/>
            <rect className="svg-shape svg-fly-up-1" x="57.4193" y="76.3093" width="76.3096" height="76.3096" fill="#E68FBE"/>
            <rect className="svg-shape svg-fly-up-2" x="133.729" y="76.3093" width="76.3096" height="76.3096" fill="#FFF3B5"/>
            <circle className="svg-shape svg-scale-bounce-1" cx="171.698" cy="37.9692" r="19.0774" fill="#0C4B78"/>
            <circle className="svg-shape svg-scale-bounce-2" cx="171.607" cy="114.741" r="19.0774" fill="#092940"/>
            <circle className="svg-shape svg-scale-bounce-3" cx="248.471" cy="37.8781" r="19.0774" fill="#FFA89C"/>
            <circle className="svg-shape svg-scale-bounce-4" cx="95.7592" cy="114.65" r="19.0774" fill="#CA60AC"/>
            <circle className="svg-shape svg-scale-bounce-5" cx="19.0774" cy="114.65" r="19.0774" fill="#FAC27D"/>
          </svg>
        </div>
      </section>

      {/* What Students Have Said Section */}
      <section className="py-16 md:py-24 px-6 md:px-12 lg:px-20 bg-white dark:bg-section-bg-alt relative">
        {/* Decorative SVG - right side, overlapping with hero above */}
        <div ref={svg1Animation.ref} className={`hidden md:block absolute -top-16 right-0 z-10 ${svg1Animation.isVisible ? 'svg-visible' : ''}`}>
          <svg width="269" height="217" viewBox="0 0 269 217" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g className="svg-shape svg-pop-1"><rect width="72.159" height="71.9974" transform="matrix(1.39071e-07 1 1 -1.39071e-07 71.9961 144.84)" fill="#24B1B1"/></g>
            <g className="svg-shape svg-pop-2"><rect width="72.159" height="71.9974" transform="matrix(1.39071e-07 1 1 -1.39071e-07 215.992 4.00511e-05)" fill="#E68FBE"/></g>
            <g className="svg-shape svg-pop-3"><rect width="72.159" height="71.9974" transform="matrix(1.39071e-07 1 1 -1.39071e-07 143.992 72.6797)" fill="#0C4B78"/></g>
            <g className="svg-shape svg-pop-4"><ellipse cx="18.0398" cy="17.9994" rx="18.0398" ry="17.9994" transform="matrix(1.39071e-07 1 1 -1.39071e-07 17.8203 163.055)" fill="#E45768"/></g>
            <g className="svg-shape svg-pop-5"><ellipse cx="18.0398" cy="17.9994" rx="18.0398" ry="17.9994" transform="matrix(1.39071e-07 1 1 -1.39071e-07 162.168 90.5469)" fill="#A2D483"/></g>
            <g className="svg-shape svg-pop-6"><ellipse cx="18.0398" cy="17.9994" rx="18.0398" ry="17.9994" transform="matrix(1.39071e-07 1 1 -1.39071e-07 90.1719 163.055)" fill="#0C4B78"/></g>
            <g className="svg-shape svg-pop-7"><ellipse cx="18.0398" cy="17.9994" rx="18.0398" ry="17.9994" transform="matrix(1.39071e-07 1 1 -1.39071e-07 234.168 18.2149)" fill="#FFF3B5"/></g>
            <g className="svg-shape svg-pop-8"><ellipse cx="18.0398" cy="17.9994" rx="18.0398" ry="17.9994" transform="matrix(1.39071e-07 1 1 -1.39071e-07 90.1719 90.5469)" fill="#FAC27D"/></g>
            <g className="svg-shape svg-fade-1"><ellipse cx="18.0398" cy="17.9994" rx="18.0398" ry="17.9994" transform="matrix(1.39071e-07 1 1 -1.39071e-07 234.242 90.4571)" fill="#E17643"/></g>
            <g className="svg-shape svg-fade-2"><ellipse cx="18.0398" cy="17.9994" rx="18.0398" ry="17.9994" transform="matrix(1.39071e-07 1 1 -1.39071e-07 162.254 7.84379)" fill="#509C81"/></g>
            <g className="svg-shape svg-fade-3"><path d="M287.989 216.998L287.989 144.84L215.992 144.84L215.992 216.998L287.989 216.998ZM234.168 180.746C234.168 170.783 242.226 162.706 252.167 162.706C262.108 162.706 270.166 170.783 270.166 180.746C270.166 190.709 262.108 198.786 252.167 198.786C242.226 198.786 234.168 190.709 234.168 180.746Z" fill="#8CE0D6"/></g>
          </svg>
        </div>
        <div className="max-w-[110rem] mx-auto">
          {/* Header */}
          <div className="text-center mb-16 md:mb-20">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-dark-blue tracking-wide">What Students Have Said</h2>
          </div>

          {/* Collage grid layout - mobile stacks, desktop uses grid with row/col spans */}
          <div className="flex flex-col gap-4 md:hidden">
            {/* Mobile layout - simple stack */}
            {/* Alejandro */}
            <div className="bg-[#8CE0D6] rounded-xl overflow-hidden">
              <div className="h-44 overflow-hidden">
                <img src="assets/education/alejandro.jpg" alt="Alejandro Manrique" className="w-full h-full object-cover" />
              </div>
              <div className="p-5">
                <svg className="w-7 h-7 text-[#1A3A52]/30 mb-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
                </svg>
                <p className="text-[#1A3A52] text-[17px]">Being a mentor and lead for the EE Just DALI internship has been one of my best experiences at Dartmouth. There are few things that are as rewarding as sharing my passion for software development.</p>
              </div>
            </div>
            {/* 92% */}
            <div className="bg-accent-coral p-5 flex flex-col rounded-xl">
              <span className="text-4xl font-bold text-white">92%</span>
              <p className="text-white text-[17px] italic mt-3">of students would recommend a DALI mini-series to another student</p>
            </div>
            {/* 89% */}
            <div className="bg-[#CA60AC] p-5 flex flex-col rounded-xl">
              <span className="text-4xl font-bold text-white">89%</span>
              <p className="text-white text-[17px] italic mt-3">said they learned something new they can apply to their work</p>
            </div>
            {/* Blue quote */}
            <div className="bg-[#F5F9FF] p-5 flex flex-col rounded-xl text-[#1A3A52]">
              <svg className="w-8 h-8 mb-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
              </svg>
              <p className="text-[17px]">I went into this knowing nothing about UI/UX, and now I feel like I understand both what it is and how to go through the whole process</p>
            </div>
            {/* Yellow quote */}
            <div className="bg-[#FFF3B5] p-5 flex flex-col rounded-xl text-[#1A3A52]">
              <svg className="w-8 h-8 mb-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
              </svg>
              <p className="text-[17px]">After more than two years as a PM at DALI, I thought I had experienced everything the community had to offer. But through the continuing education credit, I discovered UI/UX, a skill I never would have found without DALI. Workshops gave me an easy, meaningful way to learn something completely new that I never would have had room for in my class schedule.</p>
            </div>
          </div>

          {/* Desktop grid layout with varied sizes */}
          <div className="hidden md:grid grid-cols-4 gap-6 auto-rows-auto">
            {/* Row 1: Alejandro (2 cols) | 92% | Grey SVG - all in single row */}

            {/* Alejandro - cols 1-2, row 1 - horizontal layout */}
            <div className="col-span-2 row-span-1 bg-[#8CE0D6] rounded-xl overflow-hidden flex flex-row">
              <div className="w-3/5 p-5 flex flex-col justify-center">
                <svg className="w-8 h-8 text-[#1A3A52]/30 mb-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
                </svg>
                <p className="text-[#1A3A52] text-[17px]">Being a mentor and lead for the EE Just DALI internship has been one of my best experiences at Dartmouth. There are few things that are as rewarding as sharing my passion for software development. The end goal is ambitious...but the interns are extremely hardworking, and they clearly care about what they do. That is all that matters.</p>
              </div>
              <div className="w-2/5 overflow-hidden flex-shrink-0">
                <img src="assets/education/alejandro.jpg" alt="Student" className="w-full h-full object-cover" />
              </div>
            </div>

            {/* 92% Stat - col 3, row 1 */}
            <div className="col-span-1 row-span-1 bg-accent-coral p-6 flex flex-col justify-between rounded-xl">
              <span className="text-6xl font-bold text-white mt-6">92%</span>
              <p className="text-white text-[17px] italic mt-3 mb-4">of students would recommend a DALI mini-series to another student</p>
            </div>

            {/* Quotes card image - col 4, row 1 */}
            <div className="col-span-1 row-span-1 rounded-xl overflow-hidden">
              <img src="assets/education/quotescard.jpg" alt="Quotes card" className="w-full h-full object-cover" />
            </div>

            {/* Row 3: Yellow quote | ERAS card (1:3 ratio) */}

            {/* Yellow quote - col 1, row 3 */}
            <div className="col-span-1 row-span-1 bg-[#FFF3B5] p-8 flex flex-col justify-between rounded-xl text-[#1A3A52] min-h-[400px]">
              <svg className="w-9 h-9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
              </svg>
              <p className="text-[17px]">After two years as a DALI PM, I thought I had experienced all DALI had to offer. Through the continuing education credit though, I discovered UI/UX, which I never would have found otherwise. Workshops let me learn new skills that didn't fit in my class schedule.</p>
            </div>

            {/* ERAS card - spans 3 cols */}
            <div className="col-span-3 row-span-1 bg-[#0C4B78] rounded-xl overflow-hidden flex min-h-[300px] relative">
              {/* Top right decorative SVG */}
              <div ref={svg3Animation.ref} className={`absolute top-0 right-0 ${svg3Animation.isVisible ? 'svg-visible' : ''}`}>
                <svg width="163" height="125" viewBox="0 0 163 125" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path className="svg-shape svg-slide-left-1" d="M0.00283256 3.44981C0.00283159 25.658 18.204 43.6613 40.6562 43.6613L40.6562 -36.7617C18.204 -36.7617 0.00283353 -18.7584 0.00283256 3.44981Z" fill="#E45768"/>
                  <path className="svg-shape svg-slide-left-2" d="M203.267 43.6591C203.267 21.2068 185.066 3.00567 162.613 3.00567L162.613 84.3125C185.066 84.3125 203.267 66.1113 203.267 43.6591Z" fill="#8CE0D6"/>
                  <path className="svg-shape svg-slide-up-1" d="M60.3927 104.342C60.3927 115.568 69.7571 124.669 81.3086 124.669L81.3086 84.0156C69.7571 84.0156 60.3927 93.1162 60.3927 104.342Z" fill="#FFA89C"/>
                  <rect className="svg-shape svg-slide-down-1" x="40.6523" y="84.3125" width="40.6534" height="40.6534" transform="rotate(-90 40.6523 84.3125)" fill="#F9C679"/>
                  <rect className="svg-shape svg-slide-down-2" x="121.961" y="43.6602" width="40.6534" height="40.6534" transform="rotate(-90 121.961 43.6602)" fill="#F9C679"/>
                  <rect className="svg-shape svg-slide-up-2" x="40.6523" y="43.6602" width="40.6534" height="40.6534" transform="rotate(-90 40.6523 43.6602)" fill="#E68FBE"/>
                  <rect className="svg-shape svg-slide-up-3" x="81.3047" y="43.6602" width="40.6534" height="40.6534" transform="rotate(-90 81.3047 43.6602)" fill="#8CE0D6"/>
                  <rect className="svg-shape svg-slide-up-4" x="121.961" y="84.3125" width="40.6534" height="40.6534" transform="rotate(-90 121.961 84.3125)" fill="#64B598"/>
                  <rect className="svg-shape svg-fade-1" x="81.3047" y="124.965" width="40.6534" height="40.6534" transform="rotate(-90 81.3047 124.965)" fill="#FFF3B5"/>
                  <circle className="svg-shape svg-pop-1" cx="61.1279" cy="23.4776" r="10.163" transform="rotate(-90 61.1279 23.4776)" fill="#FFF3B5"/>
                  <circle className="svg-shape svg-pop-2" cx="61.0771" cy="63.8877" r="10.163" transform="rotate(-90 61.0771 63.8877)" fill="#CA60AC"/>
                  <circle className="svg-shape svg-pop-3" cx="142.386" cy="23.2315" r="10.163" transform="rotate(-90 142.386 23.2315)" fill="#CA60AC"/>
                  <circle className="svg-shape svg-pop-4" cx="101.534" cy="63.8877" r="10.163" transform="rotate(-90 101.534 63.8877)" fill="#24B1B1"/>
                  <circle className="svg-shape svg-pop-5" cx="101.534" cy="23.6299" r="10.163" transform="rotate(-90 101.534 23.6299)" fill="#092940"/>
                  <rect className="svg-shape svg-fade-2" y="3.00391" width="40.6534" height="40.6534" transform="rotate(-90 0 3.00391)" fill="#A2D483"/>
                  <rect className="svg-shape svg-fade-3" x="40.6523" y="3.00391" width="40.6534" height="40.6534" transform="rotate(-90 40.6523 3.00391)" fill="#CA60AC"/>
                  <g clipPath="url(#clip0_placeholder)">
                    <mask id="mask0_placeholder" maskUnits="userSpaceOnUse" x="91" y="94" width="21" height="21">
                      <path d="M91.0273 94.6192V114.945H111.353V94.6192H91.0273Z" fill="white"/>
                    </mask>
                    <g mask="url(#mask0_placeholder)">
                      <path fillRule="evenodd" clipRule="evenodd" d="M111.353 104.782C111.353 99.1694 106.803 94.6192 101.19 94.6192C95.5775 94.6192 91.0273 99.1694 91.0273 104.782C91.0273 110.395 95.5775 114.945 101.19 114.945C106.803 114.945 111.353 110.395 111.353 104.782ZM105.637 104.782C105.637 102.327 103.646 100.336 101.19 100.336C98.7347 100.336 96.7441 102.327 96.7441 104.782C96.7441 107.238 98.7347 109.229 101.19 109.229C103.646 109.229 105.637 107.238 105.637 104.782Z" fill="#24B1B1"/>
                    </g>
                  </g>
                  <g clipPath="url(#clip1_placeholder)">
                    <mask id="mask1_placeholder" maskUnits="userSpaceOnUse" x="10" y="53" width="21" height="21">
                      <path d="M10.0156 53.377L10.0156 73.7031H30.3417L30.3417 53.377H10.0156Z" fill="white"/>
                    </mask>
                    <g mask="url(#mask1_placeholder)">
                      <path fillRule="evenodd" clipRule="evenodd" d="M30.3417 63.5401C30.3417 57.9272 25.7915 53.377 20.1787 53.377C14.5658 53.377 10.0156 57.9272 10.0156 63.5401C10.0156 69.153 14.5658 73.7031 20.1787 73.7031C25.7915 73.7031 30.3417 69.153 30.3417 63.5401ZM24.625 63.5401C24.625 61.0845 22.6343 59.0937 20.1787 59.0937C17.723 59.0937 15.7323 61.0845 15.7323 63.5401C15.7323 65.9957 17.723 67.9864 20.1787 67.9864C22.6343 67.9864 24.625 65.9957 24.625 63.5401Z" fill="#FFF3B5"/>
                    </g>
                  </g>
                  <path d="M152.354 59.6484C154.931 59.6484 157.021 61.5664 157.021 63.9326C157.021 66.299 154.931 68.2178 152.354 68.2178C152.013 68.2178 151.682 68.1845 151.362 68.1211C147.624 67.7009 143.129 64.5962 142.366 64.0527C142.883 64.7791 145.643 68.7852 146.323 72.3623C146.506 72.8812 146.607 73.4442 146.607 74.0332C146.607 76.6107 144.689 78.7009 142.323 78.7012C139.957 78.7012 138.038 76.6109 138.038 74.0332C138.038 73.6906 138.072 73.3567 138.137 73.0352C138.557 69.3373 141.596 64.9021 142.185 64.0732C141.343 64.6703 136.911 67.7059 133.218 68.1211C132.898 68.1845 132.567 68.2178 132.227 68.2178C129.649 68.2178 127.559 66.299 127.559 63.9326C127.559 61.5664 129.649 59.6484 132.227 59.6484C132.814 59.6485 133.376 59.7497 133.894 59.9316C137.612 60.6355 141.797 63.5897 142.281 63.9385C142.282 63.937 142.283 63.9365 142.283 63.9365C142.284 63.9371 142.285 63.9399 142.288 63.9443L142.29 63.9453C142.729 63.6288 146.944 60.6401 150.687 59.9316C151.204 59.7497 151.766 59.6485 152.354 59.6484ZM142.253 49.168C144.619 49.168 146.538 51.2583 146.538 53.8359C146.538 54.1761 146.505 54.5077 146.441 54.8271C145.981 58.926 142.293 63.9365 142.293 63.9365C142.274 63.9114 138.998 59.4448 138.252 55.5029C138.07 54.9851 137.969 54.4235 137.969 53.8359C137.969 51.2584 139.887 49.1682 142.253 49.168Z" fill="#A2D483"/>
                  <path d="M81.3057 -37.6445C81.3849 -15.1788 99.5538 3.00879 121.957 3.00879H81.3047V-37.6445H81.3057ZM121.958 3.00879H121.957V-37.6445H121.958V3.00879Z" fill="#F9C679"/>
                  <path d="M162.617 84.3096C140.151 84.3888 121.964 102.558 121.964 124.961L121.964 84.3086L162.617 84.3086L162.617 84.3096ZM121.964 124.962L121.964 124.961L162.617 124.961L162.617 124.962L121.964 124.962Z" fill="#F9C679"/>
                  <defs>
                    <clipPath id="clip0_placeholder">
                      <rect width="20.3261" height="20.3261" fill="white" transform="matrix(0 -1 1 0 91.0273 114.945)"/>
                    </clipPath>
                    <clipPath id="clip1_placeholder">
                      <rect width="20.3261" height="20.3261" fill="white" transform="matrix(0 -1 1 0 10.0156 73.7031)"/>
                    </clipPath>
                  </defs>
                </svg>
              </div>
              <div className="w-1/3 overflow-hidden bg-[#1e3a5f]">
                <img src="assets/education/roen.jpg" alt="ERAS Fellow" className="w-full h-full object-contain" />
              </div>
              <div className="w-2/3 p-6 flex flex-col justify-center relative z-10">
                <svg className="w-8 h-8 text-white/30 mb-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
                </svg>
                <p className="text-white text-[17px]">ERAS has given me direction on where to go next in my life. I always wanted to do something graphic design related but I was worried about how AI was impacting the field. Through getting to know people in the lab, ERAS has made me realize that there is still space for UI/UX.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Upcoming Offerings Section */}
      <section id="upcoming-offerings" className="py-16 md:py-24 px-6 md:px-12 lg:px-20 bg-white dark:bg-background relative">
        {/* Decorative SVG - above upcoming offerings */}
        <div ref={upcomingSvgAnimation.ref} className={`hidden md:block absolute -top-12 left-0 z-10 ${upcomingSvgAnimation.isVisible ? 'svg-visible' : ''}`}>
          <svg width="147" height="134" viewBox="0 0 147 134" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path className="svg-shape svg-rotate-bounce-1" d="M117.476 5.52975H110.165V29.6056L93.1405 12.5814L87.9705 17.7514L104.995 34.7756H80.9188V42.0871H104.995L87.9705 59.1113L93.1405 64.2813L110.165 47.2571V71.333H117.476V47.2571L134.5 64.2813L139.67 59.1113L122.646 42.0871H146.722V34.7756H122.646L139.67 17.7514L134.5 12.5814L117.476 29.6057V5.52975Z" fill="#FFF3B5"/>
            <rect className="svg-shape svg-scale-up-1" width="76.3096" height="76.3096" fill="#8CE0D6"/>
            <circle className="svg-shape svg-drop-bounce-1" cx="37.6004" cy="37.9692" r="19.0774" fill="#404040"/>
            <circle className="svg-shape svg-drop-bounce-2" cx="37.5093" cy="114.741" r="19.0774" fill="#8CE0D6"/>
          </svg>
        </div>
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-dark-blue">Upcoming Offerings</h2>
            <Link to="/education/calendar#calendar" className="text-dark-blue hover:text-accent-coral transition text-base md:text-lg flex items-center gap-2">
              View Calendar
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </Link>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-10 mb-10 border-b border-gray-200 dark:border-gray-600">
            <button
              onClick={() => setActiveFilter('all')}
              className={`pb-3 text-base md:text-lg transition ${
                activeFilter === 'all'
                  ? 'text-dark-blue border-b-2 border-dark-blue'
                  : 'text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-white'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveFilter('workshops')}
              className={`pb-3 text-base md:text-lg transition ${
                activeFilter === 'workshops'
                  ? 'text-dark-blue border-b-2 border-dark-blue'
                  : 'text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-white'
              }`}
            >
              Workshops
            </button>
            <button
              onClick={() => setActiveFilter('mini-series')}
              className={`pb-3 text-base md:text-lg transition ${
                activeFilter === 'mini-series'
                  ? 'text-dark-blue border-b-2 border-dark-blue'
                  : 'text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-white'
              }`}
            >
              Mini-Series
            </button>
          </div>

          {/* Offerings List */}
          <div className="space-y-0">
            {loading ? (
              <div className="py-12 text-center text-gray-500 dark:text-gray-300">Loading offerings...</div>
            ) : filteredOfferings.length === 0 ? (
              <div className="py-12 text-center text-gray-500 dark:text-gray-300">No upcoming offerings at this time.</div>
            ) : filteredOfferings.map((offering, index) => (
              <div key={offering.id}>
                {/* Offering Item */}
                <div className="flex flex-col md:flex-row md:items-center py-8 md:py-10 gap-6 md:gap-10">
                  {/* Date */}
                  <div className="flex-shrink-0 w-24 md:w-32 text-left">
                    <div className="text-5xl md:text-6xl text-accent-coral">{offering.date.day}</div>
                    <div className="text-base md:text-lg text-accent-coral">{offering.date.month}</div>
                    {offering.date.time && (
                      <div className="text-sm text-accent-coral/70">{offering.date.time}</div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-grow">
                    <h3 className="text-xl md:text-2xl font-semibold text-dark-blue mb-4">
                      {offering.name}
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {offering.tags.map((tag, tagIndex) => (
                        <span
                          key={tagIndex}
                          className="px-4 py-1.5 border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-200 text-sm rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Sign Up Button */}
                  <div className="flex-shrink-0">
                    <a
                      href={offering.signUpLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-6 py-2.5 border border-accent-coral text-accent-coral hover:bg-accent-coral hover:text-white transition rounded font-medium text-base flex items-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Sign Up
                    </a>
                  </div>
                </div>

                {/* Decorative divider with shapes */}
                {index < filteredOfferings.length - 1 && (
                  <div className="relative h-10 flex items-center">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-200 dark:border-gray-600"></div>
                    </div>
                    {/* Decorative shapes */}
                    <div className="relative flex justify-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-accent-teal"></div>
                      <div className="w-4 h-4 rounded-sm bg-accent-yellow"></div>
                      <div className="w-4 h-4 rounded-full bg-accent-coral"></div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Rotating Marquee Section */}
      <section ref={marqueeRef} className={`bg-accent-coral py-4 overflow-hidden ${!marqueeVisible ? 'marquee-paused' : ''}`}>
        <div className="flex">
          <div className="flex animate-marquee-scroll whitespace-nowrap">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="flex items-center text-white text-lg md:text-xl font-medium">
                <span className="px-4">peer-driven</span>
                <span className="text-white/60">·</span>
                <span className="px-4">collaborative</span>
                <span className="text-white/60">·</span>
                <span className="px-4">exploratory</span>
                <span className="text-white/60">·</span>
                <span className="px-4">passion-oriented</span>
                <span className="text-white/60">·</span>
                <span className="px-4">innovative</span>
                <span className="text-white/60">·</span>
                <span className="px-4">hands-on</span>
                <span className="text-white/60">·</span>
                <span className="px-4">creative</span>
                <span className="text-white/60">·</span>
                <span className="px-4">community-focused</span>
                <span className="text-white/60">·</span>
              </div>
            ))}
          </div>
          <div className="flex animate-marquee-scroll whitespace-nowrap" aria-hidden="true">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="flex items-center text-white text-lg md:text-xl font-medium">
                <span className="px-4">peer-driven</span>
                <span className="text-white/60">·</span>
                <span className="px-4">collaborative</span>
                <span className="text-white/60">·</span>
                <span className="px-4">exploratory</span>
                <span className="text-white/60">·</span>
                <span className="px-4">passion-oriented</span>
                <span className="text-white/60">·</span>
                <span className="px-4">innovative</span>
                <span className="text-white/60">·</span>
                <span className="px-4">hands-on</span>
                <span className="text-white/60">·</span>
                <span className="px-4">creative</span>
                <span className="text-white/60">·</span>
                <span className="px-4">community-focused</span>
                <span className="text-white/60">·</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission/Model/Matters Cards Section */}
      <section className="bg-[#1A3A52] py-24 md:py-32 lg:py-40 px-6 md:px-12 lg:px-20 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-center items-center gap-8 md:gap-0">
            {/* Our Mission Card */}
            <div
              className="w-full md:w-[320px] lg:w-[360px] xl:w-[400px] min-h-[420px] md:min-h-[480px] lg:min-h-[520px] bg-[#F27878] rounded-2xl p-8 md:p-10 transform md:rotate-6 md:z-10 flex flex-col bg-cover bg-center"
              style={{ backgroundImage: 'url(assets/education/mission.png)', backgroundSize: '150% 150%' }}
            >
              <h3 className="text-3xl md:text-4xl font-bold text-[#5B2020] mb-8">Our Mission</h3>
              <p className="text-[#5B2020] text-base md:text-lg leading-relaxed mt-auto">
                Our mission is to make design and technology accessible to everyone, regardless of major or background. We provide bridge experiences: low-pressure entry points into topics that might otherwise feel out of reach. Come as you are; no prior experience required!
              </p>
            </div>

            {/* Our Model Card */}
            <div
              className="w-full md:w-[320px] lg:w-[360px] xl:w-[400px] min-h-[420px] md:min-h-[480px] lg:min-h-[520px] bg-[#A2D483] rounded-2xl p-8 md:p-10 transform md:-rotate-3 md:-translate-y-6 md:ml-2 lg:ml-4 md:z-20 flex flex-col bg-cover bg-center"
              style={{ backgroundImage: 'url(assets/education/model.png)', backgroundSize: '150% 150%' }}
            >
              <h3 className="text-3xl md:text-4xl font-bold text-[#1E4421] mb-8">Our Model</h3>
              <p className="text-[#1E4421] text-base md:text-lg leading-relaxed mt-auto">
                We believe the best learning happens when it's shared. Our peer-to-peer model creates a collaborative space where you can ask real questions, learn from students who've been in your shoes, and focus on learning and growth over perfection and grades.
              </p>
            </div>

            {/* Why It Matters Card */}
            <div
              className="w-full md:w-[320px] lg:w-[360px] xl:w-[400px] min-h-[420px] md:min-h-[480px] lg:min-h-[520px] bg-[#FFE6A5] rounded-2xl p-8 md:p-10 transform md:rotate-6 md:ml-2 lg:ml-4 md:z-10 flex flex-col bg-cover bg-center"
              style={{ backgroundImage: 'url(assets/education/matters.png)', backgroundSize: '150% 150%' }}
            >
              <h3 className="text-3xl md:text-4xl font-bold text-[#8A6913] mb-8">Why It Matters</h3>
              <p className="text-[#8A6913] text-base md:text-lg leading-relaxed mt-auto">
                Access to learning shouldn't depend on confidence, prior experience, or knowing the right people. DALI Education creates space for students to explore new paths, build self-efficacy, and see themselves in design and technology.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Education Team Section */}
      <section className="py-16 md:py-24 px-6 md:px-12 lg:px-20 bg-section-bg relative overflow-visible">
        {/* Decorative SVG - top left */}
        <div ref={eduTeamSvg1Animation.ref} className={`hidden md:block absolute -top-8 left-8 z-20 ${eduTeamSvg1Animation.isVisible ? 'svg-visible' : ''}`}>
          <svg width="240" height="240" viewBox="0 0 187 187" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect className="svg-shape svg-scale-center-1" x="46.4697" y="46.4739" width="93.4028" height="93.4028" fill="#8CE0D6"/>
            <rect className="svg-shape svg-wave-up-1" y="139.878" width="46.4736" height="46.4736" fill="#E45768"/>
            <circle className="svg-shape svg-pop-1" cx="23.0093" cy="162.886" r="12.074" fill="#E68FBE"/>
            <circle className="svg-shape svg-pop-2" cx="23.4646" cy="69.9382" r="12.074" fill="#24B1B1"/>
            <rect className="svg-shape svg-wave-up-2" x="139.874" width="46.4736" height="46.4736" fill="#FFF3B5"/>
            <circle className="svg-shape svg-pop-3" cx="162.884" cy="23.0084" r="12.074" fill="#64B598"/>
            <circle className="svg-shape svg-pop-4" cx="162.885" cy="116.411" r="12.074" fill="#FAC27D"/>
          </svg>
        </div>
        {/* Decorative SVG - right side */}
        <div ref={eduTeamSvg2Animation.ref} className={`hidden md:block absolute top-32 -right-8 z-20 ${eduTeamSvg2Animation.isVisible ? 'svg-visible' : ''}`}>
          <svg width="180" height="180" viewBox="0 0 147 134" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path className="svg-shape svg-rotate-bounce-1" d="M117.476 5.52975H110.165V29.6056L93.1405 12.5814L87.9705 17.7514L104.995 34.7756H80.9188V42.0871H104.995L87.9705 59.1113L93.1405 64.2813L110.165 47.2571V71.333H117.476V47.2571L134.5 64.2813L139.67 59.1113L122.646 42.0871H146.722V34.7756H122.646L139.67 17.7514L134.5 12.5814L117.476 29.6057V5.52975Z" fill="#FFF3B5"/>
            <rect className="svg-shape svg-scale-up-1" width="76.3096" height="76.3096" fill="#A2D483"/>
            <circle className="svg-shape svg-drop-bounce-1" cx="37.6004" cy="37.9692" r="19.0774" fill="#0C4B78"/>
            <circle className="svg-shape svg-drop-bounce-2" cx="37.5093" cy="114.741" r="19.0774" fill="#E68FBE"/>
          </svg>
        </div>
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-dark-blue dark:text-white">Meet the Education Team</h2>
          </div>
          {leadsLoading ? (
            <div className="text-center text-gray-500 py-12">Loading team members...</div>
          ) : educationLeads.length === 0 ? (
            <div className="text-center text-gray-500 py-12">No education leads found.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {educationLeads.map((member) => {
                const educationRoles = member.roles.filter(role =>
                  role.toLowerCase().includes('education lead') ||
                  role.toLowerCase().includes('eras lead') ||
                  role.toLowerCase().includes('ee just lead')
                );
                const educationRole = educationRoles.length > 0 ? educationRoles.join(' & ') : member.role;

                // Parse currentRole and filter out "core"
                const currentRoles = member.currentRole
                  ? member.currentRole.split(',').map(r => r.trim()).filter(r => r.toLowerCase() !== 'core' && r.length > 0)
                  : [];

                // Parse majorMinor into separate tags
                const majorMinorTags = member.majorMinor
                  ? member.majorMinor.split(',').map(m => m.trim()).filter(m => m.length > 0)
                  : [];

                const tagColors = [
                  'bg-[#8CE0D6]/40 dark:bg-[#8CE0D6]/30',  // teal
                  'bg-[#E68FBE]/40 dark:bg-[#E68FBE]/30',  // pink
                  'bg-[#FFF3B5]/60 dark:bg-[#FFF3B5]/25',  // yellow
                  'bg-[#A2D483]/40 dark:bg-[#A2D483]/30',  // green
                  'bg-[#F9C679]/40 dark:bg-[#F9C679]/30',  // orange
                  'bg-[#E45768]/30 dark:bg-[#E45768]/30',  // coral
                ];

                // Use member name hash to pick a starting color per person
                const nameHash = member.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                const allTags = [
                  ...(member.year != null &&
                  member.year !== '' &&
                  String(member.year) !== 'Unknown'
                    ? [`'${String(member.year).slice(-2)}`]
                    : []),
                  ...majorMinorTags,
                  ...currentRoles,
                ];

                return (
                  <div key={member.id} className="flex flex-col items-center text-center">
                    <div className="w-40 h-40 md:w-48 md:h-48 rounded-full overflow-hidden mb-4 bg-white/50">
                      {member.profileImage ? (
                        <img
                          src={member.profileImage}
                          alt={member.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl text-gray-400">
                          {member.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <h3 className="text-xl md:text-2xl font-bold text-dark-blue dark:text-white mb-1">{member.name}</h3>
                    <p className="text-accent-coral dark:text-white font-medium mb-3">{educationRole}</p>
                    <div className="flex flex-wrap justify-center gap-2 mb-3">
                      {allTags.map((tag, idx) => (
                        <span key={idx} className={`px-3 py-1 text-dark-blue dark:text-white text-sm rounded-full ${tagColors[(nameHash + idx) % tagColors.length]}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    {member.linkedinUrl && member.linkedinUrl !== '#' && (
                      <a
                        href={member.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-dark-blue/60 hover:text-dark-blue transition"
                      >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Course Offerings Section */}
      <section className="py-16 md:py-24 px-6 md:px-12 lg:px-20 bg-[#FFF8EE] dark:bg-[#1A3A52] relative overflow-visible">
        {/* Decorative SVG - top right */}
        <div ref={courseSvgAnimation.ref} className={`hidden md:block absolute -top-12 right-4 z-10 ${courseSvgAnimation.isVisible ? 'svg-visible' : ''}`}>
          <svg width="220" height="220" viewBox="0 0 187 187" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect className="svg-shape svg-scale-center-1" x="46.4697" y="46.4739" width="93.4028" height="93.4028" fill="#509C81"/>
            <path className="svg-shape svg-globe-spin" fillRule="evenodd" clipRule="evenodd" d="M105.546 118.021C101.81 124.248 97.2917 127.054 93.1733 127.054C89.0548 127.054 84.5369 124.248 80.8007 118.021C77.1197 111.886 74.6932 103.112 74.6932 93.174C74.6932 83.2358 77.1197 74.4622 80.8007 68.3272C84.5369 62.1003 89.0548 59.2938 93.1733 59.2938C97.2917 59.2938 101.81 62.1003 105.546 68.3272C109.227 74.4622 111.653 83.2358 111.653 93.174C111.653 103.112 109.227 111.886 105.546 118.021ZM131.673 93.174C131.673 71.9109 114.436 54.6738 93.1733 54.6738C71.9103 54.6738 54.6732 71.9109 54.6732 93.174C54.6732 114.437 71.9103 131.674 93.1733 131.674C114.436 131.674 131.673 114.437 131.673 93.174ZM59.2932 93.174C59.2932 107.007 67.5833 118.904 79.4662 124.167C73.7685 117.155 70.0732 105.884 70.0732 93.174C70.0732 80.464 73.7685 69.1925 79.4662 62.1811C67.5833 67.4443 59.2932 79.341 59.2932 93.174ZM127.053 93.174C127.053 107.007 118.763 118.904 106.881 124.167C112.578 117.155 116.273 105.884 116.273 93.174C116.273 80.464 112.578 69.1925 106.881 62.1811C118.763 67.4443 127.053 79.341 127.053 93.174ZM93.1733 97.409C95.5122 97.409 97.4083 95.5129 97.4083 93.174C97.4083 90.835 95.5122 88.9389 93.1733 88.9389C90.8344 88.9389 88.9383 90.835 88.9383 93.174C88.9383 95.5129 90.8344 97.409 93.1733 97.409Z" fill="#A2D483"/>
            <rect className="svg-shape svg-fly-down-left-1" y="139.878" width="46.4736" height="46.4736" fill="#E45768"/>
            <circle className="svg-shape svg-orbit-1" cx="23.0093" cy="162.886" r="12.074" fill="#E68FBE"/>
            <circle className="svg-shape svg-orbit-2" cx="23.4646" cy="69.9382" r="12.074" fill="#24B1B1"/>
            <rect className="svg-shape svg-fly-down-right-1" x="139.874" width="46.4736" height="46.4736" fill="#8CE0D6"/>
            <circle className="svg-shape svg-orbit-3" cx="162.884" cy="23.0084" r="12.074" fill="#64B598"/>
            <circle className="svg-shape svg-orbit-4" cx="162.885" cy="116.411" r="12.074" fill="#FFF3B5"/>
          </svg>
        </div>
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-dark-blue mb-4">Course Offerings</h2>
            <p className="text-lg md:text-xl text-gray-600 dark:text-gray-200">DALI Education provides hands-on learning through two core formats</p>
          </div>

          {/* Two Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {/* Workshops Card */}
            <div className="bg-[#D4F1F1] rounded-2xl p-8 md:p-12 flex flex-col min-h-[350px] text-[#1A3A52]">
              <h3 className="text-3xl md:text-4xl font-bold mb-4">Workshops</h3>
              <p className="opacity-80 text-base md:text-lg mb-8 flex-grow">
                One-time, focused sessions that introduce students to specific skills or tools. Perfect for exploring new topics or getting a quick hands-on experience.
              </p>
              <div className="flex flex-wrap gap-3">
                <span className="px-4 py-2 bg-accent-teal/20 rounded-full text-sm">1-2 hours</span>
                <span className="px-4 py-2 bg-accent-teal/20 rounded-full text-sm">Single session</span>
                <span className="px-4 py-2 bg-accent-teal/20 rounded-full text-sm">Beginner friendly</span>
              </div>
            </div>

            {/* Mini-Series Card */}
            <div className="bg-[#FDDEDE] rounded-2xl p-8 md:p-12 flex flex-col min-h-[350px] text-[#1A3A52]">
              <h3 className="text-3xl md:text-4xl font-bold mb-4">Mini-Series</h3>
              <p className="opacity-80 text-base md:text-lg mb-8 flex-grow">
                Multi-session courses that dive deeper into a subject area. Build comprehensive skills over several weeks with structured curriculum and project-based learning.
              </p>
              <div className="flex flex-wrap gap-3">
                <span className="px-4 py-2 bg-accent-coral/20 rounded-full text-sm">3-5 weeks</span>
                <span className="px-4 py-2 bg-accent-coral/20 rounded-full text-sm">Multiple sessions</span>
                <span className="px-4 py-2 bg-accent-coral/20 rounded-full text-sm">Project-based</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Educational Fellowships Section */}
      <section className="bg-section-bg dark:bg-section-bg py-16 md:py-24 relative">
        {/* Decorative SVG - top */}
        <div ref={fellowshipsSvgAnimation.ref} className={`hidden md:block absolute -top-16 left-0 z-10 ${fellowshipsSvgAnimation.isVisible ? 'svg-visible' : ''}`}>
          <svg width="300" height="300" viewBox="0 0 259 259" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect className="svg-shape svg-wave-up-1" y="64.704" width="64.6972" height="64.6972" transform="rotate(-90 0 64.704)" fill="#A2D483"/>
            <rect className="svg-shape svg-wave-up-2" x="64.7031" y="193.63" width="64.6972" height="64.6972" transform="rotate(-90 64.7031 193.63)" fill="#F9C679"/>
            <rect className="svg-shape svg-wave-up-3" x="64.7031" y="128.933" width="64.6972" height="64.6972" transform="rotate(-90 64.7031 128.933)" fill="#FFF3B5"/>
            <rect className="svg-shape svg-wave-up-4" x="64.7031" y="64.6972" width="64.6972" height="64.6972" transform="rotate(-90 64.7031 64.6972)" fill="#0C4B78"/>
            <rect className="svg-shape svg-wave-up-5" x="129.395" y="128.933" width="64.6972" height="64.6972" transform="rotate(-90 129.395 128.933)" fill="#8CE0D6"/>
            <rect className="svg-shape svg-wave-up-6" x="194.094" y="193.63" width="64.6972" height="64.6972" transform="rotate(-90 194.094 193.63)" fill="#64B598"/>
            <circle className="svg-shape svg-pulse-1" cx="32.2016" cy="96.7416" r="16.1743" transform="rotate(-90 32.2016 96.7416)" fill="#FFA89C"/>
            <circle className="svg-shape svg-pulse-2" cx="97.2837" cy="96.8178" r="16.1743" transform="rotate(-90 97.2837 96.8178)" fill="#64B598"/>
            <circle className="svg-shape svg-pulse-3" cx="97.2056" cy="32.0444" r="16.1743" transform="rotate(-90 97.2056 32.0444)" fill="#F5F9FF"/>
            <circle className="svg-shape svg-pulse-4" cx="32.1196" cy="31.6528" r="16.1743" transform="rotate(-90 32.1196 31.6528)" fill="#24B1B1"/>
            <circle className="svg-shape svg-pulse-5" cx="97.2056" cy="161.124" r="16.1743" transform="rotate(-90 97.2056 161.124)" fill="#F97979"/>
            <circle className="svg-shape svg-pulse-6" cx="161.592" cy="161.124" r="16.1743" transform="rotate(-90 161.592 161.124)" fill="#24B1B1"/>
            <circle className="svg-shape svg-pulse-7" cx="161.592" cy="97.0551" r="16.1743" transform="rotate(-90 161.592 97.0551)" fill="#092940"/>
            <circle className="svg-shape svg-pulse-8" cx="226.674" cy="96.8178" r="16.1743" transform="rotate(-90 226.674 96.8178)" fill="#CA60AC"/>
          </svg>
        </div>
        <div className="px-6 md:px-12 lg:px-16 max-w-7xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-dark-blue mb-4">
              Educational Fellowships
            </h2>
            <p className="text-lg md:text-xl text-gray-600 dark:text-gray-200 max-w-3xl mx-auto">
              First-years can apply to be a part of these paid fellowships that offer a 6-month long intensive into science and technology with the DALI lab.
            </p>
          </div>

          {/* ERAS Fellowship - Text Left, Image Right */}
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 items-center mb-16 md:mb-24">
            <div className="lg:w-1/2">
              <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold text-dark-blue mb-4">
                ERAS Fellowship
              </h3>
              <p className="text-base md:text-lg text-dark-blue/80 leading-relaxed mb-6">
                The ERAS (Education, Research, and Academic Support) Fellowship empowers students to create educational technology tools and conduct research on learning methodologies and pedagogical innovation.
              </p>
              <a
                href="https://students.dartmouth.edu/surfd/undergraduate-research/dartmouth-early-research-access-sciences"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 border border-dark-blue text-dark-blue hover:bg-dark-blue hover:text-white transition rounded font-medium"
              >
                Learn more
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
            <div className="lg:w-1/2">
              <img
                src="assets/education/eras.jpg"
                alt="ERAS Fellowship"
                className="w-full h-auto rounded-2xl"
                loading="lazy"
              />
            </div>
          </div>

          {/* EE Just Fellowship - Image Left, Text Right */}
          <div className="flex flex-col lg:flex-row-reverse gap-8 lg:gap-16 items-center mb-16 md:mb-24">
            <div className="lg:w-1/2">
              <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold text-dark-blue mb-4">
                EE Just Fellowship
              </h3>
              <p className="text-base md:text-lg text-dark-blue/80 leading-relaxed mb-6">
                The EE Just Fellowship supports students passionate about using technology for social impact and educational equity. Fellows work on projects that promote access to education and digital resources.
              </p>
              <a
                href="https://students.dartmouth.edu/eejust/undergraduate/fellowships-internships/ee-just-dali-internship"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 border border-dark-blue text-dark-blue hover:bg-dark-blue hover:text-white transition rounded font-medium"
              >
                Learn more
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
            <div className="lg:w-1/2">
              <picture>
                <source srcSet="assets/education/eejust.webp" type="image/webp" />
                <img
                  src="assets/education/eejust.png"
                  alt="EE Just Fellowship"
                  className="w-full h-auto rounded-2xl"
                  loading="lazy"
                />
              </picture>
            </div>
          </div>

        </div>
      </section>

      {/* Contact Banner - Wide Card overlaying bottom and footer */}
      <div className="px-6 md:px-12 lg:px-20 -mt-16 md:-mt-20 mb-[-2rem] relative z-10">
        <div className="bg-[#FFF3B5] py-12 md:py-16 lg:py-20 px-8 md:px-14 lg:px-20 rounded-2xl shadow-xl max-w-7xl mx-auto flex flex-col lg:flex-row lg:justify-between lg:items-center gap-8 text-[#1A3A52] relative overflow-hidden">
          {/* Decorative SVG - left side */}
          <div ref={contactCardSvgAnimation.ref} className={`hidden md:block absolute -top-20 -left-4 lg:-top-16 lg:left-4 ${contactCardSvgAnimation.isVisible ? 'svg-visible' : ''}`}>
            <svg width="128" height="160" viewBox="0 0 128 160" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect className="svg-shape svg-pop-1" x="63.6055" width="31.8023" height="31.8026" fill="#E45768"/>
              <ellipse className="svg-shape svg-pop-2" cx="79.3483" cy="15.7468" rx="8.26237" ry="8.26243" fill="#FFF3B5"/>
              <path className="svg-shape svg-scale-center-1" fillRule="evenodd" clipRule="evenodd" d="M29.9023 128.103L29.9023 95.991L29.9023 63.8789L58.3097 63.8789L86.717 63.8789V95.991V128.103H58.3097H29.9023ZM58.3097 112.038C58.3139 103.175 64.6715 95.991 72.5133 95.991C64.6689 95.991 58.3097 88.8025 58.3097 79.935C58.3097 88.8025 51.9505 95.991 44.106 95.991C51.9479 95.991 58.3055 103.175 58.3097 112.038ZM44.106 104.34C47.8713 104.34 50.9238 107.791 50.9238 112.047C50.9238 116.304 47.8713 119.754 44.106 119.754C40.3407 119.754 37.2882 116.304 37.2882 112.047C37.2882 107.791 40.3407 104.34 44.106 104.34ZM50.9238 79.935C50.9238 84.1914 47.8713 87.6419 44.106 87.6419C40.3407 87.6419 37.2882 84.1914 37.2882 79.935C37.2882 75.6785 40.3407 72.2281 44.106 72.2281C47.8713 72.2281 50.9238 75.6785 50.9238 79.935ZM65.6956 112.047C65.6956 107.791 68.7479 104.34 72.5133 104.34C76.2787 104.34 79.3311 107.791 79.3311 112.047C79.3311 116.304 76.2787 119.754 72.5133 119.754C68.7479 119.754 65.6956 116.304 65.6956 112.047ZM65.6956 79.935C65.6956 84.1914 68.7479 87.6419 72.5133 87.6419C76.2787 87.6419 79.3311 84.1914 79.3311 79.935C79.3311 75.6786 76.2787 72.2281 72.5133 72.2281C68.7479 72.2281 65.6956 75.6785 65.6956 79.935Z" fill="#509C81"/>
              <ellipse className="svg-shape svg-pop-3" cx="111.462" cy="132.028" rx="8.26237" ry="8.26243" fill="#CA60AC"/>
              <rect className="svg-shape svg-wave-up-1" x="95.7188" y="31.8008" width="31.8023" height="31.8026" fill="#A2D483"/>
              <ellipse className="svg-shape svg-pop-4" cx="111.462" cy="47.5515" rx="8.26237" ry="8.26243" fill="#154C74"/>
              <ellipse className="svg-shape svg-pop-5" cx="15.7467" cy="79.3484" rx="8.26237" ry="8.26243" fill="#F9C679"/>
              <rect className="svg-shape svg-wave-up-2" y="127.516" width="31.8023" height="31.8026" fill="#24B1B1"/>
              <ellipse className="svg-shape svg-pop-6" cx="15.7467" cy="143.262" rx="8.26237" ry="8.26243" fill="#0B1C29"/>
            </svg>
          </div>
          <div className="lg:max-w-[60%]">
            <h3 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-medium mb-4">
              Are you a professor looking to partner?
            </h3>
            <p className="text-lg md:text-xl opacity-80">
              A student with questions?<br />
              Curious about our favorite workshop stories?
            </p>
          </div>
          <div className="relative z-10">
            <a
              href="mailto:education@dali.dartmouth.edu"
              className="inline-block bg-accent-teal text-white px-10 py-5 rounded-lg text-lg font-semibold hover:opacity-90 transition"
            >
              Contact Us
            </a>
          </div>
        </div>
      </div>

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
  );
};

export default Education;
