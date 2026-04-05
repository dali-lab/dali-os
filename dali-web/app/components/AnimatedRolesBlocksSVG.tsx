import { motion, useInView } from "framer-motion"
import type { Variants } from "framer-motion";
import { useRef } from "react";

const AnimatedRolesBlocksSVG = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, amount: 0.3 });
  const blockVariants: Variants = {
    hidden: { y: -30, opacity: 0 },
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      transition: {
        delay: i * 0.06,
        duration: 0.4,
        ease: "easeOut" as const,
      },
    }),
  };

  return (
    <svg
      ref={ref}
      width="320"
      height="203"
      viewBox="0 0 307 195"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: "visible" }}
    >
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={0}>
        <rect x="48.1055" y="65.1663" width="64.6972" height="64.6972" transform="rotate(-90 48.1055 65.1663)" fill="#8CE0D6"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={1}>
        <rect x="112.805" y="194.092" width="64.6972" height="64.6972" transform="rotate(-90 112.805 194.092)" fill="#F9C679"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={2}>
        <path d="M177.502 65.2503C141.771 65.2503 112.805 35.7313 112.805 7.62939e-06L177.502 7.62939e-06V65.2503Z" fill="#E45768"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={3}>
        <rect x="112.805" y="130.5" width="65.2503" height="64.6973" transform="rotate(-90 112.805 130.5)" fill="#FFF3B5"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={4}>
        <path d="M177.5 128.842V64.6977C212.926 64.6977 241.644 93.4161 241.644 128.842H177.5Z" fill="#64B598"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={5}>
        <rect x="242.199" y="194.092" width="64.6972" height="64.6972" transform="rotate(-90 242.199 194.092)" fill="#64B598"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={6}>
        <circle cx="80.3071" cy="97.2029" r="16.1743" transform="rotate(-90 80.3071 97.2029)" fill="#D2DBE1"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={7}>
        <circle cx="210.264" cy="32.5057" r="16.1743" transform="rotate(-90 210.264 32.5057)" fill="#F97979"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={8}>
        <circle cx="80.2251" cy="32.1141" r="16.1743" transform="rotate(-90 80.2251 32.1141)" fill="#0C4B78"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={9}>
        <circle cx="16.1743" cy="32.1141" r="16.1743" transform="rotate(-90 16.1743 32.1141)" fill="#E68FBE"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={10}>
        <circle cx="145.307" cy="161.586" r="16.1743" transform="rotate(-90 145.307 161.586)" fill="#2DC0C0"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={11}>
        <circle cx="209.698" cy="161.586" r="16.1743" transform="rotate(-90 209.698 161.586)" fill="#24B1B1"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={12}>
        <circle cx="145.014" cy="97.4607" r="16.1743" transform="rotate(-90 145.014 97.4607)" fill="#FFA89C"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={13}>
        <circle cx="274.78" cy="97.2801" r="16.1743" transform="rotate(-90 274.78 97.2801)" fill="#FFF3B5"/>
      </motion.g>
      <motion.g variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"} custom={14}>
        <path fillRule="evenodd" clipRule="evenodd" d="M268.108 148.202C269.29 154.5 274.55 161.649 274.55 161.649C274.55 161.649 280.381 153.723 281.143 147.21C281.251 146.685 281.308 146.138 281.308 145.577C281.308 141.474 278.255 138.149 274.489 138.149C270.723 138.149 267.67 141.474 267.67 145.577C267.67 146.501 267.825 147.386 268.108 148.202ZM274.559 161.666C275.261 161.159 281.98 156.391 287.939 155.27C288.757 154.985 289.644 154.829 290.571 154.829C294.673 154.829 297.999 157.882 297.999 161.648C297.999 165.414 294.673 168.467 290.571 168.467C290.013 168.467 289.469 168.411 288.946 168.304C282.983 167.61 275.829 162.659 274.663 161.828C275.476 162.97 279.905 169.385 280.976 175.099C281.259 175.915 281.414 176.799 281.414 177.723C281.414 181.826 278.361 185.151 274.595 185.151C270.829 185.151 267.776 181.826 267.776 177.723C267.776 177.162 267.833 176.616 267.941 176.091C268.622 170.264 273.362 163.304 274.353 161.903C272.918 162.916 265.981 167.629 260.174 168.305C259.651 168.412 259.107 168.469 258.549 168.469C254.447 168.469 251.121 165.416 251.121 161.649C251.121 157.883 254.447 154.83 258.549 154.83C259.476 154.83 260.363 154.986 261.181 155.271C267.136 156.391 273.848 161.153 274.559 161.666Z" fill="#A2D483"/>
      </motion.g>
    </svg>
  );
};

export default AnimatedRolesBlocksSVG;
