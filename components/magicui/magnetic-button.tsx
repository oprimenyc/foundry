"use client";
import React, { useRef, useState } from "react";
import { motion } from "framer-motion";

type MagneticButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function MagneticButton({ children, className, ...props }: MagneticButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent) => {
    const button = btnRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setPosition({
      x: (e.clientX - rect.left - rect.width / 2) * 0.3,
      y: (e.clientY - rect.top - rect.height / 2) * 0.3,
    });
  };

  return (
    <motion.div animate={{ x: position.x, y: position.y }} transition={{ type: "spring", stiffness: 150, damping: 15 }}>
      <button
        ref={btnRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setPosition({ x: 0, y: 0 })}
        className={`rounded-lg px-6 py-2 font-medium disabled:opacity-50 ${className ?? ""}`}
        {...props}
      >
        {children}
      </button>
    </motion.div>
  );
}
