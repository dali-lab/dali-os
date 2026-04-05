import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, useInView } from 'framer-motion';
import Navbar from '@/components/Navbar';
import AnimatedGreenSquareSVG from '@/components/AnimatedGreenSquareSVG';
import AnimatedRolesBlocksSVG from '@/components/AnimatedRolesBlocksSVG';
import AnimatedFlowerSVG from '@/components/AnimatedFlowerSVG';
import AnimatedCuriosityIcon from '@/components/AnimatedCuriosityIcon';
import AnimatedCollaborationIcon from '@/components/AnimatedCollaborationIcon';
import AnimatedInitiativeIcon from '@/components/AnimatedInitiativeIcon';

interface AppStatus {
  open: boolean;
  termId: string | null;
  termName: string | null;
  inProgressCount: number;
}

const MOCK_APP_STATUS: AppStatus = {
  open: true,
  termId: "24F",
  termName: "Fall 2024",
  inProgressCount: 0,
};

const Apply: React.FC = () => {
  const navigate = useNavigate();

  const [appStatus] = useState<AppStatus | null>(MOCK_APP_STATUS);

  // Refs and useInView for Application Process section SVGs
  const processSvg1Ref = useRef(null);
  const processSvg1InView = useInView(processSvg1Ref, { once: false, amount: 0.3 });

  const processSvg2Ref = useRef(null);
  const processSvg2InView = useInView(processSvg2Ref, { once: false, amount: 0.3 });

  const processSvg3Ref = useRef(null);
  const processSvg3InView = useInView(processSvg3Ref, { once: false, amount: 0.3 });

  const processSvg4Ref = useRef(null);
  const processSvg4InView = useInView(processSvg4Ref, { once: false, amount: 0.3 });

  const processSvg5Ref = useRef(null);
  const processSvg5InView = useInView(processSvg5Ref, { once: false, amount: 0.3 });

  return (
    <div className="min-h-screen bg-background overflow-x-clip">
      <Navbar />

      {/* Hero Section - Full viewport with split layout */}
      <section className="pt-[72px] min-h-[calc(100vh-72px)] flex relative overflow-visible">
        {/* Left Column - Text with decorative elements */}
        <div className="w-full md:w-1/2 min-h-[calc(100vh-72px)] bg-[#E8F4FA] dark:bg-[#061825] flex flex-col justify-center px-6 md:px-12 lg:px-16 relative overflow-visible">
          {/* Top decorative SVG - animated by blocks */}
          <svg
            viewBox="0 0 290 77"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute top-8 left-2 md:top-12 md:left-4 w-[160px] md:w-[220px] lg:w-[290px] h-auto pointer-events-none z-10"
            style={{ overflow: 'visible' }}
          >
            {/* Yellow square */}
            <motion.rect
              y="0.276825" width="76.3096" height="76.3096" fill="#FFF3B5"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '38.15px 38.43px' }}
            />
            {/* Pink circle */}
            <motion.circle
              cx="37.3235" cy="38.1549" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Peach circle */}
            <motion.circle
              cx="114.373" cy="37.9701" r="19.0774" fill="#FFA89C"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Teal square */}
            <motion.rect
              x="152.711" width="76.3096" height="76.3096" fill="#8CE0D6"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '190.87px 38.15px' }}
            />
            {/* Dark circle */}
            <motion.circle
              cx="190.312" cy="37.9701" r="19.0774" fill="#404040"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Red flower shape */}
            <g clipPath="url(#clip0_2408_21394)">
              <mask id="mask0_2408_21394" maskUnits="userSpaceOnUse" x="242" y="15" width="48" height="48">
                <path d="M289.761 15.7568L242.758 15.7568V62.2061H289.761V15.7568Z" fill="white"/>
              </mask>
              <g mask="url(#mask0_2408_21394)">
                <motion.path
                  fillRule="evenodd" clipRule="evenodd" d="M248.93 38.9814C234.076 56.5477 248.484 70.7862 266.259 56.1068C284.031 70.7862 298.443 56.5342 283.589 38.9814C298.443 21.4153 284.031 7.1767 266.259 21.8561C248.484 7.1767 234.076 21.4153 248.93 38.9814ZM266.259 47.5746C271.062 47.5746 274.955 43.7274 274.955 38.9814C274.955 34.2356 271.062 30.3883 266.259 30.3883C261.457 30.3883 257.564 34.2356 257.564 38.9814C257.564 43.7274 261.457 47.5746 266.259 47.5746Z" fill="#E45768"
                  initial={{ scale: 0, rotate: -180, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                  style={{ transformOrigin: '266.259px 38.98px' }}
                />
              </g>
            </g>
            <defs>
              <clipPath id="clip0_2408_21394">
                <rect width="47.0023" height="46.4493" fill="white" transform="translate(242.758 15.7568)"/>
              </clipPath>
            </defs>
          </svg>

          {/* Main content */}
          <div className="relative z-20 max-w-xl">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6">
              <span className="text-accent-coral dark:text-[#FFA89C] block">design,</span>
              <span className="text-accent-teal dark:text-[#8CE0D6] block">build,</span>
              <span className="text-accent-pink dark:text-[#FFB6C1] block">ship.</span>
            </h1>

            <p className="text-base sm:text-lg md:text-[1.15rem] text-[#1A3A52] dark:text-white leading-relaxed sm:leading-7 md:leading-8 mb-8">
              Join a community of passionate creators building real products that matter.
            </p>

            <div>
              <button
                onClick={() => {
                  document.getElementById('roles')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="inline-flex items-center gap-2 px-8 py-4 bg-accent-coral text-white font-semibold rounded-lg hover:bg-accent-coral/90 transition-all shadow-lg hover:shadow-xl cursor-pointer"
              >
                Explore Roles
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

                  </div>

        {/* Right Column - Photo */}
        <div className="hidden md:block w-1/2 relative">
          <img
            src="assets/about/photo1.JPG"
            alt="DALI students collaborating"
            className="w-full h-full object-cover"
          />
          {/* Gradient overlay for text readability if needed */}
          <div className="absolute inset-0 bg-gradient-to-l from-transparent to-section-bg/20"></div>
        </div>

        {/* Decorative SVG at bottom-left, overlapping both sides and section below */}
        <div className="absolute -bottom-8 md:-bottom-10 left-[25%] md:left-[35%] z-20">
          <svg
            width="240"
            height="300"
            viewBox="0 0 180 224"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ overflow: 'visible' }}
          >
            {/* Large green square - center */}
            <motion.rect
              x="44.6774" y="89.3595" width="89.7984" height="89.7984" fill="#A2D483"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '89.5766px 134.2587px' }}
            />
            {/* Red square - top */}
            <motion.rect
              x="89.3571" width="44.6799" height="44.6799" fill="#E45768"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 1.0, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '111.697px 22.34px' }}
            />
            {/* Yellow circle - top */}
            <motion.circle
              cx="111.478" cy="22.1209" r="11.6082" fill="#FFF3B5"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: 1.2, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Green pattern shape - center */}
            <motion.path
              fillRule="evenodd" clipRule="evenodd" d="M44.6801 179.159L44.6801 134.26L44.6801 89.3608L89.5793 89.3607L134.478 89.3608V134.26V179.159H89.5793H44.6801ZM89.5793 156.697C89.586 144.304 99.6344 134.26 112.029 134.26C99.6304 134.26 89.5793 124.209 89.5793 111.81C89.5793 124.209 79.5282 134.26 67.1297 134.26C79.5242 134.26 89.5727 144.304 89.5793 156.697ZM67.1297 145.934C73.081 145.934 77.9055 150.758 77.9055 156.71C77.9055 162.661 73.081 167.485 67.1297 167.485C61.1784 167.485 56.3539 162.661 56.3539 156.71C56.3539 150.758 61.1784 145.934 67.1297 145.934ZM77.9055 111.81C77.9055 117.762 73.081 122.586 67.1297 122.586C61.1784 122.586 56.3539 117.762 56.3539 111.81C56.3539 105.859 61.1784 101.035 67.1297 101.035C73.081 101.035 77.9055 105.859 77.9055 111.81ZM101.253 156.71C101.253 150.758 106.077 145.934 112.029 145.934C117.98 145.934 122.805 150.758 122.805 156.71C122.805 162.661 117.98 167.485 112.029 167.485C106.077 167.485 101.253 162.661 101.253 156.71ZM101.253 111.81C101.253 117.762 106.077 122.586 112.029 122.586C117.98 122.586 122.805 117.762 122.805 111.81C122.805 105.859 117.98 101.035 112.029 101.035C106.077 101.035 101.253 105.859 101.253 111.81Z" fill="#509C81"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '89.5793px 134.26px' }}
            />
            {/* Pink circle - bottom right */}
            <motion.circle
              cx="156.6" cy="201.279" r="11.6082" fill="#CA60AC"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: 1.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Light green square - top right */}
            <motion.rect
              x="134.476" y="44.6785" width="44.6799" height="44.6799" fill="#A2D483"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 1.1, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '156.816px 67.0185px' }}
            />
            {/* Dark blue circle - top right */}
            <motion.circle
              cx="156.597" cy="66.7995" r="11.6082" fill="#154C74"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: 1.3, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Orange circle - left */}
            <motion.circle
              cx="22.1201" cy="111.481" r="11.6082" fill="#F9C679"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: 1.1, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Teal square - bottom left */}
            <motion.rect
              y="179.159" width="44.6799" height="44.6799" fill="#24B1B1"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 1.3, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '22.34px 201.499px' }}
            />
            {/* Dark circle - bottom left */}
            <motion.circle
              cx="22.1209" cy="201.28" r="11.6082" fill="#0B1C29"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: 1.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
          </svg>
        </div>
      </section>

      {/* Why Join DALI Section - Stacked Horizontal Panels */}
      <section className="bg-white dark:bg-[#13629A] py-20 md:py-28 overflow-hidden">
        {/* Section header */}
        <div className="max-w-7xl mx-auto px-6 md:px-12 mb-12 md:mb-16">
          <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-dark-blue dark:text-white">
            Why <span className="text-accent-coral dark:text-[#FFA89C]">DALI</span>?
          </h2>
        </div>

        {/* Seamless CSS marquee animation */}
        <style>{`
          @keyframes scroll-left {
            0% { transform: translateX(0); }
            100% { transform: translateX(calc(-50% - 12px)); }
          }
          @keyframes scroll-right {
            0% { transform: translateX(calc(-50% - 12px)); }
            100% { transform: translateX(0); }
          }
          .marquee-row {
            display: flex;
            width: max-content;
          }
          .marquee-left {
            animation: scroll-left 95s linear infinite;
          }
          .marquee-right {
            animation: scroll-right 105s linear infinite;
          }
          .marquee-left-fast {
            animation: scroll-left 85s linear infinite;
          }
        `}</style>

        {/* Horizontal scrolling panels */}
        <div className="space-y-4 md:space-y-6">
          {/* Panel 1 - Ship Real Products */}
          <div className="overflow-hidden">
            <div className="marquee-row marquee-left">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-4 sm:gap-6 mr-4 sm:mr-6 flex-shrink-0">
                  <div className="w-[280px] sm:w-[400px] md:w-[600px] h-[180px] sm:h-[200px] md:h-[280px] rounded-2xl overflow-hidden relative flex-shrink-0">
                    <img src="assets/about/photo2.JPG" alt="Building products" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-r from-accent-coral/90 to-accent-coral/70"></div>
                    <div className="absolute inset-0 p-6 sm:p-8 md:p-10 flex flex-col justify-end">
                      <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">Ship Real Products</h3>
                    </div>
                  </div>
                  <div className="w-[180px] sm:w-[250px] md:w-[350px] h-[180px] sm:h-[200px] md:h-[280px] bg-[#FFF3B5] rounded-2xl p-4 sm:p-6 md:p-8 flex flex-col justify-between flex-shrink-0">
                    <div className="text-5xl sm:text-6xl md:text-7xl font-black text-dark-blue/20">01</div>
                    <p className="text-dark-blue font-semibold text-base sm:text-lg md:text-xl">Real impact from day one</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Panel 2 - Get Paid */}
          <div className="overflow-hidden">
            <div className="marquee-row marquee-right">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-4 sm:gap-6 mr-4 sm:mr-6 flex-shrink-0">
                  <div className="w-[180px] sm:w-[250px] md:w-[350px] h-[180px] sm:h-[200px] md:h-[280px] bg-accent-teal rounded-2xl p-4 sm:p-6 md:p-8 flex flex-col justify-between flex-shrink-0">
                    <div className="text-5xl sm:text-6xl md:text-7xl font-black text-white/20">02</div>
                    <p className="text-white font-semibold text-base sm:text-lg md:text-xl">Work that pays off</p>
                  </div>
                  <div className="w-[280px] sm:w-[400px] md:w-[600px] h-[180px] sm:h-[200px] md:h-[280px] rounded-2xl overflow-hidden relative flex-shrink-0">
                    <img src="assets/about/photo4.JPG" alt="Students working" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-l from-accent-teal/90 to-accent-teal/70"></div>
                    <div className="absolute inset-0 p-6 sm:p-8 md:p-10 flex flex-col justify-end text-right">
                      <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">Get Paid For Your Work</h3>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Panel 3 - Community */}
          <div className="overflow-hidden">
            <div className="marquee-row marquee-left-fast">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-4 sm:gap-6 mr-4 sm:mr-6 flex-shrink-0">
                  <div className="w-[280px] sm:w-[400px] md:w-[600px] h-[180px] sm:h-[200px] md:h-[280px] rounded-2xl overflow-hidden relative flex-shrink-0">
                    <img src="assets/about/photo6.JPG" alt="DALI community" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-r from-accent-pink/90 to-accent-pink/70"></div>
                    <div className="absolute inset-0 p-6 sm:p-8 md:p-10 flex flex-col justify-end">
                      <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">Find Your People</h3>
                    </div>
                  </div>
                  <div className="w-[180px] sm:w-[250px] md:w-[350px] h-[180px] sm:h-[200px] md:h-[280px] bg-accent-pink rounded-2xl p-4 sm:p-6 md:p-8 flex flex-col justify-between flex-shrink-0">
                    <div className="text-5xl sm:text-6xl md:text-7xl font-black text-white/20">03</div>
                    <p className="text-white font-semibold text-base sm:text-lg md:text-xl">Learning and growing with your peers</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </section>


      {/* Roles Section */}
      <section id="roles" className="bg-section-bg dark:bg-[#061825] py-20 md:py-28 relative overflow-visible">
        {/* Decorative SVG on right - animated */}
        <div className="hidden lg:block absolute right-0 -top-16 z-10">
          <AnimatedGreenSquareSVG />
        </div>

        {/* Decorative SVG on left - animated blocks */}
        <div className="hidden lg:block absolute left-0 top-[280px] z-0">
          <AnimatedRolesBlocksSVG />
        </div>

        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          {/* Current Application Cycle Info */}
          <div className="mb-16 bg-dark-blue dark:bg-white rounded-2xl p-8 md:p-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent-coral/20 rounded-full -translate-y-1/2 translate-x-1/2"></div>
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-accent-teal/20 rounded-full translate-y-1/2 -translate-x-1/2"></div>

            <div className="relative z-10">
              {appStatus?.open ? (
                /* ── OPEN STATE ── */
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="px-3 py-1 bg-accent-teal/30 text-accent-teal text-sm font-semibold rounded-full flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-teal inline-block animate-pulse" />
                        Applications Open
                      </span>
                      <span className="text-white/60 dark:text-[#1A3A52]/60 text-sm">{appStatus.termName}</span>
                    </div>
                    <h3 className="text-2xl md:text-3xl font-bold text-white dark:text-[#1A3A52] mb-2">Applications Are Currently Open</h3>
                    <p className="text-white/70 dark:text-[#1A3A52]/70 text-lg">
                      We're hiring for {appStatus.termName}. Apply now to join the DALI team!
                    </p>
                    {appStatus.inProgressCount > 0 && (
                      <p className="text-white/50 dark:text-[#1A3A52]/50 text-sm mt-2">
                        {appStatus.inProgressCount} application{appStatus.inProgressCount !== 1 ? 's' : ''} in progress
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(getSession() ? '/account' : '/login')}
                    className="shrink-0 px-8 py-4 rounded-full bg-accent-coral text-white font-semibold text-lg hover:bg-accent-coral/90 transition shadow-lg hover:shadow-xl"
                  >
                    Apply Now →
                  </button>
                </div>
              ) : (
                /* ── CLOSED STATE ── */
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="px-3 py-1 bg-white/20 dark:bg-[#1A3A52]/20 text-white dark:text-[#1A3A52] text-sm font-semibold rounded-full">
                        Currently Closed
                      </span>
                    </div>
                    <h3 className="text-2xl md:text-3xl font-bold text-white dark:text-[#1A3A52] mb-2">Applications Are Currently Closed</h3>
                    <p className="text-white/70 dark:text-[#1A3A52]/70 text-lg">
                      We'll be hiring again soon. Check back for updates on the next application cycle!
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-dark-blue dark:text-white">Find Your Role</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 auto-rows-fr">
            {/* Full Stack Web Developers */}
            <div className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500">
              <div className="absolute top-0 left-0 w-full h-2 bg-accent-coral"></div>
              <div className="p-6 h-full flex flex-col">
                <div className="w-12 h-12 bg-accent-coral/10 rounded-xl flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-accent-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#1A3A52] mb-2">Full Stack Web Developers</h3>
                <p className="text-[#1A3A52]/70 text-sm leading-relaxed flex-grow">
                  Build web and mobile apps with React, Node.js, and modern frameworks.
                </p>
              </div>
            </div>

            {/* Data Developers */}
            <div className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500">
              <div className="absolute top-0 left-0 w-full h-2 bg-accent-teal"></div>
              <div className="p-6 h-full flex flex-col">
                <div className="w-12 h-12 bg-accent-teal/10 rounded-xl flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#1A3A52] mb-2">Data Developers</h3>
                <p className="text-[#1A3A52]/70 text-sm leading-relaxed flex-grow">
                  Work with ML, data pipelines, and analytics to drive insights.
                </p>
              </div>
            </div>

            {/* 3D Modeling Developers */}
            <div className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500">
              <div className="absolute top-0 left-0 w-full h-2 bg-[#A2D483]"></div>
              <div className="p-6 h-full flex flex-col">
                <div className="w-12 h-12 bg-[#A2D483]/10 rounded-xl flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#A2D483]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#1A3A52] mb-2">3D Modeling Developers</h3>
                <p className="text-[#1A3A52]/70 text-sm leading-relaxed flex-grow">
                  Create immersive AR/VR experiences and 3D visualizations.
                </p>
              </div>
            </div>

            {/* Product Managers */}
            <div className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500">
              <div className="absolute top-0 left-0 w-full h-2 bg-[#1A3A52]"></div>
              <div className="p-6 h-full flex flex-col">
                <div className="w-12 h-12 bg-[#1A3A52]/10 rounded-xl flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#1A3A52]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#1A3A52] mb-2">Product Managers</h3>
                <p className="text-[#1A3A52]/70 text-sm leading-relaxed flex-grow">
                  Lead teams and drive projects from concept to launch.
                </p>
              </div>
            </div>

            {/* UI/UX Designers */}
            <div className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500">
              <div className="absolute top-0 left-0 w-full h-2 bg-accent-pink"></div>
              <div className="p-6 h-full flex flex-col">
                <div className="w-12 h-12 bg-accent-pink/10 rounded-xl flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-accent-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#1A3A52] mb-2">UI/UX Designers</h3>
                <p className="text-[#1A3A52]/70 text-sm leading-relaxed flex-grow">
                  Craft beautiful interfaces and seamless user experiences.
                </p>
              </div>
            </div>

            {/* Animators */}
            <div className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500">
              <div className="absolute top-0 left-0 w-full h-2 bg-[#CA60AC]"></div>
              <div className="p-6 h-full flex flex-col">
                <div className="w-12 h-12 bg-[#CA60AC]/10 rounded-xl flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#CA60AC]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#1A3A52] mb-2">Animators</h3>
                <p className="text-[#1A3A52]/70 text-sm leading-relaxed flex-grow">
                  Bring products to life with motion design and animation.
                </p>
              </div>
            </div>

            {/* Graphic Designers */}
            <div className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500">
              <div className="absolute top-0 left-0 w-full h-2 bg-[#F9C679]"></div>
              <div className="p-6 h-full flex flex-col">
                <div className="w-12 h-12 bg-[#F9C679]/10 rounded-xl flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#F9C679]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#1A3A52] mb-2">Graphic Designers</h3>
                <p className="text-[#1A3A52]/70 text-sm leading-relaxed flex-grow">
                  Create visual identities, branding, and marketing assets.
                </p>
              </div>
            </div>

            {/* Hardware Engineers */}
            <div className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500">
              <div className="absolute top-0 left-0 w-full h-2 bg-[#509C81]"></div>
              <div className="p-6 h-full flex flex-col">
                <div className="w-12 h-12 bg-[#509C81]/10 rounded-xl flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#509C81]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#1A3A52] mb-2">Hardware Engineers</h3>
                <p className="text-[#1A3A52]/70 text-sm leading-relaxed flex-grow">
                  Build physical prototypes and IoT solutions.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative SVG at bottom right - animated flower */}
        <div className="hidden lg:block absolute -bottom-20 right-8 z-20">
          <AnimatedFlowerSVG />
        </div>
      </section>

      {/* What We Look For Section */}
      <section className="bg-white dark:bg-accent-coral py-20 md:py-28 relative overflow-visible">
        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-dark-blue dark:text-white">What We Look For</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
            {/* Curiosity */}
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 relative">
                <AnimatedCuriosityIcon />
              </div>
              <h3 className="text-2xl font-bold text-accent-coral dark:text-white mb-4">Curiosity</h3>
              <p className="text-dark-blue/70 dark:text-white/90 text-lg leading-relaxed">
                DALI students continuously strive to know more with excitement about the rapidly evolving technology space.
              </p>
            </div>

            {/* Collaboration */}
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 relative">
                <AnimatedCollaborationIcon />
              </div>
              <h3 className="text-2xl font-bold text-accent-teal dark:text-white mb-4">Collaboration</h3>
              <p className="text-dark-blue/70 dark:text-white/90 text-lg leading-relaxed">
                DALI students prioritize their teams. They are excited about peer-to-peer learning and mentorship opportunities.
              </p>
            </div>

            {/* Initiative */}
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 relative">
                <AnimatedInitiativeIcon />
              </div>
              <h3 className="text-2xl font-bold text-accent-pink dark:text-white mb-4">Initiative</h3>
              <p className="text-dark-blue/70 dark:text-white/90 text-lg leading-relaxed">
                DALI students have agency in their projects and drive projects to reach their greatest possible potential.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Application Process Section */}
      <section className="bg-section-bg py-20 md:py-28 relative overflow-visible">
        {/* Decorative SVG - Top Left - Green Pattern (animated by blocks) */}
        <div className="hidden lg:block absolute top-8 left-4 z-10">
          <svg ref={processSvg1Ref} width="160" height="160" viewBox="0 0 76 76" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
            {/* Main frame with cutouts */}
            <motion.path
              fillRule="evenodd" clipRule="evenodd" d="M0 75.8948L6.21264e-06 37.9474L8.29367e-07 1.65872e-06L37.9474 0L75.8948 4.13157e-06V37.9474V75.8948H37.9474H0ZM37.9474 56.9109C37.9531 46.4366 46.4457 37.9474 56.9211 37.9474C46.4423 37.9474 37.9474 29.4526 37.9474 18.9737C37.9474 29.4526 29.4526 37.9474 18.9737 37.9474C29.4492 37.9474 37.9419 46.4366 37.9474 56.9109ZM18.9737 47.8137C24.0036 47.8137 28.0811 51.8912 28.0811 56.9211C28.0811 61.951 24.0036 66.0285 18.9737 66.0285C13.9438 66.0285 9.86633 61.951 9.86633 56.9211C9.86633 51.8912 13.9438 47.8137 18.9737 47.8137ZM28.0811 18.9737C28.0811 24.0036 24.0036 28.0811 18.9737 28.0811C13.9438 28.0811 9.86633 24.0036 9.86633 18.9737C9.86633 13.9438 13.9438 9.86633 18.9737 9.86633C24.0036 9.86633 28.0811 13.9438 28.0811 18.9737ZM47.8137 56.9211C47.8137 51.8912 51.8912 47.8137 56.9211 47.8137C61.951 47.8137 66.0285 51.8912 66.0285 56.9211C66.0285 61.951 61.951 66.0285 56.9211 66.0285C51.8912 66.0285 47.8137 61.951 47.8137 56.9211ZM47.8137 18.9737C47.8137 24.0036 51.8912 28.0811 56.9211 28.0811C61.951 28.0811 66.0285 24.0036 66.0285 18.9737C66.0285 13.9439 61.951 9.86633 56.9211 9.86633C51.8912 9.86633 47.8137 13.9438 47.8137 18.9737Z" fill="#509C81"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg1InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '37.95px 37.95px' }}
            />
          </svg>
        </div>

        {/* Decorative SVG - Top Right - Flower (animated by blocks) */}
        <div className="hidden lg:block absolute top-4 right-8 z-10">
          <svg ref={processSvg2Ref} width="200" height="220" viewBox="0 0 71 76" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
            {/* Red flower shape */}
            <motion.path
              fillRule="evenodd" clipRule="evenodd" d="M6.1719 23.2247C-8.68222 40.7909 5.72591 55.0295 23.5012 40.3501C41.273 55.0295 55.6846 40.7774 40.8304 23.2247C55.6846 5.65855 41.273 -8.58008 23.5012 6.09928C5.72591 -8.58008 -8.68222 5.65855 6.1719 23.2247ZM23.5012 31.8178C28.3036 31.8178 32.1966 27.9706 32.1966 23.2247C32.1966 18.4788 28.3036 14.6315 23.5012 14.6315C18.6988 14.6315 14.8057 18.4788 14.8057 23.2247C14.8057 27.9706 18.6988 31.8178 23.5012 31.8178Z" fill="#F97979"
              initial={{ scale: 0, rotate: -180, opacity: 0 }}
              animate={processSvg2InView ? { scale: 1, rotate: 0, opacity: 1 } : { scale: 0, rotate: -180, opacity: 0 }}
              transition={{ delay: 0, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '23.5px 23.22px' }}
            />
            {/* Teal plant shape */}
            <motion.path
              d="M63.4502 45.6807C67.5522 45.6808 70.8777 48.7333 70.8779 52.499C70.8779 56.265 67.5524 59.3182 63.4502 59.3184C62.8973 59.3184 62.3583 59.2615 61.8398 59.1562C55.8652 58.468 48.6902 53.4967 47.5381 52.6748C48.3407 53.8024 52.771 60.2179 53.8486 65.9355C54.1349 66.7557 54.293 67.6456 54.293 68.5752C54.2926 72.6769 51.2401 76.0025 47.4746 76.0029C43.7088 76.0028 40.6556 72.6771 40.6553 68.5752C40.6553 68.0196 40.7131 67.4778 40.8193 66.957C41.4945 61.1191 46.2546 54.1371 47.2373 52.748C45.8141 53.7537 38.857 58.4868 33.0381 59.1572C32.5196 59.2624 31.9806 59.3193 31.4277 59.3193C27.3256 59.3192 24 56.266 24 52.5C24.0004 48.7344 27.3259 45.6818 31.4277 45.6816C32.3603 45.6817 33.2528 45.8408 34.0752 46.1289C40.0237 47.2539 46.7239 52.0018 47.4375 52.5166C48.138 52.011 54.8473 47.2542 60.8027 46.1279C61.6252 45.8398 62.5175 45.6807 63.4502 45.6807ZM47.3672 29C51.1331 29 54.1863 32.3256 54.1865 36.4277C54.1865 36.9837 54.1288 37.5258 54.0225 38.0469C53.2679 44.562 47.4277 52.501 47.4277 52.501C47.3911 52.4511 42.1761 45.34 40.9932 39.0684C40.7066 38.248 40.5489 37.3576 40.5488 36.4277C40.549 32.326 43.6017 29.0006 47.3672 29Z" fill="#24B1B1"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg2InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.15, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '47.44px 52.5px' }}
            />
          </svg>
        </div>

        {/* Decorative SVG - Bottom Left - Blocks Banner style (animated by blocks) */}
        <div className="hidden lg:block absolute bottom-24 left-4 z-0">
          <svg ref={processSvg3Ref} width="220" height="280" viewBox="0 0 180 224" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
            {/* Large green square */}
            <motion.rect
              x="44.6774" y="89.3595" width="89.7984" height="89.7984" fill="#A2D483"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '89.58px 134.26px' }}
            />
            {/* Green pattern shape */}
            <motion.path
              fillRule="evenodd" clipRule="evenodd" d="M44.6801 179.159L44.6801 134.26L44.6801 89.3608L89.5793 89.3607L134.478 89.3608V134.26V179.159H89.5793H44.6801ZM89.5793 156.697C89.586 144.304 99.6344 134.26 112.029 134.26C99.6304 134.26 89.5793 124.209 89.5793 111.81C89.5793 124.209 79.5282 134.26 67.1297 134.26C79.5242 134.26 89.5727 144.304 89.5793 156.697ZM67.1297 145.934C73.081 145.934 77.9055 150.758 77.9055 156.71C77.9055 162.661 73.081 167.485 67.1297 167.485C61.1784 167.485 56.3539 162.661 56.3539 156.71C56.3539 150.758 61.1784 145.934 67.1297 145.934ZM77.9055 111.81C77.9055 117.762 73.081 122.586 67.1297 122.586C61.1784 122.586 56.3539 117.762 56.3539 111.81C56.3539 105.859 61.1784 101.035 67.1297 101.035C73.081 101.035 77.9055 105.859 77.9055 111.81ZM101.253 156.71C101.253 150.758 106.077 145.934 112.029 145.934C117.98 145.934 122.805 150.758 122.805 156.71C122.805 162.661 117.98 167.485 112.029 167.485C106.077 167.485 101.253 162.661 101.253 156.71ZM101.253 111.81C101.253 117.762 106.077 122.586 112.029 122.586C117.98 122.586 122.805 117.762 122.805 111.81C122.805 105.859 117.98 101.035 112.029 101.035C106.077 101.035 101.253 105.859 101.253 111.81Z" fill="#509C81"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.1, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '89.58px 134.26px' }}
            />
            {/* Red square - top */}
            <motion.rect
              x="89.3571" width="44.6799" height="44.6799" fill="#E45768"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.2, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '111.7px 22.34px' }}
            />
            {/* Yellow circle - top */}
            <motion.circle
              cx="111.478" cy="22.1209" r="11.6082" fill="#FFF3B5"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.3, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Light green square - top right */}
            <motion.rect
              x="134.476" y="44.6785" width="44.6799" height="44.6799" fill="#A2D483"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.25, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '156.82px 67.02px' }}
            />
            {/* Dark blue circle - top right */}
            <motion.circle
              cx="156.597" cy="66.7995" r="11.6082" fill="#154C74"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.35, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Orange circle - left */}
            <motion.circle
              cx="22.1201" cy="111.481" r="11.6082" fill="#F9C679"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.15, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Pink circle - bottom right */}
            <motion.circle
              cx="156.6" cy="201.279" r="11.6082" fill="#CA60AC"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.4, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Teal square - bottom left */}
            <motion.rect
              y="179.159" width="44.6799" height="44.6799" fill="#24B1B1"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.3, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '22.34px 201.5px' }}
            />
            {/* Dark circle - bottom left */}
            <motion.circle
              cx="22.1209" cy="201.28" r="11.6082" fill="#0B1C29"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg3InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.45, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
          </svg>
        </div>

        {/* Decorative SVG - Bottom Right - Roles Blocks style (animated by blocks) */}
        <div className="hidden lg:block absolute bottom-16 right-4 z-0">
          <svg ref={processSvg4Ref} width="320" height="200" viewBox="0 0 307 195" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
            {/* Teal square */}
            <motion.rect
              x="48.1055" y="65.1663" width="64.6972" height="64.6972" transform="rotate(-90 48.1055 65.1663)" fill="#8CE0D6"
              initial={{ y: -50, opacity: 0 }}
              animate={processSvg4InView ? { y: 0, opacity: 1 } : { y: -50, opacity: 0 }}
              transition={{ delay: 0, duration: 0.4, ease: "easeOut" }}
            />
            {/* Orange square */}
            <motion.rect
              x="112.805" y="194.092" width="64.6972" height="64.6972" transform="rotate(-90 112.805 194.092)" fill="#F9C679"
              initial={{ y: -50, opacity: 0 }}
              animate={processSvg4InView ? { y: 0, opacity: 1 } : { y: -50, opacity: 0 }}
              transition={{ delay: 0.08, duration: 0.4, ease: "easeOut" }}
            />
            {/* Red quarter circle */}
            <motion.path
              d="M177.502 65.2503C141.771 65.2503 112.805 35.7313 112.805 7.62939e-06L177.502 7.62939e-06V65.2503Z" fill="#E45768"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.16, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Yellow square */}
            <motion.rect
              x="112.805" y="130.5" width="65.2503" height="64.6973" transform="rotate(-90 112.805 130.5)" fill="#FFF3B5"
              initial={{ y: -50, opacity: 0 }}
              animate={processSvg4InView ? { y: 0, opacity: 1 } : { y: -50, opacity: 0 }}
              transition={{ delay: 0.24, duration: 0.4, ease: "easeOut" }}
            />
            {/* Green quarter circle */}
            <motion.path
              d="M177.5 128.842V64.6977C212.926 64.6977 241.644 93.4161 241.644 128.842H177.5Z" fill="#64B598"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.32, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Green square bottom right */}
            <motion.rect
              x="242.199" y="194.092" width="64.6972" height="64.6972" transform="rotate(-90 242.199 194.092)" fill="#64B598"
              initial={{ y: -50, opacity: 0 }}
              animate={processSvg4InView ? { y: 0, opacity: 1 } : { y: -50, opacity: 0 }}
              transition={{ delay: 0.4, duration: 0.4, ease: "easeOut" }}
            />
            {/* Gray circle */}
            <motion.circle
              cx="80.3071" cy="97.2029" r="16.1743" fill="#D2DBE1"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.48, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Red circle top */}
            <motion.circle
              cx="210.264" cy="32.5057" r="16.1743" fill="#F97979"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.56, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Dark blue circle */}
            <motion.circle
              cx="80.2251" cy="32.1141" r="16.1743" fill="#0C4B78"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.64, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Pink circle */}
            <motion.circle
              cx="16.1743" cy="32.1141" r="16.1743" fill="#E68FBE"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.72, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Teal circle bottom */}
            <motion.circle
              cx="145.307" cy="161.586" r="16.1743" fill="#2DC0C0"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.8, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Dark teal circle */}
            <motion.circle
              cx="209.698" cy="161.586" r="16.1743" fill="#24B1B1"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.88, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Peach circle */}
            <motion.circle
              cx="145.014" cy="97.4607" r="16.1743" fill="#FFA89C"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.96, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Yellow circle right */}
            <motion.circle
              cx="274.78" cy="97.2801" r="16.1743" fill="#FFF3B5"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 1.04, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Green plant/flower */}
            <motion.path
              fillRule="evenodd" clipRule="evenodd" d="M268.108 148.202C269.29 154.5 274.55 161.649 274.55 161.649C274.55 161.649 280.381 153.723 281.143 147.21C281.251 146.685 281.308 146.138 281.308 145.577C281.308 141.474 278.255 138.149 274.489 138.149C270.723 138.149 267.67 141.474 267.67 145.577C267.67 146.501 267.825 147.386 268.108 148.202ZM274.559 161.666C275.261 161.159 281.98 156.391 287.939 155.27C288.757 154.985 289.644 154.829 290.571 154.829C294.673 154.829 297.999 157.882 297.999 161.648C297.999 165.414 294.673 168.467 290.571 168.467C290.013 168.467 289.469 168.411 288.946 168.304C282.983 167.61 275.829 162.659 274.663 161.828C275.476 162.97 279.905 169.385 280.976 175.099C281.259 175.915 281.414 176.799 281.414 177.723C281.414 181.826 278.361 185.151 274.595 185.151C270.829 185.151 267.776 181.826 267.776 177.723C267.776 177.162 267.833 176.616 267.941 176.091C268.622 170.264 273.362 163.304 274.353 161.903C272.918 162.916 265.981 167.629 260.174 168.305C259.651 168.412 259.107 168.469 258.549 168.469C254.447 168.469 251.121 165.416 251.121 161.649C251.121 157.883 254.447 154.83 258.549 154.83C259.476 154.83 260.363 154.986 261.181 155.271C267.136 156.391 273.848 161.153 274.559 161.666Z" fill="#A2D483"
              style={{ transformOrigin: '274.55px 161.65px' }}
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg4InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 1.12, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
          </svg>
        </div>

        {/* Decorative SVG - Middle Right - Hero banner style (animated by blocks) */}
        <div className="hidden lg:block absolute top-1/2 right-4 -translate-y-1/2 z-0">
          <svg ref={processSvg5Ref} viewBox="0 0 290 77" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-[260px] h-auto" style={{ overflow: 'visible' }}>
            {/* Yellow square */}
            <motion.rect
              y="0.276825" width="76.3096" height="76.3096" fill="#FFF3B5"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg5InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '38.15px 38.43px' }}
            />
            {/* Pink circle */}
            <motion.circle
              cx="37.3235" cy="38.1549" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg5InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.1, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Peach circle */}
            <motion.circle
              cx="114.373" cy="37.9701" r="19.0774" fill="#FFA89C"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg5InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Teal square */}
            <motion.rect
              x="152.711" width="76.3096" height="76.3096" fill="#8CE0D6"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg5InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.3, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '190.87px 38.15px' }}
            />
            {/* Dark circle */}
            <motion.circle
              cx="190.312" cy="37.9701" r="19.0774" fill="#404040"
              initial={{ scale: 0, opacity: 0 }}
              animate={processSvg5InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.4, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Red flower shape */}
            <g clipPath="url(#clip0_process)">
              <mask id="mask0_process" maskUnits="userSpaceOnUse" x="242" y="15" width="48" height="48">
                <path d="M289.761 15.7568L242.758 15.7568V62.2061H289.761V15.7568Z" fill="white"/>
              </mask>
              <g mask="url(#mask0_process)">
                <motion.path
                  fillRule="evenodd" clipRule="evenodd" d="M248.93 38.9814C234.076 56.5477 248.484 70.7862 266.259 56.1068C284.031 70.7862 298.443 56.5342 283.589 38.9814C298.443 21.4153 284.031 7.1767 266.259 21.8561C248.484 7.1767 234.076 21.4153 248.93 38.9814ZM266.259 47.5746C271.062 47.5746 274.955 43.7274 274.955 38.9814C274.955 34.2356 271.062 30.3883 266.259 30.3883C261.457 30.3883 257.564 34.2356 257.564 38.9814C257.564 43.7274 261.457 47.5746 266.259 47.5746Z" fill="#E45768"
                  initial={{ scale: 0, rotate: -180, opacity: 0 }}
                  animate={processSvg5InView ? { scale: 1, rotate: 0, opacity: 1 } : { scale: 0, rotate: -180, opacity: 0 }}
                  transition={{ delay: 0.5, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                  style={{ transformOrigin: '266.259px 38.98px' }}
                />
              </g>
            </g>
            <defs>
              <clipPath id="clip0_process">
                <rect width="47.0023" height="46.4493" fill="white" transform="translate(242.758 15.7568)"/>
              </clipPath>
            </defs>
          </svg>
        </div>

        <div className="max-w-5xl mx-auto px-6 md:px-12 lg:px-16 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-dark-blue dark:text-white">The Application Process</h2>
          </div>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-0.5 bg-dark-blue/20 dark:bg-white/20 transform md:-translate-x-1/2"></div>

            {/* Step 1 */}
            <div className="relative flex items-center mb-12 md:mb-16">
              <div className="absolute left-8 md:left-1/2 w-8 h-8 bg-accent-coral rounded-full transform -translate-x-1/2 flex items-center justify-center font-bold text-white z-10">1</div>
              <div className="ml-20 md:ml-0 md:w-1/2 md:pr-16">
                <h3 className="text-xl md:text-2xl font-bold text-[#1A3A52] dark:text-white mb-2">Start Your Application Online</h3>
                <p className="text-dark-blue/70 dark:text-white/70">Fill out our application form when applications open at the start of each term. Tell us about yourself, your interests, and why DALI.</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative flex items-center mb-12 md:mb-16 md:flex-row-reverse">
              <div className="absolute left-8 md:left-1/2 w-8 h-8 bg-accent-teal rounded-full transform -translate-x-1/2 flex items-center justify-center font-bold text-white z-10">2</div>
              <div className="ml-20 md:ml-0 md:w-1/2 md:pl-16">
                <h3 className="text-xl md:text-2xl font-bold text-[#1A3A52] dark:text-white mb-2">Complete Challenge</h3>
                <p className="text-dark-blue/70 dark:text-white/70">Show us what you can do with a role-specific challenge. Developers code, designers design, PMs strategize. No prior experience required!</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative flex items-center mb-12 md:mb-16">
              <div className="absolute left-8 md:left-1/2 w-8 h-8 bg-accent-pink rounded-full transform -translate-x-1/2 flex items-center justify-center font-bold text-white z-10">3</div>
              <div className="ml-20 md:ml-0 md:w-1/2 md:pr-16">
                <h3 className="text-xl md:text-2xl font-bold text-[#1A3A52] dark:text-white mb-2">Interview</h3>
                <p className="text-dark-blue/70 dark:text-white/70">Have a conversation with current DALI members. We want to get to know you — your passions, your goals, and how you think.</p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="relative flex items-center md:flex-row-reverse">
              <div className="absolute left-8 md:left-1/2 w-8 h-8 bg-[#A2D483] rounded-full transform -translate-x-1/2 flex items-center justify-center font-bold text-white z-10">4</div>
              <div className="ml-20 md:ml-0 md:w-1/2 md:pl-16">
                <h3 className="text-xl md:text-2xl font-bold text-[#1A3A52] dark:text-white mb-2">Welcome to DALI!</h3>
                <p className="text-dark-blue/70 dark:text-white/70">Get your offer, join the community, and start building amazing things with your new team. The adventure begins!</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Questions Section */}
      <section className="bg-section-bg py-16 md:py-20">
        <div className="max-w-4xl mx-auto px-6 md:px-12 text-center">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-dark-blue mb-4">Have Questions?</h2>
            <p className="text-dark-blue/70 text-lg mb-6">
              Reach out to us at{' '}
              <a
                href="mailto:applications@dali.dartmouth.edu"
                className="text-accent-coral dark:text-white font-semibold hover:underline"
              >
                applications@dali.dartmouth.edu
              </a>
            </p>
          </div>
        </div>
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
  );
};

export default Apply;
