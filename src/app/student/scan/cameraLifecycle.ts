/** Browser SDK boundary with deterministic cancellation and callback suppression. */
export type CameraDriver = {
    start(onDecoded: (text: string) => void): Promise<void>;
    stop(): Promise<void>;
    clear(): void;
    readonly isScanning: boolean;
};
export function cameraLifecycle(load: () => Promise<CameraDriver>, decoded: (text: string) => Promise<void>, state: (running: boolean) => void, onError: () => void) {
    let driver: CameraDriver | null = null, closed = false, starting = false, desired = false, processing = false;
    async function cleanup() { const d = driver; if (d?.isScanning)
        try {
            await d.stop();
        }
        catch { /* Already stopped by browser. */ } if (d && !d.isScanning)
        try {
            d.clear();
        }
        catch { /* Container may have unmounted. */ } if (!closed)
        state(false); }
    return {
        async start() {
            if (closed || starting || driver?.isScanning)
                return;
            starting = true;
            desired = true;
            try {
                driver = await load();
                if (closed || !desired) {
                    await cleanup();
                    return;
                }
                await driver.start(text => { if (closed || !desired || processing)
                    return; processing = true; desired = false; void (async () => { try {
                    await cleanup();
                    if (!closed)
                        await decoded(text);
                }
                finally {
                    processing = false;
                } })(); });
                if (closed || !desired)
                    await cleanup();
                else
                    state(true);
            }
            catch {
                await cleanup();
                if (!closed)
                    onError();
            }
            finally {
                starting = false;
            }
        },
        async stop() { desired = false; await cleanup(); },
        async dispose() { closed = true; desired = false; await cleanup(); },
    };
}
