import { EventEmitter } from 'node:events';

export class TypedEmitter<T extends { [K in keyof T]: (...args: any[]) => void }> {
    private emitter = new EventEmitter();

    on<K extends keyof T & string>(event: K, listener: T[K]): this {
        this.emitter.on(event, listener as any);
        return this;
    }

    once<K extends keyof T & string>(event: K, listener: T[K]): this {
        this.emitter.once(event, listener as any);
        return this;
    }

    off<K extends keyof T & string>(event: K, listener: T[K]): this {
        this.emitter.off(event, listener as any);
        return this;
    }

    emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): boolean {
        return this.emitter.emit(event, ...args);
    }

    removeAllListeners<K extends keyof T & string>(event?: K): this {
        if (event) {
            this.emitter.removeAllListeners(event);
        } else {
            this.emitter.removeAllListeners();
        }
        return this;
    }

    listenerCount<K extends keyof T & string>(event: K): number {
        return this.emitter.listenerCount(event);
    }
}
