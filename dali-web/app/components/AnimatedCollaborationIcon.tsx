import { motion, useInView } from "framer-motion"
import type { Variants } from "framer-motion";
import { useRef } from "react";

const AnimatedCollaborationIcon = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, amount: 0.5 });

  const rectVariants: Variants = {
    hidden: { scale: 0, opacity: 0, rotate: -45 },
    visible: (i: number) => ({
      scale: 1,
      opacity: 1,
      rotate: 0,
      transition: {
        delay: i * 0.1,
        duration: 0.4,
        ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
      },
    }),
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
      <motion.rect
        x="10"
        y="10"
        width="35"
        height="35"
        rx="8"
        fill="#24B1B1"
        variants={rectVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={0}
      />
      <motion.rect
        x="55"
        y="10"
        width="35"
        height="35"
        rx="8"
        fill="#8CE0D6"
        variants={rectVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={1}
      />
      <motion.rect
        x="10"
        y="55"
        width="35"
        height="35"
        rx="8"
        fill="#A2D483"
        variants={rectVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={2}
      />
      <motion.rect
        x="55"
        y="55"
        width="35"
        height="35"
        rx="8"
        fill="#509C81"
        variants={rectVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={3}
      />
    </svg>
  );
};

export default AnimatedCollaborationIcon;
