"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ShieldCheck } from "lucide-react";

export function Navbar() {
  return (
    <nav className="w-full border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-8 w-8 text-primary" />
          <span className="text-xl font-bold tracking-tight text-slate-50">
            VeriLens
          </span>
        </div>
        <div className="flex items-center gap-4">
          <ConnectButton 
            accountStatus="address"
            chainStatus="icon"
            showBalance={false}
          />
        </div>
      </div>
    </nav>
  );
}
