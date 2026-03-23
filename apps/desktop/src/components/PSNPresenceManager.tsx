import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';

export const PSNPresenceManager = () => {
    const presenceUnsubscribeRef = useRef<(() => void) | null>(null);

    // Expose loadPresence globally
    useEffect(() => {
        if (!window.electronAPI) return;

        // Store reference to loadPresence function globally
        (window as any).psnLoadPresence = async () => {
            const friends = useAppStore.getState().psnFriends;

            if (friends.length === 0) {
                console.warn('No friends to load presence for');
                return;
            }

            // Cleanup any existing listener
            if (presenceUnsubscribeRef.current) {
                presenceUnsubscribeRef.current();
                presenceUnsubscribeRef.current = null;
            }

            useAppStore.getState().setPSNPresenceLoading(true);
            useAppStore.getState().setPSNPresenceProgress({ current: 0, total: friends.length });

            const unsubscribe = window.electronAPI!.psn.onPresenceProgress((data) => {
                useAppStore.getState().setPSNPresenceProgress({ current: data.current, total: data.total });
            });
            presenceUnsubscribeRef.current = unsubscribe;

            try {
                const accountIds = friends.map(f => f.accountId);
                const presences = await window.electronAPI!.psn.getPresences(accountIds);

                // Get fresh friends list and merge presence data
                const currentFriends = useAppStore.getState().psnFriends;

                // presences is already an object (converted from Map in main.ts)
                useAppStore.getState().setPSNFriends(currentFriends.map(f => ({
                    ...f,
                    ...(presences[f.accountId] || {})
                })));
                useAppStore.getState().setPSNHasPresenceData(true);
            } catch (error) {
                console.error('Failed to load presence:', error);
            } finally {
                useAppStore.getState().setPSNPresenceLoading(false);
                if (presenceUnsubscribeRef.current) {
                    presenceUnsubscribeRef.current();
                    presenceUnsubscribeRef.current = null;
                }
            }
        };

        // Cleanup on unmount
        return () => {
            if (presenceUnsubscribeRef.current) {
                presenceUnsubscribeRef.current();
                presenceUnsubscribeRef.current = null;
            }
            delete (window as any).psnLoadPresence;
        };
    }, []); // No dependencies - only set up once

    return null;
}
