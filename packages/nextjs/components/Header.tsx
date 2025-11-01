"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { RainbowKitCustomConnectButton } from "~~/components/helper";
import { useOutsideClick } from "~~/hooks/helper";

/**
 * Site header
 */
export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <div className="sticky lg:static top-0 navbar min-h-0 shrink-0 justify-between z-20 px-0 sm:px-2" style={{ backgroundColor: 'rgb(255, 210, 8)' }}>
      <div className="navbar-start">
        <Link href="/" className="ml-4">
          <h1 className="text-2xl font-bold text-black cursor-pointer hover:opacity-80 transition-opacity">ZGRID</h1>
        </Link>
      </div>
      <div className="navbar-end grow mr-4">
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
