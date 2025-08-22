let currentCustomTimerMachine = null;
let isSubmitting = false; // Prevent rapid-fire submissions

class ModalManager {
  static showCustomTimer(machineId) {
    currentCustomTimerMachine = machineId;
    const modal = document.getElementById('custom-timer-modal');
    const input = document.getElementById('custom-minutes');

    input.value = 30;
    modal.classList.add('show');

    // Set up event listeners for the new controls
    this.setupTimeInputControls();

    // Focus on input after a short delay to ensure modal is visible
    setTimeout(() => input.focus(), 100);
  }

  static closeCustomTimerModal() {
    const modal = document.getElementById('custom-timer-modal');
    modal.classList.remove('show');
    currentCustomTimerMachine = null;
  }

  static async submitCustomTimer() {
    if (!currentCustomTimerMachine || isSubmitting) return;

    // Prevent rapid-fire submissions
    isSubmitting = true;

    // Preserve machine ID before modal closure
    const machineId = currentCustomTimerMachine;

    try {
      const minutes = parseInt(document.getElementById('custom-minutes').value);

      if (minutes < 1 || minutes > 120) {
        if (window.ErrorHandler) {
          window.ErrorHandler.showUserNotification(
            'Please enter a valid duration between 1 and 120 minutes',
            'error'
          );
        }
        return;
      }

      // Close modal immediately for better UX
      this.closeCustomTimerModal();

      // Use preserved machine ID, not the global variable
      if (window.LaundryApp && window.LaundryApp.instance && machineId) {
        await window.LaundryApp.instance.setTimer(machineId, minutes);
      }
    } catch (error) {
      console.error('Custom timer submission failed:', error);
      if (window.ErrorHandler) {
        window.ErrorHandler.showUserNotification(
          'Failed to start timer. Please try again.',
          'error'
        );
      }
    } finally {
      // Reset submission flag after delay
      setTimeout(() => {
        isSubmitting = false;
      }, 1000); // 1 second cooldown
    }
  }

  static setupTimeInputControls() {
    const input = document.getElementById('custom-minutes');
    const incrementBtn = document.getElementById('time-increment');
    const decrementBtn = document.getElementById('time-decrement');
    const presetBtns = document.querySelectorAll('.preset-btn');

    // Remove existing listeners to prevent duplicates
    const newIncrementBtn = incrementBtn.cloneNode(true);
    const newDecrementBtn = decrementBtn.cloneNode(true);
    incrementBtn.parentNode.replaceChild(newIncrementBtn, incrementBtn);
    decrementBtn.parentNode.replaceChild(newDecrementBtn, decrementBtn);

    // Increment button - increase by 1 minute
    newIncrementBtn.addEventListener('click', () => {
      const currentValue = parseInt(input.value) || 30;
      const newValue = Math.min(currentValue + 1, 120);
      input.value = newValue;
      this.updatePresetHighlight(newValue);
      input.focus();
    });

    // Decrement button - decrease by 1 minute
    newDecrementBtn.addEventListener('click', () => {
      const currentValue = parseInt(input.value) || 30;
      const newValue = Math.max(currentValue - 1, 1);
      input.value = newValue;
      this.updatePresetHighlight(newValue);
      input.focus();
    });

    // Input validation and preset highlighting
    input.addEventListener('input', () => {
      const value = parseInt(input.value);
      this.updatePresetHighlight(value);

      // Enforce limits
      if (value > 120) {
        input.value = 120;
      } else if (value < 1 && input.value !== '') {
        input.value = 1;
      }
    });

    // Preset buttons
    presetBtns.forEach((btn) => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', () => {
        const minutes = parseInt(newBtn.dataset.minutes);
        input.value = minutes;
        this.updatePresetHighlight(minutes);
        input.focus();
      });
    });

    // Initial preset highlighting
    this.updatePresetHighlight(parseInt(input.value));

    // Allow Enter key to submit
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submitCustomTimer();
      }
    });
  }

  static updatePresetHighlight(currentValue) {
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      const btnValue = parseInt(btn.dataset.minutes);
      if (btnValue === currentValue) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}

// Event delegation for modal actions - no inline onclick handlers
document.addEventListener('click', (e) => {
  const action = e.target.getAttribute('data-action');
  if (!action) return;

  switch (action) {
    case 'close-custom-timer':
      ModalManager.closeCustomTimerModal();
      break;
    case 'submit-custom-timer':
      ModalManager.submitCustomTimer();
      break;
    case 'close-notification-modal':
      if (window.LaundryApp && window.LaundryApp.instance) {
        window.LaundryApp.instance.closeNotificationModal();
      }
      break;
  }
});

export default ModalManager;
