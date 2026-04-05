import { motion, useInView } from 'framer-motion';
import { ReactNode, useRef } from 'react';

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  delay?: number;
  duration?: number;
  distance?: number;
  bounce?: boolean;
}

export default function ScrollReveal({
  children,
  className = '',
  direction = 'down',
  delay = 0,
  duration = 0.7,
  distance = 80,
  bounce = true,
}: ScrollRevealProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  const getInitialPosition = () => {
    switch (direction) {
      case 'up':
        return { y: distance, x: 0 };
      case 'down':
        return { y: -distance, x: 0 };
      case 'left':
        return { x: distance, y: 0 };
      case 'right':
        return { x: -distance, y: 0 };
      default:
        return { y: -distance, x: 0 };
    }
  };

  const initialPosition = getInitialPosition();

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{
        opacity: 0,
        ...initialPosition
      }}
      animate={isInView ? {
        opacity: 1,
        x: 0,
        y: 0
      } : {
        opacity: 0,
        ...initialPosition
      }}
      transition={{
        duration,
        delay,
        ease: bounce ? [0.34, 1.56, 0.64, 1] : 'easeOut'
      }}
    >
      {children}
    </motion.div>
  );
}
