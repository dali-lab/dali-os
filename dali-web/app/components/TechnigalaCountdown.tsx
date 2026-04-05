import React, { useState, useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

const TECHNIGALA_DATE = new Date('2026-06-03T18:00:00');
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getTimeLeft() {
  const now = new Date();
  const diff = TECHNIGALA_DATE.getTime() - now.getTime();
  if (diff <= 0 || diff > ONE_WEEK_MS) return null;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return { days, hours, minutes, seconds };
}

const TechnigalaCountdown: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(getTimeLeft);

  useEffect(() => {
    if (timeLeft && !sessionStorage.getItem('technigala-dismissed')) {
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const t = getTimeLeft();
      setTimeLeft(t);
      if (!t) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Dismiss on scroll/wheel
  useEffect(() => {
    if (!open) return;

    const dismiss = () => handleClose(false);

    window.addEventListener('wheel', dismiss, { passive: true });
    window.addEventListener('touchmove', dismiss, { passive: true });

    return () => {
      window.removeEventListener('wheel', dismiss);
      window.removeEventListener('touchmove', dismiss);
    };
  }, [open]);

  function handleClose(isOpen: boolean) {
    if (!isOpen) {
      sessionStorage.setItem('technigala-dismissed', '1');
    }
    setOpen(isOpen);
  }

  if (!timeLeft) return null;

  const units = [
    { label: 'Days', value: timeLeft.days },
    { label: 'Hrs', value: timeLeft.hours },
    { label: 'Min', value: timeLeft.minutes },
    { label: 'Sec', value: timeLeft.seconds },
  ];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleClose}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" style={{ WebkitBackdropFilter: 'blur(24px)' }} />

        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-[calc(100%-2rem)] max-w-[560px] max-h-[92vh] translate-x-[-50%] translate-y-[-50%] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          <div
            className="rounded-2xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.3)] overflow-y-auto max-h-[92vh]"
            style={{
              background: 'rgba(26, 0, 213, 0.15)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            }}
          >
            {/* Countdown at the top */}
            <div className="px-4 pt-4 pb-2">
              {/* Hidden title/description for accessibility */}
              <DialogPrimitive.Title className="sr-only">
                Technigala Countdown
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Countdown to Technigala on June 3, 2026 at 6:00 PM
              </DialogPrimitive.Description>

              <div className="grid grid-cols-4 gap-2 sm:gap-3">
                {units.map((unit) => (
                  <div key={unit.label} className="flex flex-col items-center">
                    <div
                      className="w-full aspect-square rounded-xl flex items-center justify-center"
                      style={{ background: '#F2C7FC' }}
                    >
                      <span
                        className="text-3xl sm:text-4xl font-bold tabular-nums"
                        style={{
                          color: '#F7FF91',
                          WebkitTextStroke: '2.5px #1A00D5',
                          paintOrder: 'stroke fill',
                        }}
                      >
                        {String(unit.value).padStart(2, '0')}
                      </span>
                    </div>
                    <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-white/40 mt-2">
                      {unit.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* "till..." text */}
              <p className="text-center text-white/50 text-sm font-medium tracking-wide mt-2 mb-0">
                till...
              </p>
            </div>

            {/* Full poster image with blue border */}
            <div className="mx-6 mb-4 rounded-xl overflow-hidden flex items-center justify-center">
              <img
                src="assets/landingpage/26W_poster.png"
                alt="Technigala 26W poster"
                className="w-full h-auto block max-h-[55vh] object-contain"
              />
            </div>
          </div>

          {/* Close button */}
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-full p-1.5 text-white/70 transition-colors hover:text-white hover:bg-black/20 focus:outline-none">
            <X className="h-5 w-5 drop-shadow-md" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default TechnigalaCountdown;
