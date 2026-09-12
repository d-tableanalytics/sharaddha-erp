import { Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import { Package } from 'lucide-react';

export const AuthLayout = () => {
  return (
    
    <div className="app-shell min-h-screen flex w-full font-sans bg-white">
      <div className="flex-1 flex flex-col justify-center py-12 px-4 sm:px-6 lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div className="flex flex-col items-center gap-4 mb-10">
            <img src="/logo.avif" alt="Shraddha Impex Logo" className="h-24 w-auto object-contain " />
            <div className="text-center">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">
                Shraddha<span style={{ color: "#2786CA" }}>Impex</span>
              </h1>
            </div>
          </div>
          <Suspense fallback={<div className="flex h-full w-full py-12 items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div></div>}>
            <Outlet />
          </Suspense>
        </div>
      </div>
      <div className="hidden lg:block relative w-0 flex-1 bg-primary-950">
        <img
          className="absolute inset-0 h-full w-full object-cover opacity-90"
          src="/loginImg.png"
          alt="Precision Engineering Tools"
        />
        <div className="absolute inset-0 bg-linear-to-tr from-primary-950 via-primary-900/80 to-primary-700/50" />
        <div className="absolute inset-0 flex flex-col justify-center px-16 lg:px-24 z-10 text-white">
          <h2 className="text-4xl font-black tracking-tight mb-4 leading-tight">
            Supplier & Distributor
          </h2>
          <p className="text-lg text-primary-100/80 font-medium max-w-lg">
            Impact Socket, Ratchet Handles, Screwdriver Bits, Protective Sockets, Force Instruments, Force Gauge, Torque Gauge, Torque Meters, Torque Wrenches, Taper Scale, Pin Gauge, Hand Tools, and more.          </p>
        </div>
      </div>
    </div>
  );
};
