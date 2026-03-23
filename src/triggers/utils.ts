
export function resolvePath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        if (Array.isArray(current)) {
            const idx = parseInt(part, 10);
            if (!isNaN(idx)) {
                current = current[idx];
                continue;
            }
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}
