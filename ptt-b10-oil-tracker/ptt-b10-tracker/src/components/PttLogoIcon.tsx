import React from 'react';

interface PttLogoIconProps {
  className?: string;
}

export const PttLogoIcon: React.FC<PttLogoIconProps> = ({ className = 'w-4 h-5' }) => {
  return (
    <svg
      viewBox="0 0 36 46"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* White badge backing matching the cell icon in the reference screenshot */}
      <rect x="0" y="0" width="36" height="46" rx="2" fill="#FFFFFF" />
      {/* Outer Navy Blue Droplet */}
      <path
        d="M18 3C18 3 5 18.5 5 28.5C5 35.9558 10.8203 42 18 42C25.1797 42 31 35.9558 31 28.5C31 18.5 18 3 18 3Z"
        fill="#1D3C85"
      />
      {/* Middle Cyan/Sky Blue Swirl */}
      <path
        d="M18 10.5C18 10.5 9.2 21.5 9.2 29C9.2 34.2 13.1 38.5 18 38.5C22.9 38.5 26.8 34.2 26.8 29C26.8 21.5 18 10.5 18 10.5Z"
        fill="#00AEEF"
      />
      {/* Inner Crimson Flame Drop */}
      <path
        d="M18 18.5C18 18.5 13 25.2 13 30.2C13 33.4 15.2 36 18 36C20.8 36 23 33.4 23 30.2C23 25.2 18 18.5 18 18.5Z"
        fill="#ED1C24"
      />
    </svg>
  );
};
