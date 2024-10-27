// js/utils/performance-monitor.ts
import * as tf from '@tensorflow/tfjs';

export class PerformanceMonitor {
    private metrics: {
        fps: number[];
        inferenceTime: number[];
        memoryUsage: number[];
        tensorCount: number[];
    } = {
        fps: [],
        inferenceTime: [],
        memoryUsage: [],
        tensorCount: []
    };

    private readonly maxSamples: number = 60; // 1 second at 60fps
    private lastFrameTime: number = 0;

    public recordMetrics(inferenceTime: number): void {
        const now = performance.now();
        
        // Calculate FPS
        if (this.lastFrameTime > 0) {
            const fps = 1000 / (now - this.lastFrameTime);
            this.pushMetric('fps', fps);
        }
        this.lastFrameTime = now;

        // Record inference time
        this.pushMetric('inferenceTime', inferenceTime);

        // Record memory usage
        this.recordMemoryUsage();
    }

    private recordMemoryUsage(): void {
        const memoryInfo = tf.memory();
        this.pushMetric('memoryUsage', memoryInfo.numBytes);
        this.pushMetric('tensorCount', memoryInfo.numTensors);
    }

    private pushMetric(key: keyof typeof this.metrics, value: number): void {
        this.metrics[key].push(value);
        if (this.metrics[key].length > this.maxSamples) {
            this.metrics[key].shift();
        }
    }

    public getAverageMetrics(): {[key: string]: number} {
        const result: {[key: string]: number} = {};
        
        for (const [key, values] of Object.entries(this.metrics)) {
            if (values.length > 0) {
                const sum = values.reduce((a, b) => a + b, 0);
                result[key] = sum / values.length;
            }
        }

        return result;
    }

    public getMetricsReport(): string {
        const averages = this.getAverageMetrics();
        return `
Performance Report:
------------------
FPS: ${averages.fps.toFixed(2)}
Inference Time: ${averages.inferenceTime.toFixed(2)}ms
Memory Usage: ${(averages.memoryUsage / 1024 / 1024).toFixed(2)}MB
Active Tensors: ${averages.tensorCount}
        `.trim();
    }

    public reset(): void {
        Object.keys(this.metrics).forEach(key => {
            this.metrics[key as keyof typeof this.metrics] = [];
        });
        this.lastFrameTime = 0;
    }
}