import {
  database,
  ref,
  onValue,
  off,
  runTransaction,
  get,
  set,
  remove,
} from './firebase-config.js';

class FirebaseService {
  constructor() {
    this.database = database;
    this.listeners = new Map();
    this.pendingTransactions = new Map(); // Prevent duplicate transactions
  }

  async setTimer(machineId, minutes) {
    if (!this.database) {
      throw new Error('Firebase not initialized');
    }

    // Prevent duplicate transactions for the same machine
    const pendingKey = `setTimer_${machineId}`;
    if (this.pendingTransactions.has(pendingKey)) {
      console.warn(`Transaction already pending for ${machineId}, waiting...`);
      try {
        return await this.pendingTransactions.get(pendingKey);
      } catch (error) {
        // If pending transaction failed, continue with new one
        this.pendingTransactions.delete(pendingKey);
      }
    }

    const machineRef = ref(this.database, `machines/${machineId}`);

    // Track pending transaction
    const transactionPromise = this.executeSetTimerTransaction(machineRef, machineId, minutes);
    this.pendingTransactions.set(pendingKey, transactionPromise);

    try {
      const result = await transactionPromise;
      return result;
    } finally {
      this.pendingTransactions.delete(pendingKey);
    }
  }

  async executeSetTimerTransaction(machineRef, machineId, minutes) {
    // Race condition protection with atomic transactions
    const result = await runTransaction(machineRef, (currentData) => {
      const now = Date.now();

      // Input validation and sanitization
      if (!this.validateMachineId(machineId)) {
        throw new Error('Invalid machine ID');
      }

      if (!this.validateDuration(minutes)) {
        throw new Error('Invalid timer duration');
      }

      // Aggressive force-override for user experience
      if (currentData && currentData.status === 'active') {
        const timeRemaining = currentData.end_time - now;

        // ALWAYS allow override - users should have control
        // Only warn if significant time remaining
        if (timeRemaining > 60000) {
          // 1 minute buffer
          console.warn(
            `Force-overriding timer for ${machineId} (${Math.round(timeRemaining / 1000)}s remaining)`
          );
        }

        // NEVER block - always allow user to override existing timers
        // This provides better UX and eliminates "Machine is currently in use" errors
      }

      // Set new timer data atomically with validated inputs
      const endTime = now + minutes * 60 * 1000;
      return {
        machine_id: this.sanitizeString(machineId),
        status: 'active',
        end_time: endTime,
        updated_at: now,
        duration_minutes: parseInt(minutes),
      };
    });

    if (!result.committed) {
      throw new Error('Failed to start timer - machine may be in use');
    }

    return { success: true, machine_id: machineId, duration: minutes };
  }

  // Input validation methods
  validateMachineId(machineId) {
    if (!machineId || typeof machineId !== 'string') return false;
    return /^(washer|dryer)_[1-4]$/.test(machineId);
  }

  validateDuration(minutes) {
    const duration = parseInt(minutes);
    return !isNaN(duration) && duration >= 1 && duration <= 120;
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>"'&]/g, '').trim();
  }

  async controlTimer(machineId, action) {
    if (!this.database) {
      throw new Error('Firebase not initialized');
    }

    const machineRef = ref(this.database, `machines/${machineId}`);
    const snapshot = await get(machineRef);

    if (!snapshot.exists()) {
      throw new Error('Machine not found or not running');
    }

    const machine = snapshot.val();
    const now = Date.now();

    switch (action) {
      case 'stop':
        // Remove the machine (makes it available)
        await remove(machineRef);
        return { success: true, action: 'stop', machine_id: machineId };

      case 'pause': {
        if (machine.status !== 'active') {
          throw new Error('Can only pause active timers');
        }

        const timeRemainingMs = machine.end_time - now;
        const timeRemainingMinutes = Math.ceil(timeRemainingMs / (1000 * 60));

        const pausedData = {
          ...machine,
          status: 'paused',
          paused_at: now,
          paused_time_remaining: timeRemainingMinutes,
          updated_at: now,
        };

        await set(machineRef, pausedData);
        return { success: true, action: 'pause', machine_id: machineId };
      }

      case 'resume': {
        if (machine.status !== 'paused') {
          throw new Error('Can only resume paused timers');
        }

        const resumeEndTime = now + machine.paused_time_remaining * 60 * 1000;

        const resumedData = {
          ...machine,
          status: 'active',
          end_time: resumeEndTime,
          resumed_at: now,
          updated_at: now,
        };

        // Remove pause-specific fields
        delete resumedData.paused_at;
        delete resumedData.paused_time_remaining;

        await set(machineRef, resumedData);
        return { success: true, action: 'resume', machine_id: machineId };
      }
    }
  }

  async listenToMachines(callback) {
    if (!this.database) {
      throw new Error('Firebase not initialized');
    }

    const machinesRef = ref(this.database, 'machines');

    // Smart debouncing to prevent cascade operations
    let debounceTimeout = null;
    let lastProcessTime = 0;
    const MIN_PROCESS_INTERVAL = 2000; // 2 seconds minimum between processing

    const processUpdate = async (snapshot) => {
      const now = Date.now();
      lastProcessTime = now;

      const data = snapshot.val() || {};

      // Selective cleanup - only expired timers (disabled during critical final minutes)
      const expiredTimers = this.identifyExpiredTimers(data, now);
      const hasShortTimers = Object.values(data).some(
        (machine) =>
          machine.status === 'active' &&
          machine.end_time - now <= 120000 && // 2 minutes
          machine.end_time - now > 0 // Exclude expired timers from short timer check
      );

      if (expiredTimers.length > 0 && !hasShortTimers) {
        // Only do cleanup if no timers are in critical final 2 minutes
        this.batchCleanupExpiredTimers(expiredTimers).catch((error) => {
          console.error('Background cleanup failed:', error);
        });
      } else if (expiredTimers.length > 0 && hasShortTimers) {
        // Skip cleanup while timers are in critical final minutes
      }

      // Process data immediately for UI responsiveness
      const machines = this.processMachineData(data, now);

      // Just sync timers
      this.syncTimers(machines);

      callback({ machines, timestamp: new Date(now).toISOString() });
    };

    const listener = onValue(machinesRef, async (snapshot) => {
      const now = Date.now();

      // Clear existing debounce
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      // Smart rate limiting - immediate for first call, debounced for subsequent
      if (now - lastProcessTime < MIN_PROCESS_INTERVAL) {
        // Debounce subsequent calls
        debounceTimeout = setTimeout(() => {
          processUpdate(snapshot);
        }, 500);
        return;
      }

      // Process immediately for first call or after sufficient delay
      processUpdate(snapshot);
    });

    // Store listener for cleanup
    this.listeners.set('machines', { ref: machinesRef, listener });

    return () => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      off(machinesRef, listener);
      this.listeners.delete('machines');
    };
  }

  // Identify expired timers without processing
  identifyExpiredTimers(data, currentTime) {
    const EXPIRATION_THRESHOLD = 30000; // 30 seconds
    const expiredTimers = [];

    for (const [machineId, machine] of Object.entries(data)) {
      if (machine.status === 'active' && machine.end_time - currentTime <= EXPIRATION_THRESHOLD) {
        expiredTimers.push({ machineId, endTime: machine.end_time });
      }
    }

    return expiredTimers;
  }

  // Process machine data for UI (pure function)
  processMachineData(data, currentTime) {
    const allMachineIds = [
      'washer_1',
      'washer_2',
      'washer_3',
      'washer_4',
      'dryer_1',
      'dryer_2',
      'dryer_3',
      'dryer_4',
    ];

    return allMachineIds.map((machineId) => {
      const machine = data[machineId];

      if (!machine) {
        return {
          machine_id: machineId,
          status: 'available',
          time_remaining_minutes: 0,
        };
      }

      if (machine.status === 'paused') {
        return {
          machine_id: machineId,
          status: 'paused',
          time_remaining_minutes: machine.paused_time_remaining || 0,
          paused_at: machine.paused_at,
        };
      }

      const timeRemainingMs = machine.end_time - currentTime;
      const timeRemainingMinutes = Math.max(0, Math.ceil(timeRemainingMs / (1000 * 60)));

      // Client handles expiration, server data is advisory
      const shouldBeAvailable = timeRemainingMs <= 30000; // 30 seconds buffer

      return {
        machine_id: machineId,
        status: shouldBeAvailable ? 'available' : 'active',
        time_remaining_minutes: shouldBeAvailable ? 0 : timeRemainingMinutes,
        server_end_time: machine.end_time, // Pass server timestamp for client sync
      };
    });
  }

  // Batch cleanup with controlled concurrency
  async batchCleanupExpiredTimers(expiredTimers) {
    if (expiredTimers.length === 0) return;

    // Limit concurrent cleanups to prevent Firebase overload
    const BATCH_SIZE = 2;
    const batches = [];

    for (let i = 0; i < expiredTimers.length; i += BATCH_SIZE) {
      batches.push(expiredTimers.slice(i, i + BATCH_SIZE));
    }

    // Process batches sequentially
    for (const batch of batches) {
      const batchPromises = batch.map((timer) =>
        this.atomicExpireTimer(timer.machineId, timer.endTime).catch((error) => ({
          error,
          machineId: timer.machineId,
        }))
      );

      const results = await Promise.allSettled(batchPromises);

      // Log batch results
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('Batch cleanup failed:', result.reason);
        }
      });

      // Small delay between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  async atomicExpireTimer(machineId, expectedEndTime) {
    const machineRef = ref(this.database, `machines/${machineId}`);

    try {
      // Circuit breaker for Firebase operations
      const result = await this.executeWithCircuitBreaker(() => {
        return runTransaction(machineRef, (currentData) => {
          // Verify timer hasn't changed since we started
          if (!currentData) {
            return undefined; // Already expired - abort transaction
          }

          // Verify expected end time (prevent race conditions)
          if (expectedEndTime && currentData.end_time !== expectedEndTime) {
            return undefined; // Timer changed - abort transaction
          }

          // Additional safety: check if timer is actually expired
          const timeRemaining = currentData.end_time - Date.now();
          if (timeRemaining > 30000) {
            return undefined; // Timer still has time - abort transaction
          }

          // Atomic removal - this guarantees consistency
          return null;
        });
      });

      if (result.committed) {
        return { success: true, machineId, reason: 'atomic_expiration' };
      } else {
        return { success: false, machineId, reason: 'timer_modified_or_expired' };
      }
    } catch (error) {
      // Non-blocking error handling
      console.warn(`Timer expiration failed for ${machineId}:`, error.message);
      return { success: false, machineId, reason: 'operation_failed', error: error.message };
    }
  }

  // Circuit breaker for Firebase operations
  async executeWithCircuitBreaker(operation, maxRetries = 2) {
    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        return await operation();
      } catch (error) {
        attempts++;

        if (attempts >= maxRetries) {
          throw error;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempts) * 100;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  cleanup() {
    // Remove all listeners
    for (const { ref: listenerRef, listener } of this.listeners.values()) {
      off(listenerRef, listener);
    }
    this.listeners.clear();
  }

  // Health check for Firebase connection
  async performHealthCheck() {
    try {
      const testRef = ref(this.database, '.info/connected');
      const snapshot = await get(testRef);
      return { connected: snapshot.val() === true, timestamp: Date.now() };
    } catch (error) {
      return { connected: false, error: error.message, timestamp: Date.now() };
    }
  }

  // Get Firebase performance metrics
  getPerformanceMetrics() {
    return {
      activeListeners: this.listeners.size,
      timestamp: Date.now(),
    };
  }

  // No complex sync - just let TimerManager handle it
  syncTimers(machines) {
    if (window.TimerManager) {
      window.TimerManager.updateAllMachines(machines);
    }
  }

  // Expose Firebase functions for debugging
  getFirebaseFunctions() {
    return { ref, get, set, remove };
  }
}

// Export for module usage
export default FirebaseService;
