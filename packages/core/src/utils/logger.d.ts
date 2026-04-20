import pino, { type DestinationStream, type Logger } from "pino";
type TaskContext = {
    task_id: string;
};
export declare function createLogger(destination?: DestinationStream | NodeJS.WritableStream): Logger;
export declare const logger: pino.Logger;
export declare function withTaskContext<T>(task_id: string, fn: () => Promise<T>): Promise<T>;
export declare function getTaskContext(): TaskContext | undefined;
export {};
