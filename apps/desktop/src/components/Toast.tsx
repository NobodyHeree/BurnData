import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useAppStore, Toast as ToastType } from '../store/appStore';
import { useEffect } from 'react';

const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Info
};

const styles: Record<string, { bg: string; text: string; shadow: string }> = {
    success: { bg: 'rgba(0,255,136,0.95)', text: 'text-dark-900', shadow: '0 0 20px rgba(0,255,136,0.3)' },
    error: { bg: 'rgba(255,59,59,0.95)', text: 'text-white', shadow: '0 0 20px rgba(255,59,59,0.3)' },
    warning: { bg: 'rgba(255,184,0,0.95)', text: 'text-dark-900', shadow: '0 0 20px rgba(255,184,0,0.3)' },
    info: { bg: 'rgba(255,59,0,0.95)', text: 'text-white', shadow: '0 0 20px rgba(255,59,0,0.3)' },
};

function ToastItem({ toast }: { toast: ToastType }) {
    const removeToast = useAppStore(state => state.removeToast);
    const Icon = icons[toast.type];
    const style = styles[toast.type];

    useEffect(() => {
        if (toast.duration !== Infinity) {
            const timer = setTimeout(() => {
                removeToast(toast.id);
            }, toast.duration || 5000);
            return () => clearTimeout(timer);
        }
    }, [toast.id, toast.duration, removeToast]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`flex items-center gap-3 px-4 py-3 ${style.text}`}
            style={{ background: style.bg, boxShadow: style.shadow }}
        >
            <div className="p-1 bg-white/20">
                <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
                {toast.title && (
                    <h4 className="font-black text-sm uppercase tracking-wider">{toast.title}</h4>
                )}
                <p className="text-sm opacity-90 font-medium">{toast.message}</p>
            </div>
            <button
                onClick={() => removeToast(toast.id)}
                className="p-1 hover:bg-white/10 transition-colors"
            >
                <X className="w-4 h-4 opacity-70" />
            </button>
        </motion.div>
    );
}

export function ToastContainer() {
    const toasts = useAppStore(state => state.toasts);

    return (
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 max-w-sm">
            <AnimatePresence>
                {toasts.map(toast => (
                    <ToastItem key={toast.id} toast={toast} />
                ))}
            </AnimatePresence>
        </div>
    );
}
