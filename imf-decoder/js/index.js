async function init() {
  try {
      const decoder = await import('../pkg');
      decoder.initialize();
      console.log('Decoder loaded:', decoder);
  } catch (e) {
      console.error('Failed to load decoder:', e);
  }
}

init();