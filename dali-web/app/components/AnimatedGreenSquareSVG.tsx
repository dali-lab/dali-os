import { motion, useInView } from "framer-motion"
import type { Variants } from "framer-motion";
import { useRef } from "react";

const AnimatedGreenSquareSVG = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, amount: 0.5 });

  const blockVariants: Variants = {
    hidden: { scale: 0, opacity: 0 },
    visible: (i: number) => ({
      scale: 1,
      opacity: 1,
      transition: {
        delay: i * 0.1,
        duration: 0.4,
        ease: "easeOut" as const,
      },
    }),
  };

  return (
    <svg
      ref={ref}
      width="120"
      height="120"
      viewBox="0 0 76 76"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Main square frame */}
      <motion.path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 75.8948L6.21264e-06 37.9474L8.29367e-07 1.65872e-06L37.9474 0L75.8948 4.13157e-06V37.9474V75.8948H37.9474H0ZM37.9474 56.9109C37.9531 46.4366 46.4457 37.9474 56.9211 37.9474C46.4423 37.9474 37.9474 29.4526 37.9474 18.9737C37.9474 29.4526 29.4526 37.9474 18.9737 37.9474C29.4492 37.9474 37.9419 46.4366 37.9474 56.9109ZM18.9737 47.8137C24.0036 47.8137 28.0811 51.8912 28.0811 56.9211C28.0811 61.951 24.0036 66.0285 18.9737 66.0285C13.9438 66.0285 9.86633 61.951 9.86633 56.9211C9.86633 51.8912 13.9438 47.8137 18.9737 47.8137ZM28.0811 18.9737C28.0811 24.0036 24.0036 28.0811 18.9737 28.0811C13.9438 28.0811 9.86633 24.0036 9.86633 18.9737C9.86633 13.9438 13.9438 9.86633 18.9737 9.86633C24.0036 9.86633 28.0811 13.9438 28.0811 18.9737ZM47.8137 56.9211C47.8137 51.8912 51.8912 47.8137 56.9211 47.8137C61.951 47.8137 66.0285 51.8912 66.0285 56.9211C66.0285 61.951 61.951 66.0285 56.9211 66.0285C51.8912 66.0285 47.8137 61.951 47.8137 56.9211ZM47.8137 18.9737C47.8137 24.0036 51.8912 28.0811 56.9211 28.0811C61.951 28.0811 66.0285 24.0036 66.0285 18.9737C66.0285 13.9439 61.951 9.86633 56.9211 9.86633C51.8912 9.86633 47.8137 13.9438 47.8137 18.9737Z"
        fill="#509C81"
        variants={blockVariants}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={0}
      />
    </svg>
  );
};

export default AnimatedGreenSquareSVG;
