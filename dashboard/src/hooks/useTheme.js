import { useState, useEffect } from 'react';
export function useTheme() {
    const [theme, setThemeState] = useState(() => {
        const saved = localStorage.getItem('cereal_theme');
        if (saved === 'light' || saved === 'dark')
            return saved;
        // Default: respect system preference
        if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    });
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('cereal_theme', theme);
    }, [theme]);
    return [theme, setThemeState];
}
