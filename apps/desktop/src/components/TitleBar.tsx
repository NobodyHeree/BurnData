import { Minus, Square, X } from 'lucide-react';
import '../types/electron.d.ts';

export function TitleBar() {
    const handleMinimize = () => window.electronAPI?.window.minimize();
    const handleMaximize = () => window.electronAPI?.window.maximize();
    const handleClose = () => window.electronAPI?.window.close();

    return (
        <div className="h-10 bg-dark-900 border-b border-dark-800 flex items-center justify-between px-4 titlebar-drag"
            style={{ borderBottomColor: 'rgba(255,59,0,0.15)' }}>
            {/* App Logo & Title */}
            <div className="flex items-center gap-3 titlebar-no-drag">
                <div className="w-6 h-6 flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #FF3B00, #FFB800)', clipPath: 'polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%)' }}>
                    <span className="text-white text-xs font-black">B</span>
                </div>
                <span className="font-display text-lg tracking-wider">
                    <span className="text-gold">Burn</span>
                    <span className="text-fire">Data</span>
                </span>
            </div>

            {/* Window Controls */}
            <div className="flex items-center gap-1 titlebar-no-drag">
                <button
                    onClick={handleMinimize}
                    className="p-2 hover:bg-dark-700 rounded-md transition-colors group"
                    aria-label="Minimize"
                >
                    <Minus className="w-4 h-4 text-burn-muted group-hover:text-burn-cream" />
                </button>
                <button
                    onClick={handleMaximize}
                    className="p-2 hover:bg-dark-700 rounded-md transition-colors group"
                    aria-label="Maximize"
                >
                    <Square className="w-3.5 h-3.5 text-burn-muted group-hover:text-burn-cream" />
                </button>
                <button
                    onClick={handleClose}
                    className="p-2 hover:bg-fire rounded-md transition-colors group"
                    aria-label="Close"
                >
                    <X className="w-4 h-4 text-burn-muted group-hover:text-white" />
                </button>
            </div>
        </div>
    );
}
