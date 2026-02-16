import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
    id: string;
    message: string;
    type: ToastType;
    duration?: number;
}

interface ToastProps {
    toast: ToastMessage;
    onClose: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            handleClose();
        }, toast.duration || 3000);

        return () => clearTimeout(timer);
    }, []);

    const handleClose = () => {
        setIsExiting(true);
        setTimeout(() => {
            onClose(toast.id);
        }, 300); // Wait for exit animation
    };

    const bgColors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-blue-600',
        warning: 'bg-yellow-600',
    };

    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ',
        warning: '⚠',
    };

    return (
        <div
            className={`
        flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md border border-white/10 text-white min-w-[300px] max-w-sm
        transition-all duration-300 transform
        ${isExiting ? 'opacity-0 translate-x-full scale-90' : 'opacity-100 translate-x-0 scale-100'}
        ${bgColors[toast.type] || 'bg-gray-800'}
      `}
            role="alert"
        >
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm">
                {icons[toast.type]}
            </div>
            <div className="flex-1 text-sm font-bold">{toast.message}</div>
            <button
                onClick={handleClose}
                className="text-white/50 hover:text-white transition-colors"
            >
                ✕
            </button>
        </div>
    );
};
