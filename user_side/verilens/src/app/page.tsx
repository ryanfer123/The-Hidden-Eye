import { Scanner } from "@/components/Scanner";
import { Navbar } from "@/components/Navbar";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 selection:bg-emerald-500/30 overflow-hidden">
      <Navbar />
      
      <div className="relative isolate pt-14">
        {/* Background Gradients/Effects */}
        <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80 pointer-events-none" aria-hidden="true">
          <div 
            className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-emerald-500 to-teal-500 opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" 
            style={{ 
              clipPath: 'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)' 
            }}
          />
        </div>

        <div className="absolute inset-x-0 top-[calc(100%-13rem)] -z-10 transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)] pointer-events-none" aria-hidden="true">
           <div 
            className="relative left-[calc(50%+3rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 bg-gradient-to-tr from-emerald-500 to-cyan-500 opacity-20 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]" 
            style={{ 
              clipPath: 'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)' 
            }}
          />
        </div>

        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-12 lg:py-24">
          <div className="mx-auto max-w-2xl text-center mb-16 relative">
            <div className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm leading-6 text-emerald-400 ring-1 ring-inset ring-emerald-500/20 mb-6 backdrop-blur-sm">
              <span className="flex items-center gap-1">
                <span className="relative flex h-2 w-2 mr-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Live on Mainnet
              </span>
            </div>
            
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl mb-6 drop-shadow-lg">
              Trust, <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200">Verified on Chain.</span>
            </h1>
            
            <p className="text-lg leading-8 text-slate-400 max-w-xl mx-auto">
              The first decentralized protocol to combat deepfakes using AI forensics and blockchain anchoring.
            </p>
          </div>

          <Scanner />
          
          <div className="mt-20 border-t border-slate-800/50 pt-10">
             <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                <div className="p-4">
                   <div className="text-3xl font-mono font-bold text-white mb-1">10k+</div>
                   <div className="text-sm text-slate-500">Verifications</div>
                </div>
                <div className="p-4">
                   <div className="text-3xl font-mono font-bold text-white mb-1">99.9%</div>
                   <div className="text-sm text-slate-500">Accuracy</div>
                </div>
                <div className="p-4">
                   <div className="text-3xl font-mono font-bold text-white mb-1">$0.01</div>
                   <div className="text-sm text-slate-500">Cost per Scan</div>
                </div>
                <div className="p-4">
                   <div className="text-3xl font-mono font-bold text-white mb-1">&lt;1s</div>
                   <div className="text-sm text-slate-500">Latency</div>
                </div>
             </div>
          </div>
        </div>
      </div>
    </main>
  );
}