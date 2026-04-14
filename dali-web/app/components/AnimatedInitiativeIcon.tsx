import { motion, useInView } from "framer-motion"
import type { Variants } from "framer-motion";
import { useRef } from "react";

const AnimatedInitiativeIcon = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, amount: 0.5 });

  const starVariants: Variants = {
    hidden: { scale: 0, opacity: 0, rotate: -180 },
    visible: {
      scale: 1,
      opacity: 1,
      rotate: 0,
      transition: {
        duration: 0.6,
        ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
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
      <motion.polygon
        points="50,5 61,40 98,40 68,60 79,95 50,75 21,95 32,60 2,40 39,40"
        fill="#CA60AC"
        variants={starVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
      />
    </svg>
  );
};

export default AnimatedInitiativeIcon;
