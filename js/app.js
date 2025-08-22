import FirebaseService from './firebase-service.js';
import TimerManager from './timer.js';
import ModalManager from './modal.js';

// Create global instances for backwards compatibility
window.FirebaseService = new FirebaseService();
window.TimerManager = TimerManager;
window.ModalManager = ModalManager;

class ErrorHandler {
  static handleFrontendError(error, context) {
    console.error(`Frontend Error in ${context}:`, {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    let userMessage = 'Something went wrong. Please try again.';

    if (error instanceof ValidationError) {
      userMessage = error.message;
    } else if (error instanceof NetworkError) {
      userMessage = 'Network error. Please check your connection and try again.';
    }

    this.showUserNotification(userMessage, 'error');
  }

  static showUserNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) {
      console.error('Notification container not found');
      return;
    }

    const notification = document.createElement('div');
    notification.className = `notification notification--${type}`;
    notification.textContent = message;

    container.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);

    // Remove on click
    notification.addEventListener('click', () => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });
  }
}

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

// Expose for debugging
if (typeof window !== 'undefined') {
  window.ErrorHandler = ErrorHandler;
}
class LaundryApp {
  constructor() {
    LaundryApp.instance = this;
    window.LaundryApp = LaundryApp; // Make available globally for modal callbacks

    this.isPageVisible = true;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.firebaseListener = null;
    this.pendingTimerStarts = new Set(); // Prevent rapid-fire timer starts

    this.init();
  }

  async init() {
    try {
      // Remove preload class to enable animations after DOM is ready
      setTimeout(() => {
        document.body.classList.remove('preload');
      }, 100);

      // Ensure modals are properly hidden on initialization
      const modal = document.getElementById('custom-timer-modal');
      if (modal) {
        modal.classList.remove('show');
      }

      this.setupThemeToggle();
      this.setupVisibilityHandler();
      this.setupDisclaimerToggle();
      // Timers self-manage - no health checks needed
      this.bindEvents();

      // Wait for Firebase service to initialize
      while (!window.FirebaseService || !window.FirebaseService.database) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Start real-time listening (no more polling!)
      this.startRealtimeSync();
    } catch (error) {
      ErrorHandler.handleFrontendError(error, 'init');
    }
  }

  bindEvents() {
    try {
      // Start timer buttons
      document.querySelectorAll('.start-timer').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const machineId = e.target.dataset.machine;
          if (machineId) {
            const minutes = TimerManager.getStandardDuration(machineId);
            this.setTimer(machineId, minutes);
          }
        });
      });

      // Custom timer buttons
      document.querySelectorAll('.custom-timer').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const machineId = e.target.dataset.machine;
          if (machineId) {
            ModalManager.showCustomTimer(machineId);
          }
        });
      });

      // How to Use buttons
      const howToUseBtn = document.getElementById('how-to-use-toggle');
      const howToUseBtnMobile = document.getElementById('how-to-use-toggle-mobile');

      if (howToUseBtn) {
        howToUseBtn.addEventListener('click', () => {
          this.toggleHowToUse('how-to-use-content', howToUseBtn);
        });
      }

      if (howToUseBtnMobile) {
        howToUseBtnMobile.addEventListener('click', () => {
          this.toggleHowToUse('how-to-use-content-mobile', howToUseBtnMobile);
        });
      }

      // Global error handler
      window.addEventListener('error', (e) => {
        ErrorHandler.handleFrontendError(e.error, 'global');
      });

      // Unhandled promise rejection handler
      window.addEventListener('unhandledrejection', (e) => {
        ErrorHandler.handleFrontendError(e.reason, 'unhandledPromise');
        e.preventDefault();
      });

      // Control button handlers (delegated to handle dynamically created buttons)
      document.addEventListener('click', (e) => {
        if (e.target.classList.contains('pause-timer')) {
          const machineId = e.target.dataset.machine;
          this.controlTimer(machineId, 'pause');
        } else if (e.target.classList.contains('resume-timer')) {
          const machineId = e.target.dataset.machine;
          this.controlTimer(machineId, 'resume');
        } else if (e.target.classList.contains('stop-timer')) {
          const machineId = e.target.dataset.machine;
          this.controlTimer(machineId, 'stop');
        }
      });
    } catch (error) {
      ErrorHandler.handleFrontendError(error, 'bindEvents');
    }
  }

  setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    const themeToggleDesktop = document.getElementById('theme-toggle-desktop');

    // Get system preference
    const getSystemPreference = () => {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    };

    // Check for saved theme or use system preference
    const savedTheme = localStorage.getItem('theme');
    const initialTheme = savedTheme || getSystemPreference();
    document.body.classList.toggle('dark', initialTheme === 'dark');

    const toggleTheme = () => {
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    };

    // Listen for system theme changes if no manual preference is set
    if (!savedTheme && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addListener((e) => {
        if (!localStorage.getItem('theme')) {
          document.body.classList.toggle('dark', e.matches);
        }
      });
    }

    if (themeToggle) {
      themeToggle.addEventListener('click', toggleTheme);
    }

    if (themeToggleDesktop) {
      themeToggleDesktop.addEventListener('click', toggleTheme);
    }
  }

  setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      this.isPageVisible = !document.hidden;

      if (this.isPageVisible) {
        // Page became visible, restart real-time sync if needed
        if (!this.firebaseListener) {
          this.startRealtimeSync();
        }
        // Timers will resume automatically when page becomes visible
      } else {
        // Page hidden, stop real-time sync to save resources
        this.stopRealtimeSync();
      }
    });

    // Handle window focus/blur as backup
    window.addEventListener('focus', () => {
      if (this.isPageVisible && !this.firebaseListener) {
        this.startRealtimeSync();
      }
      // Restart timer monitoring if there are active timers
      if (this.isPageVisible && TimerManager.timers.size > 0) {
        // No complex monitoring needed with simple timers
      }
    });
  }

  setupDisclaimerToggle() {
    // Set up disclaimer toggle for both mobile and desktop
    const disclaimerToggles = document.querySelectorAll('#disclaimer-toggle, .disclaimer-toggle');

    disclaimerToggles.forEach((toggle) => {
      if (toggle) {
        const disclaimerContent = toggle
          .closest('.disclaimer-container')
          ?.querySelector('.disclaimer-content');

        toggle.addEventListener('click', () => {
          const isExpanded = disclaimerContent.classList.contains('expanded');

          if (isExpanded) {
            disclaimerContent.classList.remove('expanded');
            toggle.classList.remove('expanded');
            toggle.setAttribute('aria-expanded', 'false');
          } else {
            disclaimerContent.classList.add('expanded');
            toggle.classList.add('expanded');
            toggle.setAttribute('aria-expanded', 'true');
          }
        });

        // Set initial aria attributes
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', disclaimerContent?.id || 'disclaimer-content');
      }
    });
  }

  toggleHowToUse(contentId, buttonElement) {
    const content = document.getElementById(contentId);
    if (!content) {
      console.error(`How to use content not found: ${contentId}`);
      return;
    }

    const isExpanded = content.classList.contains('expanded');

    if (isExpanded) {
      content.classList.remove('expanded');
      buttonElement.classList.remove('expanded');
      buttonElement.setAttribute('aria-expanded', 'false');
    } else {
      content.classList.add('expanded');
      buttonElement.classList.add('expanded');
      buttonElement.setAttribute('aria-expanded', 'true');

      // Smooth scroll to show the expanded content
      setTimeout(() => {
        content.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }, 100);
    }
  }

  async forceFirebaseResync() {
    try {
      // Restart Firebase listener to force fresh data
      this.stopRealtimeSync();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Brief pause
      this.startRealtimeSync();
    } catch (error) {
      console.error('Firebase resync failed:', error);
    }
  }

  getActiveMachines() {
    const activeMachines = [];
    // Order machines 4,3,2,1 to match physical room layout (4 at back/top, 1 at front/bottom)
    const allMachineIds = [
      'washer_4',
      'washer_3',
      'washer_2',
      'washer_1',
      'dryer_4',
      'dryer_3',
      'dryer_2',
      'dryer_1',
    ];

    allMachineIds.forEach((machineId) => {
      const machineCard = document.getElementById(`machine-${machineId}`);
      if (machineCard && machineCard.classList.contains('active')) {
        const timerDisplay = machineCard.querySelector('.timer-display');
        const timeText = timerDisplay ? timerDisplay.textContent : '';
        const timeMatch = timeText.match(/(\d+)\s*min/);
        const timeRemaining = timeMatch ? parseInt(timeMatch[1]) : 0;

        if (timeRemaining > 0) {
          activeMachines.push({
            id: machineId,
            name: machineId.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
            timeRemaining,
          });
        }
      }
    });

    return activeMachines;
  }

  async setTimer(machineId, minutes) {
    // Prevent rapid-fire timer starts for the same machine
    if (this.pendingTimerStarts.has(machineId)) {
      console.warn(`Timer start already pending for ${machineId}, ignoring duplicate request`);
      return;
    }

    this.pendingTimerStarts.add(machineId);

    try {
      if (!TimerManager.validateMachineId(machineId)) {
        throw new ValidationError('Invalid machine ID', 'machine_id');
      }

      // Input validation
      if (!TimerManager.validateDuration(minutes)) {
        throw new Error(`Invalid timer duration: ${minutes}`);
      }
      const validatedMinutes = parseInt(minutes);

      TimerManager.showLoadingState(machineId);

      // Aggressive retry logic with force cleanup
      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await window.FirebaseService.setTimer(machineId, validatedMinutes);
          break; // Success, exit retry loop
        } catch (error) {
          if (error.message === 'Machine is currently in use' && attempt < maxRetries) {
            // EMERGENCY: Nuclear cleanup before retry
            console.warn(
              `Timer start attempt ${attempt} failed for ${machineId}, performing emergency cleanup...`
            );

            try {
              // Clear Firebase data directly
              const { ref, remove } = window.FirebaseService.getFirebaseFunctions();
              const machineRef = ref(window.FirebaseService.database, `machines/${machineId}`);
              await remove(machineRef);

              // Clear any client-side timer
              TimerManager.stopTimer(machineId);

              console.warn(`Emergency cleanup completed for ${machineId}`);
            } catch (cleanupError) {
              console.warn('Emergency cleanup failed:', cleanupError);
            }

            await new Promise((resolve) => setTimeout(resolve, 500)); // Longer delay
            continue;
          }
          throw error; // Non-retryable error or max retries reached
        }
      }

      // UI updates automatically via Firebase sync

      this.retryCount = 0; // Reset retry count on success
    } catch (error) {
      ErrorHandler.handleFrontendError(error, 'setTimer');
    } finally {
      TimerManager.hideLoadingState(machineId);

      // Remove from pending set after delay to prevent immediate duplicates
      setTimeout(() => {
        this.pendingTimerStarts.delete(machineId);
      }, 1000); // 1 second cooldown
    }
  }

  async controlTimer(machineId, action) {
    try {
      if (!TimerManager.validateMachineId(machineId)) {
        throw new Error('Invalid machine ID');
      }

      TimerManager.showLoadingState(machineId);

      // Handle timer control actions
      if (action === 'pause') {
        TimerManager.pauseTimer(machineId);
      } else if (action === 'resume') {
        TimerManager.resumeTimer(machineId);
      } else if (action === 'stop') {
        TimerManager.stopTimer(machineId);
        // Also remove from Firebase
        if (window.FirebaseService) {
          await window.FirebaseService.controlTimer(machineId, 'stop');
        }
      }
    } catch (error) {
      ErrorHandler.handleFrontendError(error, 'controlTimer');
    } finally {
      TimerManager.hideLoadingState(machineId);
    }
  }

  async startRealtimeSync() {
    try {
      // Set up real-time listener
      this.firebaseListener = await window.FirebaseService.listenToMachines((data) => {
        if (data && data.machines) {
          TimerManager.updateAllMachines(data.machines, data.timestamp);
          this.updateLastUpdatedTime();
          this.retryCount = 0;
        } else {
          console.warn('Invalid data received from Firebase');
        }
      });
    } catch (error) {
      console.error('Failed to start real-time sync:', error);
      ErrorHandler.showUserNotification(
        'Unable to connect to real-time updates. Please refresh the page.',
        'warning'
      );
    }
  }

  stopRealtimeSync() {
    if (this.firebaseListener) {
      this.firebaseListener();
      this.firebaseListener = null;
    }
  }

  // Force Firebase refresh for health check recovery
  async refreshStatus() {
    try {
      // Force a one-time Firebase read to update stale timers
      const { ref, get } = window.FirebaseService.getFirebaseFunctions();
      const machinesRef = ref(window.FirebaseService.database, 'machines');
      const snapshot = await get(machinesRef);
      const data = snapshot.val() || {};

      // Process and sync the fresh data through the normal pipeline
      const machines = window.FirebaseService.processMachineData(data, Date.now());
      TimerManager.updateAllMachines(machines);
    } catch (error) {
      console.error('Failed to refresh Firebase status:', error);
    }
  }

  updateLastUpdatedTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updateText = `Last updated: ${dateStr} at ${timeStr}`;

    // Update both mobile and desktop elements
    const lastUpdatedMobile = document.getElementById('last-updated');
    const lastUpdatedDesktop = document.getElementById('last-updated-desktop');

    if (lastUpdatedMobile) {
      lastUpdatedMobile.textContent = updateText;
    }
    if (lastUpdatedDesktop) {
      lastUpdatedDesktop.textContent = updateText;
    }
  }

  // Cleanup method for page unload
  cleanup() {
    this.stopRealtimeSync();
    // Timers are automatically stopped in cleanupAllTimers()

    // Clean up all timers
    TimerManager.cleanupAllTimers();

    if (window.FirebaseService) {
      window.FirebaseService.cleanup();
    }
  }

  // Get current status for debugging
  getStatus() {
    return {
      hasRealtimeSync: !!this.firebaseListener,
      isPageVisible: this.isPageVisible,
      retryCount: this.retryCount,
    };
  }
}

// Make classes globally available
window.ErrorHandler = ErrorHandler;
window.ValidationError = ValidationError;
window.NetworkError = NetworkError;
window.LaundryApp = LaundryApp;

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    new LaundryApp();
  } catch (error) {
    console.error('Failed to initialize LaundryApp:', error);

    // Show fallback error message using DOM APIs - no innerHTML or inline onclick
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'padding: 2rem; text-align: center; color: #e74c3c;';

    const heading = document.createElement('h1');
    heading.textContent = 'Error Loading Application';
    errorDiv.appendChild(heading);

    const paragraph = document.createElement('p');
    paragraph.textContent = 'Please refresh the page to try again.';
    errorDiv.appendChild(paragraph);

    const refreshButton = document.createElement('button');
    refreshButton.textContent = 'Refresh Page';
    refreshButton.style.cssText = 'padding: 1rem 2rem; margin-top: 1rem; font-size: 1rem;';
    refreshButton.addEventListener('click', () => window.location.reload());
    errorDiv.appendChild(refreshButton);

    document.body.replaceChildren(errorDiv);
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (LaundryApp.instance) {
    LaundryApp.instance.cleanup();
  }
});

// Global functions for modal close buttons (called from HTML onclick)
window.closeNotificationModal = function () {
  if (LaundryApp.instance) {
    LaundryApp.instance.closeNotificationModal();
  }
};

// Event delegation for modal actions
document.addEventListener('click', (event) => {
  const action = event.target.getAttribute('data-action');
  if (!action) return;

  switch (action) {
    case 'close-custom-timer':
      if (window.ModalManager) {
        window.ModalManager.closeCustomTimerModal();
      }
      break;
    case 'submit-custom-timer':
      if (window.ModalManager) {
        window.ModalManager.submitCustomTimer();
      }
      break;
  }
});
