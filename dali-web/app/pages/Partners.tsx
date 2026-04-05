import React, { useRef } from 'react';
import { Link } from 'react-router';
import { motion, useInView } from 'framer-motion';
import Navbar from '@/components/Navbar';
import AnimatedGreenSquareSVG from '@/components/AnimatedGreenSquareSVG';
import AnimatedRolesBlocksSVG from '@/components/AnimatedRolesBlocksSVG';
import AnimatedFlowerSVG from '@/components/AnimatedFlowerSVG';
// Note: Criteria cards use inline SVGs copied from other parts of the site

const Partners: React.FC = () => {
  // Criteria section SVG refs
  const criteriaImpactSvgRef = useRef(null);
  const criteriaImpactInView = useInView(criteriaImpactSvgRef, { once: false, amount: 0.5 });
  const criteriaEduSvgRef = useRef(null);
  const criteriaEduInView = useInView(criteriaEduSvgRef, { once: false, amount: 0.5 });
  const criteriaSkillCircleSvgRef = useRef(null);
  const criteriaSkillCircleInView = useInView(criteriaSkillCircleSvgRef, { once: false, amount: 0.5 });
  const criteriaSkillSquareSvgRef = useRef(null);
  const criteriaSkillSquareInView = useInView(criteriaSkillSquareSvgRef, { once: false, amount: 0.5 });
  const criteriaTechSvg1Ref = useRef(null);
  const criteriaTechSvg1InView = useInView(criteriaTechSvg1Ref, { once: false, amount: 0.5 });
  const criteriaTechSvg2Ref = useRef(null);
  const criteriaTechSvg2InView = useInView(criteriaTechSvg2Ref, { once: false, amount: 0.5 });
  const criteriaPartnerSvg1Ref = useRef(null);
  const criteriaPartnerSvg1InView = useInView(criteriaPartnerSvg1Ref, { once: false, amount: 0.5 });
  const criteriaPartnerSvg2Ref = useRef(null);
  const criteriaPartnerSvg2InView = useInView(criteriaPartnerSvg2Ref, { once: false, amount: 0.5 });

  // Funding section SVG ref
  const fundingSvgRef = useRef(null);
  const fundingSvgInView = useInView(fundingSvgRef, { once: false, amount: 0.3 });

  // Expertise section SVG ref
  const expertiseSvgRef = useRef(null);
  const expertiseSvgInView = useInView(expertiseSvgRef, { once: false, amount: 0.3 });

  // "What We Build" heading refs
  const whatWeBuildTitleRef = useRef(null);
  const whatWeBuildTitleInView = useInView(whatWeBuildTitleRef, { once: false, amount: 0.5 });
  const whatWeBuildSubRef = useRef(null);
  const whatWeBuildSubInView = useInView(whatWeBuildSubRef, { once: false, amount: 0.5 });

  // Expertise card refs
  const expertiseCard1Ref = useRef(null);
  const expertiseCard1InView = useInView(expertiseCard1Ref, { once: false, amount: 0.3 });
  const expertiseCard2Ref = useRef(null);
  const expertiseCard2InView = useInView(expertiseCard2Ref, { once: false, amount: 0.3 });
  const expertiseCard3Ref = useRef(null);
  const expertiseCard3InView = useInView(expertiseCard3Ref, { once: false, amount: 0.3 });
  const expertiseCard4Ref = useRef(null);
  const expertiseCard4InView = useInView(expertiseCard4Ref, { once: false, amount: 0.3 });
  const expertiseCard5Ref = useRef(null);
  const expertiseCard5InView = useInView(expertiseCard5Ref, { once: false, amount: 0.3 });
  const expertiseCard6Ref = useRef(null);
  const expertiseCard6InView = useInView(expertiseCard6Ref, { once: false, amount: 0.3 });
  const expertiseCard7Ref = useRef(null);
  const expertiseCard7InView = useInView(expertiseCard7Ref, { once: false, amount: 0.3 });
  const expertiseCard8Ref = useRef(null);
  const expertiseCard8InView = useInView(expertiseCard8Ref, { once: false, amount: 0.3 });
  const expertiseCard9Ref = useRef(null);
  const expertiseCard9InView = useInView(expertiseCard9Ref, { once: false, amount: 0.3 });
  const expertiseCard10Ref = useRef(null);
  const expertiseCard10InView = useInView(expertiseCard10Ref, { once: false, amount: 0.3 });
  const expertiseCard11Ref = useRef(null);
  const expertiseCard11InView = useInView(expertiseCard11Ref, { once: false, amount: 0.3 });
  const expertiseCard12Ref = useRef(null);
  const expertiseCard12InView = useInView(expertiseCard12Ref, { once: false, amount: 0.3 });

  // Explore projects link ref
  const exploreProjectsRef = useRef(null);
  const exploreProjectsInView = useInView(exploreProjectsRef, { once: false, amount: 0.5 });

  // FAQ section SVG refs
  const faqTopSvgRef = useRef(null);
  const faqTopSvgInView = useInView(faqTopSvgRef, { once: false, amount: 0.3 });
  const faqBottomSvgRef = useRef(null);
  const faqBottomSvgInView = useInView(faqBottomSvgRef, { once: false, amount: 0.3 });

  // Sponsorship section SVG ref
  const sponsorshipSvgRef = useRef(null);
  const sponsorshipSvgInView = useInView(sponsorshipSvgRef, { once: false, amount: 0.3 });

  return (
    <div className="min-h-screen bg-background overflow-x-clip">
      <Navbar />

      {/* Hero Section - Full-width centered with floating shapes */}
      <section className="pt-[72px] min-h-screen flex items-center justify-center relative overflow-visible bg-section-bg dark:bg-[#061825]">
        {/* Scattered decorative SVGs - randomized positions */}

        {/* Green Square - top left area */}
        <motion.div
          className="absolute top-[12%] left-[-5%] z-0 scale-[0.35] md:top-[18%] md:left-[2%] md:scale-100"
          initial={{ x: -200, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 1.2, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <AnimatedGreenSquareSVG />
        </motion.div>

        {/* Flower - upper right */}
        <motion.div
          className="absolute top-[10%] right-[2%] z-0 scale-[0.4] md:top-[14%] md:right-[8%] md:scale-90"
          initial={{ x: 150, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 1, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <AnimatedFlowerSVG />
        </motion.div>

        {/* Roles Blocks - bottom left */}
        <motion.div
          className="hidden md:block absolute bottom-[8%] left-[-8%] z-0 scale-[0.35] md:bottom-[12%] md:left-[0%] md:scale-110"
          initial={{ x: -180, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 1.1, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <AnimatedRolesBlocksSVG />
        </motion.div>

        {/* Pink/Magenta pattern - bottom right corner */}
        <motion.div
          className="hidden md:block absolute bottom-[6%] right-[2%] z-0 scale-[0.4] md:bottom-[18%] md:right-[3%] md:scale-100"
          initial={{ x: 200, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 1.3, delay: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <svg width="140" height="140" viewBox="0 0 76 76" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
            {/* Main frame with star cutout */}
            <motion.path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M0 75.8948L6.21264e-06 37.9474L8.29367e-07 1.65872e-06L37.9474 0L75.8948 4.13157e-06V37.9474V75.8948H37.9474H0ZM37.9474 56.9109C37.9531 46.4366 46.4457 37.9474 56.9211 37.9474C46.4423 37.9474 37.9474 29.4526 37.9474 18.9737C37.9474 29.4526 29.4526 37.9474 18.9737 37.9474C29.4492 37.9474 37.9419 46.4366 37.9474 56.9109ZM18.9737 47.8137C24.0036 47.8137 28.0811 51.8912 28.0811 56.9211C28.0811 61.951 24.0036 66.0285 18.9737 66.0285C13.9438 66.0285 9.86633 61.951 9.86633 56.9211C9.86633 51.8912 13.9438 47.8137 18.9737 47.8137ZM28.0811 18.9737C28.0811 24.0036 24.0036 28.0811 18.9737 28.0811C13.9438 28.0811 9.86633 24.0036 9.86633 18.9737C9.86633 13.9438 13.9438 9.86633 18.9737 9.86633C24.0036 9.86633 28.0811 13.9438 28.0811 18.9737ZM47.8137 56.9211C47.8137 51.8912 51.8912 47.8137 56.9211 47.8137C61.951 47.8137 66.0285 51.8912 66.0285 56.9211C66.0285 61.951 61.951 66.0285 56.9211 66.0285C51.8912 66.0285 47.8137 61.951 47.8137 56.9211ZM47.8137 18.9737C47.8137 24.0036 51.8912 28.0811 56.9211 28.0811C61.951 28.0811 66.0285 24.0036 66.0285 18.9737C66.0285 13.9439 61.951 9.86633 56.9211 9.86633C51.8912 9.86633 47.8137 13.9438 47.8137 18.9737Z"
              fill="#CA60AC"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.7, delay: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
            />
          </svg>
        </motion.div>

        {/* Extra green square - right side, mid-height */}
        <motion.div
          className="hidden md:block absolute top-[75%] right-[-5%] z-0 scale-[0.25] md:top-[52%] md:right-[0%] md:scale-60"
          initial={{ x: 120, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 1, delay: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <AnimatedGreenSquareSVG />
        </motion.div>

        {/* Small teal pinwheel - top center-right */}
        <motion.div
          className="absolute top-[18%] right-[15%] z-0 scale-[0.5] md:top-[25%] md:right-[28%] md:scale-100"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <svg width="50" height="50" viewBox="0 0 47 47" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
            <motion.path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M16.9873 10.0534C18.1687 16.351 23.4286 23.5007 23.4286 23.5007C23.4286 23.5007 29.2602 15.5739 30.0218 9.06151C30.1301 8.53586 30.1872 7.98914 30.1872 7.42789C30.1872 3.32558 27.1342 0 23.3682 0C19.6021 0 16.5491 3.32558 16.5491 7.42789C16.5491 8.35223 16.7041 9.23713 16.9873 10.0534ZM23.438 23.5172C24.1394 23.0105 30.8585 18.2419 36.8176 17.121C37.6358 16.8363 38.523 16.6804 39.4499 16.6804C43.5523 16.6804 46.8778 19.7334 46.8778 23.4995C46.8778 27.2655 43.5523 30.3185 39.4499 30.3185C38.8919 30.3185 38.3483 30.262 37.8254 30.155C31.8617 29.4613 24.7081 24.5105 23.5422 23.6792C24.3551 24.8209 28.7842 31.2365 29.8553 36.95C30.1383 37.766 30.2931 38.6506 30.2931 39.5745C30.2931 43.6768 27.2401 47.0024 23.4741 47.0024C19.708 47.0024 16.655 43.6768 16.655 39.5745C16.655 39.0137 16.7121 38.4673 16.8202 37.9421C17.5007 32.1155 22.2409 25.1557 23.2322 23.7538C21.7969 24.7675 14.8604 29.4806 9.05246 30.1562C8.52959 30.2633 7.98592 30.3198 7.42789 30.3198C3.32558 30.3198 0 27.2668 0 23.5008C0 19.7347 3.32558 16.6817 7.42789 16.6817C8.35479 16.6817 9.24204 16.8376 10.0602 17.1223C16.0144 18.2423 22.7273 23.0039 23.438 23.5172Z"
              fill="#24B1B1"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.9, delay: 1.0, ease: [0.34, 1.56, 0.64, 1] }}
            />
          </svg>
        </motion.div>

        {/* Centered hero content */}
        <div className="relative z-10 text-center max-w-4xl mx-auto px-6">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] mb-8">
            <span className="text-dark-blue">Partner with us to</span>
            <br />
            <span className="text-accent-teal">design</span>
            <span className="text-dark-blue"> and </span>
            <span className="text-accent-coral">develop</span>
            <br />
            <span className="text-dark-blue">your idea.</span>
          </h1>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
            <a
              href="https://dali.fillout.com/t/hjQQFxv4U1us"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-accent-teal text-white font-semibold rounded-full hover:bg-accent-teal/90 transition-all shadow-lg hover:shadow-xl"
            >
              Apply to be a Partner
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </a>
            <button
              onClick={() => document.getElementById('sponsorship')?.scrollIntoView({ behavior: 'smooth' })}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 border-2 border-dark-blue text-dark-blue font-semibold rounded-full hover:bg-dark-blue hover:text-white transition-all"
            >
              Other ways to get involved
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* Stats Band - Horizontal strip with big numbers */}
      <section className="bg-accent-coral py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 text-white">
            <div className="text-center">
              <div className="text-5xl md:text-6xl font-bold text-white mb-2">12+</div>
              <div className="text-white/80 text-sm md:text-base">Years of Experience</div>
            </div>
            <div className="text-center">
              <div className="text-5xl md:text-6xl font-bold text-white mb-2">120+</div>
              <div className="text-white/80 text-sm md:text-base">Projects Completed</div>
            </div>
            <div className="text-center">
              <div className="text-5xl md:text-6xl font-bold text-white mb-2">4-6</div>
              <div className="text-white/80 text-sm md:text-base">Students Per Team</div>
            </div>
            <div className="text-center">
              <div className="text-5xl md:text-6xl font-bold text-white mb-2">10</div>
              <div className="text-white/80 text-sm md:text-base">Week Terms</div>
            </div>
          </div>
        </div>
      </section>

      {/* What We Look For - Project Criteria */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-white dark:bg-[#13629A] relative overflow-visible">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-dark-blue mb-4">
              What We Look For
            </h2>
            <p className="text-dark-blue/70 text-lg md:text-xl max-w-2xl">
              We select projects based on their potential to create meaningful learning experiences and real-world impact.
            </p>
          </div>

          {/* Criteria Grid */}
          <div className="grid grid-cols-12 gap-4 md:gap-6 auto-rows-[120px] md:auto-rows-[140px]">
            {/* Impact Potential - Large */}
            <div className="col-span-12 md:col-span-8 row-span-2 bg-dark-blue dark:bg-[#1A3A52] rounded-3xl p-8 flex flex-col justify-between relative overflow-hidden group">
              {/* Blocks Banner SVG - top right area */}
              <div className="absolute -right-8 -top-4 w-32 h-20 md:-right-2 md:-top-2 md:w-80 md:h-52">
                <svg ref={criteriaImpactSvgRef} viewBox="0 0 307 195" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
                  {/* All squares rendered first to be behind circles */}
                  {/* Yellow square - top left */}
                  <motion.rect x="48.1055" y="65.1663" width="64.6972" height="64.6972" transform="rotate(-90 48.1055 65.1663)" fill="#F9C679"
                    initial={{ opacity: 0 }}
                    animate={criteriaImpactInView ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ delay: 0, duration: 0.4, ease: "easeOut" }}
                  />
                  {/* Magenta square - bottom row */}
                  <motion.rect x="112.805" y="194.092" width="64.6972" height="64.6972" transform="rotate(-90 112.805 194.092)" fill="#CA60AC"
                    initial={{ opacity: 0 }}
                    animate={criteriaImpactInView ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ delay: 0.08, duration: 0.4, ease: "easeOut" }}
                  />
                  {/* Red square - middle */}
                  <motion.rect x="112.805" y="130.5" width="65.2503" height="64.6973" transform="rotate(-90 112.805 130.5)" fill="#E45768"
                    initial={{ opacity: 0 }}
                    animate={criteriaImpactInView ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ delay: 0.24, duration: 0.4, ease: "easeOut" }}
                  />
                  {/* Green square - bottom row */}
                  <motion.rect x="242.199" y="194.092" width="64.6972" height="64.6972" transform="rotate(-90 242.199 194.092)" fill="#A2D483"
                    initial={{ opacity: 0 }}
                    animate={criteriaImpactInView ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ delay: 0.4, duration: 0.4, ease: "easeOut" }}
                  />
                  {/* Quarter circles and other shapes */}
                  {/* Teal quarter circle */}
                  <motion.path d="M177.502 65.2503C141.771 65.2503 112.805 35.7313 112.805 7.62939e-06L177.502 7.62939e-06V65.2503Z" fill="#8CE0D6"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.16, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Yellow quarter circle */}
                  <motion.path d="M177.5 128.842V64.6977C212.926 64.6977 241.644 93.4161 241.644 128.842H177.5Z" fill="#FFF3B5"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.32, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Pink circle */}
                  <motion.circle cx="80.3071" cy="97.2029" r="16.1743" fill="#E68FBE"
                    style={{ transformOrigin: '80.3071px 97.2029px', transformBox: 'fill-box' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.48, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Teal circle */}
                  <motion.circle cx="210.264" cy="32.5057" r="16.1743" fill="#24B1B1"
                    style={{ transformOrigin: '210.264px 32.5057px', transformBox: 'fill-box' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.56, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Peach circle */}
                  <motion.circle cx="80.2251" cy="32.1141" r="16.1743" fill="#FFA89C"
                    style={{ transformOrigin: '80.2251px 32.1141px', transformBox: 'fill-box' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.64, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Green circle */}
                  <motion.circle cx="16.1743" cy="32.1141" r="16.1743" fill="#64B598"
                    style={{ transformOrigin: '16.1743px 32.1141px', transformBox: 'fill-box' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.72, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Red circle */}
                  <motion.circle cx="145.307" cy="161.586" r="16.1743" fill="#F97979"
                    style={{ transformOrigin: '145.307px 161.586px', transformBox: 'fill-box' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.8, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Gray circle */}
                  <motion.circle cx="209.698" cy="161.586" r="16.1743" fill="#D2DBE1"
                    style={{ transformOrigin: '209.698px 161.586px', transformBox: 'fill-box' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.88, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Teal circle right */}
                  <motion.circle cx="274.78" cy="97.2801" r="16.1743" fill="#2DC0C0"
                    style={{ transformOrigin: '274.78px 97.2801px', transformBox: 'fill-box' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.96, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Dark blue circle - rendered last among circles to be on top */}
                  <motion.circle cx="145.014" cy="97.4607" r="16.1743" fill="#0C4B78"
                    style={{ transformOrigin: '145.014px 97.4607px', transformBox: 'fill-box' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 1.04, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Green plant/flower */}
                  <motion.path fillRule="evenodd" clipRule="evenodd" d="M268.108 148.202C269.29 154.5 274.55 161.649 274.55 161.649C274.55 161.649 280.381 153.723 281.143 147.21C281.251 146.685 281.308 146.138 281.308 145.577C281.308 141.474 278.255 138.149 274.489 138.149C270.723 138.149 267.67 141.474 267.67 145.577C267.67 146.501 267.825 147.386 268.108 148.202ZM274.559 161.666C275.261 161.159 281.98 156.391 287.939 155.27C288.757 154.985 289.644 154.829 290.571 154.829C294.673 154.829 297.999 157.882 297.999 161.648C297.999 165.414 294.673 168.467 290.571 168.467C290.013 168.467 289.469 168.411 288.946 168.304C282.983 167.61 275.829 162.659 274.663 161.828C275.476 162.97 279.905 169.385 280.976 175.099C281.259 175.915 281.414 176.799 281.414 177.723C281.414 181.826 278.361 185.151 274.595 185.151C270.829 185.151 267.776 181.826 267.776 177.723C267.776 177.162 267.833 176.616 267.941 176.091C268.622 170.264 273.362 163.304 274.353 161.903C272.918 162.916 265.981 167.629 260.174 168.305C259.651 168.412 259.107 168.469 258.549 168.469C254.447 168.469 251.121 165.416 251.121 161.649C251.121 157.883 254.447 154.83 258.549 154.83C259.476 154.83 260.363 154.986 261.181 155.271C267.136 156.391 273.848 161.153 274.559 161.666Z" fill="#A2D483"
                    style={{ transformOrigin: '274.55px 161.65px' }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaImpactInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 1.12, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </svg>
              </div>
              <div className="relative z-10">
                <h3 className="text-2xl md:text-3xl font-bold text-white">Impact Potential</h3>
              </div>
              <p className="text-white/80 text-lg md:text-xl max-w-xl relative z-10">
                Projects that solve real problems and have the potential to make a meaningful difference in people's lives or advance important causes.
              </p>
            </div>

            {/* Educational Value */}
            <div className="col-span-6 md:col-span-4 row-span-2 bg-accent-coral rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden">
              {/* Flower SVG - middle right area */}
              <div className="absolute -right-1 top-1 w-12 h-14 md:right-4 md:top-16 md:w-20 md:h-22">
                <svg ref={criteriaEduSvgRef} viewBox="0 0 71 76" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
                  {/* Teal flower */}
                  <motion.path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M6.1719 23.2247C-8.68222 40.7909 5.72591 55.0295 23.5012 40.3501C41.273 55.0295 55.6846 40.7774 40.8304 23.2247C55.6846 5.65855 41.273 -8.58008 23.5012 6.09928C5.72591 -8.58008 -8.68222 5.65855 6.1719 23.2247ZM23.5012 31.8178C28.3036 31.8178 32.1966 27.9706 32.1966 23.2247C32.1966 18.4788 28.3036 14.6315 23.5012 14.6315C18.6988 14.6315 14.8057 18.4788 14.8057 23.2247C14.8057 27.9706 18.6988 31.8178 23.5012 31.8178Z"
                    fill="#8CE0D6"
                    initial={{ scale: 0, rotate: -180 }}
                    animate={criteriaEduInView ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
                    transition={{ delay: 0, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  {/* Yellow plant */}
                  <motion.path
                    d="M63.4502 45.6807C67.5522 45.6808 70.8777 48.7333 70.8779 52.499C70.8779 56.265 67.5524 59.3182 63.4502 59.3184C62.8973 59.3184 62.3583 59.2615 61.8398 59.1562C55.8652 58.468 48.6902 53.4967 47.5381 52.6748C48.3407 53.8024 52.771 60.2179 53.8486 65.9355C54.1349 66.7557 54.293 67.6456 54.293 68.5752C54.2926 72.6769 51.2401 76.0025 47.4746 76.0029C43.7088 76.0028 40.6556 72.6771 40.6553 68.5752C40.6553 68.0196 40.7131 67.4778 40.8193 66.957C41.4945 61.1191 46.2546 54.1371 47.2373 52.748C45.8141 53.7537 38.857 58.4868 33.0381 59.1572C32.5196 59.2624 31.9806 59.3193 31.4277 59.3193C27.3256 59.3192 24 56.266 24 52.5C24.0004 48.7344 27.3259 45.6818 31.4277 45.6816C32.3603 45.6817 33.2528 45.8408 34.0752 46.1289C40.0237 47.2539 46.7239 52.0018 47.4375 52.5166C48.138 52.011 54.8473 47.2542 60.8027 46.1279C61.6252 45.8398 62.5175 45.6807 63.4502 45.6807ZM47.3672 29C51.1331 29 54.1863 32.3256 54.1865 36.4277C54.1865 36.9837 54.1288 37.5258 54.0225 38.0469C53.2679 44.562 47.4277 52.501 47.4277 52.501C47.3911 52.4511 42.1761 45.34 40.9932 39.0684C40.7066 38.248 40.5489 37.3576 40.5488 36.4277C40.549 32.326 43.6017 29.0006 47.3672 29Z"
                    fill="#FFF3B5"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaEduInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ delay: 0.2, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </svg>
              </div>
              <div className="relative z-10">
                <h3 className="text-xl md:text-2xl font-bold text-white">Educational Value</h3>
              </div>
              <p className="text-white text-base md:text-lg relative z-10">Projects that offer rich learning opportunities across design, development, and product management.</p>
            </div>

            {/* Skill Compatibility - darker green for white text */}
            <div className="col-span-6 md:col-span-4 row-span-2 bg-[#509C81] rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden">
              {/* Small circle SVG - top right */}
              <div className="absolute right-2 top-2 w-6 h-6 md:right-6 md:top-6 md:w-10 md:h-10">
                <svg ref={criteriaSkillCircleSvgRef} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
                  <motion.circle cx="16" cy="16" r="16" fill="#FFF3B5"
                    initial={{ scale: 0 }}
                    animate={criteriaSkillCircleInView ? { scale: 1 } : { scale: 0 }}
                    transition={{ duration: 0.5, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </svg>
              </div>
              {/* Square pattern SVG - left side between header and text */}
              <div className="absolute -left-4 bottom-1 w-12 h-12 md:left-0 md:top-20 md:bottom-auto md:w-24 md:h-24">
                <svg ref={criteriaSkillSquareSvgRef} viewBox="0 0 76 76" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
                  <motion.path fillRule="evenodd" clipRule="evenodd" d="M0 75.8948L6.21264e-06 37.9474L8.29367e-07 1.65872e-06L37.9474 0L75.8948 4.13157e-06V37.9474V75.8948H37.9474H0ZM37.9474 56.9109C37.9531 46.4366 46.4457 37.9474 56.9211 37.9474C46.4423 37.9474 37.9474 29.4526 37.9474 18.9737C37.9474 29.4526 29.4526 37.9474 18.9737 37.9474C29.4492 37.9474 37.9419 46.4366 37.9474 56.9109ZM18.9737 47.8137C24.0036 47.8137 28.0811 51.8912 28.0811 56.9211C28.0811 61.951 24.0036 66.0285 18.9737 66.0285C13.9438 66.0285 9.86633 61.951 9.86633 56.9211C9.86633 51.8912 13.9438 47.8137 18.9737 47.8137ZM28.0811 18.9737C28.0811 24.0036 24.0036 28.0811 18.9737 28.0811C13.9438 28.0811 9.86633 24.0036 9.86633 18.9737C9.86633 13.9438 13.9438 9.86633 18.9737 9.86633C24.0036 9.86633 28.0811 13.9438 28.0811 18.9737ZM47.8137 56.9211C47.8137 51.8912 51.8912 47.8137 56.9211 47.8137C61.951 47.8137 66.0285 51.8912 66.0285 56.9211C66.0285 61.951 61.951 66.0285 56.9211 66.0285C51.8912 66.0285 47.8137 61.951 47.8137 56.9211ZM47.8137 18.9737C47.8137 24.0036 51.8912 28.0811 56.9211 28.0811C61.951 28.0811 66.0285 24.0036 66.0285 18.9737C66.0285 13.9439 61.951 9.86633 56.9211 9.86633C51.8912 9.86633 47.8137 13.9438 47.8137 18.9737Z" fill="#A2D483"
                    initial={{ scale: 0, rotate: 45 }}
                    animate={criteriaSkillSquareInView ? { scale: 1, rotate: 0 } : { scale: 0, rotate: 45 }}
                    transition={{ duration: 0.6, delay: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </svg>
              </div>
              <div className="relative z-10">
                <h3 className="text-xl md:text-2xl font-bold text-white">Skill Compatibility</h3>
              </div>
              <p className="text-white text-base md:text-lg relative z-10 max-w-[95%]">Projects aligned with our students' skills and growth areas for that term.</p>
            </div>

            {/* Technical Feasibility */}
            <div className="col-span-6 md:col-span-4 row-span-2 bg-accent-teal rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden">
              {/* Pinwheel SVG - top right area */}
              <div className="absolute -right-1 top-1 w-10 h-10 md:right-4 md:top-14 md:w-16 md:h-16">
                <svg ref={criteriaTechSvg1Ref} viewBox="0 0 47 47" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
                  <motion.path fillRule="evenodd" clipRule="evenodd" d="M16.9873 10.0534C18.1687 16.351 23.4286 23.5007 23.4286 23.5007C23.4286 23.5007 29.2602 15.5739 30.0218 9.06151C30.1301 8.53586 30.1872 7.98914 30.1872 7.42789C30.1872 3.32558 27.1342 0 23.3682 0C19.6021 0 16.5491 3.32558 16.5491 7.42789C16.5491 8.35223 16.7041 9.23713 16.9873 10.0534ZM23.438 23.5172C24.1394 23.0105 30.8585 18.2419 36.8176 17.121C37.6358 16.8363 38.523 16.6804 39.4499 16.6804C43.5523 16.6804 46.8778 19.7334 46.8778 23.4995C46.8778 27.2655 43.5523 30.3185 39.4499 30.3185C38.8919 30.3185 38.3483 30.262 37.8254 30.155C31.8617 29.4613 24.7081 24.5105 23.5422 23.6792C24.3551 24.8209 28.7842 31.2365 29.8553 36.95C30.1383 37.766 30.2931 38.6506 30.2931 39.5745C30.2931 43.6768 27.2401 47.0024 23.4741 47.0024C19.708 47.0024 16.655 43.6768 16.655 39.5745C16.655 39.0137 16.7121 38.4673 16.8202 37.9421C17.5007 32.1155 22.2409 25.1557 23.2322 23.7538C21.7969 24.7675 14.8604 29.4806 9.05246 30.1562C8.52959 30.2633 7.98592 30.3198 7.42789 30.3198C3.32558 30.3198 0 27.2668 0 23.5008C0 19.7347 3.32558 16.6817 7.42789 16.6817C8.35479 16.6817 9.24204 16.8376 10.0602 17.1223C16.0144 18.2423 22.7273 23.0039 23.438 23.5172Z" fill="#CA60AC"
                    initial={{ scale: 0, rotate: 180 }}
                    animate={criteriaTechSvg1InView ? { scale: 1, rotate: 0 } : { scale: 0, rotate: 180 }}
                    transition={{ duration: 0.7, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </svg>
              </div>
              {/* Pinwheel SVG - left side above subtext */}
              <div className="absolute -left-3 -bottom-1 w-10 h-10 md:-left-4 md:top-36 md:bottom-auto md:w-16 md:h-16">
                <svg ref={criteriaTechSvg2Ref} viewBox="0 0 47 47" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
                  <motion.path fillRule="evenodd" clipRule="evenodd" d="M16.9873 10.0534C18.1687 16.351 23.4286 23.5007 23.4286 23.5007C23.4286 23.5007 29.2602 15.5739 30.0218 9.06151C30.1301 8.53586 30.1872 7.98914 30.1872 7.42789C30.1872 3.32558 27.1342 0 23.3682 0C19.6021 0 16.5491 3.32558 16.5491 7.42789C16.5491 8.35223 16.7041 9.23713 16.9873 10.0534ZM23.438 23.5172C24.1394 23.0105 30.8585 18.2419 36.8176 17.121C37.6358 16.8363 38.523 16.6804 39.4499 16.6804C43.5523 16.6804 46.8778 19.7334 46.8778 23.4995C46.8778 27.2655 43.5523 30.3185 39.4499 30.3185C38.8919 30.3185 38.3483 30.262 37.8254 30.155C31.8617 29.4613 24.7081 24.5105 23.5422 23.6792C24.3551 24.8209 28.7842 31.2365 29.8553 36.95C30.1383 37.766 30.2931 38.6506 30.2931 39.5745C30.2931 43.6768 27.2401 47.0024 23.4741 47.0024C19.708 47.0024 16.655 43.6768 16.655 39.5745C16.655 39.0137 16.7121 38.4673 16.8202 37.9421C17.5007 32.1155 22.2409 25.1557 23.2322 23.7538C21.7969 24.7675 14.8604 29.4806 9.05246 30.1562C8.52959 30.2633 7.98592 30.3198 7.42789 30.3198C3.32558 30.3198 0 27.2668 0 23.5008C0 19.7347 3.32558 16.6817 7.42789 16.6817C8.35479 16.6817 9.24204 16.8376 10.0602 17.1223C16.0144 18.2423 22.7273 23.0039 23.438 23.5172Z" fill="#CA60AC"
                    initial={{ scale: 0, rotate: -180 }}
                    animate={criteriaTechSvg2InView ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
                    transition={{ duration: 0.7, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </svg>
              </div>
              <div className="relative z-10">
                <h3 className="text-xl md:text-2xl font-bold text-white">Technical Feasibility</h3>
              </div>
              <p className="text-white text-base md:text-lg relative z-10 max-w-[95%]">Scope that can achieve meaningful progress within a 10-week term.</p>
            </div>

            {/* Partner Involvement - deeper pink/magenta for white text */}
            <div className="col-span-6 md:col-span-4 row-span-2 bg-[#CA60AC] rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden">
              {/* Block with circle SVG - bottom right corner on desktop */}
              <div className="absolute -left-2 top-1 w-8 h-8 md:-right-2 md:left-auto md:-bottom-2 md:top-auto md:w-14 md:h-14">
                <svg ref={criteriaPartnerSvg1Ref} viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
                  <motion.rect width="65" height="65" fill="#509C81"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={criteriaPartnerSvg1InView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
                  />
                  <motion.circle cx="32.5" cy="32.5" r="16" fill="#FFF3B5"
                    initial={{ scale: 0 }}
                    animate={criteriaPartnerSvg1InView ? { scale: 1 } : { scale: 0 }}
                    transition={{ duration: 0.5, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </svg>
              </div>
              {/* Star pattern SVG - left side between header and text on desktop */}
              <div className="absolute -right-3 -bottom-3 w-12 h-12 md:-left-2 md:right-auto md:top-20 md:bottom-auto md:w-16 md:h-16">
                <svg ref={criteriaPartnerSvg2Ref} viewBox="0 0 76 76" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
                  <motion.path fillRule="evenodd" clipRule="evenodd" d="M0 75.8948L6.21264e-06 37.9474L8.29367e-07 1.65872e-06L37.9474 0L75.8948 4.13157e-06V37.9474V75.8948H37.9474H0ZM37.9474 56.9109C37.9531 46.4366 46.4457 37.9474 56.9211 37.9474C46.4423 37.9474 37.9474 29.4526 37.9474 18.9737C37.9474 29.4526 29.4526 37.9474 18.9737 37.9474C29.4492 37.9474 37.9419 46.4366 37.9474 56.9109ZM18.9737 47.8137C24.0036 47.8137 28.0811 51.8912 28.0811 56.9211C28.0811 61.951 24.0036 66.0285 18.9737 66.0285C13.9438 66.0285 9.86633 61.951 9.86633 56.9211C9.86633 51.8912 13.9438 47.8137 18.9737 47.8137ZM28.0811 18.9737C28.0811 24.0036 24.0036 28.0811 18.9737 28.0811C13.9438 28.0811 9.86633 24.0036 9.86633 18.9737C9.86633 13.9438 13.9438 9.86633 18.9737 9.86633C24.0036 9.86633 28.0811 13.9438 28.0811 18.9737ZM47.8137 56.9211C47.8137 51.8912 51.8912 47.8137 56.9211 47.8137C61.951 47.8137 66.0285 51.8912 66.0285 56.9211C66.0285 61.951 61.951 66.0285 56.9211 66.0285C51.8912 66.0285 47.8137 61.951 47.8137 56.9211ZM47.8137 18.9737C47.8137 24.0036 51.8912 28.0811 56.9211 28.0811C61.951 28.0811 66.0285 24.0036 66.0285 18.9737C66.0285 13.9439 61.951 9.86633 56.9211 9.86633C51.8912 9.86633 47.8137 13.9438 47.8137 18.9737Z" fill="#FFF3B5"
                    initial={{ scale: 0, rotate: -90 }}
                    animate={criteriaPartnerSvg2InView ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -90 }}
                    transition={{ duration: 0.6, delay: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </svg>
              </div>
              <div className="relative z-10">
                <h3 className="text-xl md:text-2xl font-bold text-white">Partner Involvement</h3>
              </div>
              <p className="text-white text-base md:text-lg relative z-10 max-w-[95%]">Partners who can dedicate time for weekly meetings and feedback sessions.</p>
            </div>

          </div>
        </div>
      </section>

      {/* How It Works - Horizontal Steps */}
      <section id="how-it-works" className="py-20 md:py-28 px-6 md:px-12 bg-section-bg dark:bg-accent-teal relative overflow-visible">
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-dark-blue mb-4">
              Our Process
            </h2>
            <p className="text-dark-blue/70 text-lg md:text-xl max-w-2xl mx-auto">
              A structured approach that balances learning with delivery. Most projects span two 10-week terms.
            </p>
          </div>

          {/* Horizontal Process Steps */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-4">
            {/* Step 1 - Discover */}
            <div className="relative">
              <div className="bg-white rounded-2xl p-6 h-full shadow-lg hover:shadow-xl transition-shadow text-[#1A3A52]">
                <div className="w-14 h-14 bg-accent-teal rounded-xl flex items-center justify-center text-white text-2xl font-bold mb-4">
                  1
                </div>
                <h3 className="text-xl font-bold mb-2">Discover</h3>
                <p className="opacity-70 text-sm">
                  We dive deep into understanding your users, the problem space, and existing solutions through research and interviews.
                </p>
              </div>
              {/* Arrow */}
              <div className="hidden md:block absolute top-1/2 -right-2 transform -translate-y-1/2 translate-x-full">
                <svg className="w-4 h-4 text-dark-blue/30" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>

            {/* Step 2 - Define */}
            <div className="relative">
              <div className="bg-white rounded-2xl p-6 h-full shadow-lg hover:shadow-xl transition-shadow text-[#1A3A52]">
                <div className="w-14 h-14 bg-accent-coral rounded-xl flex items-center justify-center text-white text-2xl font-bold mb-4">
                  2
                </div>
                <h3 className="text-xl font-bold mb-2">Define</h3>
                <p className="opacity-70 text-sm">
                  We synthesize research into clear problem statements and define the scope, features, and success metrics.
                </p>
              </div>
              <div className="hidden md:block absolute top-1/2 -right-2 transform -translate-y-1/2 translate-x-full">
                <svg className="w-4 h-4 text-dark-blue/30" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>

            {/* Step 3 - Design & Develop */}
            <div className="relative">
              <div className="bg-white rounded-2xl p-6 h-full shadow-lg hover:shadow-xl transition-shadow text-[#1A3A52]">
                <div className="w-14 h-14 bg-accent-pink rounded-xl flex items-center justify-center text-white text-2xl font-bold mb-4">
                  3
                </div>
                <h3 className="text-xl font-bold mb-2">Design & Develop</h3>
                <p className="opacity-70 text-sm">
                  Iterative design and agile development with weekly demos and continuous partner feedback.
                </p>
              </div>
              <div className="hidden md:block absolute top-1/2 -right-2 transform -translate-y-1/2 translate-x-full">
                <svg className="w-4 h-4 text-dark-blue/30" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>

            {/* Step 4 - Deliver */}
            <div>
              <div className="bg-white rounded-2xl p-6 h-full shadow-lg hover:shadow-xl transition-shadow text-[#1A3A52]">
                <div className="w-14 h-14 bg-[#A2D483] rounded-xl flex items-center justify-center text-white text-2xl font-bold mb-4">
                  4
                </div>
                <h3 className="text-xl font-bold mb-2">Deliver</h3>
                <p className="opacity-70 text-sm">
                  Final handoff with full documentation. You own 100% of the code, designs, and intellectual property.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Funding Section */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-white dark:bg-[#061825] relative overflow-visible">
        {/* Decorative block set - top right, overlaying with section above */}
        <div className="absolute right-0 -top-10 w-[100px] h-[140px] md:-top-24 md:w-[240px] md:h-[342px] z-20">
          <svg ref={fundingSvgRef} width="306" height="437" viewBox="0 0 306 437" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
            {/* Flower shape */}
            <g clipPath="url(#clip0_2408_22009)">
              <mask id="mask0_2408_22009" maskUnits="userSpaceOnUse" x="243" y="233" width="48" height="48">
                <path d="M290.037 233.902H243.035V280.352H290.037V233.902Z" fill="white"/>
              </mask>
              <motion.g mask="url(#mask0_2408_22009)"
                initial={{ scale: 0, rotate: -90 }}
                animate={fundingSvgInView ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -90 }}
                transition={{ duration: 0.6, delay: 1.2, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <path fillRule="evenodd" clipRule="evenodd" d="M249.207 257.127C234.353 274.693 248.761 288.932 266.536 274.252C284.308 288.932 298.72 274.68 283.866 257.127C298.72 239.561 284.308 225.322 266.536 240.002C248.761 225.322 234.353 239.561 249.207 257.127ZM266.536 265.72C271.339 265.72 275.232 261.873 275.232 257.127C275.232 252.381 271.339 248.534 266.536 248.534C261.734 248.534 257.841 252.381 257.841 257.127C257.841 261.873 261.734 265.72 266.536 265.72Z" fill="#E45768"/>
              </motion.g>
            </g>
            {/* Squares with staggered animations */}
            <motion.rect x="229.204" y="65.8029" width="76.3096" height="76.3096" fill="#A2D483"
              initial={{ y: -60, opacity: 0 }}
              animate={fundingSvgInView ? { y: 0, opacity: 1 } : { y: -60, opacity: 0 }}
              transition={{ duration: 0.4, delay: 0, ease: "easeOut" }}
            />
            <motion.rect x="76.587" y="142.113" width="76.3096" height="76.3096" fill="#E68FBE"
              initial={{ y: -60, opacity: 0 }}
              animate={fundingSvgInView ? { y: 0, opacity: 1 } : { y: -60, opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
            />
            <motion.rect x="152.897" y="142.113" width="76.3096" height="76.3096" fill="#FFF3B5"
              initial={{ y: -60, opacity: 0 }}
              animate={fundingSvgInView ? { y: 0, opacity: 1 } : { y: -60, opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
            />
            <motion.rect x="229.204" y="142.113" width="76.3096" height="76.3096" fill="#24B1B1"
              initial={{ y: -60, opacity: 0 }}
              animate={fundingSvgInView ? { y: 0, opacity: 1 } : { y: -60, opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
            />
            <motion.rect x="152.988" y="218.146" width="76.3096" height="76.3096" fill="#8CE0D6"
              initial={{ y: -60, opacity: 0 }}
              animate={fundingSvgInView ? { y: 0, opacity: 1 } : { y: -60, opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.25, ease: "easeOut" }}
            />
            <motion.rect x="76.6781" y="294.456" width="76.3096" height="76.3096" fill="#64B598"
              initial={{ y: -60, opacity: 0 }}
              animate={fundingSvgInView ? { y: 0, opacity: 1 } : { y: -60, opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
            />
            <motion.rect x="0.276855" y="218.422" width="76.3096" height="76.3096" fill="#FFF3B5"
              initial={{ y: -60, opacity: 0 }}
              animate={fundingSvgInView ? { y: 0, opacity: 1 } : { y: -60, opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.35, ease: "easeOut" }}
            />
            {/* Circles with pop-in animations */}
            <motion.circle cx="190.589" cy="103.496" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.774" cy="180.544" r="19.0774" fill="#64B598"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.45, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="267.085" cy="179.991" r="19.0774" fill="#F5F9FF"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="268.188" cy="103.682" r="19.0774" fill="#E68FBE"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="37.6004" cy="256.3" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="37.9683" cy="180.176" r="19.0774" fill="#24B1B1"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.65, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.65" cy="256.116" r="19.0774" fill="#FFA89C"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.464" cy="330.399" r="19.0774" fill="#F9C679"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.75, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.464" cy="417.768" r="19.0774" fill="#24B1B1"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="267.085" cy="19.0774" r="19.0774" fill="#FFF3B5"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.85, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.464" cy="103.682" r="19.0774" fill="#0C4B78"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.589" cy="256.116" r="19.0774" fill="#404040"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 0.95, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.498" cy="332.887" r="19.0774" fill="#E68FBE"
              initial={{ scale: 0 }}
              animate={fundingSvgInView ? { scale: 1 } : { scale: 0 }}
              transition={{ duration: 0.4, delay: 1.0, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Ring shape */}
            <g clipPath="url(#clip1_2408_22009)">
              <mask id="mask1_2408_22009" maskUnits="userSpaceOnUse" x="95" y="160" width="39" height="40">
                <path d="M133.545 160.914H95.3906V199.069H133.545V160.914Z" fill="white"/>
              </mask>
              <motion.g mask="url(#mask1_2408_22009)"
                initial={{ scale: 0, rotate: 180 }}
                animate={fundingSvgInView ? { scale: 1, rotate: 0 } : { scale: 0, rotate: 180 }}
                transition={{ duration: 0.5, delay: 1.05, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <path fillRule="evenodd" clipRule="evenodd" d="M114.468 199.069C125.004 199.069 133.545 190.528 133.545 179.991C133.545 169.455 125.004 160.914 114.468 160.914C103.932 160.914 95.3906 169.455 95.3906 179.991C95.3906 190.528 103.932 199.069 114.468 199.069ZM114.468 188.338C119.078 188.338 122.814 184.601 122.814 179.991C122.814 175.382 119.078 171.645 114.468 171.645C109.858 171.645 106.122 175.382 106.122 179.991C106.122 184.601 109.858 188.338 114.468 188.338Z" fill="#092940"/>
              </motion.g>
            </g>
            {/* Teal ring */}
            <g clipPath="url(#clip2_2408_22009)">
              <mask id="mask2_2408_22009" maskUnits="userSpaceOnUse" x="17" y="311" width="40" height="39">
                <path d="M56.1314 311.32H17.9766L17.9766 349.475H56.1314V311.32Z" fill="white"/>
              </mask>
              <motion.g mask="url(#mask2_2408_22009)"
                initial={{ scale: 0, rotate: -180 }}
                animate={fundingSvgInView ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
                transition={{ duration: 0.5, delay: 1.1, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <path fillRule="evenodd" clipRule="evenodd" d="M37.054 349.475C47.59 349.475 56.1314 340.934 56.1314 330.398C56.1314 319.862 47.59 311.32 37.054 311.32C26.5178 311.32 17.9766 319.862 17.9766 330.398C17.9766 340.934 26.5178 349.475 37.054 349.475ZM37.054 338.744C41.6635 338.744 45.4003 335.007 45.4003 330.398C45.4003 325.788 41.6635 322.051 37.054 322.051C32.4444 322.051 28.7076 325.788 28.7076 330.398C28.7076 335.007 32.4444 338.744 37.054 338.744Z" fill="#8CE0D6"/>
              </motion.g>
            </g>
            <defs>
              <clipPath id="clip0_2408_22009">
                <rect width="47.0023" height="46.4493" fill="white" transform="translate(243.035 233.902)"/>
              </clipPath>
              <clipPath id="clip1_2408_22009">
                <rect width="38.1548" height="38.1548" fill="white" transform="translate(95.3906 160.914)"/>
              </clipPath>
              <clipPath id="clip2_2408_22009">
                <rect width="38.1548" height="38.1548" fill="white" transform="translate(17.9766 311.32)"/>
              </clipPath>
            </defs>
          </svg>
        </div>
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4 text-[#64B598]">
              Funding
            </h2>
            <p className="text-dark-blue/70 text-lg md:text-xl max-w-3xl">
              All students are paid employees of the college. Partnership fees go directly to pay the students on the team and the student mentors.  Our programmatic and overhead costs are covered by internal and gift funding and are not part of the fee structure.
            </p>
          </div>

          {/* Two-column pricing layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16 lg:gap-24">
            {/* Full Team */}
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-accent-teal text-5xl md:text-6xl lg:text-7xl font-bold">$18K</span>
                <span className="text-[#CA60AC] text-lg font-medium">per 10-week term</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-bold text-dark-blue mb-6">Full Team</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-3 text-dark-blue">
                  <svg className="w-5 h-5 text-[#A2D483] flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span><strong className="text-accent-teal">6-8</strong> dedicated students</span>
                </li>
                <li className="flex items-start gap-3 text-dark-blue">
                  <svg className="w-5 h-5 text-[#A2D483] flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Full <strong className="text-[#CA60AC]">design</strong> & <strong className="text-accent-coral">development</strong> capacity</span>
                </li>
                <li className="flex items-start gap-3 text-dark-blue">
                  <svg className="w-5 h-5 text-[#A2D483] flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Weekly partner meetings</span>
                </li>
              </ul>
            </div>

            {/* Half Team */}
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-accent-coral text-5xl md:text-6xl lg:text-7xl font-bold">$9K</span>
                <span className="text-[#CA60AC] text-lg font-medium">per 10-week term</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-bold text-dark-blue mb-6">Half Team</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-3 text-dark-blue">
                  <svg className="w-5 h-5 text-[#E68FBE] flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span><strong className="text-accent-coral">3-4</strong> dedicated students</span>
                </li>
                <li className="flex items-start gap-3 text-dark-blue">
                  <svg className="w-5 h-5 text-[#E68FBE] flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Ideal for <strong className="text-accent-teal">focused</strong> projects</span>
                </li>
                <li className="flex items-start gap-3 text-dark-blue">
                  <svg className="w-5 h-5 text-[#E68FBE] flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Weekly partner meetings</span>
                </li>
              </ul>
            </div>
          </div>

          <p className="text-dark-blue/70 text-base mt-12 max-w-3xl">
            Most projects span <strong className="text-accent-teal">two terms</strong>. Funding assistance and grant documentation available upon request.
          </p>
        </div>
      </section>

      {/* Our Expertise Section */}
      <section className="py-12 md:py-16 px-6 md:px-12 bg-accent-coral relative overflow-visible">
        {/* Decorative SVG - right side, overlapping above section */}
        <div className="absolute right-0 -top-20 md:-top-32 w-[180px] h-[224px] md:w-[250px] md:h-[310px] z-20 hidden md:block">
          <svg ref={expertiseSvgRef} width="306" height="381" viewBox="0 0 306 381" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
            {/* Yellow asterisk */}
            <motion.path d="M147.092 270.463L147.092 263.151L123.016 263.151L140.04 246.127L134.87 240.957L117.846 257.981L117.846 233.906L110.534 233.906L110.534 257.981L93.51 240.957L88.34 246.127L105.364 263.151L81.2883 263.151L81.2883 270.463L105.364 270.463L88.34 287.487L93.51 292.657L110.534 275.633L110.534 299.709L117.846 299.709L117.846 275.633L134.87 292.657L140.04 287.487L123.016 270.463L147.092 270.463Z" fill="#FFF3B5"
              initial={{ scale: 0, rotate: -180 }}
              animate={expertiseSvgInView ? {scale: 1, rotate: 0} : {scale: 0, rotate: -180}}
              transition={{ duration: 0.6, delay: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Dark blue rect */}
            <motion.rect x="305.24" y="228.929" width="76.3096" height="76.3096" transform="rotate(90 305.24 228.929)" fill="#0C4B78"
              initial={{ opacity: 0 }}
              animate={expertiseSvgInView ? {opacity: 1} : {opacity: 0}}
              transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
            />
            {/* Light green rect */}
            <motion.rect x="228.93" y="76.3093" width="76.3096" height="76.3096" transform="rotate(90 228.93 76.3093)" fill="#A2D483"
              initial={{ opacity: 0 }}
              animate={expertiseSvgInView ? {opacity: 1} : {opacity: 0}}
              transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
            />
            {/* Yellow rect */}
            <motion.rect x="228.93" y="152.619" width="76.3096" height="76.3096" transform="rotate(90 228.93 152.619)" fill="#FFF3B5"
              initial={{ opacity: 0 }}
              animate={expertiseSvgInView ? {opacity: 1} : {opacity: 0}}
              transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
            />
            {/* Green rect */}
            <motion.rect x="228.93" y="228.929" width="76.3096" height="76.3096" transform="rotate(90 228.93 228.929)" fill="#64B598"
              initial={{ opacity: 0 }}
              animate={expertiseSvgInView ? {opacity: 1} : {opacity: 0}}
              transition={{ duration: 0.4, delay: 0.25, ease: "easeOut" }}
            />
            {/* Orange rect */}
            <motion.rect x="152.62" y="152.988" width="76.3096" height="76.3096" transform="rotate(90 152.62 152.988)" fill="#F9C679"
              initial={{ opacity: 0 }}
              animate={expertiseSvgInView ? {opacity: 1} : {opacity: 0}}
              transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
            />
            {/* Peach rect */}
            <motion.rect x="76.3097" y="76.679" width="76.3096" height="76.3096" transform="rotate(90 76.3097 76.679)" fill="#FFA89C"
              initial={{ opacity: 0 }}
              animate={expertiseSvgInView ? {opacity: 1} : {opacity: 0}}
              transition={{ duration: 0.4, delay: 0.35, ease: "easeOut" }}
            />
            {/* Pink rect */}
            <motion.rect x="152.62" y="304.685" width="76.3096" height="76.3096" transform="rotate(90 152.62 304.685)" fill="#E68FBE"
              initial={{ opacity: 0 }}
              animate={expertiseSvgInView ? {opacity: 1} : {opacity: 0}}
              transition={{ duration: 0.4, delay: 0.4, ease: "easeOut" }}
            />
            {/* Teal rect */}
            <motion.rect x="152.07" y="1.33425e-05" width="76.3096" height="76.3096" transform="rotate(90 152.07 1.33425e-05)" fill="#8CE0D6"
              initial={{ opacity: 0 }}
              animate={expertiseSvgInView ? {opacity: 1} : {opacity: 0}}
              transition={{ duration: 0.4, delay: 0.05, ease: "easeOut" }}
            />
            {/* Circles with pop-in animations */}
            <motion.circle cx="114.652" cy="342.657" r="19.0774" fill="#0C4B78"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="267.272" cy="190.589" r="19.0774" fill="#4CD5C5"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.59" cy="266.898" r="19.0774" fill="#FFA89C"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="267.363" cy="267.361" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.65, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.59" cy="114.65" r="19.0774" fill="#092940"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.59" cy="37.9692" r="19.0774" fill="#FAC27D"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.75, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.652" cy="114.65" r="19.0774" fill="#0C4B78"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.652" cy="190.589" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.85, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="37.9698" cy="114.65" r="19.0774" fill="#F5F9FF"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="37.8788" cy="190.498" r="19.0774" fill="#E45768"
              initial={{ scale: 0 }}
              animate={expertiseSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.95, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Green ring */}
            <g clipPath="url(#clip0_expertise)">
              <mask id="mask0_expertise" maskUnits="userSpaceOnUse" x="95" y="18" width="39" height="39">
                <path d="M133.268 56.9564L133.268 18.8016L95.1128 18.8016L95.1128 56.9564L133.268 56.9564Z" fill="white"/>
              </mask>
              <motion.g mask="url(#mask0_expertise)"
                initial={{ scale: 0, rotate: 180 }}
                animate={expertiseSvgInView ? {scale: 1, rotate: 0} : {scale: 0, rotate: 180}}
                transition={{ duration: 0.5, delay: 1.0, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <path fillRule="evenodd" clipRule="evenodd" d="M95.1128 37.879C95.1128 48.4151 103.654 56.9564 114.19 56.9564C124.726 56.9564 133.268 48.4151 133.268 37.879C133.268 27.3429 124.726 18.8016 114.19 18.8016C103.654 18.8016 95.1128 27.3429 95.1128 37.879ZM105.844 37.879C105.844 42.4885 109.581 46.2254 114.19 46.2254C118.8 46.2254 122.537 42.4885 122.537 37.879C122.537 33.2694 118.8 29.5327 114.19 29.5327C109.581 29.5327 105.844 33.2694 105.844 37.879Z" fill="#64B598"/>
              </motion.g>
            </g>
            {/* Teal flower */}
            <g clipPath="url(#clip1_expertise)">
              <mask id="mask1_expertise" maskUnits="userSpaceOnUse" x="166" y="166" width="49" height="49">
                <path d="M214.553 214.552L214.553 166.997L166.997 166.997L166.997 214.552L214.553 214.552Z" fill="white"/>
              </mask>
              <motion.g mask="url(#mask1_expertise)"
                initial={{ scale: 0, rotate: -180 }}
                animate={expertiseSvgInView ? {scale: 1, rotate: 0} : {scale: 0, rotate: -180}}
                transition={{ duration: 0.6, delay: 1.05, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <path fillRule="evenodd" clipRule="evenodd" d="M190.776 181.579C170.45 153.987 153.977 170.46 181.575 190.779C153.977 211.086 170.45 227.559 190.776 199.979C211.099 227.572 227.575 211.098 199.974 190.779C227.566 170.448 211.099 153.974 190.776 181.579ZM184.831 190.775C184.831 194.058 187.492 196.719 190.775 196.719C194.058 196.719 196.72 194.058 196.72 190.775C196.72 187.492 194.058 184.83 190.775 184.83C187.492 184.83 184.831 187.492 184.831 190.775Z" fill="#24B1B1"/>
              </motion.g>
            </g>
            <defs>
              <clipPath id="clip0_expertise">
                <rect width="38.1548" height="38.1548" fill="white" transform="translate(133.268 18.8016) rotate(90)"/>
              </clipPath>
              <clipPath id="clip1_expertise">
                <rect width="47.5553" height="47.5553" fill="white" transform="translate(214.553 166.997) rotate(90)"/>
              </clipPath>
            </defs>
          </svg>
        </div>

        <div className="max-w-7xl mx-auto">
          {/* Section Header */}
          <div className="text-center mb-10">
            <motion.h2
              ref={whatWeBuildTitleRef}
              className="text-3xl md:text-4xl lg:text-5xl font-bold text-white"
              initial={{ opacity: 0, y: 15 }}
              animate={whatWeBuildTitleInView ? {opacity: 1, y: 0} : {opacity: 0, y: 15}}
              transition={{ duration: 0.4 }}
            >
              What We Build
            </motion.h2>
            <motion.p
              ref={whatWeBuildSubRef}
              className="text-white/80 text-lg mt-4 max-w-2xl mx-auto"
              initial={{ opacity: 0, y: 15 }}
              animate={whatWeBuildSubInView ? {opacity: 1, y: 0} : {opacity: 0, y: 15}}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              From web apps to physical products, our teams tackle diverse technical challenges.
            </motion.p>
          </div>

          {/* Expertise Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {/* Web Platforms */}
            <motion.div
              ref={expertiseCard1Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard1InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-accent-coral"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-accent-coral/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-accent-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold">Web Platforms</h3>
              </div>
            </motion.div>

            {/* Mobile Apps */}
            <motion.div
              ref={expertiseCard2Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard2InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.05 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-accent-teal"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-accent-teal/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">Mobile Apps</h3>
              </div>
            </motion.div>

            {/* AI-Powered Applications */}
            <motion.div
              ref={expertiseCard3Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard3InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#CA60AC]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#CA60AC]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#CA60AC]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">AI-Powered Apps</h3>
              </div>
            </motion.div>

            {/* Data Science */}
            <motion.div
              ref={expertiseCard4Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard4InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.15 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#1A3A52]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#1A3A52]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#1A3A52]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">Data Science</h3>
              </div>
            </motion.div>

            {/* AR/VR & Games */}
            <motion.div
              ref={expertiseCard5Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard5InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#A2D483]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#A2D483]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#A2D483]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">AR/VR & Games</h3>
              </div>
            </motion.div>

            {/* Scientific Visualizations */}
            <motion.div
              ref={expertiseCard6Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard6InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.25 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#F9C679]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#F9C679]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#F9C679]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">Scientific Viz</h3>
              </div>
            </motion.div>

            {/* UI/UX Design */}
            <motion.div
              ref={expertiseCard7Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard7InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-accent-pink"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-accent-pink/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-accent-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">UI/UX Design</h3>
              </div>
            </motion.div>

            {/* Graphic & Motion Design */}
            <motion.div
              ref={expertiseCard8Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard8InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.35 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#E68FBE]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#E68FBE]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#E68FBE]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">Motion Design</h3>
              </div>
            </motion.div>

            {/* Physical Product Design */}
            <motion.div
              ref={expertiseCard9Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard9InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.4 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#509C81]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#509C81]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#509C81]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">Product Design</h3>
              </div>
            </motion.div>

            {/* Electronics */}
            <motion.div
              ref={expertiseCard10Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard10InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.45 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#64B598]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#64B598]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#64B598]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">Electronics</h3>
              </div>
            </motion.div>

            {/* Digital Sensing */}
            <motion.div
              ref={expertiseCard11Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard11InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.5 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#8CE0D6]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#8CE0D6]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#8CE0D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">Digital Sensing</h3>
              </div>
            </motion.div>

            {/* Communications Platforms */}
            <motion.div
              ref={expertiseCard12Ref}
              className="group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-[#1A3A52]"
              initial={{ opacity: 0, y: 20 }}
              animate={expertiseCard12InView ? {opacity: 1, y: 0} : {opacity: 0, y: 20}}
              transition={{ duration: 0.4, delay: 0.55 }}
            >
              <div className="absolute left-0 top-0 w-1 h-full bg-[#FFA89C]"></div>
              <div className="p-4">
                <div className="w-10 h-10 bg-[#FFA89C]/10 rounded-lg flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#FFA89C]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A3A52]">Communications</h3>
              </div>
            </motion.div>
          </div>

          {/* Explore Projects Link */}
          <motion.div
            ref={exploreProjectsRef}
            className="text-center mt-10"
            initial={{ opacity: 0, y: 15 }}
            animate={exploreProjectsInView ? {opacity: 1, y: 0} : {opacity: 0, y: 15}}
            transition={{ duration: 0.4, delay: 0.6 }}
          >
            <Link
              to="/projects"
              className="inline-flex items-center gap-2 text-white font-semibold hover:underline underline-offset-4"
            >
              Explore our projects
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-section-bg relative overflow-visible">
        {/* Decorative SVG - top */}
        <div className="absolute left-0 -top-8 w-[75px] h-[73px] md:-top-20 md:w-[186px] md:h-[181px] z-20">
          <svg ref={faqTopSvgRef} width="186" height="181" viewBox="0 0 186 181" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
            {/* Green main square */}
            <motion.rect x="46.2004" y="44.9576" width="92.8488" height="90.3544" fill="#509C81"
              initial={{ scale: 0, opacity: 0 }}
              animate={faqTopSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ duration: 0.5, delay: 0, ease: "easeOut" }}
            />
            {/* Concentric circles pattern */}
            <motion.path fillRule="evenodd" clipRule="evenodd" d="M94.4349 127.819C115.572 127.819 132.707 111.145 132.707 90.5757C132.707 70.0066 115.572 53.3321 94.4349 53.3321C73.298 53.3321 56.1631 70.0066 56.1631 90.5757C56.1631 111.145 73.298 127.819 94.4349 127.819ZM94.4349 123.35C113.035 123.35 128.114 108.677 128.114 90.5757C128.114 72.4749 113.035 57.8013 94.4349 57.8013C75.8344 57.8013 60.7557 72.4749 60.7557 90.5757C60.7557 108.677 75.8344 123.35 94.4349 123.35ZM94.4349 118.881C110.499 118.881 123.522 106.208 123.522 90.5757C123.522 74.9432 110.499 62.2706 94.4349 62.2706C78.3709 62.2706 65.3484 74.9432 65.3484 90.5757C65.3484 106.208 78.3709 118.881 94.4349 118.881ZM94.4349 114.412C107.963 114.412 118.929 103.74 118.929 90.5757C118.929 77.4115 107.963 66.7398 94.4349 66.7398C80.9073 66.7398 69.941 77.4115 69.941 90.5757C69.941 103.74 80.9073 114.412 94.4349 114.412ZM114.336 90.5757C114.336 101.272 105.426 109.942 94.4349 109.942C83.4437 109.942 74.5336 101.272 74.5336 90.5757C74.5336 79.8798 83.4437 71.209 94.4349 71.209C105.426 71.209 114.336 79.8798 114.336 90.5757ZM109.744 90.5757C109.744 98.8032 102.89 105.473 94.4349 105.473C85.9802 105.473 79.1262 98.8032 79.1262 90.5757C79.1262 82.3481 85.9802 75.6783 94.4349 75.6783C102.89 75.6783 109.744 82.3481 109.744 90.5757Z" fill="#A2D483"
              initial={{ scale: 0, rotate: 180 }}
              animate={faqTopSvgInView ? {scale: 1, rotate: 0} : {scale: 0, rotate: 180}}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Light green square */}
            <motion.rect x="139.048" y="135.311" width="46.1979" height="44.9568" fill="#A2D483"
              initial={{ y: -40, opacity: 0 }}
              animate={faqTopSvgInView ? {y: 0, opacity: 1} : {y: -40, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
            />
            {/* Teal square */}
            <motion.rect x="46.2004" y="8.39233e-05" width="46.1979" height="44.9568" fill="#8CE0D6"
              initial={{ y: -40, opacity: 0 }}
              animate={faqTopSvgInView ? {y: 0, opacity: 1} : {y: -40, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
            />
            {/* Dark blue ellipse */}
            <motion.ellipse cx="69.5243" cy="22.2583" rx="12.0024" ry="11.68" fill="#0B1C29"
              initial={{ scale: 0 }}
              animate={faqTopSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Yellow ellipse */}
            <motion.ellipse cx="162.375" cy="22.2583" rx="12.0024" ry="11.68" fill="#FFF3B5"
              initial={{ scale: 0 }}
              animate={faqTopSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Peach square */}
            <motion.rect y="44.9578" width="46.1979" height="44.9568" fill="#FFA89C"
              initial={{ x: -40, opacity: 0 }}
              animate={faqTopSvgInView ? {x: 0, opacity: 1} : {x: -40, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
            />
            {/* Red ellipse */}
            <motion.ellipse cx="22.8719" cy="67.215" rx="12.0024" ry="11.68" fill="#E45768"
              initial={{ scale: 0 }}
              animate={faqTopSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
            />
          </svg>
        </div>

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="mb-16">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-dark-blue mb-4">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
            {/* FAQ 1 */}
            <div className="bg-white rounded-3xl p-8 md:p-10 flex gap-6 text-[#1A3A52]">
              <div className="w-16 h-16 bg-accent-coral rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-3">What is DALI?</h3>
                <p className="opacity-70 text-base leading-relaxed">
                  DALI is an experiential learning lab at Dartmouth where students work on real projects for real partners. We combine human-centered design with agile development to build products that matter.
                </p>
              </div>
            </div>

            {/* FAQ 2 */}
            <div className="bg-white rounded-3xl p-8 md:p-10 flex gap-6 text-[#1A3A52]">
              <div className="w-16 h-16 bg-accent-teal rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-3">How long do projects last?</h3>
                <p className="opacity-70 text-base leading-relaxed">
                  We scope our projects in 10-week sprints with deliverables for each term so you can plan. Projects range from 1 - ∞ terms, but the majority fall in the 2-3 10-week scope range to build a reasonably complex and production ready system.
                </p>
              </div>
            </div>

            {/* FAQ 3 */}
            <div className="bg-white rounded-3xl p-8 md:p-10 flex gap-6 text-[#1A3A52]">
              <div className="w-16 h-16 bg-accent-pink rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-3">What's my involvement as a partner?</h3>
                <p className="opacity-70 text-base leading-relaxed">
                  Partners attend weekly meetings to provide feedback, answer questions, and guide direction. You're a key collaborator — your domain expertise helps students build the right solution.
                </p>
              </div>
            </div>

            {/* FAQ 4 */}
            <div className="bg-white rounded-3xl p-8 md:p-10 flex gap-6 text-[#1A3A52]">
              <div className="w-16 h-16 bg-[#A2D483] rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-3">Who owns the intellectual property?</h3>
                <p className="opacity-70 text-base leading-relaxed">
                  You do. 100% of the code, designs, research, and all deliverables belong to you. No royalties, no licensing fees, no strings attached.
                </p>
              </div>
            </div>

            {/* FAQ 5 */}
            <div className="bg-white rounded-3xl p-8 md:p-10 flex gap-6 text-[#1A3A52]">
              <div className="w-16 h-16 bg-[#1A3A52] rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-3">Who are your partners?</h3>
                <p className="opacity-70 text-base leading-relaxed">
                  We work with Dartmouth faculty, departments, startups, nonprofits, and established companies. If you have an idea that could benefit from student talent and fresh perspectives, we'd love to hear from you.
                </p>
              </div>
            </div>

            {/* FAQ 6 */}
            <div className="bg-white rounded-3xl p-8 md:p-10 flex gap-6 text-[#1A3A52]">
              <div className="w-16 h-16 bg-[#CA60AC] rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-3">What about post-term support?</h3>
                <p className="opacity-70 text-base leading-relaxed">
                  We offer continued support after project completion. Within 30 days, support is $30/hour. After 90 days, it's $50/hour. We're committed to your project's long-term success.
                </p>
              </div>
            </div>

            {/* FAQ 7 */}
            <div className="bg-white rounded-3xl p-8 md:p-10 flex gap-6 md:col-span-2 text-[#1A3A52]">
              <div className="w-16 h-16 bg-[#8CE0D6] rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-3">Do we use AI?</h3>
                <p className="opacity-70 text-base leading-relaxed">
                  Many of our projects are AI enabled projects: chatbots, machine learning platforms, data processing and sensing. We also use AI thoughtfully in our process and work hard to ensure quality outputs. We balance hand-crafting code and designs with the efficiencies of AI agents enabling us to move more quickly and architect more complex solutions.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative SVG - bottom right */}
        <div className="absolute right-0 -bottom-20 w-[85px] h-[85px] md:-bottom-48 md:w-[220px] md:h-[220px] z-20">
          <svg ref={faqBottomSvgRef} width="306" height="306" viewBox="0 0 306 306" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
            {/* Yellow asterisk */}
            <motion.path d="M270.464 158.149H263.153V182.225L246.129 165.201L240.959 170.371L257.983 187.395H233.907V194.707H257.983L240.959 211.731L246.129 216.901L263.153 199.877V223.952H270.464V199.877L287.489 216.901L292.659 211.731L275.634 194.707H299.71V187.395H275.634L292.659 170.371L287.489 165.201L270.464 182.225V158.149Z" fill="#FFF3B5"
              initial={{ scale: 0, rotate: -180 }}
              animate={faqBottomSvgInView ? {scale: 1, rotate: 0} : {scale: 0, rotate: -180}}
              transition={{ duration: 0.6, delay: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Teal asterisk */}
            <motion.path d="M117.844 4.97699H110.533V29.0529L93.5083 12.0287L88.3383 17.1987L105.363 34.2229H81.2867V41.5343H105.363L88.3384 58.5586L93.5083 63.7286L110.533 46.7043V70.7802H117.844V46.7043L134.868 63.7286L140.038 58.5586L123.014 41.5343H147.09V34.2229H123.014L140.038 17.1986L134.868 12.0287L117.844 29.0529V4.97699Z" fill="#8CE0D6"
              initial={{ scale: 0, rotate: 180 }}
              animate={faqBottomSvgInView ? {scale: 1, rotate: 0} : {scale: 0, rotate: 180}}
              transition={{ duration: 0.6, delay: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Red square */}
            <motion.rect x="228.931" width="76.3096" height="76.3096" fill="#E45768"
              initial={{ y: -50, opacity: 0 }}
              animate={faqBottomSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ duration: 0.4, delay: 0, ease: "easeOut" }}
            />
            {/* Pink square */}
            <motion.rect x="76.3102" y="76.3093" width="76.3096" height="76.3096" fill="#E68FBE"
              initial={{ y: -50, opacity: 0 }}
              animate={faqBottomSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }}
            />
            {/* Yellow square */}
            <motion.rect x="152.62" y="76.3093" width="76.3096" height="76.3096" fill="#FFF3B5"
              initial={{ y: -50, opacity: 0 }}
              animate={faqBottomSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.12, ease: "easeOut" }}
            />
            {/* Green square */}
            <motion.rect x="228.931" y="76.3093" width="76.3096" height="76.3096" fill="#A2D483"
              initial={{ y: -50, opacity: 0 }}
              animate={faqBottomSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.16, ease: "easeOut" }}
            />
            {/* Teal square */}
            <motion.rect x="152.988" y="152.619" width="76.3096" height="76.3096" fill="#8CE0D6"
              initial={{ y: -50, opacity: 0 }}
              animate={faqBottomSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
            />
            {/* Dark blue square */}
            <motion.rect x="76.6781" y="228.929" width="76.3096" height="76.3096" fill="#0C4B78"
              initial={{ y: -50, opacity: 0 }}
              animate={faqBottomSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.24, ease: "easeOut" }}
            />
            {/* Red/coral square */}
            <motion.rect y="153.172" width="76.3096" height="76.3096" fill="#F97979"
              initial={{ x: -50, opacity: 0 }}
              animate={faqBottomSvgInView ? {x: 0, opacity: 1} : {x: -50, opacity: 0}}
              transition={{ duration: 0.4, delay: 0.28, ease: "easeOut" }}
            />
            {/* Circles */}
            <motion.circle cx="190.589" cy="37.9692" r="19.0774" fill="#0C4B78"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.32, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.498" cy="114.741" r="19.0774" fill="#092940"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.36, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="266.899" cy="114.65" r="19.0774" fill="#24B1B1"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="267.361" cy="37.8781" r="19.0774" fill="#FFA89C"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.44, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.65" cy="114.65" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.48, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="37.9683" cy="114.65" r="19.0774" fill="#FAC27D"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.52, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.65" cy="190.589" r="19.0774" fill="#24B1B1"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.56, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.589" cy="190.589" r="19.0774" fill="#404040"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.498" cy="267.361" r="19.0774" fill="#8CE0D6"
              initial={{ scale: 0 }}
              animate={faqBottomSvgInView ? {scale: 1} : {scale: 0}}
              transition={{ duration: 0.4, delay: 0.64, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Ring shape */}
            <g clipPath="url(#clip0_2408_21935)">
              <mask id="mask0_2408_21935" maskUnits="userSpaceOnUse" x="18" y="171" width="39" height="39">
                <path d="M56.9556 171.42H18.8008V209.575H56.9556V171.42Z" fill="white"/>
              </mask>
              <motion.g mask="url(#mask0_2408_21935)"
                initial={{ scale: 0, rotate: 180 }}
                animate={faqBottomSvgInView ? {scale: 1, rotate: 0} : {scale: 0, rotate: 180}}
                transition={{ duration: 0.5, delay: 0.68, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <path fillRule="evenodd" clipRule="evenodd" d="M37.8782 209.575C48.4143 209.575 56.9556 201.033 56.9556 190.497C56.9556 179.961 48.4143 171.42 37.8782 171.42C27.342 171.42 18.8008 179.961 18.8008 190.497C18.8008 201.033 27.342 209.575 37.8782 209.575ZM37.8782 198.844C42.4877 198.844 46.2246 195.107 46.2246 190.497C46.2246 185.888 42.4877 182.151 37.8782 182.151C33.2686 182.151 29.5318 185.888 29.5318 190.497C29.5318 195.107 33.2686 198.844 37.8782 198.844Z" fill="#FFF3B5"/>
              </motion.g>
            </g>
            {/* Magenta flower */}
            <motion.path fillRule="evenodd" clipRule="evenodd" d="M109.031 244.702C110.939 246.61 112.774 249.643 114.107 252.912C115.456 249.4 117.405 246.09 119.438 244.058C124.227 239.268 131.293 240.807 135.465 244.979C139.636 249.15 141.728 255.663 136.386 261.006C133.998 263.394 130.407 265.48 126.731 266.795C130.73 268.134 134.646 270.32 136.938 272.612C141.728 277.402 140.188 284.467 136.017 288.639C131.846 292.81 125.332 294.902 119.99 289.56C117.533 287.103 115.395 283.372 114.089 279.586C112.77 283.179 110.722 286.669 108.384 289.006C103.042 294.349 96.5288 292.257 92.3574 288.085C88.1861 283.914 86.6467 276.848 91.4363 272.058C93.4323 270.062 96.6599 268.146 100.101 266.801C97.0172 265.495 94.1149 263.682 92.0834 261.65C86.7411 256.308 88.8331 249.795 93.0045 245.624C97.1759 241.452 104.242 239.913 109.031 244.702ZM121.628 259.567C117.518 263.511 111.043 263.556 106.879 259.67C110.822 263.78 110.867 270.255 106.981 274.419C111.091 270.476 117.566 270.431 121.73 274.317C117.787 270.207 117.742 263.732 121.628 259.567Z" fill="#CA60AC"
              initial={{ scale: 0, rotate: -90 }}
              animate={faqBottomSvgInView ? {scale: 1, rotate: 0} : {scale: 0, rotate: -90}}
              transition={{ duration: 0.6, delay: 0.72, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <defs>
              <clipPath id="clip0_2408_21935">
                <rect width="38.1548" height="38.1548" fill="white" transform="translate(18.8008 171.42)"/>
              </clipPath>
            </defs>
          </svg>
        </div>
      </section>

      {/* Other Ways to Work With Us Section */}
      <section id="sponsorship" className="py-20 md:py-28 px-6 md:px-12 bg-white dark:bg-[#061825] relative overflow-visible">
        {/* Decorative SVG - aligned to screen edge */}
        <div className="hidden md:block absolute left-0 -top-20 md:-top-32 w-[85px] h-[106px] md:w-[220px] md:h-[274px]">
          <svg ref={sponsorshipSvgRef} width="306" height="381" viewBox="0 0 306 381" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: 'visible' }}>
            {/* Star shape */}
            <motion.path
              d="M147.092 270.463L147.092 263.151L123.016 263.151L140.04 246.127L134.87 240.957L117.846 257.981L117.846 233.906L110.534 233.906L110.534 257.981L93.51 240.957L88.34 246.127L105.364 263.151L81.2883 263.151L81.2883 270.463L105.364 270.463L88.34 287.487L93.51 292.657L110.534 275.633L110.534 299.709L117.846 299.709L117.846 275.633L134.87 292.657L140.04 287.487L123.016 270.463L147.092 270.463Z"
              fill="#FFF3B5"
              initial={{ scale: 0, rotate: -90, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, rotate: 0, opacity: 1} : {scale: 0, rotate: -90, opacity: 0}}
              transition={{ delay: 0.5, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Rectangles */}
            <motion.rect x="228.9304" y="228.929" width="76.3096" height="76.3096" fill="#0C4B78"
              initial={{ y: -50, opacity: 0 }}
              animate={sponsorshipSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ delay: 0, duration: 0.4, ease: "easeOut" }}
            />
            <motion.rect x="152.6204" y="76.3093" width="76.3096" height="76.3096" fill="#A2D483"
              initial={{ y: -50, opacity: 0 }}
              animate={sponsorshipSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ delay: 0.08, duration: 0.4, ease: "easeOut" }}
            />
            <motion.rect x="152.6204" y="152.619" width="76.3096" height="76.3096" fill="#FFF3B5"
              initial={{ y: -50, opacity: 0 }}
              animate={sponsorshipSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ delay: 0.16, duration: 0.4, ease: "easeOut" }}
            />
            <motion.rect x="152.6204" y="228.929" width="76.3096" height="76.3096" fill="#64B598"
              initial={{ y: -50, opacity: 0 }}
              animate={sponsorshipSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ delay: 0.24, duration: 0.4, ease: "easeOut" }}
            />
            <motion.rect x="76.3104" y="152.988" width="76.3096" height="76.3096" fill="#F9C679"
              initial={{ y: -50, opacity: 0 }}
              animate={sponsorshipSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ delay: 0.32, duration: 0.4, ease: "easeOut" }}
            />
            <motion.rect x="0.0001" y="76.679" width="76.3096" height="76.3096" fill="#FFA89C"
              initial={{ y: -50, opacity: 0 }}
              animate={sponsorshipSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ delay: 0.4, duration: 0.4, ease: "easeOut" }}
            />
            <motion.rect x="76.3104" y="304.685" width="76.3096" height="76.3096" fill="#E68FBE"
              initial={{ y: -50, opacity: 0 }}
              animate={sponsorshipSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ delay: 0.48, duration: 0.4, ease: "easeOut" }}
            />
            <motion.rect x="75.7604" y="1.33425e-05" width="76.3096" height="76.3096" fill="#8CE0D6"
              initial={{ y: -50, opacity: 0 }}
              animate={sponsorshipSvgInView ? {y: 0, opacity: 1} : {y: -50, opacity: 0}}
              transition={{ delay: 0.56, duration: 0.4, ease: "easeOut" }}
            />
            {/* Circles */}
            <motion.circle cx="114.652" cy="342.657" r="19.0774" fill="#0C4B78"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.1, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="267.272" cy="190.589" r="19.0774" fill="#4CD5C5"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.18, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.59" cy="266.898" r="19.0774" fill="#FFA89C"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.26, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="267.363" cy="267.361" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.34, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.59" cy="114.65" r="19.0774" fill="#092940"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.42, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="190.59" cy="37.9692" r="19.0774" fill="#FAC27D"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.5, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.652" cy="114.65" r="19.0774" fill="#0C4B78"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.58, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="114.652" cy="190.589" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.66, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="37.9698" cy="114.65" r="19.0774" fill="#F5F9FF"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.74, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            <motion.circle cx="37.8788" cy="190.498" r="19.0774" fill="#E45768"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.82, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Ring shape */}
            <motion.path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M95.1128 37.879C95.1128 48.4151 103.654 56.9564 114.19 56.9564C124.726 56.9564 133.268 48.4151 133.268 37.879C133.268 27.3429 124.726 18.8016 114.19 18.8016C103.654 18.8016 95.1128 27.3429 95.1128 37.879ZM105.844 37.879C105.844 42.4885 109.581 46.2254 114.19 46.2254C118.8 46.2254 122.537 42.4885 122.537 37.879C122.537 33.2694 118.8 29.5327 114.19 29.5327C109.581 29.5327 105.844 33.2694 105.844 37.879Z"
              fill="#64B598"
              initial={{ scale: 0, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, opacity: 1} : {scale: 0, opacity: 0}}
              transition={{ delay: 0.3, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            />
            {/* Flower/star shape */}
            <motion.path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M190.776 181.579C170.45 153.987 153.977 170.46 181.575 190.779C153.977 211.086 170.45 227.559 190.776 199.979C211.099 227.572 227.575 211.098 199.974 190.779C227.566 170.448 211.099 153.974 190.776 181.579ZM184.831 190.775C184.831 194.058 187.492 196.719 190.775 196.719C194.058 196.719 196.72 194.058 196.72 190.775C196.72 187.492 194.058 184.83 190.775 184.83C187.492 184.83 184.831 187.492 184.831 190.775Z"
              fill="#24B1B1"
              initial={{ scale: 0, rotate: -180, opacity: 0 }}
              animate={sponsorshipSvgInView ? {scale: 1, rotate: 0, opacity: 1} : {scale: 0, rotate: -180, opacity: 0}}
              transition={{ delay: 0.6, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
            />
          </svg>
        </div>
        <div className="max-w-7xl mx-auto">
          <div className="mb-16 text-center">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-dark-blue mb-4">
              Other Ways to Work With Us
            </h2>
            <p className="text-dark-blue/70 text-lg md:text-xl max-w-3xl mx-auto">
              Looking to support DALI without a project in mind? Explore our sponsorship opportunities.
            </p>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
            {/* General Sponsorship Column */}
            <div className="bg-[#D4F1F1] rounded-3xl p-6 md:p-10 text-[#1A3A52] flex flex-col">
              <h3 className="text-2xl md:text-3xl font-bold mb-6">General Sponsorship</h3>

              {/* Tier Headers */}
              <div className="flex items-center gap-2 mb-4 border-b border-[#1A3A52]/10 pb-3 px-3">
                <div className="flex-1"></div>
                <div className="flex gap-3 md:gap-4 text-xs md:text-sm font-semibold text-[#1A3A52]/70">
                  <span className="w-8 md:w-10 text-center">1K</span>
                  <span className="w-8 md:w-10 text-center">2.5K</span>
                  <span className="w-8 md:w-10 text-center">5K</span>
                  <span className="w-8 md:w-10 text-center">10K</span>
                </div>
              </div>

              {/* General */}
              <div className="mb-6">
                <h4 className="font-semibold text-lg mb-3 text-accent-coral">General</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 bg-[#1A3A52]/5 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Distribute Swag</p>
                      <p className="text-xs opacity-60">distribute your company swag</p>
                    </div>
                    <div className="flex gap-3 md:gap-4">
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Resume Book</p>
                      <p className="text-xs opacity-60">collection of lab member resumes</p>
                    </div>
                    <div className="flex gap-3 md:gap-4">
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Events */}
              <div className="mb-6">
                <h4 className="font-semibold text-lg mb-3 text-accent-coral">Events</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 bg-[#1A3A52]/5 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">All-Lab Presentation</p>
                      <p className="text-xs opacity-60">30 minute presentation during our all hands meeting</p>
                    </div>
                    <div className="flex gap-3 md:gap-4">
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Student Recruiting Event</p>
                      <p className="text-xs opacity-60">1 hour event to present your company to the lab and Dartmouth community</p>
                    </div>
                    <div className="flex gap-3 md:gap-4">
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-[#1A3A52]/5 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Workshop</p>
                      <p className="text-xs opacity-60">host a 1-3 hour workshop on a topic of relevance</p>
                    </div>
                    <div className="flex gap-3 md:gap-4">
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Mini-Series Course</p>
                      <p className="text-xs opacity-60">educate members on your topic (2 sessions per week with take home work)</p>
                    </div>
                    <div className="flex gap-3 md:gap-4">
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-[#1A3A52]/5 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">The Pitch</p>
                      <p className="text-xs opacity-60">sponsorship of the event where 12 pitches compete for funding or a dali partnership</p>
                    </div>
                    <div className="flex gap-3 md:gap-4">
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Technigala Demo Spot</p>
                      <p className="text-xs opacity-60">sponsorship of the quarterly student showcase with over 300 attendees</p>
                    </div>
                    <div className="flex gap-3 md:gap-4">
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-8 md:w-10 flex justify-center"><span className="w-4 h-4 border-2 border-accent-coral flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-coral"></span></span></span>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-text-secondary text-sm mt-auto pt-4">
                Email us at{" "}
                <a
                  href="mailto:dali@dartmouth.edu"
                  className="text-accent-coral font-semibold hover:underline"
                >
                  dali@dartmouth.edu
                </a>{" "}
                for inquiries
              </p>
            </div>

            {/* Student / Project Sponsorship Column */}
            <div className="bg-[#FDDEDE] rounded-3xl p-6 md:p-10 text-[#1A3A52] flex flex-col">
              <h3 className="text-2xl md:text-3xl font-bold mb-6">Student / Project Sponsorship</h3>

              {/* Tier Headers */}
              <div className="flex items-center gap-2 mb-4 border-b border-[#1A3A52]/10 pb-3 px-3">
                <div className="flex-1"></div>
                <div className="flex gap-2 md:gap-3 text-xs md:text-sm font-semibold text-[#1A3A52]/70">
                  <span className="w-6 md:w-9 text-center">1K</span>
                  <span className="w-6 md:w-9 text-center">2K</span>
                  <span className="w-6 md:w-9 text-center">5K</span>
                  <span className="w-6 md:w-9 text-center">10K</span>
                  <span className="w-6 md:w-9 text-center">25K</span>
                </div>
              </div>

              {/* Student */}
              <div className="mb-6">
                <h4 className="font-semibold text-lg mb-3 text-accent-teal">Student</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 bg-[#1A3A52]/5 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Student Equipment</p>
                      <p className="text-xs opacity-60">fund student gear: phones, computers, cameras</p>
                    </div>
                    <div className="flex gap-2 md:gap-3">
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Student Scholarship</p>
                      <p className="text-xs opacity-60">fund student financial needs and opportunities</p>
                    </div>
                    <div className="flex gap-2 md:gap-3">
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-[#1A3A52]/5 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Student Conference Fees</p>
                      <p className="text-xs opacity-60">send dali members to your conference</p>
                    </div>
                    <div className="flex gap-2 md:gap-3">
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Project */}
              <div className="mb-6">
                <h4 className="font-semibold text-lg mb-3 text-accent-teal">Project</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 bg-[#1A3A52]/5 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Project Equipment</p>
                      <p className="text-xs opacity-60">fund project needs such as hardware, devices, software for a project</p>
                    </div>
                    <div className="flex gap-2 md:gap-3">
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Funding A Project</p>
                      <p className="text-xs opacity-60">fund one project dedicated to a collaboration or theme</p>
                    </div>
                    <div className="flex gap-2 md:gap-3">
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-[#1A3A52]/5 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm md:text-base">Funding A Line Of Projects</p>
                      <p className="text-xs opacity-60">funding for 3 projects over the course of a year</p>
                    </div>
                    <div className="flex gap-2 md:gap-3">
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4"></span></span>
                      <span className="w-6 md:w-9 flex justify-center"><span className="w-4 h-4 border-2 border-accent-teal flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-accent-teal"></span></span></span>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-text-secondary text-sm mt-auto pt-4">
                Email us at{" "}
                <a
                  href="mailto:dali@dartmouth.edu"
                  className="text-accent-teal font-semibold hover:underline"
                >
                  dali@dartmouth.edu
                </a>{" "}
                for inquiries
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-dark-blue dark:bg-accent-teal relative overflow-hidden">
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6">
            Ready to get started?
          </h2>
          <p className="text-white/70 text-lg md:text-xl mb-10 max-w-2xl mx-auto">
            Tell us about your idea and let's explore how we can work together. We review applications on a rolling basis.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href="https://dali.fillout.com/t/hjQQFxv4U1us"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-accent-teal dark:bg-[#1A3A52] text-white font-semibold rounded-full hover:bg-accent-teal/90 dark:hover:bg-[#1A3A52]/90 transition-all"
            >
              Apply to be a Partner
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </a>
            <span className="text-white/50">or</span>
            <a
              href="mailto:partners@dali.dartmouth.edu"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 border-2 border-white/30 dark:border-transparent dark:bg-[#1A3A52] text-white font-semibold rounded-full hover:bg-white/10 dark:hover:bg-[#1A3A52]/90 transition-all"
            >
              partners@dali.dartmouth.edu
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </a>
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

export default Partners;
