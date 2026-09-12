import { useState, useRef, useEffect } from "react";
import { Moon, Sun, LogOut, User as UserIcon, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { useUserStore } from "../../store/userStore";
import { useUIStore } from "../../store/uiStore";
import { useThemeStore } from "../../store/themeStore";
// HRMS notification centre. Renders nothing for anyone without an HRMS inbox
// grant — which in this app is only ever an account mid-sign-out.
import { InboxBell } from "../hrms/InboxBell";
import { O2dBell } from "../../pages/O2d/O2dBell";

/**
 * The Employee Portal top bar.
 *
 * The Customer Portal's bar carried three things this one does not: the
 * command palette trigger (it searched ERP screens), the inventory-alert bell
 * (`useNotificationStore`, fed by a socket), and the alert drawer behind it.
 * All three are Customer Portal features, and dropping them is what keeps
 * `socket.io-client` out of this bundle.
 *
 * `InboxBell` stays, because it IS the HRMS notification centre — it polls
 * /hrms/inbox and was always the employee-facing half of this bar.
 */
export const Navbar = () => {
  const navigate = useNavigate();
  const { user, logout } = useUserStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();

  const { theme, setTheme } = useThemeStore();
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const handleLogout = () => {
    logout();
    toast.success("Successfully logged out.");
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="h-16 bg-white/80 backdrop-blur-md border-b border-primary-100 px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-4">
        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors focus:outline-none"
          >
            <Menu size={20} />
          </button>
        )}
        <span className="text-sm font-black text-slate-800 tracking-tight select-none">
          Employee Portal
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="p-2 rounded-lg text-slate-500 hover:text-primary-700 hover:bg-primary-50 transition-colors focus:outline-none"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle dark mode"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <InboxBell />
        {/*
          A SECOND bell, not a merged one. HRMS notifications are about the
          reader's own employment; O2D notifications are about the business's
          orders. Merging them would mean one badge whose count answers neither
          "does HR need something from me" nor "is an order stuck", and each
          renders itself to nothing for an account that cannot see its module.
        */}
        <O2dBell />

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setProfileDropdownOpen((open) => !open)}
            className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-100 transition-colors focus:outline-none"
            aria-haspopup="menu"
            aria-expanded={profileDropdownOpen}
          >
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="w-8 h-8 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-800 flex items-center justify-center text-xs font-bold">
                {(user?.user || user?.name || "US").slice(0, 2).toUpperCase()}
              </div>
            )}
          </button>

          {profileDropdownOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-lg shadow-enterprise-md py-1 z-30"
            >
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-900 truncate">
                  {user?.user || user?.name || "Signed in"}
                </p>
                <p className="text-[11px] text-slate-500 font-medium truncate">{user?.email}</p>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setProfileDropdownOpen(false);
                  navigate("/hrms/me");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none"
              >
                <UserIcon size={15} />
                My Profile
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setProfileDropdownOpen(false);
                  handleLogout();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
export default Navbar;
