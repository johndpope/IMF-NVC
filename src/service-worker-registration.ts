export function unregisterServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().then((success) => {
            console.log('Service worker unregistered:', success);
          });
        }
      });
    }
  }