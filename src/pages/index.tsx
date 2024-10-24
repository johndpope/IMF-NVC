import type { NextPage } from 'next'
import dynamic from 'next/dynamic'
import NVCClient from '@/components/NVCClient';
import { useEffect } from 'react';

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('Service Workers not supported');
    return;
  }

  try {
    // Unregister any existing service workers first
    const existingRegistrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(existingRegistrations.map(reg => reg.unregister()));

    // Register new service worker with specific options
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      // Add registration options for development
      updateViaCache: 'none'
    });

    // Log registration details
    console.log('Service Worker registration successful with scope:', registration.scope);

    // Handle updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      console.log('Service Worker update found!', newWorker);

      newWorker?.addEventListener('statechange', () => {
        console.log('Service Worker state changed:', newWorker.state);
      });
    });

    // Force activation
    if (registration.active) {
      registration.active.postMessage({ type: 'SKIP_WAITING' });
    }

  } catch (error) {
    console.error('Service Worker registration failed:', error);
    // Log additional error details
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
    }
  }
}

const Home: NextPage = () => {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      registerServiceWorker();
    }
  }, []);


  return (
    <div className="min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">TensorFlow.js Next.js Demo</h1>
        <NVCClient /> 
    </div>
  )
}

export default Home