import { motion, useInView } from "framer-motion"
import type { Variants } from "framer-motion";
import { useRef } from "react";

const AnimatedProcessCircles = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, amount: 0.5 });

  const circleVariants: Variants = {
    hidden: { scale: 0, opacity: 0 },
    visible: (i: number) => ({
      scale: 1,
      opacity: 0.3,
      transition: {
        delay: i * 0.2,
        duration: 0.5,
        ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
      },
    }),
  };

  return (
    <svg
      ref={ref}
      viewBox="0 0 150 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute top-10 right-10 w-[80px] md:w-[120px] pointer-events-none"
      style={{ overflow: "visible" }}
    >
      <motion.circle
        cx="75"
        cy="75"
        r="60"
        stroke="#8CE0D6"
        strokeWidth="2"
        fill="none"
        variants={circleVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={0}
      />
      <motion.circle
        cx="75"
        cy="75"
        r="40"
        stroke="#E45768"
        strokeWidth="2"
        fill="none"
        variants={circleVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={1}
      />
      <motion.circle
        cx="75"
        cy="75"
        r="20"
        stroke="#FFF3B5"
        strokeWidth="2"
        fill="none"
        variants={circleVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={2}
      />
    </svg>
  );
};

export default AnimatedProcessCircles;
