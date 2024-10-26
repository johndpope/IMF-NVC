
const decoder = new IMFDecoder();
decoder.enableMetrics();

setInterval(() => {
  const metrics = decoder.getMetrics();
  console.log('FPS:', metrics.fps);
  console.log('Memory:', metrics.memoryUsage);
  console.log('Queue Size:', metrics.queueSize);
}, 1000);