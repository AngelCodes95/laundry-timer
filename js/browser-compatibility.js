/**
 * Browser compatibility detection and fallback handling
 * Focuses on core timer functionality and storage capabilities
 */

class BrowserCompatibilityManager {
  constructor() {
    this.capabilities = this.detectCapabilities();
    this.isInitialized = false;
  }

  detectCapabilities() {
    const userAgent = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(userAgent);
    const isSafari = /Safari/.test(userAgent) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(userAgent);
    const isIOSSafari = isIOS && isSafari;
    const isIOSChrome = isIOS && /CriOS/.test(userAgent);
    const iosVersion = isIOS ? this.getIOSVersion() : null;

    return {
      // Platform detection
      isIOS,
      isSafari,
      isIOSSafari,
      isIOSChrome,
      iosVersion,

      // Storage capabilities
      supportsLocalStorage: this.testLocalStorage(),
      supportsSessionStorage: this.testSessionStorage(),

      // Network capabilities
      supportsOnlineStatus: 'onLine' in navigator,

      // Performance capabilities
      supportsRequestIdleCallback: 'requestIdleCallback' in window,
      supportsIntersectionObserver: 'IntersectionObserver' in window,
    };
  }

  getIOSVersion() {
    const match = navigator.userAgent.match(/OS (\d+)_(\d+)_?(\d+)?/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      return parseFloat(`${major}.${minor}`);
    }
    return null;
  }

  testLocalStorage() {
    try {
      const test = '__localStorage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  testSessionStorage() {
    try {
      const test = '__sessionStorage_test__';
      sessionStorage.setItem(test, test);
      sessionStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  getFeatureSupport() {
    return {
      realTimeUpdates: true,
      offlineMode: this.capabilities.supportsLocalStorage,
    };
  }

  initialize() {
    if (this.isInitialized) return;

    // Listen for online/offline status if supported
    if (this.capabilities.supportsOnlineStatus) {
      window.addEventListener('online', () => {
        if (window.ErrorHandler) {
          window.ErrorHandler.showUserNotification('Connection restored', 'success');
        }
      });

      window.addEventListener('offline', () => {
        if (window.ErrorHandler) {
          window.ErrorHandler.showUserNotification(
            'Working offline - changes will sync when reconnected',
            'warning'
          );
        }
      });
    }

    this.isInitialized = true;
  }

  // Public API for other components
  static getInstance() {
    if (!window._browserCompatibilityManager) {
      window._browserCompatibilityManager = new BrowserCompatibilityManager();
    }
    return window._browserCompatibilityManager;
  }
}

// Auto-initialize when script loads
document.addEventListener('DOMContentLoaded', () => {
  const manager = BrowserCompatibilityManager.getInstance();
  manager.initialize();
});

// Expose globally for other components
window.BrowserCompatibilityManager = BrowserCompatibilityManager;
