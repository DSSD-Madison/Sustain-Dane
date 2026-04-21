import './App.css'
import {MapBox} from "@/components/MapBox.jsx";
import InteractiveMap from "@/components/InteractiveMap.jsx";
import { useEffect, useMemo, useState } from "react";

function App() {
  const initialIsDark = useMemo(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    // Default to light unless user explicitly chose otherwise.
    return false;
  }, []);

  const [isDark, setIsDark] = useState(initialIsDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }, [isDark]);

  return (
    <>
      <div className="theme-toggle" aria-label="Theme">
        <span className="theme-toggle__label">{isDark ? "Dark" : "Light"}</span>
        <button
          type="button"
          className="theme-toggle__switch"
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setIsDark((v) => !v)}
        >
          <span className="theme-toggle__thumb" />
        </button>
      </div>
      {/*<MapBox></MapBox>*/}
      {<InteractiveMap isDark={isDark}></InteractiveMap>}
    </>
  )
}

export default App
