import { motion } from 'framer-motion';
import {
    Shield,
    Flame,
    Download,
    Bell,
    Github,
    ExternalLink,
    AlertTriangle,
    Gauge
} from 'lucide-react';
import { useState } from 'react';
import { useAppStore, DeletionSpeed } from '../store/appStore';

export function Settings() {
    const platforms = useAppStore((state) => state.platforms);
    const getTotalDeleted = useAppStore((state) => state.getTotalDeleted);
    const settings = useAppStore((state) => state.settings);
    const updateSettings = useAppStore((state) => state.updateSettings);
    const addToast = useAppStore((state) => state.addToast);

    const [showClearConfirm, setShowClearConfirm] = useState(false);

    const handleClearData = async () => {
        if (window.electronAPI) {
            await window.electronAPI.store.clear();
        }
        localStorage.removeItem('burndata-storage');
        window.location.reload();
    };

    const totalDeleted = getTotalDeleted();
    const connectedCount = Object.values(platforms).filter(p => p.connected).length;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="max-w-2xl mx-auto space-y-8"
        >
            {/* Header */}
            <div>
                <h1 className="font-display text-4xl text-burn-cream tracking-wide mb-2">Settings</h1>
                <p className="text-burn-muted">Configure your BurnData preferences</p>
            </div>

            {/* Safety Settings */}
            <section className="glass-card p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2" style={{ background: 'rgba(0,255,136,0.1)' }}>
                        <Shield className="w-5 h-5 text-burn-green" />
                    </div>
                    <h2 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider">Safety</h2>
                </div>

                <div className="space-y-4">
                    <label className="flex items-center justify-between cursor-pointer">
                        <div>
                            <p className="font-bold text-burn-cream">Export before delete</p>
                            <p className="text-sm text-burn-muted">Always backup data before deletion</p>
                        </div>
                        <input
                            type="checkbox"
                            checked={settings.exportBeforeDelete}
                            onChange={(e) => updateSettings({ exportBeforeDelete: e.target.checked })}
                            className="w-5 h-5 accent-fire"
                        />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer">
                        <div>
                            <p className="font-bold text-burn-cream">Confirm before delete</p>
                            <p className="text-sm text-burn-muted">Show confirmation dialog before starting</p>
                        </div>
                        <input
                            type="checkbox"
                            checked={settings.confirmBeforeDelete}
                            onChange={(e) => updateSettings({ confirmBeforeDelete: e.target.checked })}
                            className="w-5 h-5 accent-fire"
                        />
                    </label>
                </div>
            </section>

            {/* Deletion Speed */}
            <section className="glass-card p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2" style={{ background: 'rgba(255,184,0,0.1)' }}>
                        <Gauge className="w-5 h-5 text-gold" />
                    </div>
                    <h2 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider">Burn Speed</h2>
                </div>

                <div className="space-y-4">
                    <p className="text-sm text-burn-muted">
                        Controls how fast messages are burned. Higher speeds may trigger more rate limits. Changes apply immediately, even mid-job.
                    </p>

                    <div className="grid grid-cols-3 gap-3">
                        {([
                            { id: 'conservative' as DeletionSpeed, label: 'Conservative', desc: '~1.5s delay, safest', color: 'text-burn-green' },
                            { id: 'balanced' as DeletionSpeed, label: 'Balanced', desc: '~1s delay, recommended', color: 'text-gold' },
                            { id: 'aggressive' as DeletionSpeed, label: 'Aggressive', desc: '~0.8s delay, more rate limits', color: 'text-fire' },
                        ]).map((option) => {
                            const isSelected = settings.deletionSpeed === option.id;
                            return (
                                <button
                                    key={option.id}
                                    onClick={() => updateSettings({ deletionSpeed: option.id })}
                                    className={`p-4 text-left transition-all border ${
                                        isSelected
                                            ? 'border-fire bg-fire/10'
                                            : 'border-dark-700 bg-dark-800 hover:border-dark-600'
                                    }`}
                                >
                                    <p className={`font-bold ${isSelected ? 'text-burn-cream' : 'text-burn-text'}`}>
                                        {option.label}
                                    </p>
                                    <p className="text-xs text-burn-muted mt-1">{option.desc}</p>
                                </button>
                            );
                        })}
                    </div>

                    <p className="text-xs text-burn-muted font-mono">
                        All modes handle Discord rate limits automatically. Using a user token is against Discord ToS — conservative is safest.
                    </p>
                </div>
            </section>

            {/* Notifications */}
            <section className="glass-card p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2" style={{ background: 'rgba(255,184,0,0.1)' }}>
                        <Bell className="w-5 h-5 text-gold" />
                    </div>
                    <h2 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider">Notifications</h2>
                </div>

                <label className="flex items-center justify-between cursor-pointer">
                    <div>
                        <p className="font-bold text-burn-cream">Desktop notifications</p>
                        <p className="text-sm text-burn-muted">Get notified when jobs complete</p>
                    </div>
                    <input
                        type="checkbox"
                        checked={settings.notifications}
                        onChange={(e) => updateSettings({ notifications: e.target.checked })}
                        className="w-5 h-5 accent-fire"
                    />
                </label>
            </section>

            {/* Statistics */}
            <section className="glass-card p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2" style={{ background: 'rgba(255,59,0,0.1)' }}>
                        <Flame className="w-5 h-5 text-fire" />
                    </div>
                    <h2 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider">Statistics</h2>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-dark-900 border border-dark-700">
                        <p className="text-2xl font-display text-burn-cream tracking-wide">{totalDeleted.toLocaleString()}</p>
                        <p className="text-xs font-bold text-burn-muted uppercase tracking-wider">Total items burned</p>
                    </div>
                    <div className="p-4 bg-dark-900 border border-dark-700">
                        <p className="text-2xl font-display text-burn-cream tracking-wide">{connectedCount}</p>
                        <p className="text-xs font-bold text-burn-muted uppercase tracking-wider">Platforms connected</p>
                    </div>
                </div>
            </section>

            {/* Data Management */}
            <section className="glass-card p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2" style={{ background: 'rgba(255,59,59,0.1)' }}>
                        <Flame className="w-5 h-5 text-burn-red" />
                    </div>
                    <h2 className="font-heading text-lg font-black text-burn-cream uppercase tracking-wider">Data Management</h2>
                </div>

                <div className="space-y-3">
                    <button
                        className="w-full flex items-center justify-between p-4 bg-dark-800 hover:bg-dark-700 transition-colors border border-dark-700 fire-border-hover"
                        onClick={() => {
                            const exportData = {
                                settings,
                                platforms: Object.fromEntries(
                                    Object.entries(platforms).map(([id, p]) => [id, { connected: p.connected, stats: p.stats }])
                                ),
                                exportedAt: new Date().toISOString(),
                            };
                            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `burndata-settings-${new Date().toISOString().split('T')[0]}.json`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            addToast({ type: 'success', message: 'Settings exported successfully' });
                        }}
                    >
                        <div className="flex items-center gap-3">
                            <Download className="w-5 h-5 text-burn-muted" />
                            <span className="font-bold text-burn-cream">Export settings</span>
                        </div>
                        <span className="text-burn-muted">→</span>
                    </button>

                    {!showClearConfirm ? (
                        <button
                            onClick={() => setShowClearConfirm(true)}
                            className="w-full flex items-center justify-between p-4 transition-colors border"
                            style={{ background: 'rgba(255,59,59,0.08)', borderColor: 'rgba(255,59,59,0.2)' }}
                        >
                            <div className="flex items-center gap-3">
                                <Flame className="w-5 h-5 text-burn-red" />
                                <span className="font-bold text-burn-red">Clear all data</span>
                            </div>
                            <span className="text-burn-red">→</span>
                        </button>
                    ) : (
                        <div className="p-4 border" style={{ background: 'rgba(255,59,59,0.08)', borderColor: 'rgba(255,59,59,0.3)' }}>
                            <div className="flex items-start gap-3 mb-4">
                                <AlertTriangle className="w-5 h-5 text-burn-red flex-shrink-0" />
                                <div>
                                    <p className="font-bold text-burn-cream">Are you sure?</p>
                                    <p className="text-sm text-burn-muted">
                                        This will remove all stored tokens, settings, and statistics.
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowClearConfirm(false)}
                                    className="flex-1 p-2 bg-dark-800 text-burn-cream hover:bg-dark-700 transition-colors border border-dark-700"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleClearData}
                                    className="flex-1 p-2 bg-burn-red text-white hover:bg-burn-red/90 transition-colors font-bold"
                                >
                                    Clear All Data
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* About */}
            <section className="glass-card p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="font-display text-2xl tracking-wide">
                            <span className="text-gold">Burn</span><span className="text-fire">Data</span>
                        </h2>
                        <p className="text-sm text-burn-muted font-mono">v1.0.0 · Open Source · No trace left behind</p>
                    </div>
                    <a
                        href="https://github.com/NobodyHeree/BurnData"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 transition-colors border border-dark-700 fire-border-hover"
                    >
                        <Github className="w-5 h-5 text-burn-cream" />
                        <span className="font-bold text-burn-cream">GitHub</span>
                        <ExternalLink className="w-4 h-4 text-burn-muted" />
                    </a>
                </div>
            </section>
        </motion.div>
    );
}
