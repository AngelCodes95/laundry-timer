// Basic timer with pause/resume functionality
class SimpleTimer {
  constructor(machineId, endTime) {
    this.machineId = machineId;
    this.endTime = endTime;
    this.isPaused = false;
    this.pausedTimeRemainingMs = 0; // EXACT milliseconds remaining when paused
    this.interval = setInterval(() => this.tick(), 1000);
    this.tick(); // Initial update
  }

  tick() {
    if (this.isPaused) return; // Don't tick when paused

    const now = Date.now();
    const timeRemainingMs = this.endTime - now;
    const timeRemainingMinutes = Math.max(0, Math.ceil(timeRemainingMs / (1000 * 60)));

    if (timeRemainingMs <= 0) {
      this.expire();
      return;
    }

    TimerManager.updateMachineDisplayOnly(
      this.machineId,
      'active',
      timeRemainingMinutes,
      timeRemainingMs
    );
  }

  pause() {
    if (this.isPaused) return;

    const now = Date.now();
    this.pausedTimeRemainingMs = this.endTime - now; // Store EXACT milliseconds
    this.isPaused = true;

    // Display in minutes for UI
    const displayMinutes = Math.ceil(this.pausedTimeRemainingMs / (1000 * 60));
    TimerManager.updateMachineDisplayOnly(this.machineId, 'paused', displayMinutes);
  }

  resume() {
    if (!this.isPaused) return;

    // Restart timer with EXACT remaining time
    const now = Date.now();
    this.endTime = now + this.pausedTimeRemainingMs; // Use exact milliseconds
    this.isPaused = false;

    // Immediate tick to update display
    this.tick();
  }

  expire() {
    clearInterval(this.interval);
    TimerManager.updateMachineDisplayOnly(this.machineId, 'available', 0, 0);
    TimerManager.timers.delete(this.machineId);
  }

  stop() {
    clearInterval(this.interval);
  }

  getTimeRemaining() {
    if (this.isPaused) {
      return Math.ceil(this.pausedTimeRemainingMs / (1000 * 60));
    }
    const now = Date.now();
    const timeRemainingMs = this.endTime - now;
    return Math.max(0, Math.ceil(timeRemainingMs / (1000 * 60)));
  }
}

export default class TimerManager {
  static timers = new Map(); // Timer instances

  static formatTime(minutes) {
    if (minutes <= 0) return 'Available';
    if (minutes === 1) return '1 min left';
    return `${minutes} min left`;
  }

  // Start a timer with end time
  static startTimer(machineId, endTime) {
    this.stopTimer(machineId);
    const timer = new SimpleTimer(machineId, endTime);
    this.timers.set(machineId, timer);
  }

  static stopTimer(machineId) {
    const timer = this.timers.get(machineId);
    if (timer) {
      timer.stop();
      this.timers.delete(machineId);
    }
    this.updateMachineDisplayOnly(machineId, 'available', 0, 0);
  }

  static pauseTimer(machineId) {
    const timer = this.timers.get(machineId);
    if (timer) {
      timer.pause();
    }
  }

  static resumeTimer(machineId) {
    const timer = this.timers.get(machineId);
    if (timer) {
      timer.resume();
    }
  }

  // Display-only update method (no timer management)
  static updateMachineDisplayOnly(machineId, status, timeRemaining, timeRemainingMs = null) {
    const card = document.getElementById(`machine-${machineId}`);
    if (!card) {
      console.warn(`Machine card not found: ${machineId}`);
      return;
    }

    const timerDisplay = card.querySelector('.timer-display');
    const actionButtons = card.querySelector('.action-buttons');
    const runningStatus = card.querySelector('.running-status');

    if (!timerDisplay || !actionButtons || !runningStatus) {
      console.warn(`Missing elements in machine card: ${machineId}`);
      return;
    }

    // Update card state class
    card.className = `machine-card ${status}`;

    if (status === 'active') {
      timerDisplay.textContent = this.formatTime(timeRemaining);
      actionButtons.style.display = 'none';
      runningStatus.style.display = 'block';

      // Create running status with DOM APIs
      runningStatus.textContent = '';

      const runningText = document.createElement('div');
      runningText.className = 'running-text';
      runningText.textContent = 'Running...';
      runningStatus.appendChild(runningText);

      const controlButtons = document.createElement('div');
      controlButtons.className = 'control-buttons';

      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'btn btn-small btn-warning pause-timer';
      pauseBtn.setAttribute('data-machine', machineId);
      pauseBtn.textContent = 'Pause';
      controlButtons.appendChild(pauseBtn);

      const stopBtn = document.createElement('button');
      stopBtn.className = 'btn btn-small btn-danger stop-timer';
      stopBtn.setAttribute('data-machine', machineId);
      stopBtn.textContent = 'Stop';
      controlButtons.appendChild(stopBtn);

      runningStatus.appendChild(controlButtons);

      // Visual urgency indicators
      if (timeRemainingMs && timeRemainingMs <= 60000) {
        // Last minute
        card.classList.add('almost-done');
      } else {
        card.classList.remove('almost-done');
      }
    } else if (status === 'paused') {
      timerDisplay.textContent = this.formatTime(timeRemaining);
      actionButtons.style.display = 'none';
      runningStatus.style.display = 'block';

      runningStatus.textContent = '';

      const pausedText = document.createElement('div');
      pausedText.className = 'paused-text';
      pausedText.textContent = 'Paused';
      runningStatus.appendChild(pausedText);

      const controlButtons = document.createElement('div');
      controlButtons.className = 'control-buttons';

      const resumeBtn = document.createElement('button');
      resumeBtn.className = 'btn btn-small btn-success resume-timer';
      resumeBtn.setAttribute('data-machine', machineId);
      resumeBtn.textContent = 'Resume';
      controlButtons.appendChild(resumeBtn);

      const stopBtn = document.createElement('button');
      stopBtn.className = 'btn btn-small btn-danger stop-timer';
      stopBtn.setAttribute('data-machine', machineId);
      stopBtn.textContent = 'Stop';
      controlButtons.appendChild(stopBtn);

      runningStatus.appendChild(controlButtons);
      card.classList.add('paused');
    } else {
      timerDisplay.textContent = 'Available';
      actionButtons.style.display = 'flex';
      runningStatus.style.display = 'none';
      card.classList.remove('almost-done', 'paused');
    }
  }

  static updateAllMachines(machines) {
    if (!Array.isArray(machines)) {
      console.error('Invalid machines data:', machines);
      return;
    }

    machines.forEach((machine) => {
      if (!machine?.machine_id) return;

      if (machine.status === 'active' && machine.server_end_time) {
        // Start timer if none exists
        if (!this.timers.has(machine.machine_id)) {
          this.startTimer(machine.machine_id, machine.server_end_time);
        }
      } else {
        // Stop timer for non-active machines
        this.stopTimer(machine.machine_id);
      }
    });
  }

  static updateLastRefreshTime() {
    // No longer needed - last updated handled by main app updateLastUpdatedTime
  }

  static showLoadingState(machineId) {
    const card = document.getElementById(`machine-${machineId}`);
    if (card) {
      card.classList.add('loading');
    }
  }

  static hideLoadingState(machineId) {
    const card = document.getElementById(`machine-${machineId}`);
    if (card) {
      card.classList.remove('loading');
    }
  }

  static getStandardDuration(machineId) {
    return machineId.startsWith('washer') ? 29 : 60;
  }

  static validateMachineId(machineId) {
    const pattern = /^(washer|dryer)_[1-4]$/;
    return pattern.test(machineId);
  }

  static validateDuration(minutes) {
    const duration = parseInt(minutes);
    return !isNaN(duration) && duration >= 1 && duration <= 120;
  }

  static cleanupAllTimers() {
    for (const timer of this.timers.values()) {
      timer.stop();
    }
    this.timers.clear();
  }
}
