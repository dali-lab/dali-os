import { motion, useInView } from "framer-motion"
import type { Variants } from "framer-motion";
import { useRef } from "react";

const AnimatedCuriosityIcon = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, amount: 0.5 });

  const circleVariants: Variants = {
    hidden: { scale: 0, opacity: 0 },
    visible: (i: number) => ({
      scale: 1,
      opacity: 1,
      transition: {
        delay: i * 0.15,
        duration: 0.5,
        ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
      },
    }),
  };

  const questionVariants: Variants = {
    hidden: { scale: 0, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: {
        delay: 0.5,
        duration: 0.4,
        ease: "easeOut" as const,
      },
    },
  };

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      style={{ overflow: "visible" }}
    >
      <motion.circle
        cx="50"
        cy="50"
        r="45"
        fill="#E45768"
        fillOpacity="0.1"
        variants={circleVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={0}
      />
      <motion.circle
        cx="50"
        cy="50"
        r="35"
        fill="#E45768"
        fillOpacity="0.2"
        variants={circleVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={1}
      />
      <motion.circle
        cx="50"
        cy="50"
        r="25"
        fill="#E45768"
        variants={circleVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={2}
      />
      <motion.text
        x="50"
        y="58"
        textAnchor="middle"
        fill="white"
        fontSize="28"
        variants={questionVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
      >
        ?
      </motion.text>
    </svg>
  );
};

export default AnimatedCuriosityIcon;
